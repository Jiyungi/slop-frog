import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchCommunityAggregate,
  submitCommunityVote,
} from "../../extension/src/shared/supabase.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = readEnv(path.join(repositoryRoot, ".env"));
const fixtures = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "extension/src/shared/fixtures.json"), "utf8")
);
const fixture = fixtures.find((item) => item.name === "medium-yellow");

if (!fixture) throw new Error("The medium-yellow fixture is missing.");

const savedVote = await submitCommunityVote(
  {
    url: env.SLOP_FROG_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  {
    contentKey: fixture.post.contentKey,
    platform: fixture.post.platform,
    vote: "looks_ai",
    reviewerId: requiredEnv(env, "SLOP_FROG_DEMO_REVIEWER_ID"),
    tweetId: fixture.post.tweetId,
    url: fixture.post.url,
    textHash: fixture.post.textHash,
    textSnapshot: fixture.post.normalizedText,
    authorHandle: fixture.post.authorHandle,
  }
);

const config = {
  url: env.SLOP_FROG_SUPABASE_URL,
  publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};
const aggregate = await fetchCommunityAggregate(config, fixture.post.contentKey);

if (
  savedVote.contentKey !== fixture.post.contentKey ||
  savedVote.vote !== "looks_ai" ||
  !Number.isFinite(savedVote.reviewerWeight)
) {
  throw new Error("The saved vote did not match the demo request.");
}

if (
  !aggregate ||
  aggregate.contentKey !== fixture.post.contentKey ||
  aggregate.voteCount < 1 ||
  aggregate.weightedAiScore !== 100
) {
  throw new Error("The weighted community aggregate did not reflect the demo vote.");
}

console.log(
  `Vote and aggregate verified for ${savedVote.contentKey}: ${savedVote.vote} at weight ${savedVote.reviewerWeight}, weighted AI score ${aggregate.weightedAiScore}.`
);

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
