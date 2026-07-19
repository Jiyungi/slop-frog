import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const extensionPath = path.join(repositoryRoot, "extension");
const chromeBinary =
  process.env.CHROME_BINARY ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const temporaryPath = mkdtempSync(path.join(tmpdir(), "slop-frog-feed-check-"));
const certificatePath = path.join(temporaryPath, "certificate.pem");
const privateKeyPath = path.join(temporaryPath, "private-key.pem");
const fixturePort = 8443;

createCertificate();

const timestamp = String(Date.now());
const xFixture = withUniqueIds(
  readFileSync(path.join(repositoryRoot, "extension/dev/x-feed-fixture.html"), "utf8")
    .split("<script>")[0] + "</body></html>"
);
const linkedInFixture = withUniqueIds(
  readFileSync(path.join(repositoryRoot, "extension/dev/linkedin-feed-fixture.html"), "utf8")
);
const fixtureServer = https.createServer(
  {
    key: readFileSync(privateKeyPath),
    cert: readFileSync(certificatePath),
  },
  (request, response) => {
    const host = String(request.headers.host || "");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(host.includes("linkedin.com") ? linkedInFixture : xFixture);
  }
);
await new Promise((resolve) => fixtureServer.listen(fixturePort, "127.0.0.1", resolve));

const chrome = spawn(
  chromeBinary,
  [
    "--headless=new",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    "--ignore-certificate-errors",
    "--host-resolver-rules=MAP x.com 127.0.0.1,MAP linkedin.com 127.0.0.1,MAP www.linkedin.com 127.0.0.1",
    `--user-data-dir=${path.join(temporaryPath, "chrome-profile")}`,
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
  // Ignore Chrome updater diagnostics; protocol errors are returned directly.
});

