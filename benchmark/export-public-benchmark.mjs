import fs from "node:fs";
import path from "node:path";
import {
  listPublicBenchmarkExamples,
  prepareBenchmarkBatch,
} from "../extension/src/shared/product-api.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const env = readEnv(path.join(repositoryRoot, ".env"));
const args = parseArgs(process.argv.slice(2));
const limit = Number(args.limit || 100);
const dryRun = Boolean(args["dry-run"]);
const outPath = args.out
  ? path.resolve(repositoryRoot, args.out)
  : path.resolve(repositoryRoot, "benchmark/exports/slop-frog-public-benchmark.json");

const config = {
  insforgeUrl: required("INSFORGE_BACKEND_URL"),
  insforgeAnonKey:
    envValue("INSFORGE_ANON_KEY") ||
    envValue("NEXT_PUBLIC_INSFORGE_ANON_KEY") ||
    envValue("PUBLIC_INSFORGE_ANON_KEY") ||
    required("INSFORGE_SERVICE_KEY"),
  demoReviewerId: envValue("SLOP_FROG_DEMO_REVIEWER_ID") || "demo-reviewer-local",
};

if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
  throw new Error("--limit must be a number from 1 to 1000.");
}

const batch = await prepareBenchmarkBatch(config, { limit, minVotes: Number(args["min-votes"] || 1) });
const rows = await listPublicBenchmarkExamples(config, { limit });
const exportedAt = new Date().toISOString();
const examples = dedupeExamples(rows.map((row) => sanitizeExample(row, exportedAt)).filter(Boolean));

const payload = {
  name: "slop-frog-public-benchmark",
  version: exportedAt.slice(0, 10),
  exported_at: exportedAt,
  source: "InsForge cleaned benchmark examples",
  batch: {
    id: batch?.batch_id || batch?.id || null,
    inserted_examples: Number(batch?.inserted_examples || 0),
  },
  privacy: {
    pii_cleaned: true,
    raw_media_included: false,
    passive_feed_collection: false,
  },
  count: examples.length,
  examples,
};

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  ensureOutputPath(outPath);
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Exported ${examples.length} examples to ${path.relative(repositoryRoot, outPath)}`);
}

function sanitizeExample(row, exportedAtValue) {
  const cleanedText = cleanText(row.cleaned_text || row.text || row.text_snapshot || "");
  if (!cleanedText) return null;

  return {
    source_platform: row.source_platform || row.platform,
    content_key_hash: row.content_key_hash || hashFallback(row.content_key || cleanedText),
    cleaned_text: cleanedText,
    label: row.label,
    community_score: numberOrNull(row.community_score),
    vote_count: Number(row.vote_count || 0),
    exported_at: exportedAtValue,
  };
}

function dedupeExamples(examples) {
  const seen = new Set();
  return examples.filter((example) => {
    const key = `${example.source_platform}:${example.cleaned_text.toLowerCase()}:${example.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanText(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/@\w{2,30}/g, "[handle]")
    .replace(/\s+/g, " ")
    .trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hashFallback(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(16)}`;
}

function ensureOutputPath(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
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
  if (!value) throw new Error(`${key} is required for benchmark export.`);
  return value;
}
