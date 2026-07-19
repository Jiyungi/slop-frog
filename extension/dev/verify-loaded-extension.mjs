import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const extensionPath = path.join(repositoryRoot, "extension");
const chromeBinary =
  process.env.CHROME_BINARY ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profilePath = mkdtempSync(path.join(tmpdir(), "slop-frog-extension-check-"));

const chrome = spawn(
  chromeBinary,
  [
    "--headless=new",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
  { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] }
);

let nextCommandId = 1;
let responseBuffer = Buffer.alloc(0);
const pendingCommands = new Map();

chrome.stdio[4].on("data", (chunk) => {
  responseBuffer = Buffer.concat([responseBuffer, chunk]);
  let boundary;
  while ((boundary = responseBuffer.indexOf(0)) >= 0) {
    const message = JSON.parse(responseBuffer.subarray(0, boundary).toString("utf8"));
    responseBuffer = responseBuffer.subarray(boundary + 1);
    const pending = pendingCommands.get(message.id);
    if (!pending) continue;
    pendingCommands.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }
});

chrome.stderr.on("data", () => {
  // Chrome may emit updater diagnostics even when the extension loads cleanly.
});

try {
  await wait(700);
  const loaded = await command("Extensions.loadUnpacked", { path: extensionPath });
  assert(loaded.id, "Chrome did not return an unpacked extension ID.");

  const popupTarget = await command("Target.createTarget", {
    url: `chrome-extension://${loaded.id}/src/popup/popup.html`,
  });
  await wait(500);
  const attached = await command("Target.attachToTarget", {
    targetId: popupTarget.targetId,
    flatten: true,
  });

  const popupState = await waitForPopupState(attached.sessionId);
  const savedState = await evaluate(
    attached.sessionId,
    `new Promise((resolve) => {
      const control = document.querySelector("#autoFilterRed");
      control.checked = true;
      control.dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "SLOP_FROG_GET_SETTINGS" }, (response) => {
          resolve(JSON.stringify({
            saved: document.body.dataset.saved,
            persisted: response?.settings?.autoFilterRed
          }));
        });
      }, 150);
    })`,
    true
  );
  const targets = await command("Target.getTargets");

  const parsedPopupState = JSON.parse(popupState);
  const parsedSavedState = JSON.parse(savedState);
  assert(parsedPopupState.text.includes("Slop Frog"), "Popup did not render.");
  assert(
    parsedPopupState.endpoint === "http://localhost:8765",
    "Popup did not show the local detector endpoint."
  );
  assert(parsedPopupState.community === "connected", "Supabase was not connected in popup.");
  assert(parsedSavedState.saved === "true", "Popup did not save its setting.");
  assert(parsedSavedState.persisted === true, "chrome.storage did not persist the setting.");
  assert(
    targets.targetInfos.some(
      (target) =>
        target.type === "service_worker" &&
        target.url.startsWith(`chrome-extension://${loaded.id}/`)
    ),
    "The extension background worker did not start."
  );

  if (process.env.SLOP_FROG_EXPECT_DETECTOR) {
    assert(
      parsedPopupState.detector === process.env.SLOP_FROG_EXPECT_DETECTOR,
      `Expected detector ${process.env.SLOP_FROG_EXPECT_DETECTOR}, got ${parsedPopupState.detector}.`
    );
  }

  const scoreVerification =
    process.env.SLOP_FROG_VERIFY_SCORE === "1"
      ? await verifyBackgroundScoring(attached.sessionId)
      : null;
  const communityVerification =
    process.env.SLOP_FROG_VERIFY_SUPABASE === "1"
      ? await verifyCommunityActions(attached.sessionId)
      : null;
  const offlineVerification =
    process.env.SLOP_FROG_VERIFY_OFFLINE === "1"
      ? await verifyOfflineFallback(attached.sessionId)
      : null;

  console.log(
    JSON.stringify(
      {
        extensionId: loaded.id,
        detector: parsedPopupState.detector,
        community: parsedPopupState.community,
        detectorEndpoint: parsedPopupState.endpoint,
        autoFilterPersisted: parsedSavedState.persisted,
        scoreVerification,
        communityVerification,
        offlineVerification,
      },
      null,
      2
    )
  );
} finally {
  chrome.kill("SIGTERM");
  await wait(400);
  try {
    rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A terminating Chrome helper can briefly retain the isolated test profile.
    // It contains no project data and does not affect the result of this check.
  }
}

