import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const envPath = path.join(repositoryRoot, ".env");
const targetPath = path.join(
  repositoryRoot,
  "extension/src/shared/supabase-config.local.json"
);
const env = readEnv(envPath);

const config = {
  url: requiredEnv(env, "SLOP_FROG_SUPABASE_URL"),
  publishableKey: requiredEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  demoReviewerId: requiredEnv(env, "SLOP_FROG_DEMO_REVIEWER_ID"),
};

fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log("Wrote local Supabase extension configuration.");

function readEnv(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function requiredEnv(envValues, key) {
  if (!envValues[key]) throw new Error(`${key} is required in .env.`);
  return envValues[key];
}
