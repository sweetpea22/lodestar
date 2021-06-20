import {runBenchmarkAction} from "./index";

// Lightwiegth CLI wrapper for CI runs

const threshold = process.env.THRESHOLD ? parseInt(process.env.THRESHOLD) : undefined;
const githubToken = process.env.GITHUB_TOKEN;
const benchmarkResultsPath = process.env.BENCHMARK_RESULTS_PATH;
const benchmarkHistoryPath = process.env.BENCHMARK_HISTORY_PATH;

if (!githubToken) throw Error("Must set ENV GITHUB_TOKEN");
if (!benchmarkResultsPath) throw Error("Must set ENV BENCHMARK_RESULTS_PATH");
if (!benchmarkHistoryPath) throw Error("Must set ENV BENCHMARK_HISTORY_PATH");

runBenchmarkAction({
  threshold,
  githubToken,
  benchmarkResultsPath,
  benchmarkHistoryPath,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
