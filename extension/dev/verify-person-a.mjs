import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const extensionRoot = path.resolve("extension");
const manifest = readJson("manifest.json");

assert(manifest.manifest_version === 3, "manifest is MV3");
assert(!JSON.stringify(manifest).includes("<all_urls>"), "manifest avoids all_urls");

const manifestRefs = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((script) => script.js),
];

for (const ref of manifestRefs) {
  assert(fs.existsSync(path.join(extensionRoot, ref)), `manifest ref exists: ${ref}`);
}

const runtime = loadRuntime();
assert(runtime.labelForScore(76) === "red", "76 is red");
assert(runtime.labelForScore(75) === "yellow", "75 is yellow boundary");
assert(runtime.labelForScore(40) === "yellow", "40 is yellow boundary");
assert(runtime.labelForScore(39) === "green", "39 is green");

const gray = runtime.composeSlopScore(
  runtime.makeGrayScoreResponse("not_enough_signal"),
  null,
  runtime.DEFAULT_EXTENSION_SETTINGS
);
assert(gray.label === "gray", "gray response stays gray");
assert(gray.slopScore === null, "gray response has no Slop Score");

const scored = runtime.composeSlopScore(
  {
    ok: true,
    contentKey: "x:fixture",
    detectorScore: 80,
    evidenceCoverage: 80,
    labelRecommendation: "red",
    reasons: ["fixture"],
  },
  { weightedAiScore: 40 },
  runtime.DEFAULT_EXTENSION_SETTINGS
);
assert(scored.slopScore === 70, "Slop Score combines detector/community");
assert(scored.label === "yellow", "combined score can soften detector label");

const contentScript = fs.readFileSync(
  path.join(extensionRoot, "src/content/index.js"),
  "utf8"
);
assert(
  contentScript.includes('article[data-testid="tweet"]'),
  "content script scans X tweet articles"
);
assert(
  contentScript.includes('"SLOP_FROG_SUBMIT_VOTE"'),
  "feedback panel sends vote action"
);
assert(
  contentScript.includes('"SLOP_FROG_SUBMIT_APPEAL"'),
  "appeal panel sends appeal action"
);
assert(
  contentScript.includes('label: "Scoring"'),
  "pending detector state shows Scoring, not Gray"
);
assert(
  contentScript.includes('slot.className = "slop-frog-slot"') &&
    contentScript.includes('article.classList.add("slop-frog-anchored")') &&
    contentScript.includes("position: absolute"),
  "controls are anchored to article bottom-left"
);
assert(
  contentScript.includes("function el(tag, props = {}, ...children)"),
  "DOM helper accepts multiple children"
);
assert(
  sliceFunction(contentScript, "createEvidencePanel").includes('"Slop Score"'),
  "evidence panel renders Slop Score row"
);
assert(
  contentScript.includes("createPanelCloseButton") &&
    contentScript.includes('close.textContent = "×"'),
  "panels include a close button"
);
assert(
  contentScript.includes("closePanelsOnEscape") &&
    contentScript.includes('event.key !== "Escape"'),
  "panels can close with Escape"
);
assert(
  !sliceFunction(contentScript, "createEvidencePanel").includes("Looks AI"),
  "evidence panel does not contain feedback choices"
);
assert(
  !sliceFunction(contentScript, "createEvidencePanel").includes("Appeal sent"),
  "evidence panel does not contain appeal flow"
);

const fixture = fs.readFileSync(path.join(extensionRoot, "dev/x-feed-fixture.html"), "utf8");
const fixturePosts = fixture.match(/data-testid="tweet"/g) || [];
assert(fixturePosts.length === 3, "fixture includes three X-style posts");

const popupHtml = fs.readFileSync(path.join(extensionRoot, "src/popup/popup.html"), "utf8");
assert(!popupHtml.includes("Detector URL"), "popup hides detector URL");
assert(popupHtml.includes('class="frog"'), "popup includes frog brand mark");

const popupCss = fs.readFileSync(path.join(extensionRoot, "src/popup/popup.css"), "utf8");
assert(popupCss.includes("--frog-display"), "popup uses a separate display font for the brand");
assert(contentScript.includes("--sf-display"), "feed UI declares a separate display font");
assert(!popupCss.includes("ui-rounded"), "popup avoids ui-rounded dependency");

console.log("Person A verification passed");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(extensionRoot, relativePath), "utf8"));
}

function loadRuntime() {
  const context = {
    globalThis: {},
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(extensionRoot, "src/shared/runtime.js"), "utf8"),
    context
  );
  return context.SlopFrogRuntime;
}

function sliceFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  if (start === -1) return "";
  const next = source.indexOf("\n  function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}
