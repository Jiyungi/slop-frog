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
      filtered: document.querySelectorAll("article.slop-frog-filtered").length
    })`,
    (state) => state.controls === 3 && state.filtered === 1,
    "three X controls and one auto-filtered red post"
  );
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

  const linkedInPage = await openPage(`https://www.linkedin.com:${fixturePort}/feed/`);
  const linkedInState = await waitForState(
    linkedInPage,
    `JSON.stringify({
      cards: document.querySelectorAll('.feed-shared-update-v2').length,
      controls: document.querySelectorAll('.feed-shared-update-v2 .slop-frog-controls').length
    })`,
    (state) => state.cards === 3 && state.controls === 3,
    "three LinkedIn cards with controls"
  );

  console.log(
    JSON.stringify(
      {
        extensionId: loaded.id,
        x: { ...xState, evidenceState, feedbackState, appealState },
        linkedIn: linkedInState,
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
  const result = spawnSync(
    "openssl",
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
    lastState = rawState.startsWith("{") ? JSON.parse(rawState) : rawState;
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
    throw new Error(result.exceptionDetails.text || "Feed-page evaluation failed.");
  }
  return result.result.value;
}

function withUniqueIds(html) {
  return ["10001", "10002", "10003"].reduce(
    (nextHtml, id, index) => nextHtml.replaceAll(id, `${timestamp}${index + 1}`),
    html
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
