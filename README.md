# ChatGPT Control Addon

This project consists of a Chrome extension and a Python FastAPI backend that work together to automate interactions with the ChatGPT web interface. The addon allows external programs (via the Python server) to send prompts to ChatGPT, retrieve its responses, and potentially manage chat sessions.

## Features

*   **Prompt Injection:** Send text prompts to ChatGPT.
*   **Response Retrieval:** Capture and return the AI's generated response.
*   **Two-way Communication:** Persistent WebSocket connection between the Chrome addon and the Python server.
*   **External API:** A simple HTTP endpoint on the Python server to trigger ChatGPT interactions.

## Project Structure

```
gpt-chrome-addon/
├── server/                 # Python FastAPI backend
│   ├── main.py             # Main server application
│   ├── pyproject.toml      # Project dependencies (using uv)
│   └── .venv/              # Python virtual environment (created by uv)
├── chrome-addon/           # Chrome Extension (Manifest V3)
│   ├── manifest.json       # Extension manifest
│   ├── background.js       # Service worker for background tasks and WebSocket client
│   └── content.js          # Injected script for interacting with ChatGPT DOM
├── .gitignore              # Git ignore file
└── README.md               # This file
```

## Getting Started

### Prerequisites

*   **Python 3.8+**
*   **`uv`**: A fast Python package installer and resolver. Install with `pip install uv`.
*   **Google Chrome** browser.

### 1. Set Up and Run the Python Backend Server

1.  **Navigate to the `server` directory:**
    ```bash
    cd server
    ```
2.  **Create a virtual environment using `uv`:**
    ```bash
    uv venv
    ```
3.  **Activate the virtual environment:**
    *   **Windows (PowerShell):**
        ```bash
        .\.venv\Scripts\activate
        ```
    *   **macOS/Linux (Bash/Zsh):**
        ```bash
        source ./.venv/bin/activate
        ```
4.  **Install dependencies:**
    ```bash
    uv pip install -e .
    ```
    This command installs `fastapi`, `uvicorn[standard]`, and `websockets` as defined in `pyproject.toml`.
5.  **Run the FastAPI server:**
    ```bash
    uvicorn main:app --reload
    ```
    The server should start, typically accessible at `http://127.0.0.1:8000`. You can verify it by opening this URL in your browser; you should see "ChatGPT Addon Server is running.". Keep this terminal window open.

### 2. Load the Chrome Addon

1.  **Open Google Chrome** and go to `chrome://extensions`.
2.  **Enable "Developer mode"** using the toggle switch usually found in the top right corner.
3.  Click the **"Load unpacked"** button.
4.  Navigate to your project directory and select the **`chrome-addon` folder** (e.g., `E:\Programming\projects\gpt-chrome-addon\chrome-addon`).
5.  The "ChatGPT Control Addon" should now appear in your extensions list.

#### Verify Addon Connection

*   Click on **"service worker"** (located on the addon's card in `chrome://extensions`) to open its console.
*   Look for the message: "WebSocket connection established.". If you see connection errors, ensure your Python server is running correctly.

### 3. Use the Addon

1.  **Open ChatGPT:** Navigate to `https://chat.openai.com/` in a new Chrome tab.
2.  **Inspect Console (Optional but Recommended):** Open the browser's developer console (F12) for the ChatGPT page and go to the "Console" tab. You should see "ChatGPT Control content script loaded."
3.  **Send a Query:** From a **new terminal window** (do not close the server's terminal), send a POST request to your Python server's `/query` endpoint.

    ```bash
    curl -X POST "http://localhost:8000/query" \
         -H "Content-Type: application/json" \
         -d '{"prompt": "Tell me a short story about a brave knight and a dragon."}'
    ```
4.  **Observe the Automation:**
    *   On the ChatGPT page, you should see the addon automatically typing your prompt into the input box and submitting it.
    *   After a short delay, ChatGPT will generate a response.
    *   The addon will capture this response.
    *   In your `curl` terminal, you should receive a JSON response containing the AI's reply.
    *   Check the Python server, addon service worker, and ChatGPT page consoles for detailed logs of the communication.

## Troubleshooting and Refinement

*   **DOM Selectors (Most Common Issue):** If the addon fails to interact with ChatGPT (e.g., can't type, send, or retrieve responses), it's likely due to changes in ChatGPT's website structure.
    *   **Solution:** Open `https://chat.openai.com/`, right-click on the problematic element (input box, send button, chat message), and select "Inspect". Update the CSS selectors in `chrome-addon/content.js` (e.g., `#prompt-textarea`, `[data-testid="send-button"]`, `div.group.w-full`, etc.) to match the current DOM.
*   **Timing Issues:** If prompts are cut off or responses are incomplete, you might need to adjust the `setTimeout` delays or the `MutationObserver` debounce time (currently `1500` ms) in `chrome-addon/content.js` to account for page rendering speed.
*   **WebSocket Connection:** If the addon's service worker console shows connection errors, ensure the Python server is running on `http://localhost:8000` and no firewall is blocking the connection.
*   **Error Logs:** Always check the console/terminal outputs of the server, addon service worker, and ChatGPT page for any error messages, as they are crucial for debugging.

## Future Enhancements (TODO)

*   **Image Support:** Implement logic in `content.js` to handle image uploads for prompts.
*   **Chat Management:** Add commands to `content.js` (and corresponding server/addon logic) to create new chats or delete existing ones.
*   **User Interface:** Develop a simple UI for the Python server or the addon popup to make it easier to send commands without `curl`.
*   **Error Handling and Retries:** Implement more robust error handling and retry mechanisms.
*   **Configuration:** Externalize configurable elements like ChatGPT URL, server port, and timeouts.
