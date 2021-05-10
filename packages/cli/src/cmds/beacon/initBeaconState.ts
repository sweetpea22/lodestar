import {AbortSignal} from "abort-controller";

import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {allForks} from "@chainsafe/lodestar-types";
import {
  IBeaconDb,
  Eth1Provider,
  IBeaconNodeOptions,
  initStateFromAnchorState,
  initStateFromDb,
  initStateFromEth1,
} from "@chainsafe/lodestar";
import {downloadOrLoadFile} from "../../util";
import {IBeaconArgs} from "./options";
import {defaultNetwork, IGlobalArgs} from "../../options/globalOptions";
import {getGenesisFileUrl} from "../../networks";
import {praterWeakSubjectivityState, mainnetWeakSubjectivityState} from "../weakSubjectivityState";

async function initAndVerifyWeakSujectivityState(
  args: IBeaconArgs & IGlobalArgs,
  weakSubjectivityState: {
    stateRoot: string;
    ipfsPath: string;
  },
  initFunc: (pathOrUrl: string) => Promise<TreeBacked<allForks.BeaconState>>
): Promise<TreeBacked<allForks.BeaconState>> {
  const state = await initFunc(args.ipfsGatewayUrl + weakSubjectivityState.ipfsPath);
  if (!state) {
    throw new Error("Weak subjectivity state not found for network " + args.network);
  }
  // verify downloaded state against locally stored state root
  if (toHexString(state.hashTreeRoot()) !== weakSubjectivityState.stateRoot) {
    throw new Error("Unable to verify state root downloaded from IPFS");
  }
  return state;
}

/**
 * Initialize a beacon state, picking the strategy based on the `IBeaconArgs`
 *
 * State is initialized in one of three ways:
 * 1. restore from a file (possibly downloaded via URL)
 * 2. restore from db
 * 3. create from eth1
 */
export async function initBeaconState(
  options: IBeaconNodeOptions,
  args: IBeaconArgs & IGlobalArgs,
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  signal: AbortSignal
): Promise<TreeBacked<allForks.BeaconState>> {
  async function initFromFile(pathOrUrl: string): Promise<TreeBacked<allForks.BeaconState>> {
    const anchorState = config.types.phase0.BeaconState.createTreeBackedFromBytes(await downloadOrLoadFile(pathOrUrl));
    return await initStateFromAnchorState(config, db, logger, anchorState as TreeBacked<allForks.BeaconState>);
  }

  const dbHasSomeState = (await db.stateArchive.lastKey()) != null;

  if (args.weakSubjectivityStateFile) {
    return await initFromFile(args.weakSubjectivityStateFile);
  } else if (dbHasSomeState) {
    return await initStateFromDb(config, db, logger);
  } else if (args.fetchWeakSubjectivityStateFromIPFS) {
    if (args.network === "prater") {
      return await initAndVerifyWeakSujectivityState(args, praterWeakSubjectivityState, initFromFile);
    } else if (args.network === "mainnet") {
      return await initAndVerifyWeakSujectivityState(args, mainnetWeakSubjectivityState, initFromFile);
    } else {
      throw new Error("No matching network with weak subjectivity state.");
    }
  } else {
    const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
    if (genesisStateFile && !args.forceGenesis) {
      return await initFromFile(genesisStateFile);
    } else {
      return await initStateFromEth1(config, db, logger, new Eth1Provider(config, options.eth1), signal);
    }
  }
}
