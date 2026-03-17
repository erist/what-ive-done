const endpointInput = document.getElementById("endpoint");
const authTokenInput = document.getElementById("auth-token");
const statusElement = document.getElementById("status");
const saveButton = document.getElementById("save");
const DEFAULT_INGEST_ENDPOINT = "http://127.0.0.1:4318/events";

async function loadOptions() {
  const result = await chrome.storage.sync.get(["ingestEndpoint", "ingestAuthToken"]);
  endpointInput.value = result.ingestEndpoint || DEFAULT_INGEST_ENDPOINT;
  authTokenInput.value = result.ingestAuthToken || "";
}

async function saveOptions() {
  const ingestEndpoint = endpointInput.value.trim() || DEFAULT_INGEST_ENDPOINT;
  const ingestAuthToken = authTokenInput.value.trim();
  await chrome.storage.sync.set({ ingestEndpoint, ingestAuthToken });
  statusElement.textContent = `Saved: ${ingestEndpoint}`;

  window.setTimeout(() => {
    statusElement.textContent = "";
  }, 2000);
}

saveButton.addEventListener("click", () => {
  void saveOptions();
});

void loadOptions();
