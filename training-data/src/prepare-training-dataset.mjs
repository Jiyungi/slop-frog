#!/usr/bin/env node
import { deriveTargetLabel, fingerprintCleanText, hashValue, sanitizeText } from "./pii-redactor.mjs";
import { parseArgs, readJsonl, writeJsonl } from "./jsonl.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.content || !args.labels || !args.out) {
    throw new Error("Usage: node prepare-training-dataset.mjs --content x-posts.jsonl --labels labels.jsonl --out clean.jsonl");
  }

  const contentRows = await readJsonl(args.content);
  const labelRows = await readJsonl(args.labels);
  const contentById = new Map(contentRows.map((row) => [String(row.tweet_id || row.source_post_id), row]));
  const minVotes = Number(args["min-votes"] ?? 2);
  const minReviewerWeight = Number(args["min-reviewer-weight"] ?? 0.5);
  const output = [];
  const blocked = [];

  for (const label of labelRows) {
    const tweetId = String(
      label.source_post_id || label.tweet_id || String(label.content_key || "").match(/^x:(\d+)/)?.[1] || ""
    );
    const content = contentById.get(tweetId);
    if (!content) continue;

    const communityScore = Number(label.community_score ?? label.weighted_ai_score);
    const targetLabel = deriveTargetLabel(communityScore);
    const voteCount = Number(label.vote_count || 0);
    const reviewerWeightSum = Number(
      label.reviewer_weight_sum ??
        Number(label.looks_ai_weight || 0) + Number(label.looks_human_weight || 0) + Number(label.unsure_weight || 0)
    );

    if (!targetLabel) continue;
    if (voteCount < minVotes || reviewerWeightSum < minReviewerWeight) continue;

    const clean = sanitizeText(content.text, {
      minLength: Number(args["min-length"] ?? 20),
      maxLength: Number(args["max-length"] ?? 1800),
    });

    const base = {
      schema_version: 1,
      platform: "x",
      content_key_hash: hashValue(label.content_key || `x:${tweetId}`),
      source_post_id_hash: hashValue(tweetId),
      content_fingerprint: fingerprintCleanText(clean.cleanedText),
      cleaned_text: clean.cleanedText,
      target_label: targetLabel || "uncertain",
      label_score: communityScore,
      label_source: label.label_source || "community_weighted",
      vote_count: voteCount,
      reviewer_weight_sum: reviewerWeightSum,
      detector_score: nullableNumber(label.detector_score),
      slop_score: nullableNumber(label.slop_score),
      redaction_report: clean.redactionReport,
      pii_status: clean.piiStatus,
      is_public: clean.piiStatus === "clean" && Boolean(args.public),
      collected_at: content.fetched_at || content.created_at || null,
      cleaned_at: new Date().toISOString(),
    };

    if (clean.piiStatus === "clean" && targetLabel) {
      output.push(base);
    } else {
      blocked.push(base);
    }
  }

  writeJsonl(args.out, output);
  if (args.blocked) writeJsonl(args.blocked, blocked);
  console.log(`Wrote ${output.length} clean examples to ${args.out}`);
  console.log(`Blocked ${blocked.length} risky/uncertain examples`);
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
