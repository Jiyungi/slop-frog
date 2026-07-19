#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const env = readEnv(path.resolve(".env"));
const tokenId = env.MODAL_TOKEN_ID || process.env.MODAL_TOKEN_ID;
const tokenSecret = env.MODAL_TOKEN_SECRET || process.env.MODAL_TOKEN_SECRET;

if (!tokenId || !tokenSecret) {
  throw new Error("MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are required in .env or process env.");
}

const result = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  ["-m", "modal", "token", "set", "--token-id", tokenId, "--token-secret", tokenSecret, "--verify"],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}
