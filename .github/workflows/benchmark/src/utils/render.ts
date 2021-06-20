import {BenchComparision} from "../types";

export function renderComment(
  allResultsComp: BenchComparision[],
  badResultsComp: BenchComparision[],
  commitsSha: {curr: string; prev: string},
  threshold: number
): string {
  const topSection =
    badResultsComp.length > 0
      ? // If there was any bad benchmark print a table only with the bad results
        `# :warning: **Performance Alert** :warning:

Possible performance regression was detected for some benchmarks.
Benchmark result of this commit is worse than the previous benchmark result exceeding threshold \`${threshold}\`.
  
${renderBenchmarkTable(commitsSha, badResultsComp)}
`
      : // Otherwise, just add a title
        "# Performance Report";

  // For all cases attach the full benchmarks
  return `${topSection}

<details>

${renderBenchmarkTable(commitsSha, allResultsComp)}

</details>
`;
}

function renderBenchmarkTable(commitsSha: {curr: string; prev: string}, resultsComp: BenchComparision[]) {
  function toRow(arr: (number | string)[]): string {
    const row = arr.map((e) => `\`${e}\``).join(" | ");
    return `| ${row} |`;
  }

  const rows = resultsComp.map((result) => {
    const {id, prevAverageNs, currAverageNs, ratio} = result;

    if (prevAverageNs != undefined && ratio != undefined) {
      return toRow([id, prettyTimeStr(currAverageNs), prettyTimeStr(prevAverageNs), ratio.toFixed(2)]);
    } else {
      return toRow([id, prettyTimeStr(currAverageNs)]);
    }
  });

  return `| Benchmark suite | Previous: ${commitsSha.prev} | Current: ${commitsSha.curr} | Ratio |
|-|-|-|-|
${rows.join("\n")}
`;
}

function prettyTimeStr(nanoSec: number) {
  const [value, unit] = prettyTime(nanoSec);
  return `${value.toPrecision(5)} ${unit}`;
}

function prettyTime(nanoSec: number): [number, string] {
  if (nanoSec > 1e9) return [nanoSec / 1e9, " s"];
  if (nanoSec > 1e6) return [nanoSec / 1e6, "ms"];
  if (nanoSec > 1e3) return [nanoSec / 1e3, "us"];
  return [nanoSec, "ns"];
}
