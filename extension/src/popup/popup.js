const detectorStatus = document.querySelector("#detectorStatus");
const supabaseStatus = document.querySelector("#supabaseStatus");
const showNumericScore = document.querySelector("#showNumericScore");
const autoFilterRed = document.querySelector("#autoFilterRed");
const localDetectorUrl = document.querySelector("#localDetectorUrl");
const hint = document.querySelector("#hint");

initPopup();

async function initPopup() {
  const status = await sendMessage({ type: "SLOP_FROG_GET_STATUS" });
  const settings = status.settings || globalThis.SlopFrogRuntime.DEFAULT_EXTENSION_SETTINGS;

  showNumericScore.checked = Boolean(settings.showNumericScore);
  autoFilterRed.checked = Boolean(settings.autoFilterRed);
  localDetectorUrl.value = settings.localDetectorUrl;

  setStatus(detectorStatus, status.detector);
  setStatus(supabaseStatus, status.supabase);

  showNumericScore.addEventListener("change", save);
  autoFilterRed.addEventListener("change", save);
  localDetectorUrl.addEventListener("change", save);

  hint.textContent = status.detector?.ok
    ? ""
    : "Start the detector at localhost:8765";
}

async function save() {
  const response = await sendMessage({
    type: "SLOP_FROG_SAVE_SETTINGS",
    settings: {
      showNumericScore: showNumericScore.checked,
      autoFilterRed: autoFilterRed.checked,
      localDetectorUrl: localDetectorUrl.value.trim(),
    },
  });

  hint.textContent = response.ok ? "Saved" : "Could not save";
  window.setTimeout(() => {
    hint.textContent = "";
  }, 1400);
}

function setStatus(element, value) {
  element.textContent = value?.label || "Unknown";
  element.dataset.state = value?.status || "offline";
  element.title = value?.detail || "";
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false });
    });
  });
}
