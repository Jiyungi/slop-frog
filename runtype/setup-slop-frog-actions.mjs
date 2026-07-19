import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repositoryRoot, ".env");
const env = readEnv(envPath);

const runtypeApiKey = required("RUNTYPE_API_KEY");
const productId = required("RUNTYPE_PRODUCT_ID");
const surfaceId = envValue("RUNTYPE_SURFACE_ID") || extractSurfaceId(envValue("RUNTYPE_SCORE_POST_URL"));
const writeEnv = process.argv.includes("--write-env");

if (!surfaceId) {
  throw new Error("RUNTYPE_SURFACE_ID or RUNTYPE_SCORE_POST_URL with a surface id is required.");
}

const headers = {
  Authorization: `Bearer ${runtypeApiKey}`,
  "Content-Type": "application/json",
};

const actionDefinitions = [
  {
    flowName: "submit_feedback_insforge",
    capabilityName: "submit_feedback_insforge",
    endpointSlug: "submit-feedback-insforge",
    description: "Normalize Slop Frog community feedback and write the vote to InsForge.",
    steps: feedbackSteps(),
    envKey: "RUNTYPE_SUBMIT_FEEDBACK_URL",
  },
  {
    flowName: "submit_appeal_insforge",
    capabilityName: "submit_appeal_insforge",
    endpointSlug: "submit-appeal-insforge",
    description: "Normalize Slop Frog appeals and write the appeal to InsForge.",
    steps: appealSteps(),
    envKey: "RUNTYPE_SUBMIT_APPEAL_URL",
  },
];

const productBefore = await getProduct();
const surface = productBefore.surfaces?.find((candidate) => candidate.id === surfaceId);
if (!surface) throw new Error(`Surface ${surfaceId} was not found on product ${productId}.`);

const endpointUrls = {};

for (const action of actionDefinitions) {
  const flow = await upsertFlow(action);
  const product = await getProduct();
  const capability = await ensureCapability(product, action, flow.id);
  const latestProduct = await getProduct();
  await ensureSurfaceItem(latestProduct, action, capability.id);
  endpointUrls[action.envKey] =
    `https://api.runtype.com/v1/products/${productId}/surfaces/${surfaceId}/api/${action.endpointSlug}`;
  console.log(`${action.capabilityName}: ${endpointUrls[action.envKey]}`);
}

if (writeEnv) {
  updateEnvFile(envPath, endpointUrls);
  console.log("Updated .env Runtype feedback/appeal endpoint URLs.");
} else {
  console.log("Run again with --write-env to update local .env endpoint URLs.");
}

async function upsertFlow(action) {
  const existing = await findFlowByName(action.flowName);
  const body = {
    name: action.flowName,
    description: action.description,
    flowSteps: action.steps.map((step, index) => ({
      ...step,
      order: index + 1,
      enabled: true,
    })),
  };

  if (!existing) {
    const created = await requestJson("/v1/flows", {
      method: "POST",
      body,
    });
    await publishFlow(created.id);
    console.log(`${action.flowName}: created ${created.id}`);
    return created;
  }

  const updated = await requestJson(`/v1/flows/${existing.id}`, {
    method: "PUT",
    body,
  });
  await publishFlow(existing.id);
  console.log(`${action.flowName}: updated ${existing.id}`);
  return updated;
}

async function findFlowByName(name) {
  const flows = await requestJson("/v1/flows", { method: "GET" });
  const list = Array.isArray(flows) ? flows : flows?.data || flows?.flows || [];
  return list.find((flow) => flow.name === name) || null;
}

async function publishFlow(flowId) {
  await requestJson(`/v1/flows/${flowId}/publish`, {
    method: "POST",
    body: {},
  });
}

async function ensureCapability(product, action, flowId) {
  const existing = product.capabilities?.find(
    (capability) => capability.capabilityName === action.capabilityName
  );

  if (existing) {
    if (existing.flowId === flowId && existing.enabled !== false) return existing;
    console.log(
      `${action.capabilityName}: existing capability ${existing.id} is already present; leaving flow binding unchanged`
    );
    return existing;
  }

  const created = await requestJson(`/v1/products/${productId}/capabilities`, {
    method: "POST",
    body: {
      capabilityName: action.capabilityName,
      capabilityDescription: action.description,
      flowId,
      enabled: true,
      parametersSchema: {
        type: "object",
        additionalProperties: true,
      },
    },
  });
  console.log(`${action.capabilityName}: created capability ${created.id}`);
  return created;
}

async function ensureSurfaceItem(product, action, capabilityId) {
  const currentSurface = product.surfaces?.find((candidate) => candidate.id === surfaceId);
  const existing = currentSurface?.items?.find((item) => item.endpointSlug === action.endpointSlug);
  if (existing) return existing;

  const created = await requestJson(`/v1/products/${productId}/surfaces/${surfaceId}/items`, {
    method: "POST",
    body: {
      capabilityId,
      endpointSlug: action.endpointSlug,
      exposedName: action.capabilityName,
      exposedDescription: action.description,
      enabled: true,
      isEntryPoint: false,
    },
  });
  console.log(`${action.capabilityName}: created surface item ${created.id}`);
  return created;
}

async function getProduct() {
  return requestJson(`/v1/products/${productId}`, { method: "GET" });
}

