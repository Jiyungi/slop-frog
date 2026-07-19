import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { submitAppeal } from "../../extension/src/shared/supabase.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = readEnv(path.join(repositoryRoot, ".env"));
const fixtures = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "extension/src/shared/fixtures.json"), "utf8")
);
const fixture = fixtures.find((item) => item.name === "medium-yellow");

if (!fixture) throw new Error("The medium-yellow fixture is missing.");

const savedAppeal = await submitAppeal(
  {
    url: requiredEnv(env, "SLOP_FROG_SUPABASE_URL"),
    publishableKey: requiredEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  },
  {
    contentKey: fixture.post.contentKey,
    reviewerId: requiredEnv(env, "SLOP_FROG_DEMO_REVIEWER_ID"),
    reason: "ai_assisted_not_fully_ai",
    status: "submitted",
  }
);

if (
  !savedAppeal.id ||
  savedAppeal.contentKey !== fixture.post.contentKey ||
  savedAppeal.status !== "submitted"
) {
  throw new Error("The saved appeal did not match the demo request.");
}

console.log(`Appeal insert verified for ${savedAppeal.contentKey}: ${savedAppeal.status}.`);

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
