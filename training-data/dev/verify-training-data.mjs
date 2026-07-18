import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sanitizeText } from "../src/pii-redactor.mjs";
import { readJsonl } from "../src/jsonl.mjs";

const pii = sanitizeText("Email me at person@example.com or @realuser. Call 415-555-1212. https://x.com/a/status/1");
assert(pii.cleanedText.includes("[EMAIL]"), "redacts email");
assert(pii.cleanedText.includes("[HANDLE]"), "redacts handle");
assert(pii.cleanedText.includes("[PHONE]"), "redacts phone");
assert(pii.cleanedText.includes("[URL]"), "redacts URL");

const risky = sanitizeText("My name is John Smith and I live at 123 Mission Street");
assert(risky.piiStatus === "blocked", "blocks residual identity risk");

const trainingSql = fs.readFileSync("supabase/training_schema.sql", "utf8");
for (const required of [
  "training_label_queue",
  "training_clean_examples",
  "training_dataset_exports",
  "training_data_access_requests",
  "public_training_dataset",
  "pii_status = 'clean'",
]) {
  assert(trainingSql.includes(required), `training schema includes ${required}`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "slop-frog-training-"));
const content = path.join(temp, "content.jsonl");
const labels = path.join(temp, "labels.jsonl");
const clean = path.join(temp, "clean.jsonl");
const pub = path.join(temp, "public.jsonl");
const manifest = path.join(temp, "manifest.json");

fs.writeFileSync(
  content,
  JSON.stringify({
    platform: "x",
    tweet_id: "123",
    text: "This product update uses crisp language and avoids all direct identifiers in this synthetic fixture.",
    fetched_at: "2026-07-18T00:00:00.000Z",
  }) + "\n",
  "utf8"
);

fs.writeFileSync(
  labels,
  JSON.stringify({
    content_key: "x:123",
    platform: "x",
    source_post_id: "123",
    community_score: 92,
    vote_count: 3,
    reviewer_weight_sum: 1.5,
  }) + "\n",
  "utf8"
);

execFileSync(
  process.execPath,
  ["training-data/src/prepare-training-dataset.mjs", "--content", content, "--labels", labels, "--out", clean],
  { stdio: "inherit" }
);
execFileSync(
  process.execPath,
  ["training-data/src/export-public-dataset.mjs", "--in", clean, "--out", pub, "--manifest", manifest],
  { stdio: "inherit" }
);

const cleanRows = await readJsonl(clean);
const publicRows = await readJsonl(pub);
assert(cleanRows.length === 1, "writes one clean training example");
assert(publicRows.length === 1, "exports one public example");
assert(!("source_post_id_hash" in publicRows[0]), "public export excludes source post hash");
assert(!("content_key_hash" in publicRows[0]), "public export excludes content key hash");
assert(!/https?:\/\/|@[A-Za-z0-9_]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(publicRows[0].cleaned_text), "public text has no direct PII patterns");

console.log("Training data verification passed");

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}
