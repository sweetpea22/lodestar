import fs from "fs";

export function readJson<T>(filepath: string): T {
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

export function writeJson<T>(filepath: string, json: T): void {
  const jsonStr = JSON.stringify(json, null, 2);
  fs.writeFileSync(filepath, jsonStr);
}
