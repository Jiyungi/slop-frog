import type { ExtensionSettings } from "./contracts";

export const DEFAULT_SCORING_API_URL = "";

export const DEFAULT_MODAL_DETECTOR_URL = "";

export const DEFAULT_RED_THRESHOLD = 75;

export const DEFAULT_YELLOW_THRESHOLD = 40;

export const DEFAULT_EVIDENCE_COVERAGE_MINIMUM = 50;

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  evidenceCoverageMinimum: DEFAULT_EVIDENCE_COVERAGE_MINIMUM,
  redThreshold: DEFAULT_RED_THRESHOLD,
  yellowThreshold: DEFAULT_YELLOW_THRESHOLD,
  scoringApiUrl: DEFAULT_SCORING_API_URL,
  modalDetectorUrl: DEFAULT_MODAL_DETECTOR_URL,
  showNumericScore: false,
  autoFilterRed: false,
  publicQuota: 1,
  userTier: "public_guest",
};