try {
  await wait(700);
  const loaded = await command("Extensions.loadUnpacked", { path: extensionPath });
  const popupTarget = await command("Target.createTarget", {
    url: `chrome-extension://${loaded.id}/src/popup/popup.html`,
  });
  const popupSession = await attach(popupTarget.targetId);
  await wait(700);
  await evaluate(
    popupSession,
    `new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: "SLOP_FROG_SAVE_SETTINGS",
        settings: { autoFilterRed: true, showNumericScore: true }
      }, (response) => resolve(JSON.stringify(response)));
    })`,
    true
  );

  const xPage = await openPage(`https://x.com:${fixturePort}/home`);
  const xState = await waitForState(
    xPage,
    `JSON.stringify({
      controls: document.querySelectorAll("article .slop-frog-controls").length,
      evidenceButtons: document.querySelectorAll('article .slop-frog-controls button[title="View Slop Score evidence"]').length,
      filtered: document.querySelectorAll("article.slop-frog-filtered").length
    })`,
    (state) => state.controls === 7 && state.evidenceButtons === 7,
    "seven scored X controls"
  );
  const xPlacementState = await verifyXPlacement(xPage);
  await evaluate(
    xPage,
    `document.querySelector('.slop-frog-controls button[title="View Slop Score evidence"]').click()`
  );
  const evidenceState = await waitForState(
    xPage,
    `JSON.stringify({
      text: document.querySelector('.slop-frog-panel[data-kind="evidence"]')?.innerText || "",
      charts: document.querySelectorAll('.slop-frog-panel[data-kind="evidence"] svg').length
    })`,
    (state) =>
      state.text.includes("Detector score") &&
      state.text.includes("Slop Score") &&
      state.charts === 2,
    "X evidence panel with both charts"
  );
  await evaluate(
    xPage,
    `document.querySelector('.slop-frog-panel[data-kind="evidence"] .slop-frog-close').click()`
  );
  const closeState = await waitForState(
    xPage,
    `document.querySelector('.slop-frog-panel[data-kind="evidence"]') === null`,
    (closed) => closed === true,
    "evidence panel close button"
  );
  await evaluate(
    xPage,
    `document.querySelector('.slop-frog-controls button[title="Add feedback"]').click()`
  );
  await waitForState(
    xPage,
    `JSON.stringify({ text: document.querySelector('.slop-frog-panel[data-kind="feedback"]')?.innerText || "" })`,
    (state) => state.text.includes("Looks AI"),
    "X feedback panel"
  );
  await evaluate(
    xPage,
    `Array.from(document.querySelectorAll('.slop-frog-panel[data-kind="feedback"] button')).find((button) => button.textContent === "Looks AI").click()`
  );
  const feedbackState = await waitForState(
    xPage,
    `document.querySelector('.slop-frog-panel[data-kind="feedback"]')?.innerText || ""`,
    (text) => text.includes("Saved to community"),
    "saved X feedback"
  );
  await evaluate(
    xPage,
    `document.querySelector('.slop-frog-controls button[title="Appeal label"]').click()`
  );
  await waitForState(
    xPage,
    `JSON.stringify({ text: document.querySelector('.slop-frog-panel[data-kind="appeal"]')?.innerText || "" })`,
    (state) => state.text.includes("Missing context"),
    "X appeal panel"
  );
  await evaluate(
    xPage,
    `Array.from(document.querySelectorAll('.slop-frog-panel[data-kind="appeal"] button')).find((button) => button.textContent === "Missing context").click()`
  );
  const appealState = await waitForState(
    xPage,
    `document.querySelector('.slop-frog-panel[data-kind="appeal"]')?.innerText || ""`,
    (text) => text.includes("Appeal sent"),
    "saved X appeal"
  );
  const recolorState = await verifyFlagRecolorsAfterVote(xPage);
  await evaluate(
    xPage,
    `document.querySelector("main").insertAdjacentHTML("beforeend",
      '<article data-testid="tweet"><div role="group" aria-label="Post actions"><button data-testid="reply">Reply</button></div></article>'
    )`
  );
  await waitForState(
    xPage,
    `document.querySelectorAll('article .slop-frog-controls').length`,
    (count) => count === 8,
    "gray control on a malformed X post"
  );
  await evaluate(
    xPage,
    `document.querySelector('article:last-of-type .slop-frog-controls button[title="View Slop Score evidence"]').click()`
  );
  const malformedState = await waitForState(
    xPage,
    `document.querySelector('article:last-of-type .slop-frog-panel[data-kind="evidence"]')?.innerText || ""`,
    (text) => text.includes("Gray reason") && text.includes("extraction_failed"),
    "gray extraction-failed evidence"
  );
  await evaluate(xPage, "window.dispatchEvent(new Event('scroll'))");
  const stableControlCount = await waitForState(
    xPage,
    `document.querySelectorAll('article .slop-frog-controls').length`,
    (count) => count === 8,
    "stable X control count after scroll"
  );

  const linkedInPage = await openPage(`https://www.linkedin.com:${fixturePort}/feed/`);
  const linkedInState = await waitForState(
    linkedInPage,
    `JSON.stringify({
      oldCards: document.querySelectorAll('.feed-shared-update-v2').length,
      newCards: document.querySelectorAll('.fie-impression-container[data-view-name="feed-full-update"]').length,
      rawComments: document.querySelectorAll('.comments-comment-item, .comment-thread-node').length,
      controls: document.querySelectorAll('.feed-shared-update-v2 > .slop-frog-slot .slop-frog-controls, .fie-impression-container .slop-frog-controls, .comments-comment-item .slop-frog-controls, .comment-thread-node .slop-frog-controls').length,
      commentControls: document.querySelectorAll('.comments-comment-item .slop-frog-slot.is-linkedin-comment .slop-frog-controls, .comment-thread-node .slop-frog-slot.is-linkedin-comment .slop-frog-controls').length,
      duplicateSlots: (() => {
        const keys = Array.from(document.querySelectorAll('.slop-frog-slot[data-content-key]')).map((slot) => slot.dataset.contentKey).filter(Boolean);
        return keys.length - new Set(keys).size;
      })(),
      overlap: (() => {
        const controls = Array.from(document.querySelectorAll('.slop-frog-controls'));
        const nativeButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((button) =>
          /Like|Comment|Reply|Repost|Send/i.test(button.getAttribute('aria-label') || button.textContent || '')
        );
        return controls.some((control) => {
          const a = control.getBoundingClientRect();
          return nativeButtons.some((button) => {
            if (control.contains(button) || button.closest('.slop-frog-controls')) return false;
            const b = button.getBoundingClientRect();
            return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
          });
        });
      })()
    })`,
    (state) =>
      state.oldCards === 3 &&
      state.newCards === 1 &&
      state.rawComments === 4 &&
      state.controls === 8 &&
      state.commentControls === 4 &&
      state.duplicateSlots === 0 &&
      state.overlap === false,
    "LinkedIn feed posts and comments with one non-overlapping control set per content item"
  );
  await evaluate(
    linkedInPage,
    `document.querySelector('.feed-shared-update-v2').insertAdjacentHTML('beforeend',
      '<div class="comments-comment-item" data-test-id="comments-comment-item"><div class="comments-comment-text">This is a dynamically loaded LinkedIn comment after the post was already scanned, and it still needs its own Slop Frog controls.</div><div class="comments-comment-social-bar" role="group"><button aria-label="Like dynamic LinkedIn comment">Like</button><button aria-label="Reply to dynamic LinkedIn comment">Reply</button></div></div>'
    )`
  );
  const dynamicLinkedInState = await waitForState(
    linkedInPage,
    `JSON.stringify({
      controls: document.querySelectorAll('.feed-shared-update-v2 > .slop-frog-slot .slop-frog-controls, .fie-impression-container .slop-frog-controls, .comments-comment-item .slop-frog-controls, .comment-thread-node .slop-frog-controls').length,
      commentControls: document.querySelectorAll('.comments-comment-item .slop-frog-slot.is-linkedin-comment .slop-frog-controls, .comment-thread-node .slop-frog-slot.is-linkedin-comment .slop-frog-controls').length,
      duplicateSlots: (() => {
        const keys = Array.from(document.querySelectorAll('.slop-frog-slot[data-content-key]')).map((slot) => slot.dataset.contentKey).filter(Boolean);
        return keys.length - new Set(keys).size;
      })()
    })`,
    (state) => state.controls === 9 && state.commentControls === 5 && state.duplicateSlots === 0,
    "dynamically loaded LinkedIn comments receive one control set"
  );

  console.log(
    JSON.stringify(
      {
        extensionId: loaded.id,
        x: {
          ...xState,
          placement: xPlacementState,
          evidenceState,
          closeState,
          feedbackState,
        appealState,
          recolorState,
        malformedState,
        stableControlCount,
      },
        linkedIn: linkedInState,
        dynamicLinkedIn: dynamicLinkedInState,
      },
      null,
      2
    )
  );
} finally {
  fixtureServer.close();
  chrome.kill("SIGTERM");
  await wait(400);
  try {
    rmSync(temporaryPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A terminating Chrome helper can briefly retain this isolated temp profile.
  }
}

function createCertificate() {
  const opensslBinary = resolveOpenSslBinary();
  const result = spawnSync(
    opensslBinary,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      privateKeyPath,
      "-out",
      certificatePath,
      "-days",
      "1",
      "-subj",
      "/CN=x.com",
    ],
    { stdio: "ignore" }
  );
  if (result.status !== 0) {
    throw new Error("Could not create the temporary HTTPS certificate for feed testing.");
  }
}

