import "../shared/runtime.js";
import {
  fetchCommunityAggregate,
  isSupabaseConfigured,
  submitAppeal,
  submitCommunityVote,
} from "../shared/supabase.mjs";

const runtime = globalThis.SlopFrogRuntime;
const memoryCache = new Map();
const SUPABASE_CONFIG_STORAGE_KEY = "slopFrog.supabaseConfig";
const SUPABASE_LOCAL_CONFIG_PATH = "src/shared/supabase-config.local.json";
const AUTO_FILTER_OPT_IN_STORAGE_KEY = "slopFrog.autoFilterOptInDefault.v1";
const SUPPORTED_PLATFORMS = new Set(["x", "linkedin"]);
const DETECTOR_SCORE_TIMEOUT_MS = 20_000;
let supabaseConfigPromise;

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
    default:
      return { ok: false, error: "unknown_message_type" };
  }
}

async function getStatus() {
  const settings = await getEffectiveSettings();
  const [detector, supabase] = await Promise.all([
    fetchDetectorHealth(settings.localDetectorUrl),
    getSupabaseStatus(),
  ]);

  return {
    ok: true,
    settings,
    detector,
    supabase,
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

  const [detectorResponse, communityAggregate] = await Promise.all([
    callLocalDetector(post, settings),
    fetchCommunityAggregateForPost(post),
  ]);
  const response = buildPanelResponse(
    post,
    detectorResponse,
    communityAggregate,
    settings
  );

  remember(cacheKey, response);
  return response;
}

async function getSupabaseStatus() {
  const config = await getSupabaseConfig();
  if (!isSupabaseConfigured(config)) {
    return {
      ok: false,
      status: "offline",
      label: "Not configured",
      detail: "Run extension/dev/configure-supabase-from-env.mjs before loading the extension.",
    };
  }

  try {
    // A read for a non-existent key validates the live RPC path without
    // creating records or exposing the underlying community tables.
    await fetchCommunityAggregate(config, "slop-frog:connection-check");
    return {
      ok: true,
      status: "connected",
      label: "Connected",
      detail: "Supabase community layer is ready.",
    };
  } catch (error) {
    return {
      ok: false,
      status: "offline",
      label: "Not connected",
      detail: error?.message || "Supabase connection failed.",
    };
  }
}

async function getSupabaseConfig() {
  if (!supabaseConfigPromise) {
    supabaseConfigPromise = loadSupabaseConfig();
  }
  return supabaseConfigPromise;
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
  const config = await getSupabaseConfig();
  const detectorUrl = config.detectorUrl || config.localDetectorUrl;
  if (!detectorUrl) return settings;
  return {
    ...settings,
    localDetectorUrl: detectorUrl,
  };
}

async function loadSupabaseConfig() {
  const stored = await runtime.chromeGet(SUPABASE_CONFIG_STORAGE_KEY);
  const storedConfig = stored[SUPABASE_CONFIG_STORAGE_KEY] || {};

  try {
    const response = await fetch(chrome.runtime.getURL(SUPABASE_LOCAL_CONFIG_PATH));
    if (!response.ok) return storedConfig;
    const localConfig = await response.json();
    return { ...localConfig, ...storedConfig };
  } catch {
    return storedConfig;
  }
}

async function fetchCommunityAggregateForPost(post) {
  const config = await getSupabaseConfig();
  if (!isSupabaseConfigured(config)) return null;

  try {
    return await fetchCommunityAggregate(config, post.contentKey);
  } catch {
    // The local detector is still useful when the optional community layer is
    // offline. The popup reports the connection state separately.
    return null;
  }
}

async function fetchDetectorHealth(localDetectorUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    detectorTimeoutMs(localDetectorUrl, "health")
  );

  try {
    const response = await fetch(`${trimSlash(localDetectorUrl)}/health`, {
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
      detail: payload.model_loaded ? "Local model ready" : "Local model unavailable",
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
          : "Start local detector",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callLocalDetector(post, settings) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    detectorTimeoutMs(settings.localDetectorUrl, "score")
  );

  try {
    const response = await fetch(`${trimSlash(settings.localDetectorUrl)}/score`, {
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

  const config = await getSupabaseConfig();
  if (!isSupabaseConfigured(config)) {
    return { ok: false, error: "supabase_not_configured" };
  }

  try {
    const savedVote = await submitCommunityVote(config, {
      contentKey: post.contentKey,
      platform: post.platform,
      vote: payload?.vote,
      reviewerId: config.demoReviewerId,
      tweetId: post.tweetId,
      url: post.url,
      textHash: post.textHash,
      textSnapshot: post.normalizedText,
      authorHandle: post.authorHandle,
    });
    const communityAggregate = await fetchCommunityAggregate(config, post.contentKey);
    updateCachedCommunityPanel(post.contentKey, communityAggregate);
    return { ok: true, savedVote, communityAggregate };
  } catch (error) {
    return { ok: false, error: error?.message || "supabase_vote_failed" };
  }
}

async function submitPostAppeal(payload) {
  const post = resolveActionPost(payload);
  if (!post) return { ok: false, error: "missing_post_context" };

  const config = await getSupabaseConfig();
  if (!isSupabaseConfigured(config)) {
    return { ok: false, error: "supabase_not_configured" };
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
    return { ok: false, error: error?.message || "supabase_appeal_failed" };
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

function buildPanelResponse(post, scoreResponse, communityAggregate, settings) {
  const result = runtime.composeSlopScore(
    { ...scoreResponse, contentKey: post?.contentKey || "" },
    communityAggregate,
    settings
  );

  return {
    ok: true,
    post,
    result,
    scoreResponse,
    communityAggregate,
    scoreHistory: [],
    volumeHistory: [],
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
  return String(value || runtime.LOCAL_DETECTOR_URL).replace(/\/+$/, "");
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
