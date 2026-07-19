import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const envPath = path.join(repositoryRoot, ".env");
const targetPath = path.join(
  repositoryRoot,
  "extension/src/shared/product-api-config.local.json"
);
const env = fs.existsSync(envPath) ? readEnv(envPath) : {};

const config = {
  runtypeScorePostUrl: envValue(env, "RUNTYPE_SCORE_POST_URL"),
  runtypeSubmitFeedbackUrl: envValue(env, "RUNTYPE_SUBMIT_FEEDBACK_URL"),
  runtypeSubmitAppealUrl: envValue(env, "RUNTYPE_SUBMIT_APPEAL_URL"),
  runtypeProductApiKey: envValue(env, "RUNTYPE_PRODUCT_API_KEY"),
  insforgeUrl: envValue(env, "INSFORGE_BACKEND_URL"),
  insforgeAnonKey:
    envValue(env, "INSFORGE_ANON_KEY") ||
    envValue(env, "NEXT_PUBLIC_INSFORGE_ANON_KEY") ||
    envValue(env, "PUBLIC_INSFORGE_ANON_KEY") ||
    readInsForgeAnonKeyFromCli(),
  modalDetectorUrl: envValue(env, "SLOP_FROG_MODAL_DETECTOR_URL"),
  demoReviewerId: requiredEnv(env, "SLOP_FROG_DEMO_REVIEWER_ID"),
  ownerReviewerId: envValue(env, "SLOP_FROG_OWNER_REVIEWER_ID") || envValue(env, "SLOP_FROG_DEMO_REVIEWER_ID"),
  publicQuota: Number(envValue(env, "SLOP_FROG_PUBLIC_QUOTA") || 1),
  allowDirectDetectorFallback:
    String(envValue(env, "SLOP_FROG_ALLOW_DIRECT_DETECTOR_FALLBACK") || "true").toLowerCase() !== "false",
};

if (!config.runtypeScorePostUrl && !config.modalDetectorUrl) {
  throw new Error("RUNTYPE_SCORE_POST_URL or SLOP_FROG_MODAL_DETECTOR_URL is required.");
}

if (!config.insforgeUrl) {
  throw new Error("INSFORGE_BACKEND_URL is required.");
}

if (!config.insforgeAnonKey) {
  console.warn(
    "INSFORGE_ANON_KEY is not set. Extension InsForge RPC calls will be unavailable until a public anon key is configured."
  );
}

writeJson(targetPath, config);

console.log("Wrote local Slop Frog product API extension configuration.");

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readEnv(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function envValue(envValues, key) {
  const value = process.env[key] || envValues[key];
  if (!value || /^YOUR_|^https:\/\/YOUR-|^placeholder$/i.test(value)) return "";
  return value;
}

function requiredEnv(envValues, key) {
  const value = envValue(envValues, key);
  if (!value) throw new Error(`${key} is required in .env.`);
  return value;
}

function readInsForgeAnonKeyFromCli() {
  try {
    const output = execSync("npx @insforge/cli secrets get ANON_KEY", {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
    const match = output.match(/ANON_KEY\s*=\s*([^\s]+)/);
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}