function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = nextCommandId++;
    pendingCommands.set(id, { resolve, reject });
    chrome.stdio[3].write(
      `${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`
    );
  });
}

async function evaluate(sessionId, expression, awaitPromise = false) {
  const result = await command(
    "Runtime.evaluate",
    { expression, awaitPromise, returnByValue: true },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Popup evaluation failed.");
  }
  return result.result.value;
}

async function waitForPopupState(sessionId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await evaluate(
      sessionId,
      `JSON.stringify({
        text: document.body.innerText,
        detector: document.querySelector("#detectorStatus")?.dataset.state,
        community: document.querySelector("#supabaseStatus")?.dataset.state,
        endpoint: document.querySelector("#detectorUrl")?.textContent,
        scoreToggle: document.querySelector("#showNumericScore")?.checked,
        filterToggle: document.querySelector("#autoFilterRed")?.checked
      })`
    );
    const state = JSON.parse(snapshot);
    if (state.community === "connected") return snapshot;
    await wait(200);
  }
  throw new Error("Supabase did not become connected in the popup.");
}

async function verifyBackgroundScoring(sessionId) {
  const fixtures = JSON.parse(
    readFileSync(path.join(repositoryRoot, "extension/src/shared/fixtures.json"), "utf8")
  );
  const timestamp = Date.now();
  const posts = fixtures.map((fixture) => ({
    ...fixture.post,
    contentKey: `x:cdp-score-${timestamp}-${fixture.name}`,
    tweetId: `cdp-score-${timestamp}-${fixture.name}`,
    textHash: `cdp-score-${timestamp}-${fixture.name}`,
  }));
  const directDetectorResponse = JSON.parse(
    await evaluate(
      sessionId,
      `fetch("http://localhost:8765/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post: ${JSON.stringify(posts[1])}, settings: {
          evidenceCoverageMinimum: 50,
          redThreshold: 75,
          yellowThreshold: 40
        }})
      }).then(async (response) => JSON.stringify({
        status: response.status,
        body: await response.json()
      })).catch((error) => JSON.stringify({ error: error.message, name: error.name }))`,
      true
    )
  );
  assert(
    directDetectorResponse.status === 200,
    `Direct extension detector request failed: ${JSON.stringify(directDetectorResponse)}.`
  );
  const scores = await sendExtensionMessages(
    sessionId,
    posts.map((post) => ({ type: "SLOP_FROG_SCORE_POST", post }))
  );

  for (const [index, fixture] of fixtures.entries()) {
    assert(scores[index]?.ok, `Scoring ${fixture.name} did not return an extension response.`);
    assert(
      scores[index]?.result?.label === fixture.expectedLabel,
      `${fixture.name} expected ${fixture.expectedLabel}, got ${JSON.stringify(scores[index]?.result)}.`
    );
  }

  const duplicate = await sendExtensionMessages(sessionId, [
    { type: "SLOP_FROG_SCORE_POST", post: posts[1] },
  ]);
  assert(
    JSON.stringify(duplicate[0]) === JSON.stringify(scores[1]),
    "The same content key did not return the cached scoring response."
  );

  const linkedInPost = {
    ...posts[1],
    platform: "linkedin",
    contentKey: `linkedin:cdp-score-${timestamp}`,
    tweetId: undefined,
    url: `https://www.linkedin.com/feed/update/urn:li:activity:${timestamp}/`,
  };
  const linkedInScore = await sendExtensionMessages(sessionId, [
    { type: "SLOP_FROG_SCORE_POST", post: linkedInPost },
  ]);
  assert(linkedInScore[0]?.ok, "LinkedIn post did not return an extension score response.");
  assert(
    linkedInScore[0]?.result?.label === fixtures[1].expectedLabel,
    `LinkedIn score was unexpected: ${JSON.stringify(linkedInScore[0]?.result)}.`
  );

  return {
    labels: scores.map((score) => score.result.label),
    cachedContentKey: posts[1].contentKey,
    linkedInLabel: linkedInScore[0].result.label,
  };
}

