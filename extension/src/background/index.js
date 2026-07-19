import "../shared/runtime.js";
import {
  fetchVerdictHistory,
  fetchCommunityAggregate,
  isInsForgeConfigured,
  isProductApiConfigured,
  recordScoreCache,
  resolveScorePlan,
  scorePostViaRuntype,
  submitAppeal,
  submitCommunityVote,
} from "../shared/product-api.mjs";

const runtime = globalThis.SlopFrogRuntime;
const memoryCache = new Map();
const PRODUCT_API_CONFIG_STORAGE_KEY = "slopFrog.productApiConfig";
const PRODUCT_API_LOCAL_CONFIG_PATH = "src/shared/product-api-config.local.json";
const AUTO_FILTER_OPT_IN_STORAGE_KEY = "slopFrog.autoFilterOptInDefault.v1";
const SUPPORTED_PLATFORMS = new Set(["x", "linkedin"]);
const DETECTOR_SCORE_TIMEOUT_MS = 20_000;
let productApiConfigPromise;

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getEffectiveSettings();
  await runtime.saveSettings(settings);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  routeMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || "unknown_error",
      });
    });
  return true;
});

async function routeMessage(message) {
  switch (message?.type) {
    case "SLOP_FROG_GET_SETTINGS":
      return { ok: true, settings: await getEffectiveSettings() };
    case "SLOP_FROG_SAVE_SETTINGS": {
      const current = await runtime.getSettings();
      const saved = await runtime.saveSettings({ ...current, ...(message.settings || {}) });
      const effectiveSettings = await applyLocalRuntimeConfig(saved);
      notifySettingsChanged(effectiveSettings);
      return {
        ok: true,
        settings: effectiveSettings,
      };
    }
    case "SLOP_FROG_GET_STATUS":
      return getStatus();
    case "SLOP_FROG_SCORE_POST":
      return scorePost(message.post);
    case "SLOP_FROG_SUBMIT_VOTE":
      return submitVote(message.payload);
    case "SLOP_FROG_SUBMIT_APPEAL":
      return submitPostAppeal(message.payload);
    case "SLOP_FROG_TEST_SET_PRODUCT_CONFIG":
      return setProductConfigForTest(message.config);
    default:
      return { ok: false, error: "unknown_message_type" };
  }
}

async function getStatus() {
  const settings = await getEffectiveSettings();
  const [detector, backend, runtype] = await Promise.all([
    fetchDetectorHealth(resolveDetectorUrl(settings)),
    getBackendStatus(),
    getRuntypeStatus(),
  ]);

  return {
    ok: true,
    settings,
    detector,
    backend,
    runtype,
  };
}

async function scorePost(post) {
  const settings = await getEffectiveSettings();
  const cacheKey = post?.contentKey;

  if (!cacheKey || !SUPPORTED_PLATFORMS.has(post?.platform)) {
    return buildPanelResponse(
      post,
      runtime.makeGrayScoreResponse("extraction_failed"),
      null,
      settings
    );
  }

  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  const config = await getProductApiConfig();
  const subjectKey = await runtime.getInstallSubjectKey();
  const { detectorResponse, communityAggregate, scoreHistory, volumeHistory } =
    await scorePostThroughProductPath(post, settings, config, subjectKey);
  const response = buildPanelResponse(
    post,
    detectorResponse,
    communityAggregate,
    settings,
    scoreHistory,
    volumeHistory
  );

  remember(cacheKey, response);
  return response;
}

async function getBackendStatus() {
  const config = await getProductApiConfig();
  if (!isInsForgeConfigured(config)) {
    return {
      ok: false,
      status: "offline",
      label: "Not configured",
      detail: "Run extension/dev/configure-product-api-from-env.mjs before loading the extension.",
    };
  }

  try {
    await fetchCommunityAggregate(config, "slop-frog:connection-check");
    return {
      ok: true,
      status: "connected",
      label: "Connected",
      detail: "InsForge community layer is ready.",
    };
  } catch (error) {
    return {
      ok: false,
      status: "offline",
      label: "Not connected",
      detail: error?.message || "InsForge connection failed.",
    };
  }
}

