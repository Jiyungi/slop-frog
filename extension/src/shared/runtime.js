(function initSlopFrogRuntime(globalScope) {
  const DEFAULT_SCORING_API_URL = "";
  const DEFAULT_MODAL_DETECTOR_URL = "";
  const DEFAULT_RED_THRESHOLD = 75;
  const DEFAULT_YELLOW_THRESHOLD = 40;
  const DEFAULT_EVIDENCE_COVERAGE_MINIMUM = 50;
  const SETTINGS_STORAGE_KEY = "slopFrog.settings";
  const CACHE_STORAGE_KEY = "slopFrog.scoreCache";
  const INSTALL_STORAGE_KEY = "slopFrog.installSubjectKey";
  const MAX_CACHE_ITEMS = 150;

  const DEFAULT_EXTENSION_SETTINGS = Object.freeze({
    evidenceCoverageMinimum: DEFAULT_EVIDENCE_COVERAGE_MINIMUM,
    redThreshold: DEFAULT_RED_THRESHOLD,
    yellowThreshold: DEFAULT_YELLOW_THRESHOLD,
    scoringApiUrl: DEFAULT_SCORING_API_URL,
    modalDetectorUrl: DEFAULT_MODAL_DETECTOR_URL,
    showNumericScore: false,
    autoFilterRed: false,
    publicQuota: 1,
    userTier: "public_guest",
  });

  const LABEL_META = Object.freeze({
    red: { label: "Red", tone: "Strong AI evidence" },
    yellow: { label: "Yellow", tone: "Mixed signal" },
    green: { label: "Green", tone: "Low AI evidence" },
    gray: { label: "Gray", tone: "Not enough signal" },
  });

  const CONTROL_META = Object.freeze([
    {
      kind: "evidence",
      icon: "Flag",
      tooltip: "View Slop Score evidence",
      ariaLabel: "View Slop Score evidence",
      opens: "evidence",
    },
    {
      kind: "feedback",
      icon: "MessageSquareCheck",
      tooltip: "Add feedback",
      ariaLabel: "Add community feedback",
      opens: "feedback",
    },
    {
      kind: "appeal",
      icon: "ShieldAlert",
      tooltip: "Appeal label",
      ariaLabel: "Appeal this label",
      opens: "appeal",
    },
  ]);

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\b(Reply|Repost|Like|Views|Share|Bookmark)\b/gi, "")
      .trim();
  }

  function stableHash(value) {
    const input = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function clampScore(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round(Number(value))));
  }

  function labelForScore(score, settings = DEFAULT_EXTENSION_SETTINGS) {
    const cleanScore = clampScore(score);
    if (cleanScore === null) return "gray";
    if (cleanScore >= settings.redThreshold) return "red";
    if (cleanScore >= settings.yellowThreshold) return "yellow";
    return "green";
  }

  function composeSlopScore(scoreResponse, communityAggregate, settings) {
    const mergedSettings = { ...DEFAULT_EXTENSION_SETTINGS, ...(settings || {}) };
    const evidenceCoverage = Number(scoreResponse?.evidenceCoverage || 0);
    const reasons = Array.isArray(scoreResponse?.reasons)
      ? [...scoreResponse.reasons]
      : [];

    if (!scoreResponse?.ok || scoreResponse?.labelRecommendation === "gray") {
      return {
        contentKey: scoreResponse?.contentKey || "",
        label: "gray",
        slopScore: null,
        detectorScore: clampScore(scoreResponse?.detectorScore),
        communityScore: clampScore(
          communityAggregate?.weightedAiScore ?? communityAggregate?.communityScore
        ),
        evidenceCoverage,
        reasons: reasons.length ? reasons : ["not_enough_signal"],
      autoFiltered: false,
      rateLimitDecision: scoreResponse?.rateLimitDecision,
      };
    }

    const detectorScore = clampScore(scoreResponse.detectorScore);
    const communityScore = clampScore(
      communityAggregate?.weightedAiScore ?? communityAggregate?.communityScore
    );
    const slopScore =
      communityScore === null
        ? detectorScore
        : clampScore(detectorScore * 0.75 + communityScore * 0.25);
    const label = labelForScore(slopScore, mergedSettings);

    return {
      contentKey: scoreResponse.contentKey || "",
      label,
      slopScore,
      detectorScore,
      communityScore,
      evidenceCoverage,
      reasons,
      autoFiltered: label === "red" && Boolean(mergedSettings.autoFilterRed),
      rateLimitDecision: scoreResponse?.rateLimitDecision,
    };
  }

  function makeGrayScoreResponse(reason, modelName = "slop-frog-extension") {
    return {
      ok: false,
      detectorScore: null,
      evidenceCoverage: 0,
      labelRecommendation: "gray",
      reasons: [reason],
      modalityScores: {
        text: { status: "error", reason },
        image: { status: "unsupported", reason: "mvp_text_first" },
        audio: { status: "unsupported", reason: "mvp_text_first" },
        video: { status: "unsupported", reason: "mvp_text_first" },
      },
      modelName,
      modelVersion: "0.1.0",
      errorCode: reason,
    };
  }

  function chromeGet(keys) {
    return new Promise((resolve) => {
      if (!globalScope.chrome?.storage?.local) {
        resolve({});
        return;
      }
      globalScope.chrome.storage.local.get(keys, resolve);
    });
  }

  function chromeSet(values) {
    return new Promise((resolve) => {
      if (!globalScope.chrome?.storage?.local) {
        resolve();
        return;
      }
      globalScope.chrome.storage.local.set(values, resolve);
    });
  }

  async function getSettings() {
    const stored = await chromeGet(SETTINGS_STORAGE_KEY);
    return {
      ...DEFAULT_EXTENSION_SETTINGS,
      ...(stored[SETTINGS_STORAGE_KEY] || {}),
    };
  }

  async function saveSettings(nextSettings) {
    const merged = {
      ...DEFAULT_EXTENSION_SETTINGS,
      ...(nextSettings || {}),
    };
    await chromeSet({ [SETTINGS_STORAGE_KEY]: merged });
    return merged;
  }

  async function getInstallSubjectKey() {
    const stored = await chromeGet(INSTALL_STORAGE_KEY);
    if (stored[INSTALL_STORAGE_KEY]) return stored[INSTALL_STORAGE_KEY];
    const random =
      globalScope.crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const subjectKey = `install:${stableHash(random)}`;
    await chromeSet({ [INSTALL_STORAGE_KEY]: subjectKey });
    return subjectKey;
  }

  globalScope.SlopFrogRuntime = Object.freeze({
    DEFAULT_SCORING_API_URL,
    DEFAULT_MODAL_DETECTOR_URL,
    DEFAULT_EXTENSION_SETTINGS,
    DEFAULT_RED_THRESHOLD,
    DEFAULT_YELLOW_THRESHOLD,
    DEFAULT_EVIDENCE_COVERAGE_MINIMUM,
    SETTINGS_STORAGE_KEY,
    CACHE_STORAGE_KEY,
    INSTALL_STORAGE_KEY,
    MAX_CACHE_ITEMS,
    LABEL_META,
    CONTROL_META,
    normalizeText,
    stableHash,
    clampScore,
    labelForScore,
    composeSlopScore,
    makeGrayScoreResponse,
    chromeGet,
    chromeSet,
    getSettings,
    saveSettings,
    getInstallSubjectKey,
  });
})(globalThis);
