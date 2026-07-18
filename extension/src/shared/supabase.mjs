const REQUIRED_CONFIG_FIELDS = ["url", "publishableKey"];

export function isSupabaseConfigured(config) {
  return REQUIRED_CONFIG_FIELDS.every((field) => Boolean(config?.[field]));
}

export async function submitCommunityVote(config, vote, fetchImpl = globalThis.fetch) {
  if (!isSupabaseConfigured(config)) {
    throw new Error("Supabase is not configured for this extension.");
  }

  if (!vote?.contentKey || !vote?.platform || !vote?.vote || !vote?.reviewerId) {
    throw new Error("A content key, platform, vote, and reviewer ID are required.");
  }

  const response = await fetchImpl(
    `${String(config.url).replace(/\/+$/, "")}/rest/v1/rpc/submit_community_vote`,
    {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_content_key: vote.contentKey,
        p_platform: vote.platform,
        p_vote: vote.vote,
        p_reviewer_id: vote.reviewerId,
        p_tweet_id: vote.tweetId ?? null,
        p_url: vote.url ?? null,
        p_text_hash: vote.textHash ?? null,
        p_text_snapshot: vote.textSnapshot ?? null,
        p_author_handle: vote.authorHandle ?? null,
      }),
    }
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || `Supabase vote request failed (HTTP ${response.status}).`);
  }

  if (!Array.isArray(body) || body.length !== 1) {
    throw new Error("Supabase did not return the saved community vote.");
  }

  const savedVote = body[0];
  return {
    contentKey: savedVote.content_key,
    reviewerId: savedVote.reviewer_id,
    vote: savedVote.vote,
    reviewerWeight: Number(savedVote.reviewer_weight),
    createdAt: savedVote.created_at,
  };
}

export async function fetchCommunityAggregate(
  config,
  contentKey,
  fetchImpl = globalThis.fetch
) {
  if (!isSupabaseConfigured(config)) {
    throw new Error("Supabase is not configured for this extension.");
  }

  if (!contentKey) {
    throw new Error("A content key is required to fetch a community aggregate.");
  }

  const response = await fetchImpl(
    `${String(config.url).replace(/\/+$/, "")}/rest/v1/rpc/get_community_aggregate`,
    {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_content_key: contentKey }),
    }
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      body?.message || `Supabase aggregate request failed (HTTP ${response.status}).`
    );
  }

  if (!Array.isArray(body) || body.length > 1) {
    throw new Error("Supabase returned an invalid community aggregate response.");
  }

  if (body.length === 0) return null;

  const aggregate = body[0];
  return {
    contentKey: aggregate.content_key,
    voteCount: Number(aggregate.vote_count),
    weightedAiScore:
      aggregate.weighted_ai_score === null ? null : Number(aggregate.weighted_ai_score),
    looksAiWeight: Number(aggregate.looks_ai_weight),
    looksHumanWeight: Number(aggregate.looks_human_weight),
    unsureWeight: Number(aggregate.unsure_weight),
    appealStatus: aggregate.appeal_status,
    latestVerdictLabel: aggregate.latest_verdict_label,
    updatedAt: aggregate.updated_at,
  };
}
