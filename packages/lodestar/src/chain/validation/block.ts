import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain, IBlockJob} from "..";
import {IBeaconDb} from "../../db";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {BlockError, BlockErrorCode} from "../errors";

export async function validateGossipBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  blockJob: IBlockJob
): Promise<void> {
  const block = blockJob.signedBlock;
  const blockSlot = block.message.slot;
  const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
  const finalizedCheckpoint = chain.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  // block is too old
  if (blockSlot <= finalizedSlot) {
    throw new BlockError(block, {code: BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT, blockSlot, finalizedSlot});
  }

  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < blockSlot) {
    throw new BlockError(block, {
      code: BlockErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot,
    });
  }

  if (await db.badBlock.has(blockRoot)) {
    throw new BlockError(block, {code: BlockErrorCode.KNOWN_BAD_BLOCK});
  }

  const existingBlock = await db.block.get(blockRoot);
  if (existingBlock?.message.proposerIndex === block.message.proposerIndex) {
    throw new BlockError(block, {code: BlockErrorCode.REPEAT_PROPOSAL, proposer: block.message.proposerIndex});
  }

  let blockState;
  try {
    // getBlockSlotState also checks for whether the current finalized checkpoint is an ancestor of the block.  as a result, we throw an IGNORE (whereas the spec says we should REJECT for this scenario).  this is something we should change this in the future to make the code airtight to the spec.
    blockState = await chain.regen.getBlockSlotState(block.message.parentRoot, block.message.slot);
  } catch (e) {
    throw new BlockError(block, {
      code: BlockErrorCode.PARENT_UNKNOWN,
      parentRoot: block.message.parentRoot.valueOf() as Uint8Array,
    });
  }

  const signatureSet = allForks.getProposerSignatureSet(blockState, block);
  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new BlockError(block, {code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID});
  }

  try {
    const validProposer = isExpectedProposer(blockState.epochCtx, block.message);
    if (!validProposer) {
      throw Error("INCORRECT_PROPOSER");
    }
  } catch (error) {
    throw new BlockError(block, {
      code: BlockErrorCode.INCORRECT_PROPOSER,
      blockProposer: block.message.proposerIndex,
    });
  }
}

export function isExpectedProposer(epochCtx: allForks.EpochContext, block: allForks.BeaconBlock): boolean {
  const supposedProposerIndex = epochCtx.getBeaconProposer(block.slot);
  return supposedProposerIndex === block.proposerIndex;
}