async function verifyFlagRecolorsAfterVote(sessionId) {
  await evaluate(
    sessionId,
    `document.querySelectorAll('article')[1]?.querySelector('.slop-frog-filter-card button')?.click?.()`
  );
  const before = await waitForState(
    sessionId,
    `document.querySelectorAll('article')[1]?.querySelector('.slop-frog-button.is-evidence')?.className || ""`,
    (className) => className.includes("is-red"),
    "red fixture starts red before community correction"
  );
  await evaluate(
    sessionId,
    `document.querySelectorAll('article')[1].querySelector('.slop-frog-button.is-feedback').click()`
  );
  await waitForState(
    sessionId,
    `JSON.stringify({ text: document.querySelectorAll('article')[1].querySelector('.slop-frog-panel[data-kind="feedback"]')?.innerText || "" })`,
    (state) => state.text.includes("Looks human"),
    "red fixture feedback panel"
  );
  await evaluate(
    sessionId,
    `Array.from(document.querySelectorAll('article')[1].querySelectorAll('.slop-frog-panel[data-kind="feedback"] button')).find((button) => button.textContent === "Looks human").click()`
  );
  await waitForState(
    sessionId,
    `document.querySelectorAll('article')[1].querySelector('.slop-frog-panel[data-kind="feedback"]')?.innerText || ""`,
    (text) => text.includes("Saved to community"),
    "saved human feedback before evidence refresh"
  );
  await evaluate(
    sessionId,
    `document.querySelectorAll('article')[1].querySelector('.slop-frog-button.is-evidence').click()`
  );
  const evidenceText = await waitForState(
    sessionId,
    `document.querySelectorAll('article')[1].querySelector('.slop-frog-panel[data-kind="evidence"]')?.innerText || ""`,
    (text) => text.includes("Community") && /Community\s+0 \(1 vote\)/.test(text),
    "clean community score formatting after vote"
  );
  const after = await evaluate(
    sessionId,
    `document.querySelectorAll('article')[1]?.querySelector('.slop-frog-button.is-evidence')?.className || ""`
  );
  const scoreMatch = evidenceText.match(/Slop Score\s+(\d+)/);
  const slopScore = scoreMatch ? Number(scoreMatch[1]) : null;
  const expectedTone =
    slopScore === null ? "gray" : slopScore >= 75 ? "red" : slopScore >= 40 ? "yellow" : "green";
  if (!after.includes(`is-${expectedTone}`)) {
    throw new Error(`Expected flag ${expectedTone} for Slop Score ${slopScore}, got ${after}`);
  }
  if (/\\.0\\b/.test(evidenceText)) {
    throw new Error(`Community score contains a stray decimal: ${evidenceText}`);
  }
  return { before, after, slopScore, expectedTone, community: "0 (1 vote)" };
}

