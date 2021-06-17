import fs from "fs";
import path from "path";
import github from "@actions/github";
import {getGithubContext, getGithubEventData, GithubActionsEventData} from "./utils/gaContext";
import {parseRef} from "./utils/gitRef";

const prCommentTag = "benchmarkbot/tag";

type Context = {
  octokit: ReturnType<typeof github.getOctokit>;
  repo: Required<typeof github.context.payload>["repository"];
  commitSha: string;
};

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
 *       # Must get the entire git history
 *       - uses: actions/checkout@v2
 *         with:
 *           fetch-depth: 0
 * ```
 */
async function runBenchmarkAction(threshold: number) {
  const {eventName, sha: commitSha, ref: refString} = getGithubContext();

  const githubToken = process.env.GITHUB_TOKEN;
  const octokit = github.getOctokit(githubToken);

  const repo = github.context.payload.repository;
  if (!repo) {
    throw Error("Repository information is not available in payload");
  }

  const context: Context = {octokit, repo, commitSha};

  // Read JSON file with benchmark results
  const benchmarkOutputJsonPath = process.env.BENCHMARK_OUTPUT;
  const currBench = readJson<Benchmark>(benchmarkOutputJsonPath);
  console.log(`Read benchmark output from BENCHMARK_OUTPUT ${benchmarkOutputJsonPath}`);

  // TODO: Validate schema of `bench`

  // Load previous benchmark history results
  const benchmarkHistoryPath = process.env.BENCHMARK_HISTORY_PATH;
  const benchkHistory = readJson<BenchmarkHistory>(benchmarkHistoryPath);
  console.log(`Read benchmark history from BENCHMARK_HISTORY_PATH ${benchmarkHistoryPath}`);

  if (eventName === "pull_request") {
    const eventData = getGithubEventData<GithubActionsEventData["pull_request"]>();
    // Ensure it's not a merge commit, but the head branch commit

    const prNumber = eventData.number;
    eventData.pull_request.head.sha;
    // TODO: parse ref to be `/refs/heads/$branch`
    const baseBranch = eventData.pull_request.base.ref;

    // On PR fetch the latest commit from the base branch with an available benchmark
    const baseBranchBenches = benchkHistory.benchmarks[baseBranch] || [];
    const prevBench = baseBranchBenches[baseBranchBenches.length - 1];
    const allResultsComp = computeBenchComparision(currBench, prevBench);
    const badResultsComp = allResultsComp.filter((r) => r.ratio !== null && r.ratio > threshold);
    const commitsSha = {
      curr: currBench.commit.id,
      prev: prevBench.commit.id,
    };

    // Build a comment to publish to a PR
    const commentBody = buildComment(allResultsComp, badResultsComp, commitsSha, threshold);
    await commetToPrUpdatable(context, prNumber, commentBody);

    // Note: For PRs do not persist the bench data
  } else if (eventName === "push") {
    const ref = parseRef(refString);
    if (ref.type !== "branch") {
      throw Error(`Must only run on push event for branches: ${ref.type}`);
    }

    const defaultBranch = await getIsDefaultBranch(context);
    if (ref.branch !== defaultBranch) {
      throw Error(`Must not run on push event for non-default branch: ${ref.branch}`);
    }

    // Persist benchmark data
    // TODO

    // Fetch the previous commit
    const eventData = getGithubEventData<GithubActionsEventData["push"]>();
    const baseBranchBenches = benchkHistory.benchmarks[defaultBranch] || [];

    const prevBench = baseBranchBenches.find((b) => b.commit.id === eventData.before);
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

    if (badResultsComp.length > 0) {
      // Only comment if it should fail
      const commitsSha = {
        curr: currBench.commit.id,
        prev: prevBench.commit.id,
      };
      const commentBody = buildComment(allResultsComp, badResultsComp, commitsSha, threshold);
      commentToCommit(context, github.context.sha, commentBody);

      throw Error(`Benchmark performance alert: \n\n${commentBody}`);
    }
  } else {
    throw Error(`event not supported ${eventName}`);
  }
}

function buildComment(
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

type BenchmarkResult = {
  id: string;
  averageNs: number;
  runsDone: number;
  runsNs: bigint[];
  totalMs: number;
  factor?: number;
};

type GitHubUser = {
  email?: string;
  name: string;
  username: string;
};

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

type Benchmark = {
  commit: Commit;
  date: number;
  results: BenchmarkResult[];
};

type BenchmarkHistory = {
  lastUpdate: number;
  repoUrl: string;
  benchmarks: {
    [branch: string]: Benchmark[];
  };
};

type BenchComparision = {
  id: string;
  currAverageNs: number;
  prevAverageNs: number | null;
  ratio: number | null;
};

function readJson<T>(filepath: string): T {
  const jsonStr = fs.readFileSync(filepath, "utf8");

  let json: T;
  try {
    json = JSON.parse(jsonStr);
  } catch (e) {
    throw Error(`Error parsing JSON ${filepath}: ${e.messge}`);
  }

  // TODO: Validate schema

  return json;
}

async function getIsDefaultBranch(context: Context): Promise<string> {
  const {octokit, repo} = context;
  const thisRepo = await octokit.rest.repos.get({
    owner: repo.owner.login,
    repo: repo.name,
  });
  return thisRepo.data.default_branch;
}

async function commetToPrUpdatable(context: Context, prNumber: number, body: string): Promise<void> {
  const {octokit, repo} = context;

  // Append tag so the comment is findable latter
  const bodyWithTag = `${body}\n\n${prCommentTag}`;

  const comments = await octokit.rest.issues.listComments({
    owner: repo.owner.login,
    repo: repo.name,
    issue_number: prNumber,
  });
  const prevComment = comments.data.find((c) => c.body_text && c.body_text.includes(prCommentTag));

  if (prevComment) {
    // Update
    await octokit.rest.issues.updateComment({
      owner: repo.owner.login,
      repo: repo.name,
      issue_number: prNumber,
      comment_id: prevComment.id,
      body: bodyWithTag,
    });
  } else {
    // Create
    await octokit.rest.issues.createComment({
      owner: repo.owner.login,
      repo: repo.name,
      issue_number: prNumber,
      body: bodyWithTag,
    });
  }
}

async function commentToCommit(context: Context, commitSha: string, body: string): Promise<void> {
  const {octokit, repo} = context;

  await octokit.rest.repos.createCommitComment({
    owner: repo.owner.login,
    repo: repo.name,
    commit_sha: commitSha,
    body,
  });
}

function addBenchmarkToDataJson(bench: Benchmark, history: BenchmarkHistory): Benchmark | null {
  // eslint-disable-next-line @typescript-eslint/camelcase
  const htmlUrl = github.context.payload.repository?.html_url ?? "";

  let prevBench: Benchmark | null = null;
  history.lastUpdate = Date.now();
  history.repoUrl = htmlUrl;

  // Add benchmark result
  if (history.entries[benchName] === undefined) {
    history.entries[benchName] = [bench];
    console.log(`No suite was found for benchmark '${benchName}' in existing data. Created`);
  } else {
    const suites = history.entries[benchName];
    // Get last suite which has different commit ID for alert comment
    for (const e of suites.slice().reverse()) {
      if (e.commit.id !== bench.commit.id) {
        prevBench = e;
        break;
      }
    }

    suites.push(bench);
  }

  return prevBench;
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

function renderBenchmarkTable(
  commitsSha: {curr: string; prev: string},
  results: {id: string; currAverageNs: number; prevAverageNs?: number; ratio?: number}[]
) {
  function toRow(arr: (number | string)[]): string {
    const row = arr.map((e) => `\`${e}\``).join(" | ");
    return `| ${row} |`;
  }

  const rows = results.map((result) => {
    const {id, prevAverageNs, currAverageNs, ratio} = result;

    if (prevAverageNs !== undefined && ratio !== undefined) {
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

async function leaveComment(commitSha: string, body: string, token: string) {
  core.debug("Sending comment:\n" + body);

  const repo = getCurrentRepo();
  // eslint-disable-next-line @typescript-eslint/camelcase
  const repoUrl = repo.html_url ?? "";
  const client = new github.GitHub(token);
  const res = await client.repos.createCommitComment({
    owner: repo.owner.login,
    repo: repo.name,
    // eslint-disable-next-line @typescript-eslint/camelcase
    commit_sha: commitSha,
    body,
  });

  const commitUrl = `${repoUrl}/commit/${commitSha}`;
  console.log(`Comment was sent to ${commitUrl}. Response:`, res.status, res.data);

  return res;
}

function prettyTime(nanoSec: number): [number, string] {
  if (nanoSec > 1e9) return [nanoSec / 1e9, " s"];
  if (nanoSec > 1e6) return [nanoSec / 1e6, "ms"];
  if (nanoSec > 1e3) return [nanoSec / 1e3, "us"];
  return [nanoSec, "ns"];
}

function prettyTimeStr(nanoSec: number) {
  const [value, unit] = prettyTime(nanoSec);
  return `${value.toPrecision(5)} ${unit}`;
}
