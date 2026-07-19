#!/usr/bin/env node
import fs from "node:fs";

const source = fs.readFileSync("modal-detector/slop_frog_modal.py", "utf8");

for (const expected of [
  "DarrenJiaImbue/ai-detection-demo-qwen_3_4b",
  "Qwen/Qwen3-4B",
  "@modal.asgi_app()",
  'gpu=os.environ.get("SLOP_FROG_MODAL_GPU", "L4")',
  'volumes={CACHE_DIR: hf_cache}',
  "min_containers=1",
  "max_containers=1",
  "@modal.concurrent(max_inputs=1)",
  '@web_app.get("/health")',
  '@web_app.post("/score")',
  '"labelRecommendation"',
  '"modalityScores"',
  "score >= red_threshold",
]) {
  assert(source.includes(expected), `modal detector includes ${expected}`);
}

const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
assert(
  JSON.stringify(manifest.host_permissions).includes("https://*.modal.run/*"),
  "extension permits Modal detector endpoint"
);

const background = fs.readFileSync("extension/src/background/index.js", "utf8");
assert(background.includes("detectorTimeoutMs"), "background uses remote-aware detector timeouts");
assert(background.includes("applyLocalRuntimeConfig"), "background reads generated detector URL config");

console.log("Modal detector contract verification passed");

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}
