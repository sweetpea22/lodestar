import {allForks, phase0} from "@chainsafe/lodestar-types";
import {processAttesterSlashingAllForks} from "../../phase0/block/processAttesterSlashing";
import {CachedBeaconState} from "../../allForks/util";
import {ForkName} from "@chainsafe/lodestar-params";

export function processAttesterSlashing(
  state: CachedBeaconState<allForks.BeaconState>,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(ForkName.altair, state, attesterSlashing, verifySignatures);
}
