const REQUIRED_INSFORGE_FIELDS = ["insforgeUrl", "insforgeAnonKey"];

export function isInsForgeConfigured(config) {
  return REQUIRED_INSFORGE_FIELDS.every((field) => Boolean(config?.[field]));
}

export function isRuntypeScoreConfigured(config) {
  return Boolean(config?.runtypeScorePostUrl);
}

export function isProductApiConfigured(config) {
  return isRuntypeScoreConfigured(config) || isInsForgeConfigured(config);
}

export async function scorePostViaRuntype(config, request, fetchImpl = globalThis.fetch) {
  if (!isRuntypeScoreConfigured(config)) {
    throw new Error("Runtype score endpoint is not configured.");
  }

  const response = await fetchImpl(config.runtypeScorePostUrl, {
    method: "POST",
    headers: productHeaders(config, "runtype"),
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Runtype score failed (HTTP ${response.status}).`);
  }

  return normalizeScoreEnvelope(body, request.post);
}

export async function resolveScorePlan(config, payload, fetchImpl = globalThis.fetch) {
  const rows = await callInsForgeRpc(config, "resolve_score_plan", {
    p_content_key: payload.contentKey,
    p_platform: payload.platform,
    p_subject_key: payload.subjectKey,
    p_tier: payload.tier || "public_guest",
    p_public_quota: payload.publicQuota ?? 1,
  }, fetchImpl);
  return rows?.[0] || null;
}

export async function recordScoreCache(config, payload, fetchImpl = globalThis.fetch) {
  const rows = await callInsForgeRpc(config, "record_score_cache", {
    p_content_key: payload.contentKey,
    p_platform: payload.platform,
    p_detector_score: payload.detectorScore,
    p_evidence_coverage: payload.evidenceCoverage,
    p_label: payload.label,
    p_model_name: payload.modelName,
    p_model_version: payload.modelVersion,
    p_reasons: payload.reasons || [],
    p_ttl_seconds: payload.ttlSeconds ?? 2592000,
  }, fetchImpl);
  return rows?.[0] || null;
}

export async function submitCommunityVote(config, vote, fetchImpl = globalThis.fetch) {
  if (config?.runtypeSubmitFeedbackUrl) {
    await callRuntypeAction(config, config.runtypeSubmitFeedbackUrl, {
      kind: "feedback",
      vote,
    }, fetchImpl).catch(() => null);
  }

  const rows = await callInsForgeRpc(config, "submit_community_vote", {
    p_content_key: vote.contentKey,
    p_platform: vote.platform,
    p_vote: vote.vote,
    p_reviewer_id: vote.reviewerId,
    p_post_id: vote.postId ?? vote.tweetId ?? null,
    p_tweet_id: vote.tweetId ?? null,
    p_url: vote.url ?? null,
    p_text_hash: vote.textHash ?? null,
    p_text_snapshot: vote.textSnapshot ?? null,
    p_author_handle: vote.authorHandle ?? null,
  }, fetchImpl);

  const savedVote = rows?.[0];
  return savedVote
    ? {
        contentKey: savedVote.content_key,
        reviewerId: savedVote.reviewer_id,
        vote: savedVote.vote,
        reviewerWeight: Number(savedVote.reviewer_weight),
        createdAt: savedVote.created_at,
      }
    : null;
}

export async function fetchCommunityAggregate(config, contentKey, fetchImpl = globalThis.fetch) {
  const rows = await callInsForgeRpc(config, "get_community_aggregate", {
    p_content_key: contentKey,
  }, fetchImpl);
  const aggregate = rows?.[0];
  if (!aggregate) return null;

  return {
    contentKey: aggregate.content_key,
    voteCount: Number(aggregate.vote_count || 0),
    communityScore:
      aggregate.community_score === null || aggregate.community_score === undefined
        ? null
        : Number(aggregate.community_score),
    weightedAiScore:
      aggregate.weighted_ai_score === null || aggregate.weighted_ai_score === undefined
        ? null
        : Number(aggregate.weighted_ai_score),
    looksAiWeight: Number(aggregate.looks_ai_weight || 0),
    looksHumanWeight: Number(aggregate.looks_human_weight || 0),
    unsureWeight: Number(aggregate.unsure_weight || 0),
    appealStatus: aggregate.appeal_status,
    latestVerdictLabel: aggregate.latest_verdict_label,
    updatedAt: aggregate.updated_at,
  };
}

export async function fetchVerdictHistory(config, contentKey, fetchImpl = globalThis.fetch) {
  const rows = await callInsForgeRpc(config, "get_verdict_history", {
    p_content_key: contentKey,
    p_limit: 20,
  }, fetchImpl);
  return (rows || []).map((row, index) => ({
    createdAt: row.created_at,
    slopScore: row.slop_score === null || row.slop_score === undefined ? null : Number(row.slop_score),
    label: row.label || "gray",
    volume: index + 1,
  }));
}

export async function submitAppeal(config, appeal, fetchImpl = globalThis.fetch) {
  if (config?.runtypeSubmitAppealUrl) {
    await callRuntypeAction(config, config.runtypeSubmitAppealUrl, {
      kind: "appeal",
      appeal,
    }, fetchImpl).catch(() => null);
  }

  const rows = await callInsForgeRpc(config, "submit_appeal", {
    p_content_key: appeal.contentKey,
    p_reviewer_id: appeal.reviewerId,
    p_reason: appeal.reason,
    p_status: appeal.status || "submitted",
  }, fetchImpl);

  const savedAppeal = rows?.[0];
  return savedAppeal
    ? {
        id: savedAppeal.id,
        contentKey: savedAppeal.content_key,
        reviewerId: savedAppeal.reviewer_id,
        reason: savedAppeal.reason,
        status: savedAppeal.status,
        createdAt: savedAppeal.created_at,
      }
    : null;
}

export async function prepareBenchmarkBatch(config, options = {}, fetchImpl = globalThis.fetch) {
  const rows = await callInsForgeRpc(config, "prepare_benchmark_batch", {
    p_limit: options.limit ?? 100,
    p_min_votes: options.minVotes ?? 1,
  }, fetchImpl);
  return rows?.[0] || null;
}

export async function listPublicBenchmarkExamples(config, options = {}, fetchImpl = globalThis.fetch) {
  return callInsForgeRpc(config, "list_public_benchmark_examples", {
    p_limit: options.limit ?? 100,
  }, fetchImpl);
}

export async function callInsForgeRpc(config, functionName, payload, fetchImpl = globalThis.fetch) {
  if (!isInsForgeConfigured(config)) {
    throw new Error("InsForge is not configured for this extension.");
  }

  const response = await fetchImpl(
    `${trimSlash(config.insforgeUrl)}/api/database/rpc/${functionName}`,
    {
      method: "POST",
      headers: productHeaders(config, "insforge"),
      body: JSON.stringify(payload || {}),
    }
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `InsForge RPC ${functionName} failed (HTTP ${response.status}).`);
  }

  return Array.isArray(body) ? body : body ? [body] : [];
}

async function callRuntypeAction(config, url, payload, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: productHeaders(config, "runtype"),
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Runtype action failed (HTTP ${response.status}).`);
  }
  return body;
}