async function getRuntypeStatus() {
  const config = await getProductApiConfig();
  if (!config.runtypeScorePostUrl) {
    return {
      ok: false,
      status: "offline",
      label: "Not configured",
      detail: "Runtype score endpoint is not configured.",
    };
  }
  return {
    ok: true,
    status: "connected",
    label: "Configured",
    detail: "Runtype score endpoint is configured.",
  };
}

async function getProductApiConfig() {
  if (!productApiConfigPromise) {
    productApiConfigPromise = loadProductApiConfig();
  }
  return productApiConfigPromise;
}

async function setProductConfigForTest(config) {
  if (!config || config.testOnly !== true) {
    return { ok: false, error: "test_config_requires_testOnly_true" };
  }
  const storedConfig = { ...config };
  delete storedConfig.testOnly;
  await runtime.chromeSet({ [PRODUCT_API_CONFIG_STORAGE_KEY]: storedConfig });
  productApiConfigPromise = null;
  memoryCache.clear();
  return { ok: true };
}

async function getEffectiveSettings() {
  return applyLocalRuntimeConfig(await getMigratedSettings());
}

async function getMigratedSettings() {
  const settings = await runtime.getSettings();
  const marker = await runtime.chromeGet(AUTO_FILTER_OPT_IN_STORAGE_KEY);
  if (marker[AUTO_FILTER_OPT_IN_STORAGE_KEY]) return settings;

  const migratedSettings = await runtime.saveSettings({
    ...settings,
    autoFilterRed: false,
  });
  await runtime.chromeSet({ [AUTO_FILTER_OPT_IN_STORAGE_KEY]: true });
  return migratedSettings;
}

async function applyLocalRuntimeConfig(settings) {
  const config = await getProductApiConfig();
  return {
    ...settings,
    scoringApiUrl: config.runtypeScorePostUrl || settings.scoringApiUrl || "",
    modalDetectorUrl:
      config.modalDetectorUrl ||
      settings.modalDetectorUrl ||
      "",
    publicQuota: Number(config.publicQuota || settings.publicQuota || 15),
    userTier:
      config.ownerReviewerId && config.ownerReviewerId === config.demoReviewerId
        ? "owner_admin"
        : settings.userTier || "public_guest",
  };
}

async function loadProductApiConfig() {
  const stored = await runtime.chromeGet(PRODUCT_API_CONFIG_STORAGE_KEY);
  const storedConfig = stored[PRODUCT_API_CONFIG_STORAGE_KEY] || {};

  try {
    const response = await fetch(chrome.runtime.getURL(PRODUCT_API_LOCAL_CONFIG_PATH));
    if (!response.ok) return storedConfig;
    const localConfig = await response.json();
    return { ...localConfig, ...storedConfig };
  } catch {
    return storedConfig;
  }
}

async function fetchCommunityAggregateForPost(post) {
  const config = await getProductApiConfig();
  if (!isInsForgeConfigured(config)) return null;

  try {
    return await fetchCommunityAggregate(config, post.contentKey);
  } catch {
    // The local detector is still useful when the optional community layer is
    // offline. The popup reports the connection state separately.
    return null;
  }
}

