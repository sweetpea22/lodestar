import {Context} from "../types";

const prCommentTag = "benchmarkbot/tag";

export async function commetToPrUpdatable(context: Context, prNumber: number, body: string): Promise<void> {
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

export async function commentToCommit(context: Context, commitSha: string, body: string): Promise<void> {
  const {octokit, repo} = context;

  await octokit.rest.repos.createCommitComment({
    owner: repo.owner.login,
    repo: repo.name,
    commit_sha: commitSha,
    body,
  });
}

export async function getIsDefaultBranch(context: Context): Promise<string> {
  const {octokit, repo} = context;
  const thisRepo = await octokit.rest.repos.get({
    owner: repo.owner.login,
    repo: repo.name,
  });
  return thisRepo.data.default_branch;
}
