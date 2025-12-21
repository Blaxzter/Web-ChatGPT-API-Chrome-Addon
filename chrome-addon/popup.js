// Get connection status from background script
async function updateConnectionStatus() {
  try {
    // Get the background service worker
    const response = await chrome.runtime.sendMessage({
      command: "get_connection_status",
    });

    if (response) {
      updateUI(response);
    } else {
      // If no response, background script might not have the message handler yet
      // Show default disconnected state
      updateUI({
        connected: false,
        serverUrl: "ws://localhost:8000/ws",
        readyState: null,
      });
    }
  } catch (error) {
    console.error("Error getting connection status:", error);
    updateUI({
      connected: false,
      serverUrl: "ws://localhost:8000/ws",
      readyState: null,
      error: error.message,
    });
  }
}

function updateUI(status) {
  const loadingDiv = document.getElementById("loading");
  const contentDiv = document.getElementById("content");
  const statusIndicator = document.getElementById("status-indicator");
  const connectionStatus = document.getElementById("connection-status");
  const serverUrl = document.getElementById("server-url");

  // Hide loading, show content
  loadingDiv.style.display = "none";
  contentDiv.style.display = "block";

  // Update connection status
  if (status.connected) {
    statusIndicator.className = "status-indicator connected";
    connectionStatus.textContent = "Connected";
  } else if (status.readyState === 0) {
    statusIndicator.className = "status-indicator connecting";
    connectionStatus.textContent = "Connecting...";
  } else {
    statusIndicator.className = "status-indicator disconnected";
    connectionStatus.textContent = "Disconnected";
  }

  // Update server URL
  serverUrl.textContent = status.serverUrl || "ws://localhost:8000/ws";

  // Get active tab info
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      const tab = tabs[0];
      const tabUrl = document.getElementById("tab-url");
      const isChatGPT = document.getElementById("is-chatgpt");

      // Truncate URL if too long
      const url = tab.url || "Unknown";
      tabUrl.textContent = url.length > 40 ? url.substring(0, 40) + "..." : url;
      tabUrl.title = url; // Full URL on hover

      // Check if it's a ChatGPT page
      const isChatGPTPage =
        url.includes("chat.openai.com") || url.includes("chatgpt.com");
      isChatGPT.textContent = isChatGPTPage ? "Yes ✓" : "No";
      isChatGPT.style.color = isChatGPTPage ? "#4caf50" : "#f44336";
    }
  });

  // Get extension version from manifest
  const manifest = chrome.runtime.getManifest();
  document.getElementById("extension-version").textContent = manifest.version;
}

// Update status when popup opens
document.addEventListener("DOMContentLoaded", () => {
  updateConnectionStatus();

  // Refresh status every 2 seconds while popup is open
  setInterval(updateConnectionStatus, 2000);
});
