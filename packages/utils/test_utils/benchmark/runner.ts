/* eslint-disable no-console */

export type BenchmarkOpts = {
  runs?: number;
  maxMs?: number;
  minMs?: number;
};

export type BenchmarkRunOpts = BenchmarkOpts & {
  id: string;
};

export type BenchmarkRunOptsWithFn<T> = BenchmarkOpts & {
  id: string;
  fn: (arg: T) => void | Promise<void>;
  beforeEach?: (i: number) => T | Promise<T>;
};

export type BenchmarkResult = {
  id: string;
  averageNs: number;
  runsDone: number;
  totalMs: number;
  factor?: number;
};

export type BenchmarkResultDetail = {
  runsNs: bigint[];
};

export async function doRun<T>(opts: BenchmarkRunOptsWithFn<T>): Promise<{result: BenchmarkResult; runsNs: bigint[]}> {
  const runs = opts.runs || 512;
  const maxMs = opts.maxMs || 2000;
  const minMs = opts.minMs || 100;

  const runsNs: bigint[] = [];

  const startRunMs = Date.now();
  let i = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ellapsedMs = Date.now() - startRunMs;
    // Exceeds time limit, stop
    if (ellapsedMs > maxMs) break;
    // Exceeds target runs + min time
    if (i++ > runs && ellapsedMs > minMs) break;

    const input = opts.beforeEach ? await opts.beforeEach(i) : ((undefined as unknown) as T);

    const startNs = process.hrtime.bigint();
    await opts.fn(input);
    const endNs = process.hrtime.bigint();

    runsNs.push(endNs - startNs);
  }

  const average = averageBigint(runsNs);
  const averageNs = Number(average);

  return {
    result: {id: opts.id, averageNs, runsDone: i - 1, totalMs: Date.now() - startRunMs},
    runsNs,
  };
}

function averageBigint(arr: bigint[]): bigint {
  const total = arr.reduce((total, value) => total + value);
  return total / BigInt(arr.length);
}

export function formatResultRow({id, averageNs, runsDone, factor, totalMs}: BenchmarkResult): string {
  const precision = 7;
  const idLen = 64;

  const opsPerSec = 1e9 / averageNs;

  // ================================================================================================================
  // Scalar multiplication G1 (255-bit, constant-time)                              7219.330 ops/s       138517 ns/op
  // Scalar multiplication G2 (255-bit, constant-time)                              3133.117 ops/s       319171 ns/op

  const [averageTime, timeUnit] = prettyTime(averageNs);
  const row = [
    factor === undefined ? "" : `x${factor.toFixed(2)}`.padStart(6),
    `${opsPerSec.toPrecision(precision).padStart(11)} ops/s`,
    `${averageTime.toPrecision(precision).padStart(11)} ${timeUnit}/op`,
    `${String(runsDone).padStart(10)} runs`,
    `${(totalMs / 1000).toPrecision(3).padStart(6)} s`,
  ].join(" ");

  return id.slice(0, idLen).padEnd(idLen) + " " + row;
}

/**
 * Return results in benckmark.js output format
 * ```
 * fib(10) x 1,431,759 ops/sec ±0.74% (93 runs sampled)
 * ```
 */
function formatAsBenchmarkJs(results: BenchmarkResult[]): string {
  return (
    results
      .map(({id, averageNs, runsDone}) => `${id} x ${1e9 / averageNs} ops/sec ±0.00% (${runsDone} runs sampled)`)
      .join("\n") + "\n"
  );
}

export function formatTitle(title: string): string {
  return `
${title}
${"=".repeat(64)}`;
}

function prettyTime(nanoSec: number): [number, string] {
  if (nanoSec > 1e9) return [nanoSec / 1e9, " s"];
  if (nanoSec > 1e6) return [nanoSec / 1e6, "ms"];
  if (nanoSec > 1e3) return [nanoSec / 1e3, "us"];
  return [nanoSec, "ns"];
}
