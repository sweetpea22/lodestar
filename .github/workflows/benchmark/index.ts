import github from "@actions/github";
import {getGithubEventData, GithubActionsEventData} from "./utils/gaContext";
import {parseRef} from "./utils/gitRef";
import {Benchmark, BenchmarkHistory, BenchComparision, Context} from "./types";
import {commentToCommit, commetToPrUpdatable, getIsDefaultBranch} from "./utils/octokit";
import {renderComment} from "./utils/render";
import {getCurrentCommitInfo} from "./utils/git";
import {readBenchmarkHistory, readBenchmarkResults, writeBenchmarkResults} from "./utils/benchmarkFiles";

/**
 * 1. Read benchmark results from disk
 * 2. Read benchmark history from cache (disk)
 * 3. From git history figure out the target commit to compare with
 *    - If push on main branch, compare with previous commit
 *    - If pull request, compare with base commit
 * 4. Persist new results, one result per branch except main branch, up to some number
 * 5. Publish comment in PR if any alerts are found, exit with error too
 *
 * Trigger logic:
 * - On branches with a PR, compare benchmark against latest commit available of base branch
 * - On main branch, compare against previous commit
 *
 * ```yaml
 * // Trigger on push to branches, not tags
 * on:
 *   pull_request:
 *   push:
 *     branches:
 *       - master
 *
 *       - uses: actions/checkout@v2
 *         with:
 *           # Must get the entire git history
 *           fetch-depth: 0
 *           # Do not checkout merge commit
 *           ref: ${{ github.event.pull_request.head.sha }}
 * ```
 */
export async function runBenchmarkAction(inputs: {
  threshold?: number;
  githubToken: string;
  benchmarkResultsPath: string;
  benchmarkHistoryPath: string;
}) {
  const {threshold = 2, githubToken, benchmarkResultsPath, benchmarkHistoryPath} = inputs;

  const eventName = github.context.eventName;
  const refStr = github.context.ref;
  const repo = github.context.payload.repository;
  const octokit = github.getOctokit(githubToken);

  if (!eventName) throw Error("Empty github.context.eventName");
  if (!refStr) throw Error("Empty github.context.ref");
  if (!repo) throw Error("Empty github.context.payload.repository");

  const context: Context = {octokit, repo, refStr, threshold, benchmarkHistoryPath};

  // Read JSON file with benchmark results (+ validate)
  const currResults = readBenchmarkResults(benchmarkResultsPath);
  console.log(`Read benchmark results from ${benchmarkResultsPath}`);

  // Attach current commit data to results
  const currentCommit = await getCurrentCommitInfo();
  const currBench: Benchmark = {
    commitSha: currentCommit.sha,
    timestamp: currentCommit.timestamp,
    results: currResults,
  };

  // Load previous benchmark history results (+ validate)
  const benchHistory = readBenchmarkHistory(benchmarkHistoryPath);
  console.log(`Read benchmark history from ${benchmarkHistoryPath}`);

  if (eventName === "pull_request") {
    await onPullRequestEvent(context, benchHistory, currBench);
  } else if (eventName === "push") {
    await onPushEvent(context, benchHistory, currBench);
  } else {
    throw Error(`event not supported ${eventName}`);
  }
}

/**
 * On `pull_request` event:
 * 1. Read event data to get PR number + base branch
 * 2. Get the latest bench in the base branch
 * 3. Always post a comment with results + alert
 */
