import fs from "node:fs";
import readline from "node:readline";

export async function readJsonl(filePath) {
  const rows = [];
  const stream = fs.createReadStream(filePath, "utf8");
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`${filePath}:${lineNumber} invalid JSONL: ${error.message}`);
    }
  }

  return rows;
}

export function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8"
  );
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}
