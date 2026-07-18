import "../shared/runtime.js";

const runtime = globalThis.SlopFrogRuntime;
const memoryCache = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await runtime.getSettings();
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
      return { ok: true, settings: await runtime.getSettings() };
    case "SLOP_FROG_SAVE_SETTINGS":
      return {
        ok: true,
        settings: await runtime.saveSettings(message.settings),
      };
    case "SLOP_FROG_GET_STATUS":
      return getStatus();
    case "SLOP_FROG_SCORE_POST":
      return scorePost(message.post);
    case "SLOP_FROG_SUBMIT_VOTE":
      return storeLocalAction("vote", message.payload);
    case "SLOP_FROG_SUBMIT_APPEAL":
      return storeLocalAction("appeal", message.payload);
    default:
      return { ok: false, error: "unknown_message_type" };
  }
}

async function getStatus() {
  const settings = await runtime.getSettings();
  const detector = await fetchDetectorHealth(settings.localDetectorUrl);

  return {
    ok: true,
    settings,
    detector,
    supabase: {
      ok: false,
      status: "pending",
      label: "Pending",
      detail: "Person B will connect Supabase actions.",
    },
  };
}

async function scorePost(post) {
  const settings = await runtime.getSettings();
  const cacheKey = post?.contentKey;

  if (!cacheKey) {
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

  const detectorResponse = await callLocalDetector(post, settings);
  const communityAggregate = null;
  const response = buildPanelResponse(
    post,
    detectorResponse,
    communityAggregate,
    settings
  );

  remember(cacheKey, response);
  return response;
}

async function fetchDetectorHealth(localDetectorUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1600);

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
    return {
      ok: Boolean(payload.ok),
      status: payload.ok ? "connected" : "offline",
      label: payload.ok ? "Connected" : "Not connected",
      detail: payload.modelName || localDetectorUrl,
      modelName: payload.modelName,
      modelVersion: payload.modelVersion,
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
  const timeoutId = setTimeout(() => controller.abort(), 4200);

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

function buildPanelResponse(post, scoreResponse, communityAggregate, settings) {
  const result = runtime.composeSlopScore(
    { ...scoreResponse, contentKey: post?.contentKey || "" },
    communityAggregate,
    settings
  );

  const scoreHistory = makeScoreHistory(result);
  const volumeHistory = makeVolumeHistory(result);

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

function makeScoreHistory(result) {
  const score = result.slopScore ?? result.detectorScore ?? null;
  if (score === null) return [];
  const now = Date.now();
  return [3, 2, 1, 0].map((daysAgo, index) => ({
    createdAt: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    slopScore: Math.max(0, Math.min(100, score - (3 - index) * 4)),
    label: result.label,
  }));
}

function makeVolumeHistory(result) {
  const score = result.slopScore ?? result.detectorScore ?? null;
  if (score === null) return [];
  return [1, 4, 9, 16].map((volume, index) => ({
    volume,
    slopScore: Math.max(0, Math.min(100, score - (3 - index) * 3)),
  }));
}

async function storeLocalAction(kind, payload) {
  const key = `slopFrog.${kind}s`;
  const stored = await runtime.chromeGet(key);
  const next = [...(stored[key] || []), { ...payload, createdAt: new Date().toISOString() }];
  await runtime.chromeSet({ [key]: next.slice(-50) });
  return { ok: true, pendingSupabase: true };
}

function remember(cacheKey, response) {
  memoryCache.set(cacheKey, response);
  while (memoryCache.size > runtime.MAX_CACHE_ITEMS) {
    const oldestKey = memoryCache.keys().next().value;
    memoryCache.delete(oldestKey);
  }
}

function trimSlash(value) {
  return String(value || runtime.LOCAL_DETECTOR_URL).replace(/\/+$/, "");
}
