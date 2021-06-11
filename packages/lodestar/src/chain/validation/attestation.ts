import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ssz} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, zipIndexesCommitteeBits} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconDb} from "../../db";
import {IAttestationJob, IBeaconChain} from "..";
import {AttestationError, AttestationErrorCode} from "../errors";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";

export async function validateGossipAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  attestationJob: IAttestationJob,
  subnet: number
): Promise<phase0.IndexedAttestation> {
  // Do checks in this order:
  // - do early checks (w/o indexed attestation)
  // - > obtain indexed attestation and committes per slot
  // - do middle checks w/ indexed attestation
  // - > verify signature
  // - do late checks w/ a valid signature

  // verify_early_checks
  // Run the checks that happen before an indexed attestation is constructed.
  const attestation = attestationJob.attestation;
  const attestationData = attestation.data;
  const attestationSlot = attestationData.slot;

  // Check the attestation's epoch matches its target.
  // [REJECT] The attestation's epoch matches its target -- i.e. attestation.data.target.epoch == compute_epoch_at_slot(attestation.data.slot)
  if (!ssz.Epoch.equals(attestationData.target.epoch, computeEpochAtSlot(attestationSlot))) {
    throw new AttestationError({
      code: AttestationErrorCode.BAD_TARGET_EPOCH,
      job: attestationJob,
    });
  }

  // Ensure attestation is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (within a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance).
  //
  // TODO (LH): Do not queue future attestations for later processing. Investigate why LH doesn't do it
  // TODO: use MAXIMUM_GOSSIP_CLOCK_DISPARITY to compute the clock.currentSlot

  // [IGNORE] attestation.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (within a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  //  -- i.e. attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= current_slot >= attestation.data.slot
  // (a client MAY queue future attestations for processing at the appropriate slot).
  const latestPermissibleSlot = chain.clock.currentSlot;
  const earliestPermissibleSlot = Math.max(chain.clock.currentSlot - ATTESTATION_PROPAGATION_SLOT_RANGE, 0);
  if (attestationSlot < earliestPermissibleSlot) {
    throw new AttestationError({
      code: AttestationErrorCode.PAST_SLOT,
      earliestPermissibleSlot,
      attestationSlot,
      job: attestationJob,
    });
  }
  if (attestationSlot > latestPermissibleSlot) {
    throw new AttestationError({
      code: AttestationErrorCode.FUTURE_SLOT,
      latestPermissibleSlot,
      attestationSlot,
      job: attestationJob,
    });
  }

  // Attestations must be for a known block. If the block is unknown, we simply drop the
  // attestation and do not delay consideration for later.
  //
  // TODO (LH): Enforce a maximum skip distance for unaggregated attestations.

  // [IGNORE] The block being voted for (attestation.data.beacon_block_root) has been seen (via both gossip
  // and non-gossip sources) (a client MAY queue attestations for processing once block is retrieved).
  const beaconBlockRoot = attestationData.beaconBlockRoot;
  if (!chain.forkChoice.hasBlock(beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: beaconBlockRoot as Uint8Array,
      job: attestationJob,
    });
  }

  // [REJECT] The block being voted for (attestation.data.beacon_block_root) passes validation.
  // > Altready check in `chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)`

  // [REJECT] The attestation's target block is an ancestor of the block named in the LMD vote
  //  --i.e. get_ancestor(store, attestation.data.beacon_block_root, compute_start_slot_at_epoch(attestation.data.target.epoch)) == attestation.data.target.root
  // TODO: Lighthouse has an optimization here with `verify_attestation_target_root()`
  if (!chain.forkChoice.isDescendant(attestation.data.target.root, attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK,
      job: attestationJob,
    });
  }

  // [REJECT] The current finalized_checkpoint is an ancestor of the block defined by attestation.data.beacon_block_root
  // -- i.e. get_ancestor(store, attestation.data.beacon_block_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
  // > Altready check in `chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)`

  // TODO: Is necessary?
  if (!chain.forkChoice.isDescendantOfFinalized(attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT,
      job: attestationJob,
    });
  }

  const attestationTargetState = await chain.regen.getCheckpointState(attestationData.target).catch((e) => {
    throw new AttestationError({
      code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE,
      error: e as Error,
      job: attestationJob,
    });
  });

  const attestationIndex = attestationData.index;
  // TODO: try / catch and rethrow, wrong committe
  const committeeIndices = attestationTargetState.getBeaconCommittee(attestationSlot, attestationIndex);
  const attestingIndices = zipIndexesCommitteeBits(committeeIndices, attestation.aggregationBits);
  const indexedAttestation = attestationTargetState.getIndexedAttestation(attestation);

  // [REJECT] The attestation is unaggregated -- that is, it has exactly one participating validator
  // (len([bit for bit in attestation.aggregation_bits if bit]) == 1, i.e. exactly 1 bit is set).
  // > TODO: Do this check **before** getting the target state but don't recompute zipIndexes
  if (indexedAttestation.attestingIndices.length !== 1) {
    throw new AttestationError({
      code: AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET,
      numBits: indexedAttestation.attestingIndices.length,
      job: attestationJob,
    });
  }

  // [REJECT] The committee index is within the expected range
  // -- i.e. data.index < get_committee_count_per_slot(state, data.target.epoch)
  // > TODO: Altready verified in `getIndexedAttestation()`?

  // [REJECT] The number of aggregation bits matches the committee size
  // -- i.e. len(attestation.aggregation_bits) == len(get_beacon_committee(state, data.slot, data.index)).
  // > TODO: Altready verified in `getIndexedAttestation()`?

  // LH > verify_middle_checks
  // Run the checks that apply to the indexed attestation before the signature is checked.
  //   Check correct subnet
  //   The attestation is the first valid attestation received for the participating validator for the slot, attestation.data.slot.

  // [REJECT] The attestation is for the correct subnet
  // -- i.e. compute_subnet_for_attestation(committees_per_slot, attestation.data.slot, attestation.data.index) == subnet_id,
  // where committees_per_slot = get_committee_count_per_slot(state, attestation.data.target.epoch),
  // which may be pre-computed along with the committee information for the signature check.
  const expectedSubnet = allForks.computeSubnetForAttestation(attestationTargetState, attestation);
  if (subnet !== expectedSubnet) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_SUBNET_ID,
      received: subnet,
      expected: expectedSubnet,
      job: attestationJob,
    });
  }

  // [IGNORE] There has been no other valid attestation seen on an attestation subnet that has an
  // identical attestation.data.target.epoch and participating validator index.
  if (db.seenAttestationCache.hasCommitteeAttestation(attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN,
      root: ssz.phase0.Attestation.hashTreeRoot(attestation),
      job: attestationJob,
    });
  }

  // [REJECT] The signature of attestation is valid.
  if (!attestationJob.validSignature) {
    const signatureSet = allForks.getIndexedAttestationSignatureSet(attestationTargetState, indexedAttestation);
    if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
      throw new AttestationError({
        code: AttestationErrorCode.INVALID_SIGNATURE,
        job: attestationJob,
      });
    }
  }

  // LH > verify_late_checks
  // Run the checks that apply after the signature has been checked.
  //   Now that the attestation has been fully verified, store that we have received a valid
  //   attestation from this validator.
  //
  //   It's important to double check that the attestation still hasn't been observed, since
  //   there can be a race-condition if we receive two attestations at the same time and
  //   process them in different threads.

  // no other validator attestation for same target epoch has been seen
  if (db.seenAttestationCache.hasCommitteeAttestation(attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN,
      root: ssz.phase0.Attestation.hashTreeRoot(attestation),
      job: attestationJob,
    });
  }

  db.seenAttestationCache.addCommitteeAttestation(attestation);

  return indexedAttestation;
}