async function onPullRequestEvent(context: Context, benchHistory: BenchmarkHistory, currBench: Benchmark) {
  const {threshold} = context;
  const eventData = getGithubEventData<GithubActionsEventData["pull_request"]>();

  const prNumber = eventData.number;
  const headCommitSha = eventData.pull_request.head.sha;
  // TODO: parse ref to be `/refs/heads/$branch`
  const baseBranch = eventData.pull_request.base.ref;

  // Ensure it's not running on a merge commit, but the head branch commit
  // See: https://github.com/actions/checkout#checkout-pull-request-head-commit-instead-of-merge-commit
  if (currBench.commitSha !== headCommitSha) {
    throw Error(
      `pull_request event current commit sha ${currBench.commitSha} doesn't match head branch sha ${headCommitSha}`
    );
  }

  // On PR fetch the latest commit from the base branch with an available benchmark
  const baseBranchBenches = benchHistory.benchmarks[baseBranch] || [];
  const prevBench = baseBranchBenches[baseBranchBenches.length - 1];
  if (!prevBench) {
    throw Error(`No benchmark available in base branch ${baseBranch}`);
  }

  const allResultsComp = computeBenchComparision(currBench, prevBench);
  const badResultsComp = allResultsComp.filter((r) => r.ratio !== null && r.ratio > threshold);
  const commitsSha = {curr: currBench.commitSha, prev: prevBench.commitSha};

  // Build a comment to publish to a PR
  const commentBody = renderComment(allResultsComp, badResultsComp, commitsSha, threshold);
  await commetToPrUpdatable(context, prNumber, commentBody);

  // Note: For PRs do not persist the bench data

  if (badResultsComp.length > 0) {
    throw Error(`Benchmark performance alert: \n\n${commentBody}`);
  }
}

/**
 * On `push` event:
 * 1. Throw if not on default branch
 * 2. Persist benchmark data
 * 3. Get previous commit bench
 * 4. Only on regression post an alert comment
 */
async function onPushEvent(context: Context, benchHistory: BenchmarkHistory, currBench: Benchmark) {
  const {threshold, refStr} = context;
  const ref = parseRef(refStr);
  if (ref.type !== "branch") {
    throw Error(`Must only run on push event for branches: ${ref.type}`);
  }

  const defaultBranch = await getIsDefaultBranch(context);
  if (ref.branch !== defaultBranch) {
    throw Error(`Must not run on push event for non-default branch: ${ref.branch}`);
  }

  // Persist benchmark data
  writeBenchmarkEntry(context, benchHistory, currBench, defaultBranch);

  // Fetch the previous commit
  const eventData = getGithubEventData<GithubActionsEventData["push"]>();
  const baseBranchBenches = benchHistory.benchmarks[defaultBranch] || [];

  const prevBench = baseBranchBenches.find((b) => b.commitSha === eventData.before);
  if (!prevBench) {
    if (baseBranchBenches.length > 0) {
      throw Error(`Previous commit not found ${eventData.before}. You must run this action with concurrency of 1`);
    } else {
      // Store the result and stop.
      // The first time this benchmark is ran, there won't be any prev results.
      return;
    }
  }

  const allResultsComp = computeBenchComparision(currBench, prevBench);
  const badResultsComp = allResultsComp.filter((r) => r.ratio !== null && r.ratio > threshold);

  // Only comment on performance regression
  if (badResultsComp.length > 0) {
    const commitsSha = {curr: currBench.commitSha, prev: prevBench.commitSha};
    const commentBody = renderComment(allResultsComp, badResultsComp, commitsSha, threshold);
    await commentToCommit(context, github.context.sha, commentBody);

    throw Error(`Benchmark performance alert: \n\n${commentBody}`);
  }
}

function writeBenchmarkEntry(context: Context, history: BenchmarkHistory, newBench: Benchmark, branch: string): void {
  if (history.benchmarks[branch] === undefined) {
    history.benchmarks[branch] = [];
  }

  // Ensure there are no duplicates for the same commit
  history.benchmarks[branch] = history.benchmarks[branch].filter((bench) => {
    if (bench.commitSha === newBench.commitSha) {
      console.log("Deleting previous benchmark for the same commit");
      return false;
    } else {
      return true;
    }
  });

  history.benchmarks[branch].push(newBench);

  writeBenchmarkResults(context.benchmarkHistoryPath, history);
}

function computeBenchComparision(currBench: Benchmark, prevBench: Benchmark | null): BenchComparision[] {
  const prevBenches = new Map(prevBench.results.map((b) => [b.id, b]));

  return currBench.results.map((currBench) => {
    const {id} = currBench;
    const prevBench = prevBenches.get(id);

    if (prevBench) {
      return {
        id,
        currAverageNs: currBench.averageNs,
        prevAverageNs: prevBench.averageNs,
        ratio: currBench.averageNs / prevBench.averageNs,
      };
    } else {
      return {
        id,
        currAverageNs: currBench.averageNs,
        prevAverageNs: null,
        ratio: null,
      };
    }
  });
}
