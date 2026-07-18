import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
  await wait(1400);
  const attached = await command("Target.attachToTarget", {
    targetId: popupTarget.targetId,
    flatten: true,
  });

  const popupState = await evaluate(
    attached.sessionId,
    `JSON.stringify({
      text: document.body.innerText,
      detector: document.querySelector("#detectorStatus")?.dataset.state,
      community: document.querySelector("#supabaseStatus")?.dataset.state,
      endpoint: document.querySelector("#detectorUrl")?.textContent,
      scoreToggle: document.querySelector("#showNumericScore")?.checked,
      filterToggle: document.querySelector("#autoFilterRed")?.checked
    })`
  );
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

  console.log(
    JSON.stringify(
      {
        extensionId: loaded.id,
        detector: parsedPopupState.detector,
        community: parsedPopupState.community,
        detectorEndpoint: parsedPopupState.endpoint,
        autoFilterPersisted: parsedSavedState.persisted,
      },
      null,
      2
    )
  );
} finally {
  chrome.kill("SIGTERM");
  rmSync(profilePath, { recursive: true, force: true });
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
