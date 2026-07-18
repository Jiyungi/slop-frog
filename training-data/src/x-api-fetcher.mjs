#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs, readJsonl, writeJsonl } from "./jsonl.mjs";

const X_POST_LOOKUP_URL = "https://api.x.com/2/tweets";

async function main() {
  const args = parseArgs(process.argv);
  const out = args.out;
  const token = process.env.X_BEARER_TOKEN;

  if (!out) {
    throw new Error("Missing --out .local/x-posts.jsonl");
  }
  if (!token) {
    throw new Error("Missing X_BEARER_TOKEN. Use an authorized X API bearer token.");
  }

  const ids = await readIds(args);
  if (ids.length === 0) {
    throw new Error("No X post IDs found. Provide --ids or --labels.");
  }

  const rows = [];
  for (const batch of chunks([...new Set(ids)], 100)) {
    const url = new URL(X_POST_LOOKUP_URL);
    url.searchParams.set("ids", batch.join(","));
    url.searchParams.set(
      "tweet.fields",
      "id,text,created_at,lang,possibly_sensitive,public_metrics,edit_history_tweet_ids,attachments"
    );
    url.searchParams.set("expansions", "attachments.media_keys");
    url.searchParams.set("media.fields", "media_key,type,url,preview_image_url,width,height,alt_text");

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`X API fetch failed: HTTP ${response.status} ${body.slice(0, 300)}`);
    }

    const payload = await response.json();
    const mediaByKey = new Map((payload.includes?.media || []).map((media) => [media.media_key, media]));

    for (const post of payload.data || []) {
      const mediaKeys = post.attachments?.media_keys || [];
      rows.push({
        platform: "x",
        tweet_id: post.id,
        text: post.text,
        lang: post.lang,
        created_at: post.created_at,
        possibly_sensitive: post.possibly_sensitive,
        public_metrics: post.public_metrics,
        media: mediaKeys.map((key) => {
          const media = mediaByKey.get(key) || {};
          return {
            type: media.type,
            width: media.width,
            height: media.height,
            has_alt_text: Boolean(media.alt_text),
          };
        }),
        fetched_at: new Date().toISOString(),
      });
    }
  }

  writeJsonl(out, rows);
  console.log(`Fetched ${rows.length} X posts into ${out}`);
}

async function readIds(args) {
  if (args.ids) {
    return fs
      .readFileSync(args.ids, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (args.labels) {
    const labels = await readJsonl(args.labels);
    return labels
      .map((row) => row.source_post_id || row.tweet_id || String(row.content_key || "").match(/^x:(\d+)/)?.[1])
      .filter(Boolean);
  }

  return [];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
