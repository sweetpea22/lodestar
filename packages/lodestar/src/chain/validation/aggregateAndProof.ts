import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ssz} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {
  phase0,
  allForks,
  computeEpochAtSlot,
  isAggregatorFromCommitteeLength,
  zipIndexesCommitteeBits,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "..";
import {getSelectionProofSignatureSet, getAggregateAndProofSignatureSet} from "./signatureSets";
import {AttestationError, AttestationErrorCode} from "../errors";
import {getCommitteeIndices, verifyHeadBlockIsKnown, verifyPropagationSlotRange} from "./attestation";

export async function validateGossipAggregateAndProof(
  config: IBeaconConfig,
  chain: IBeaconChain,
  signedAggregateAndProof: phase0.SignedAggregateAndProof
): Promise<phase0.IndexedAttestation> {
  // Do checks in this order:
  // - do early checks (w/o indexed attestation)
  //   - Check the attestation's epoch matches its target
  //   - Ensure attestation is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (within a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance).
  //   - Ensure the valid aggregated attestation has not already been seen locally.
  //   - Ensure there has been no other observed aggregate for the given `aggregator_index`.
  //   - Ensure the block being voted for (attestation.data.beacon_block_root) passes validation.
  //   - Ensure that the attestation has participants.
  // - > obtain indexed attestation and committes per slot
  // - do middle checks w/ indexed attestation
  //   - Is aggregator
  //   - Ensure the aggregator is a member of the committee for which it is aggregating.
  // - > verify signature
  // - do late checks w/ a valid signature
  //   - Observe the valid attestation so we do not re-process it.
  //   - Observe the aggregator so we don't process another aggregate from them.

  const aggregateAndProof = signedAggregateAndProof.message;
  const aggregate = aggregateAndProof.aggregate;
  const attData = aggregate.data;
  const attSlot = attData.slot;
  const attEpoch = computeEpochAtSlot(attSlot);
  const targetEpoch = attData.target.epoch;

  // [REJECT] The attestation's epoch matches its target -- i.e. attestation.data.target.epoch == compute_epoch_at_slot(attestation.data.slot)
  if (!ssz.Epoch.equals(targetEpoch, attEpoch)) {
    throw new AttestationError({code: AttestationErrorCode.BAD_TARGET_EPOCH});
  }

  // [IGNORE] aggregate.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  // -- i.e. aggregate.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= current_slot >= aggregate.data.slot
  // (a client MAY queue future aggregates for processing at the appropriate slot).
  verifyPropagationSlotRange(chain, attSlot);

  // [IGNORE] The aggregate is the first valid aggregate received for the aggregator with
  // index aggregate_and_proof.aggregator_index for the epoch aggregate.data.target.epoch.
  const aggregatorIndex = aggregateAndProof.aggregatorIndex;
  if (chain.seenAggregators.isKnown(targetEpoch, aggregatorIndex)) {
    throw new AttestationError({code: AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN, targetEpoch, aggregatorIndex});
  }

  // [IGNORE] The block being voted for (attestation.data.beacon_block_root) has been seen (via both gossip
  // and non-gossip sources) (a client MAY queue attestations for processing once block is retrieved).
  verifyHeadBlockIsKnown(chain, attData.beaconBlockRoot);

  // [REJECT] The current finalized_checkpoint is an ancestor of the block defined by aggregate.data.beacon_block_root
  // -- i.e. get_ancestor(store, aggregate.data.beacon_block_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
  // > Altready check in `chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)`

  const attestationTargetState = await chain.regen.getCheckpointState(attData.target).catch((e) => {
    throw new AttestationError({code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE, error: e as Error});
  });

  const committeeIndices = getCommitteeIndices(attestationTargetState, attSlot, attData.index);
  const attestingIndices = zipIndexesCommitteeBits(committeeIndices, aggregate.aggregationBits);
  const indexedAttestation: phase0.IndexedAttestation = {
    attestingIndices: attestingIndices as List<number>,
    data: attData,
    signature: aggregate.signature,
  };

  // TODO: Check this before regen
  // [REJECT] The attestation has participants -- that is,
  // len(get_attesting_indices(state, aggregate.data, aggregate.aggregation_bits)) >= 1.
  if (attestingIndices.length < 1) {
    // missing attestation participants
    throw new AttestationError({code: AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS});
  }

  // [REJECT] aggregate_and_proof.selection_proof selects the validator as an aggregator for the slot
  // -- i.e. is_aggregator(state, aggregate.data.slot, aggregate.data.index, aggregate_and_proof.selection_proof) returns True.
  if (!isAggregatorFromCommitteeLength(committeeIndices.length, aggregateAndProof.selectionProof)) {
    throw new AttestationError({code: AttestationErrorCode.INVALID_AGGREGATOR});
  }

  // [REJECT] The aggregator's validator index is within the committee
  // -- i.e. aggregate_and_proof.aggregator_index in get_beacon_committee(state, aggregate.data.slot, aggregate.data.index).
  if (!committeeIndices.includes(aggregateAndProof.aggregatorIndex)) {
    throw new AttestationError({code: AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE});
  }

  // [REJECT] The aggregate_and_proof.selection_proof is a valid signature of the aggregate.data.slot
  // by the validator with index aggregate_and_proof.aggregator_index.
  // [REJECT] The aggregator signature, signed_aggregate_and_proof.signature, is valid.
  // [REJECT] The signature of aggregate is valid.
  const aggregator = attestationTargetState.index2pubkey[aggregateAndProof.aggregatorIndex];
  const signatureSets = [
    getSelectionProofSignatureSet(config, attestationTargetState, attSlot, aggregator, signedAggregateAndProof),
    getAggregateAndProofSignatureSet(config, attestationTargetState, attEpoch, aggregator, signedAggregateAndProof),
    allForks.getIndexedAttestationSignatureSet(attestationTargetState, indexedAttestation),
  ];
  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new AttestationError({code: AttestationErrorCode.INVALID_SIGNATURE});
  }

  if (chain.seenAggregators.isKnown(targetEpoch, aggregatorIndex)) {
    throw new AttestationError({code: AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN, targetEpoch, aggregatorIndex});
  }

  chain.seenAggregators.add(targetEpoch, aggregatorIndex);

  return indexedAttestation;
}
