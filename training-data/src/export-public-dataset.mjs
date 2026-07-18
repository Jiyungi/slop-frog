#!/usr/bin/env node
import fs from "node:fs";
import { CLEANER_VERSION } from "./pii-redactor.mjs";
import { parseArgs, readJsonl, writeJsonl } from "./jsonl.mjs";

const PUBLIC_FIELDS = [
  "schema_version",
  "platform",
  "content_fingerprint",
  "cleaned_text",
  "target_label",
  "label_score",
  "label_source",
  "vote_count",
  "reviewer_weight_sum",
  "detector_score",
  "slop_score",
  "redaction_report",
  "collected_at",
  "cleaned_at",
];

async function main() {
  const args = parseArgs(process.argv);
  if (!args.in || !args.out || !args.manifest) {
    throw new Error("Usage: node export-public-dataset.mjs --in clean.jsonl --out public.jsonl --manifest manifest.json");
  }

  const rows = await readJsonl(args.in);
  const publicRows = rows
    .filter((row) => row.pii_status === "clean")
    .map((row) => Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, row[field] ?? null])));

  writeJsonl(args.out, publicRows);

  const labelCounts = publicRows.reduce((counts, row) => {
    counts[row.target_label] = (counts[row.target_label] || 0) + 1;
    return counts;
  }, {});

  const manifest = {
    name: args.name || "slop-frog-public-training-dataset",
    schema_version: 1,
    cleaner_version: CLEANER_VERSION,
    exported_at: new Date().toISOString(),
    example_count: publicRows.length,
    label_counts: labelCounts,
    pii_policy:
      "Only cleaned rows are exported. Raw post IDs, URLs, handles, author profiles, and media files are excluded.",
    fields: PUBLIC_FIELDS,
  };

  fs.writeFileSync(args.manifest, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Exported ${publicRows.length} public examples to ${args.out}`);
  console.log(`Wrote manifest to ${args.manifest}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