async function requestJson(apiPath, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const response = await fetch(`https://api.runtype.com${apiPath}`, {
    method: options.method,
    headers,
    signal: controller.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }).finally(() => clearTimeout(timeout));
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method} ${apiPath} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function feedbackSteps() {
  return [
    {
      type: "transform-data",
      name: "Normalize community vote payload",
      config: {
        outputVariable: "feedback_payload",
        script: `
const sourceVote = typeof vote !== 'undefined' && vote ? vote : {};
const nestedVote = typeof payload !== 'undefined' && payload?.vote ? payload.vote : {};
const source = Object.keys(sourceVote).length ? sourceVote : nestedVote;
const contentKey = source.contentKey || source.content_key || (typeof contentHash !== 'undefined' ? contentHash : null);
const selectedVote = source.vote || (typeof voteValue !== 'undefined' ? voteValue : null) || 'unsure';
if (!contentKey) throw new Error('content_key_required');
return {
  contentKey,
  platform: source.platform || (typeof platform !== 'undefined' ? platform : 'x'),
  vote: selectedVote,
  reviewerId: source.reviewerId || source.reviewer_id || (typeof reviewerId !== 'undefined' ? reviewerId : 'runtype-reviewer'),
  postId: source.postId || source.post_id || null,
  tweetId: source.tweetId || source.tweet_id || null,
  url: source.url || (typeof postUrl !== 'undefined' ? postUrl : null),
  textHash: source.textHash || source.text_hash || null,
  textSnapshot: source.textSnapshot || source.text_snapshot || null,
  authorHandle: source.authorHandle || source.author_handle || null
};`,
      },
    },
    {
      type: "api-call",
      name: "Write InsForge community vote",
      config: {
        outputVariable: "insforge_vote",
        http: {
          method: "POST",
          url: "{{secrets.insforgeUrl}}/api/database/rpc/submit_community_vote",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer {{secrets.insforgeAnonKey}}",
          },
          responseType: "json",
          body: `{
  "p_content_key": "{{feedback_payload.contentKey}}",
  "p_platform": "{{feedback_payload.platform}}",
  "p_vote": "{{feedback_payload.vote}}",
  "p_reviewer_id": "{{feedback_payload.reviewerId}}",
  "p_post_id": "{{feedback_payload.postId}}",
  "p_tweet_id": "{{feedback_payload.tweetId}}",
  "p_url": "{{feedback_payload.url}}",
  "p_text_hash": "{{feedback_payload.textHash}}",
  "p_text_snapshot": "{{feedback_payload.textSnapshot}}",
  "p_author_handle": "{{feedback_payload.authorHandle}}"
}`,
        },
      },
    },
    {
      type: "transform-data",
      name: "Return feedback record",
      config: {
        outputVariable: "feedback_record",
        script: `
const row = Array.isArray(insforge_vote) ? insforge_vote[0] : insforge_vote;
return {
  ok: Boolean(row),
  contentKey: feedback_payload.contentKey,
  reviewerId: feedback_payload.reviewerId,
  vote: feedback_payload.vote,
  reviewerWeight: row?.reviewer_weight == null ? null : Number(row.reviewer_weight),
  createdAt: row?.created_at || new Date().toISOString(),
  source: 'runtype_submit_feedback_insforge_v1'
};`,
      },
    },
  ];
}

function appealSteps() {
  return [
    {
      type: "transform-data",
      name: "Normalize appeal payload",
      config: {
        outputVariable: "appeal_payload",
        script: `
const sourceAppeal = typeof appeal !== 'undefined' && appeal ? appeal : {};
const nestedAppeal = typeof payload !== 'undefined' && payload?.appeal ? payload.appeal : {};
const source = Object.keys(sourceAppeal).length ? sourceAppeal : nestedAppeal;
const contentKey = source.contentKey || source.content_key || (typeof contentHash !== 'undefined' ? contentHash : null);
if (!contentKey) throw new Error('content_key_required');
return {
  contentKey,
  reviewerId: source.reviewerId || source.reviewer_id || (typeof reviewerId !== 'undefined' ? reviewerId : 'runtype-reviewer'),
  reason: source.reason || source.appealReason || (typeof appealReason !== 'undefined' ? appealReason : null) || 'other',
  status: source.status || 'submitted'
};`,
      },
    },
    {
      type: "api-call",
      name: "Write InsForge appeal",
      config: {
        outputVariable: "insforge_appeal",
        http: {
          method: "POST",
          url: "{{secrets.insforgeUrl}}/api/database/rpc/submit_appeal",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer {{secrets.insforgeAnonKey}}",
          },
          responseType: "json",
          body: `{
  "p_content_key": "{{appeal_payload.contentKey}}",
  "p_reviewer_id": "{{appeal_payload.reviewerId}}",
  "p_reason": "{{appeal_payload.reason}}",
  "p_status": "{{appeal_payload.status}}"
}`,
        },
      },
    },
    {
      type: "transform-data",
      name: "Return appeal record",
      config: {
        outputVariable: "appeal_record",
        script: `
const row = Array.isArray(insforge_appeal) ? insforge_appeal[0] : insforge_appeal;
return {
  ok: Boolean(row),
  id: row?.id || null,
  contentKey: appeal_payload.contentKey,
  reviewerId: appeal_payload.reviewerId,
  reason: appeal_payload.reason,
  status: row?.status || appeal_payload.status,
  createdAt: row?.created_at || new Date().toISOString(),
  source: 'runtype_submit_appeal_insforge_v1'
};`,
      },
    },
  ];
}

function updateEnvFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) throw new Error(`${filePath} does not exist.`);
  let text = fs.readFileSync(filePath, "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    const line = `${key}=${value}`;
    if (new RegExp(`^${key}=.*$`, "m").test(text)) {
      text = text.replace(new RegExp(`^${key}=.*$`, "m"), line);
    } else {
      text += `${text.endsWith("\n") ? "" : "\n"}${line}\n`;
    }
  }
  fs.writeFileSync(filePath, text, "utf8");
}

function extractSurfaceId(value) {
  if (!value) return "";
  const match = value.match(/\/surfaces\/([^/]+)\//);
  return match?.[1] || "";
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
  if (!value) throw new Error(`${key} is required.`);
  return value;
}
