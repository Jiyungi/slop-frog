import fs from "node:fs";
import path from "node:path";
import {
  fetchCommunityAggregate,
  listPublicBenchmarkExamples,
  prepareBenchmarkBatch,
  recordScoreCache,
  resolveScorePlan,
  submitAppeal,
  submitCommunityVote,
} from "../src/shared/product-api.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const env = readEnv(path.join(repositoryRoot, ".env"));
const stamp = Date.now();
const contentKey = `x:js-api-${stamp}`;
const config = {
  insforgeUrl: required("INSFORGE_BACKEND_URL"),
  insforgeAnonKey:
    envValue("INSFORGE_ANON_KEY") ||
    envValue("NEXT_PUBLIC_INSFORGE_ANON_KEY") ||
    envValue("PUBLIC_INSFORGE_ANON_KEY") ||
    required("INSFORGE_SERVICE_KEY"),
  demoReviewerId: envValue("SLOP_FROG_DEMO_REVIEWER_ID") || "demo-reviewer-local",
};

await submitCommunityVote(config, vote("looks_ai", "ai"));
await submitCommunityVote(config, vote("looks_human", "human"));
await submitCommunityVote(config, vote("unsure", "unsure"));

const aggregate = await fetchCommunityAggregate(config, contentKey);
assert(aggregate.voteCount === 3, "InsForge JS client fetches three community votes");
assert(aggregate.communityScore === 50, "InsForge JS client computes community score 50");

const appeal = await submitAppeal(config, {
  contentKey,
  reviewerId: `js-api-appealer-${stamp}`,
  reason: "missing_context",
  status: "submitted",
});
assert(appeal.id, "InsForge JS client submits appeals");

const publicSubject = `js-public-${stamp}`;
const firstPlan = await resolveScorePlan(config, {
  contentKey: `x:js-quota-a-${stamp}`,
  platform: "x",
  subjectKey: publicSubject,
  tier: "public_guest",
  publicQuota: 1,
});
const secondPlan = await resolveScorePlan(config, {
  contentKey: `x:js-quota-b-${stamp}`,
  platform: "x",
  subjectKey: publicSubject,
  tier: "public_guest",
  publicQuota: 1,
});
assert(firstPlan.decision === "live_allowed", "public quota allows first uncached score");
assert(secondPlan.decision === "rate_limited", "public quota limits second uncached score");

await recordScoreCache(config, {
  contentKey,
  platform: "x",
  detectorScore: 91,
  evidenceCoverage: 95,
  label: "red",
  modelName: "verify-model",
  modelVersion: "0.0.1",
  reasons: ["fixture"],
  ttlSeconds: 3600,
});
const cachedPlan = await resolveScorePlan(config, {
  contentKey,
  platform: "x",
  subjectKey: publicSubject,
  tier: "public_guest",
  publicQuota: 1,
});
assert(cachedPlan.decision === "cache_hit", "score cache avoids live detector call");
assert(Number(cachedPlan.cached_detector_score) === 91, "score cache returns detector score");

const batch = await prepareBenchmarkBatch(config, { limit: 10, minVotes: 1 });
assert(batch.inserted_examples >= 1, "benchmark batch creates public examples");
const examples = await listPublicBenchmarkExamples(config, { limit: 5 });
assert(examples.some((example) => example.source_platform === "x"), "public benchmark examples include X examples");

console.log("Product API verification passed");

function vote(voteValue, suffix) {
  return {
    contentKey,
    platform: "x",
    vote: voteValue,
    reviewerId: `js-api-${suffix}-${stamp}`,
    postId: `${stamp}`,
    tweetId: `${stamp}`,
    url: `https://x.com/slopfrog/status/${stamp}`,
    textHash: `js-api-hash-${stamp}`,
    textSnapshot:
      "This X benchmark verification fixture has enough public text to test cleaned training data generation without storing raw handles or email addresses.",
    authorHandle: "@slopfrog",
  };
}

function readEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function envValue(key) {
  return process.env[key] || env[key] || "";
}

function required(key) {
  const value = envValue(key);
  if (!value) throw new Error(`${key} is required for product API verification.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}
