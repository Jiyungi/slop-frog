const detectorStatus = document.querySelector("#detectorStatus");
const supabaseStatus = document.querySelector("#supabaseStatus");
const showNumericScore = document.querySelector("#showNumericScore");
const autoFilterRed = document.querySelector("#autoFilterRed");

initPopup();

async function initPopup() {
  const status = await sendMessage({ type: "SLOP_FROG_GET_STATUS" });
  const settings = status.settings || globalThis.SlopFrogRuntime.DEFAULT_EXTENSION_SETTINGS;

  showNumericScore.checked = Boolean(settings.showNumericScore);
  autoFilterRed.checked = Boolean(settings.autoFilterRed);

  setStatus(detectorStatus, status.detector);
  setStatus(supabaseStatus, status.supabase);

  showNumericScore.addEventListener("change", save);
  autoFilterRed.addEventListener("change", save);
}

async function save() {
  const response = await sendMessage({
    type: "SLOP_FROG_SAVE_SETTINGS",
    settings: {
      showNumericScore: showNumericScore.checked,
      autoFilterRed: autoFilterRed.checked,
    },
  });

  document.body.dataset.saved = response.ok ? "true" : "false";
  window.setTimeout(() => {
    delete document.body.dataset.saved;
  }, 900);
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
