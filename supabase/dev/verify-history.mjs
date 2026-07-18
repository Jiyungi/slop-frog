import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { recordVerdictHistory } from "../../extension/src/shared/supabase.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = readEnv(path.join(repositoryRoot, ".env"));
const fixture = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "extension/src/shared/fixtures.json"), "utf8")
).find((item) => item.name === "medium-yellow");

if (!fixture) throw new Error("The medium-yellow fixture is missing.");

const entry = await recordVerdictHistory(
  {
    url: requiredEnv(env, "SLOP_FROG_SUPABASE_URL"),
    publishableKey: requiredEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  },
  {
    contentKey: fixture.post.contentKey,
    eventType: "label_changed",
    label: "yellow",
    slopScore: 70,
    detectorScore: 70,
    communityScore: 100,
    metadata: { source: "person-b-verification" },
  }
);

if (
  !entry.id ||
  entry.contentKey !== fixture.post.contentKey ||
  entry.eventType !== "label_changed" ||
  entry.label !== "yellow"
) {
  throw new Error("The saved history entry did not match the demo request.");
}

console.log(`Verdict-history insert verified for ${entry.contentKey}: ${entry.eventType}.`);

function readEnv(envPath) {
  const values = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function requiredEnv(env, key) {
  if (!env[key]) throw new Error(`${key} is required in .env.`);
  return env[key];
}
