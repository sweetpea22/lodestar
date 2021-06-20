import {shell} from "./shell";

export async function getCurrentCommitInfo(): Promise<{
  /** commit hash `71f08b12d45d44255c31f7b7d135bd15a93fdaac` */
  sha: string;
  /** committer date, UNIX timestamp in seconds */
  timestamp: number;
}> {
  const sha = await shell("git show -s --format=%H");
  const timestampStr = await shell("git show -s --format=%ct");
  const timestamp = parseInt(timestampStr, 10);

  if (!timestamp || isNaN(timestamp)) {
    throw Error(`Invalid timestampStr ${timestampStr}`);
  }

  return {
    sha,
    timestamp,
  };
}
