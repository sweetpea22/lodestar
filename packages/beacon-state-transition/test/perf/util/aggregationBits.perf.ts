import {MAX_VALIDATORS_PER_COMMITTEE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {itBench, setBenchOpts} from "@chainsafe/lodestar-utils/test_utils/benchmark/mochaPlugin";
import {List, readonlyValues} from "@chainsafe/ssz";
import {zipIndexesCommitteeBits} from "../../../src";

describe("aggregationBits", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 512,
  });

  const aggregationBits = Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => true);
  const indexes = Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => 165432);
  const bitlistTree = ssz.phase0.CommitteeBits.createTreeBackedFromStruct(aggregationBits as List<boolean>);

  itBench("readonlyValues", () => {
    Array.from(readonlyValues(bitlistTree));
  });

  itBench("zipIndexesInBitList", () => {
    zipIndexesCommitteeBits(indexes, bitlistTree);
  });
});
