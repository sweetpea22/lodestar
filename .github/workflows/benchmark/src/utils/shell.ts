import util from "util";
import child from "child_process";

const exec = util.promisify(child.exec);

export async function shell(cmd: string): Promise<string> {
  const {stdout} = await exec(cmd);
  return (stdout || "").trim();
}