function resolveOpenSslBinary() {
  const candidates = [
    process.env.OPENSSL_BINARY,
    "openssl",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
    "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }

  return "openssl";
}

async function verifyXPlacement(sessionId) {
  return waitForState(
    sessionId,
    `JSON.stringify((() => {
      const articles = Array.from(document.querySelectorAll('article')).filter((article) =>
        article.querySelector('.slop-frog-controls')
      );
      const inspected = articles.map((article) => {
        const controls = article.querySelector('.slop-frog-controls');
        const actions = Array.from(article.querySelectorAll('[role="group"]')).find((group) =>
          group.querySelector('[data-testid="reply"], [data-testid="retweet"], [data-testid="like"]')
        );
        const articleRect = article.getBoundingClientRect();
        const controlsRect = controls.getBoundingClientRect();
        const actionsRect = actions?.getBoundingClientRect();
        const actionButtons = actions ? Array.from(actions.querySelectorAll('button')).map((button) => button.getBoundingClientRect()) : [];
        const overlapsActionButton = actionButtons.some((buttonRect) =>
          !(controlsRect.right <= buttonRect.left || controlsRect.left >= buttonRect.right || controlsRect.bottom <= buttonRect.top || controlsRect.top >= buttonRect.bottom)
        );
        return {
          leftAligned: controlsRect.left <= articleRect.left + 28,
          afterActions: actionsRect ? controlsRect.top >= actionsRect.bottom - 1 : true,
          overlapsActionButton
        };
      });
      return {
        inspected: inspected.length,
        leftAligned: inspected.every((item) => item.leftAligned),
        afterActions: inspected.every((item) => item.afterActions),
        noActionOverlap: inspected.every((item) => !item.overlapsActionButton)
      };
    })())`,
    (state) =>
      state.inspected >= 7 &&
      state.leftAligned &&
      state.afterActions &&
      state.noActionOverlap,
    "X bottom-left controls with no native action overlap"
  );
}

async function openPage(url) {
  const page = await command("Target.createTarget", { url });
  return attach(page.targetId);
}

async function attach(targetId) {
  const attached = await command("Target.attachToTarget", { targetId, flatten: true });
  return attached.sessionId;
}

async function waitForState(sessionId, expression, predicate, description) {
  let lastState;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rawState = await evaluate(sessionId, expression);
    lastState =
      typeof rawState === "string" && rawState.startsWith("{")
        ? JSON.parse(rawState)
        : rawState;
    if (predicate(lastState)) return lastState;
    await wait(200);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(lastState)}.`);
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
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "Feed-page evaluation failed."
    );
  }
  return result.result.value;
}

function withUniqueIds(html) {
  return ["10001", "10002", "10003", "10004", "10005", "10006", "10007"].reduce(
    (nextHtml, id, index) => nextHtml.replaceAll(id, `${timestamp}${index + 1}`),
    html
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