async function fetchDetectorHealth(detectorUrl) {
  if (!detectorUrl) {
    return {
      ok: false,
      status: "offline",
      label: "Not configured",
      detail: "No detector endpoint configured.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
      detectorTimeoutMs(detectorUrl, "health")
  );

  try {
    const response = await fetch(`${trimSlash(detectorUrl)}/health`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        status: "offline",
        label: "Not connected",
        detail: `HTTP ${response.status}`,
      };
    }
    const payload = await response.json();
    const isReady = payload.status === "ok";
    return {
      ok: isReady,
      status: isReady ? "connected" : "offline",
      label: isReady ? "Connected" : "Not connected",
      detail: payload.model_loaded ? "Detector ready" : "Detector unavailable",
      modelLoaded: Boolean(payload.model_loaded),
      service: payload.service,
      version: payload.version,
    };
  } catch (error) {
    return {
      ok: false,
      status: "offline",
      label: "Not connected",
      detail:
        error?.name === "AbortError"
          ? "Detector timed out"
          : "Detector unavailable",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scorePostThroughProductPath(post, settings, config, subjectKey) {
  const base = {
    detectorResponse: runtime.makeGrayScoreResponse("detector_unavailable"),
    communityAggregate: null,
    scoreHistory: [],
    volumeHistory: [],
  };

  const communityPromise = fetchCommunityAggregateForPost(post);
  let plan = null;

  if (isInsForgeConfigured(config)) {
    plan = await resolveScorePlan(config, {
      contentKey: post.contentKey,
      platform: post.platform,
      subjectKey,
      tier: settings.userTier,
      publicQuota: settings.publicQuota,
    }).catch(() => null);

    if (plan?.decision === "cache_hit") {
      const cachedResponse = makeCachedScoreResponse(post, plan);
      return {
        detectorResponse: cachedResponse,
        communityAggregate: await communityPromise,
        ...(await historyPayloadForPost(post)),
      };
    }

    if (plan?.decision === "rate_limited") {
      const rateLimited = runtime.makeGrayScoreResponse("rate_limited", "slop-frog-quota");
      rateLimited.contentKey = post.contentKey;
      rateLimited.rateLimitDecision = "rate_limited";
      return {
        detectorResponse: rateLimited,
        communityAggregate: await communityPromise,
        ...(await historyPayloadForPost(post)),
      };
    }
  }

  if (!config.runtypeScorePostUrl && config.allowDirectDetectorFallback === false) {
    const noApi = runtime.makeGrayScoreResponse("product_api_unavailable", "slop-frog-product-api");
    noApi.contentKey = post.contentKey;
    return { ...base, detectorResponse: noApi };
  }

  const detectorResponse = await callPreferredDetector(post, settings, config, subjectKey);
  if (plan?.decision) detectorResponse.rateLimitDecision = plan.decision;

  if (isInsForgeConfigured(config) && detectorResponse?.ok) {
    await recordScoreCache(config, {
      contentKey: post.contentKey,
      platform: post.platform,
      detectorScore: detectorResponse.detectorScore,
      evidenceCoverage: detectorResponse.evidenceCoverage,
      label: detectorResponse.labelRecommendation,
      modelName: detectorResponse.modelName,
      modelVersion: detectorResponse.modelVersion,
      reasons: detectorResponse.reasons,
    }).catch(() => null);
  }

  return {
    detectorResponse,
    communityAggregate: await communityPromise,
    ...(await historyPayloadForPost(post)),
  };
}

async function callPreferredDetector(post, settings, config, subjectKey) {
  if (isProductApiConfigured(config) && config.runtypeScorePostUrl) {
    try {
      const scored = await scorePostViaRuntype(config, {
        post,
        platform: post.platform,
        postUrl: post.url,
        contentHash: post.contentKey,
        postText: post.normalizedText || post.visibleText || "",
        settings: {
          evidenceCoverageMinimum: settings.evidenceCoverageMinimum,
          redThreshold: settings.redThreshold,
          yellowThreshold: settings.yellowThreshold,
        },
        subjectKey,
        tier: settings.userTier,
        publicQuota: settings.publicQuota,
      });
      return scored.scoreResponse;
    } catch {
      // Fall through to the direct Modal/local debug path for demo resilience.
    }
  }

  if (config.allowDirectDetectorFallback === false) {
    const noApi = runtime.makeGrayScoreResponse("product_api_unavailable", "slop-frog-product-api");
    noApi.contentKey = post.contentKey;
    return noApi;
  }

  return callDetector(post, settings, resolveDetectorUrl(settings, config));
}

async function historyPayloadForPost(post) {
  const scoreHistory = await fetchHistoryForPost(post);
  return {
    scoreHistory,
    volumeHistory: volumeFromHistory(scoreHistory),
  };
}

async function callDetector(post, settings, detectorUrl) {
  if (!detectorUrl) {
    return runtime.makeGrayScoreResponse("detector_not_configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    detectorTimeoutMs(detectorUrl, "score")
  );

  try {
    const response = await fetch(`${trimSlash(detectorUrl)}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        post,
        settings: {
          evidenceCoverageMinimum: settings.evidenceCoverageMinimum,
          redThreshold: settings.redThreshold,
          yellowThreshold: settings.yellowThreshold,
        },
      }),
    });

    if (!response.ok) {
      return runtime.makeGrayScoreResponse(`detector_http_${response.status}`);
    }

    const payload = await response.json();
    return {
      ...payload,
      contentKey: post.contentKey,
    };
  } catch (error) {
    return runtime.makeGrayScoreResponse(
      error?.name === "AbortError" ? "detector_timeout" : "detector_unavailable"
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function submitVote(payload) {
  const post = resolveActionPost(payload);
  if (!post) return { ok: false, error: "missing_post_context" };

  const config = await getProductApiConfig();
  if (!isInsForgeConfigured(config)) {
    return { ok: false, error: "insforge_not_configured" };
  }

  try {
    const savedVote = await submitCommunityVote(config, {
      contentKey: post.contentKey,
      platform: post.platform,
      vote: payload?.vote,
      reviewerId: config.demoReviewerId,
      postId: post.postId,
      tweetId: post.tweetId,
      url: post.url,
      textHash: post.textHash,
      textSnapshot: post.normalizedText,
      authorHandle: post.authorHandle,
    });
    const communityAggregate =
      (await fetchCommunityAggregate(config, post.contentKey)) ||
      communityAggregateFromSavedVote(post.contentKey, savedVote, payload?.vote);
    updateCachedCommunityPanel(post.contentKey, communityAggregate);
    return { ok: true, savedVote, communityAggregate };
  } catch (error) {
    return { ok: false, error: error?.message || "insforge_vote_failed" };
  }
}

async function submitPostAppeal(payload) {
  const post = resolveActionPost(payload);
  if (!post) return { ok: false, error: "missing_post_context" };

  const config = await getProductApiConfig();
  if (!isInsForgeConfigured(config)) {
    return { ok: false, error: "insforge_not_configured" };
  }

  try {
    const savedAppeal = await submitAppeal(config, {
      contentKey: post.contentKey,
      reviewerId: config.demoReviewerId,
      reason: payload?.reason,
      status: payload?.status || "submitted",
    });
    const communityAggregate = await fetchCommunityAggregate(config, post.contentKey);
    updateCachedCommunityPanel(post.contentKey, communityAggregate);
    return { ok: true, savedAppeal, communityAggregate };
  } catch (error) {
    return { ok: false, error: error?.message || "insforge_appeal_failed" };
  }
}

function resolveActionPost(payload) {
  const post = payload?.post || memoryCache.get(payload?.contentKey)?.post;
  if (!post?.contentKey || !SUPPORTED_PLATFORMS.has(post.platform)) return null;
  return post;
}

function updateCachedCommunityPanel(contentKey, communityAggregate) {
  const cached = memoryCache.get(contentKey);
  if (!cached) return;
  remember(
    contentKey,
    buildPanelResponse(
      cached.post,
      cached.scoreResponse,
      communityAggregate,
      cached.settings
    )
  );
}

function communityAggregateFromSavedVote(contentKey, savedVote, vote) {
  if (!savedVote && !vote) return null;
  const normalizedVote = savedVote?.vote || vote;
  const weightedAiScore =
    normalizedVote === "looks_ai" ? 100 : normalizedVote === "looks_human" ? 0 : 50;
  return {
    contentKey: savedVote?.contentKey || contentKey,
    voteCount: 1,
    communityScore: weightedAiScore,
    weightedAiScore,
    looksAiWeight: normalizedVote === "looks_ai" ? Number(savedVote?.reviewerWeight || 1) : 0,
    looksHumanWeight: normalizedVote === "looks_human" ? Number(savedVote?.reviewerWeight || 1) : 0,
    unsureWeight: normalizedVote === "unsure" ? Number(savedVote?.reviewerWeight || 1) : 0,
    appealStatus: null,
    latestVerdictLabel: null,
    updatedAt: savedVote?.createdAt || new Date().toISOString(),
  };
}

function buildPanelResponse(
  post,
  scoreResponse,
  communityAggregate,
  settings,
  scoreHistory = [],
  volumeHistory = []
) {
  const result = runtime.composeSlopScore(
    { ...scoreResponse, contentKey: post?.contentKey || "", platform: post?.platform || "" },
    communityAggregate,
    settings
  );

  return {
    ok: true,
    post,
    result,
    scoreResponse,
    communityAggregate,
    scoreHistory,
    volumeHistory,
    settings,
  };
}

function remember(cacheKey, response) {
  memoryCache.set(cacheKey, response);
  while (memoryCache.size > runtime.MAX_CACHE_ITEMS) {
    const oldestKey = memoryCache.keys().next().value;
    memoryCache.delete(oldestKey);
  }
}

function notifySettingsChanged(nextSettings) {
  chrome.tabs?.query?.({ url: supportedTabUrlPatterns() }, (tabs) => {
    for (const tab of tabs || []) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(
        tab.id,
        { type: "SLOP_FROG_SETTINGS_CHANGED", settings: nextSettings },
        () => void chrome.runtime.lastError
      );
    }
  });
}

function supportedTabUrlPatterns() {
  return [
    "https://x.com/*",
    "https://twitter.com/*",
    "https://www.linkedin.com/*",
    "https://linkedin.com/*",
  ];
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function resolveDetectorUrl(settings, config = {}) {
  return trimSlash(config?.modalDetectorUrl || settings?.modalDetectorUrl || "");
}

function makeCachedScoreResponse(post, plan) {
  return {
    ok: true,
    contentKey: post.contentKey,
    detectorScore:
      plan.cached_detector_score === null || plan.cached_detector_score === undefined
        ? null
        : Number(plan.cached_detector_score),
    evidenceCoverage: 100,
    labelRecommendation: plan.cached_label || "gray",
    reasons: Array.isArray(plan.cached_reasons) ? plan.cached_reasons : ["cache_hit"],
    modalityScores: {
      text: {
        status: "available",
        score:
          plan.cached_detector_score === null || plan.cached_detector_score === undefined
            ? undefined
            : Number(plan.cached_detector_score),
      },
      image: { status: "unsupported", reason: "mvp_text_first" },
      audio: { status: "unsupported", reason: "mvp_text_first" },
      video: { status: "unsupported", reason: "mvp_text_first" },
    },
    modelName: plan.cached_model_name || "slop-frog-score-cache",
    modelVersion: plan.cached_model_version || "cached",
    rateLimitDecision: "cache_hit",
  };
}

async function fetchHistoryForPost(post) {
  const config = await getProductApiConfig();
  if (!isInsForgeConfigured(config)) return [];
  return fetchVerdictHistory(config, post.contentKey).catch(() => []);
}

function volumeFromHistory(history) {
  return (history || [])
    .filter((point) => point.slopScore !== null && point.slopScore !== undefined)
    .map((point, index) => ({
      volume: index + 1,
      slopScore: point.slopScore,
    }));
}

function detectorTimeoutMs(detectorUrl, purpose) {
  const host = safeHost(detectorUrl);
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "";
  if (isLocal) return purpose === "health" ? 1600 : DETECTOR_SCORE_TIMEOUT_MS;
  return purpose === "health" ? 90_000 : 140_000;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
