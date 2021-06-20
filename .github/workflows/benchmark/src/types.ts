import * as github from "@actions/github";

/** Helper type to pass common arguments at once */
export type Context = {
  octokit: ReturnType<typeof github.getOctokit>;
  repo: Required<typeof github.context.payload>["repository"];
  refStr: string;
  threshold: number;
  benchmarkHistoryPath: string;
};

export type BenchmarkResults = BenchmarkResult[];

/** Time results for a single benchmark item */
export type BenchmarkResult = {
  id: string;
  averageNs: number;
  runsDone: number;
  totalMs: number;
  factor?: number;
};

/** Time results for a single benchmark (all items) */
export type Benchmark = {
  commitSha: string;
  timestamp: number;
  results: BenchmarkResults;
};

/** All benchmarks organized by branch */
export type BenchmarkHistory = {
  benchmarks: {
    [branch: string]: Benchmark[];
  };
};

export type BenchComparision = {
  id: string;
  currAverageNs: number;
  prevAverageNs: number | null;
  ratio: number | null;
};

/** Github API type */
type GitHubUser = {
  email?: string;
  name: string;
  username: string;
};

/** Github API type */
type Commit = {
  author: GitHubUser;
  committer: GitHubUser;
  distinct?: unknown; // Unused
  id: string;
  message: string;
  timestamp: string;
  tree_id?: unknown; // Unused
  url: string;
};
