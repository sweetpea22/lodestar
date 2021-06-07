import {allForks, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";

import {isSlashableValidator, isSlashableAttestationData} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {isValidIndexedAttestation} from "../../allForks/block";
import {slashValidator} from "./slashValidator";

export function processAttesterSlashing(
  state: CachedBeaconState<phase0.BeaconState>,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  assertValidAttesterSlashing(state as CachedBeaconState<allForks.BeaconState>, attesterSlashing, verifySignatures);

  let slashedAny = false;
  const attSet1 = new Set(attesterSlashing.attestation1.attestingIndices);
  const attSet2 = new Set(attesterSlashing.attestation2.attestingIndices);
  const indices: ValidatorIndex[] = [];
  for (const i of attSet1.values()) {
    if (attSet2.has(i)) {
      indices.push(i);
    }
  }
  const validators = state.validators;
  for (const index of indices.sort((a, b) => a - b)) {
    if (isSlashableValidator(validators[index], state.epochCtx.currentShuffling.epoch)) {
      slashValidator(state, index);
      slashedAny = true;
    }
  }
  if (!slashedAny) {
    throw new Error("AttesterSlashing did not result in any slashings");
  }
}

export function assertValidAttesterSlashing(
  state: CachedBeaconState<allForks.BeaconState>,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  const attestation1 = attesterSlashing.attestation1;
  const attestation2 = attesterSlashing.attestation2;

  if (!isSlashableAttestationData(attestation1.data, attestation2.data)) {
    throw new Error("AttesterSlashing is not slashable");
  }
  if (!isValidIndexedAttestation(state, attestation1, verifySignatures)) {
    throw new Error("AttesterSlashing attestation1 is not a valid IndexedAttestation");
  }
  if (!isValidIndexedAttestation(state, attestation2, verifySignatures)) {
    throw new Error("AttesterSlashing attestation2 is not a valid IndexedAttestation");
  }
}
