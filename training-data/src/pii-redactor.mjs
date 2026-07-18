import crypto from "node:crypto";

export const CLEANER_VERSION = "slop-frog-cleaner-0.1.0";

const REDACTION_PATTERNS = [
  ["url", /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi, "[URL]"],
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]"],
  ["handle", /(^|[^A-Za-z0-9_])@[A-Za-z0-9_]{2,}/g, "$1[HANDLE]"],
  ["phone", /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, "[PHONE]"],
  ["ssn", /\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]"],
  ["card", /\b(?:\d[ -]*?){13,19}\b/g, "[CARD]"],
  ["ip", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]"],
  [
    "street_address",
    /\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl)\b/gi,
    "[ADDRESS]",
  ],
  ["wallet", /\b0x[a-fA-F0-9]{32,}\b/g, "[WALLET]"],
  ["dob", /\b(?:DOB|date of birth|born on)\s*[:\-]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, "[DOB]"],
];

const RESIDUAL_RISK_PATTERNS = [
  /\bmy name is\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/i,
  /\bcall me at\b/i,
  /\btext me at\b/i,
  /\bemail me\b/i,
  /\bDM me\b/i,
  /\bI live at\b/i,
  /\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr)\b/i,
];

export function sanitizeText(input, options = {}) {
  const minLength = Number(options.minLength ?? 20);
  const maxLength = Number(options.maxLength ?? 1800);
  let text = normalizeWhitespace(String(input || ""));
  const replacements = {};

  for (const [name, pattern, replacement] of REDACTION_PATTERNS) {
    let count = 0;
    text = text.replace(pattern, (...args) => {
      count += 1;
      return typeof replacement === "function" ? replacement(...args) : replacement;
    });
    if (count > 0) replacements[name] = count;
  }

  text = normalizeWhitespace(text).slice(0, maxLength).trim();

  const residualRisk = RESIDUAL_RISK_PATTERNS.some((pattern) => pattern.test(text));
  const tooShort = text.length < minLength;
  const stillContainsDirectPii = REDACTION_PATTERNS.some(([_, pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });

  const status =
    tooShort || residualRisk || stillContainsDirectPii ? "blocked" : "clean";

  return {
    cleanedText: text,
    piiStatus: status,
    redactionReport: {
      cleanerVersion: CLEANER_VERSION,
      replacements,
      residualRisk,
      tooShort,
      stillContainsDirectPii,
      originalLength: String(input || "").length,
      cleanedLength: text.length,
    },
  };
}

export function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hashValue(value, salt = process.env.SLOP_FROG_DATASET_HASH_SALT || "slop-frog-local-dev") {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${String(value || "")}`)
    .digest("hex");
}

export function fingerprintCleanText(text) {
  return hashValue(normalizeWhitespace(text).toLowerCase(), "slop-frog-content-fingerprint");
}

export function deriveTargetLabel(score, options = {}) {
  const aiThreshold = Number(options.aiThreshold ?? 75);
  const humanThreshold = Number(options.humanThreshold ?? 25);
  const value = Number(score);

  if (!Number.isFinite(value)) return null;
  if (value >= aiThreshold) return "ai_generated";
  if (value <= humanThreshold) return "human_written";
  return null;
}