function productHeaders(config, target) {
  const headers = { "Content-Type": "application/json" };
  if (target === "insforge") {
    headers.Authorization = `Bearer ${config.insforgeAnonKey}`;
  }
  if (target === "runtype" && config.runtypeProductApiKey) {
    headers.Authorization = `Bearer ${config.runtypeProductApiKey}`;
  }
  return headers;
}

function normalizeScoreEnvelope(body, post) {
  const direct = body?.scoreResponse || body?.result?.scoreResponse || body?.detector || body;
  const result = body?.result || body?.slopScoreResult || null;

  return {
    scoreResponse: {
      ...direct,
      ok: direct?.ok !== false,
      contentKey: direct?.contentKey || post?.contentKey,
      detectorScore: numberOrNull(direct?.detectorScore ?? direct?.detector_score),
      evidenceCoverage: Number(direct?.evidenceCoverage ?? direct?.evidence_coverage ?? 0),
      labelRecommendation: direct?.labelRecommendation || direct?.label || result?.label || "gray",
      reasons: direct?.reasons || direct?.reasonCodes || [],
      modalityScores: direct?.modalityScores || direct?.modality_scores || {},
      modelName: direct?.modelName || direct?.model_name || "runtype-score-post",
      modelVersion: direct?.modelVersion || direct?.model_version || "unknown",
      errorCode: direct?.errorCode || direct?.error_code,
    },
    communityAggregate: body?.communityAggregate || body?.community_aggregate || null,
    rateLimit: body?.rateLimit || body?.rate_limit || body?.scorePlan || null,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