async function verifyCommunityActions(sessionId) {
  const timestamp = Date.now();
  const post = {
    platform: "x",
    contentKey: `x:cdp-community-${timestamp}`,
    tweetId: `cdp-community-${timestamp}`,
    url: `https://x.com/slopfrog/status/${timestamp}`,
    authorHandle: "slopfrog",
    visibleText:
      "This is an explicit community-action integration fixture with enough text to preserve a complete post identity for the vote and appeal path.",
    normalizedText:
      "this is an explicit community-action integration fixture with enough text to preserve a complete post identity for the vote and appeal path.",
    textHash: `cdp-community-${timestamp}`,
    imageUrls: [],
    extractedAt: new Date().toISOString(),
  };
  const [vote] = await sendExtensionMessages(sessionId, [
    {
      type: "SLOP_FROG_SUBMIT_VOTE",
      payload: { contentKey: post.contentKey, vote: "looks_ai", post },
    },
  ]);
  const [appeal] = await sendExtensionMessages(sessionId, [
    {
      type: "SLOP_FROG_SUBMIT_APPEAL",
      payload: {
        contentKey: post.contentKey,
        reason: "context_missing",
        status: "submitted",
        post,
      },
    },
  ]);
  assert(vote?.ok, `Community vote failed: ${vote?.error || "unknown error"}.`);
  assert(vote?.communityAggregate, "Vote did not return a community aggregate.");
  assert(appeal?.ok, `Appeal failed: ${appeal?.error || "unknown error"}.`);
  assert(appeal?.savedAppeal?.id, "Appeal did not return a saved appeal ID.");

  const linkedInPost = {
    ...post,
    platform: "linkedin",
    contentKey: `linkedin:cdp-community-${timestamp}`,
    tweetId: undefined,
    url: `https://www.linkedin.com/feed/update/urn:li:activity:${timestamp}/`,
    textHash: `linkedin-cdp-community-${timestamp}`,
  };
  const [linkedInVote] = await sendExtensionMessages(sessionId, [
    {
      type: "SLOP_FROG_SUBMIT_VOTE",
      payload: { contentKey: linkedInPost.contentKey, vote: "looks_human", post: linkedInPost },
    },
  ]);
  assert(linkedInVote?.ok, `LinkedIn community vote failed: ${linkedInVote?.error || "unknown error"}.`);
  assert(
    linkedInVote?.communityAggregate?.contentKey === linkedInPost.contentKey,
    "LinkedIn vote did not create the requested community aggregate."
  );

  return {
    contentKey: post.contentKey,
    aggregate: vote.communityAggregate,
    appealId: appeal.savedAppeal.id,
    linkedInAggregate: linkedInVote.communityAggregate,
  };
}

async function verifyOfflineFallback(sessionId) {
  const fixture = JSON.parse(
    readFileSync(path.join(repositoryRoot, "extension/src/shared/fixtures.json"), "utf8")
  ).find((entry) => entry.name === "medium-yellow");
  const post = {
    ...fixture.post,
    contentKey: `x:cdp-offline-${Date.now()}`,
    tweetId: `cdp-offline-${Date.now()}`,
  };
  const [response] = await sendExtensionMessages(sessionId, [
    { type: "SLOP_FROG_SCORE_POST", post },
  ]);
  assert(response?.ok, "Offline score did not return an extension response.");
  assert(response?.result?.label === "gray", "Offline score was not shown as gray.");
  assert(
    response?.result?.reasons?.includes("detector_unavailable"),
    `Offline score did not report detector_unavailable: ${JSON.stringify(response?.result)}.`
  );
  return { label: response.result.label, reason: response.result.reasons[0] };
}

async function sendExtensionMessages(sessionId, messages) {
  const result = await evaluate(
    sessionId,
    `Promise.all(${JSON.stringify(messages)}.map((message) => new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    }))).then(JSON.stringify)`,
    true
  );
  return JSON.parse(result);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
