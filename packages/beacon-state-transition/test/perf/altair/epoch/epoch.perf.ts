import {init} from "@chainsafe/bls";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {allForks, altair} from "../../../../src";
import {generatePerfTestCachedStateAltair} from "../../util";

export async function runAltairEpochTransitionStepTests(): Promise<void> {
  const runner = new BenchmarkRunner("Altair epoch transition steps", {
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });

  await init("blst-native");

  const originalState = generatePerfTestCachedStateAltair({goBackOneSlot: true});
  const process = allForks.prepareEpochProcessState(originalState);

  await runner.run({
    id: "processJustificationAndFinalization",
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => altair.processJustificationAndFinalization(state, process),
  });

  const mutatedState = originalState.clone();
  altair.processJustificationAndFinalization(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  await runner.run({
    id: "processInactivityUpdates",
    beforeEach: () => mutatedState.clone(),
    run: (state) => altair.processInactivityUpdates(state, process),
  });

  altair.processInactivityUpdates(mutatedState, process);

  await runner.run({
    id: "processRewardsAndPenalties",
    beforeEach: () => mutatedState.clone(),
    run: (state) => altair.processRewardsAndPenalties(state, process),
  });

  altair.processRewardsAndPenalties(mutatedState, process);

  await runner.run({
    id: "processRegistryUpdates",
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => altair.processRegistryUpdates(state, process),
  });

  altair.processRegistryUpdates(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  await runner.run({
    id: "processSlashings",
    beforeEach: () => mutatedState.clone(),
    run: (state) => altair.processSlashings(state, process),
  });

  altair.processSlashings(mutatedState, process);

  await runner.run({
    id: "processEth1DataReset",
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => allForks.processEth1DataReset(state, process),
  });

  allForks.processEth1DataReset(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  await runner.run({
    id: "processEffectiveBalanceUpdates",
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => allForks.processEffectiveBalanceUpdates(state, process),
  });

  allForks.processEffectiveBalanceUpdates(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  await runner.run({
    id: "processSlashingsReset",
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => allForks.processSlashingsReset(state, process),
  });

  allForks.processSlashingsReset(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  await runner.run({
    id: "processRandaoMixesReset",
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => allForks.processRandaoMixesReset(state, process),
  });

  allForks.processRandaoMixesReset(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  await runner.run({
    id: "processHistoricalRootsUpdate",
    beforeEach: () => mutatedState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => allForks.processHistoricalRootsUpdate(state, process),
  });

  allForks.processHistoricalRootsUpdate(mutatedState as allForks.CachedBeaconState<allForks.BeaconState>, process);

  await runner.run({
    id: "processParticipationFlagUpdates",
    beforeEach: () => mutatedState.clone(),
    run: (state) => altair.processParticipationFlagUpdates(state),
  });

  altair.processParticipationFlagUpdates(mutatedState);

  await runner.run({
    id: "processSyncCommitteeUpdates",
    beforeEach: () => mutatedState.clone(),
    run: (state) => altair.processSyncCommitteeUpdates(state, process),
  });

  // do prepareEpochProcessState last
  await runner.run({
    id: "prepareEpochProcessState",
    beforeEach: () => originalState.clone() as allForks.CachedBeaconState<allForks.BeaconState>,
    run: (state) => allForks.prepareEpochProcessState(state),
  });

  runner.done();
}
