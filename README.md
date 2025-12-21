# ChatGPT Control Addon

A Chrome extension and Python FastAPI backend that work together to automate interactions with the ChatGPT web interface. This system allows external programs to send prompts (with optional images) to ChatGPT, retrieve responses, and manage chat sessions programmatically.

## Features

- **Text Prompts:** Send text prompts to ChatGPT programmatically
- **Image Support:** Upload and send images alongside prompts (base64 or file upload)
- **Response Retrieval:** Automatically capture and return ChatGPT's responses
- **Chat Management:** Create new chats or continue in existing sessions
- **Temporary Chat Mode:** Automatically activates temporary chat for privacy
- **WebSocket Communication:** Persistent two-way connection between addon and server
- **RESTful API:** Simple HTTP endpoints for integration with other applications
- **Health Monitoring:** Built-in health check and connection status monitoring
- **Auto-Reconnection:** Automatic WebSocket reconnection with exponential backoff
- **Status UI:** Chrome popup showing real-time connection and tab information

## Architecture

The system consists of three main components:

1. **FastAPI Server** (`server/main.py`): Manages WebSocket connections, handles HTTP requests, and coordinates message passing
2. **Chrome Background Script** (`chrome-addon/background.js`): Maintains WebSocket connection and routes messages between server and content scripts
3. **Chrome Content Script** (`chrome-addon/content.js`): Interacts with ChatGPT's DOM to inject prompts and extract responses

## Project Structure

```
gpt-chrome-addon/
├── server/                     # Python FastAPI backend
│   ├── main.py                 # Main server application with WebSocket & HTTP endpoints
│   ├── pyproject.toml          # Project dependencies (using uv)
│   └── uv.lock                 # Locked dependency versions
├── chrome-addon/               # Chrome Extension (Manifest V3)
│   ├── manifest.json           # Extension manifest with permissions
│   ├── background.js           # Service worker managing WebSocket connection
│   ├── content.js              # DOM interaction script for ChatGPT pages
│   ├── popup.html              # Extension popup UI
│   └── popup.js                # Popup logic for status display
└── README.md                   # This file
```

## Getting Started

### Prerequisites

- **Python 3.8+** (Python 3.12 recommended)
- **uv**: Fast Python package installer. Install with:
  ```bash
  pip install uv
  ```
- **Google Chrome** browser
- **ChatGPT Account**: Access to https://chatgpt.com or https://chat.openai.com

### 1. Set Up the Python Backend Server

1. **Navigate to the server directory:**

   ```bash
   cd server
   ```

2. **Install dependencies using uv:**

   ```bash
   uv sync
   ```

   This installs all dependencies defined in `pyproject.toml`:

   - `fastapi`: Web framework
   - `uvicorn[standard]`: ASGI server
   - `websockets`: WebSocket support
   - `pydantic>=2.10.6`: Data validation
   - `python-multipart>=0.0.20`: File upload support

3. **Run the FastAPI server:**

   ```bash
   cd server
   python main.py
   ```

   Or alternatively:

   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

4. **Verify the server is running:**
   - Open http://localhost:8000 in your browser
   - You should see: "ChatGPT Addon Server is running."
   - Check health status at: http://localhost:8000/health

### 2. Load the Chrome Extension

1. **Open Chrome Extensions page:**

   - Navigate to `chrome://extensions`
   - Or click the puzzle icon → "Manage Extensions"

2. **Enable Developer Mode:**

   - Toggle the "Developer mode" switch in the top right corner

3. **Load the extension:**

   - Click "Load unpacked"
   - Select the `chrome-addon` folder from your project directory
   - The "ChatGPT Control Addon" should appear in your extensions list

4. **Verify the connection:**

   - Click "Service worker" on the extension card to open the console
   - Look for: `"WebSocket connection established."`
   - If you see connection errors, ensure the Python server is running

5. **Check the popup UI:**
   - Click the extension icon in Chrome's toolbar
   - Verify "WebSocket Status" shows "Connected" (green indicator)

### 3. Using the System

#### Basic Text Query

Send a simple text prompt to ChatGPT:

```bash
curl -X POST "http://localhost:8000/query" \
     -H "Content-Type: application/json" \
     -d '{
       "prompt": "Explain quantum computing in simple terms",
       "startNewChat": true
     }'
```

**Response:**

```json
{
  "status": "success",
  "request_id": "a1b2c3d4e5f6...",
  "response": "Quantum computing is a type of computing that..."
}
```

#### Query with Base64 Image

Send a prompt with a base64-encoded image:

```bash
curl -X POST "http://localhost:8000/query" \
     -H "Content-Type: application/json" \
     -d '{
       "prompt": "What is in this image?",
       "image": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
       "startNewChat": true
     }'
```

#### Query with File Upload

Upload an image file directly:

```bash
curl -X POST "http://localhost:8000/query/upload" \
     -F "prompt=Describe this image in detail" \
     -F "image=@/path/to/your/image.png" \
     -F "startNewChat=true"
```

**Python Example:**

```python
import requests

with open("image.png", "rb") as f:
    response = requests.post(
        "http://localhost:8000/query/upload",
        data={"prompt": "What's in this image?", "startNewChat": True},
        files={"image": f}
    )

print(response.json())
```

#### Continue in Existing Chat

To continue in the current chat without creating a new one:

```bash
curl -X POST "http://localhost:8000/query" \
     -H "Content-Type: application/json" \
     -d '{
       "prompt": "Can you elaborate on that?",
       "startNewChat": false
     }'
```

## API Reference

### Endpoints

#### `GET /`

Returns a simple HTML page confirming the server is running.

**Response:** `200 OK` with HTML content

---

#### `GET /health`

Health check endpoint that reports server and addon connection status.

**Response:**

```json
{
  "status": "healthy", // "healthy" or "degraded"
  "addon_connected": true, // WebSocket connection status
  "pending_requests": 0 // Number of requests awaiting response
}
```

---

#### `POST /query`

Send a query with optional base64-encoded image to ChatGPT.

**Request Body:**

```json
{
  "prompt": "string", // Required: The text prompt
  "image": "string", // Optional: Base64-encoded image
  "startNewChat": true // Optional: Create new chat (default: true)
}
```

**Response:**

```json
{
  "status": "success",
  "request_id": "uuid",
  "response": "ChatGPT's response text"
}
```

**Error Response:**

```json
{
  "status": "error",
  "detail": "Error message"
}
```

**Status Codes:**

- `200`: Success
- `400`: Invalid request or ChatGPT error
- `503`: WebSocket not connected
- `504`: Timeout waiting for response (120s)

---

#### `POST /query/upload`

Send a query with file upload (multipart/form-data).

**Form Data:**

- `prompt` (string, required): The text prompt
- `image` (file, optional): Image file to upload
- `startNewChat` (boolean, optional): Create new chat (default: true)

**Response:** Same as `/query` endpoint

---

#### `WebSocket /ws`

WebSocket endpoint for addon communication. Used internally by the Chrome extension.

**Message Format:**

```json
{
  "id": "uuid",
  "type": "prompt" | "response" | "control",
  "data": {
    "prompt": "string",
    "image": "string",
    "startNewChat": boolean
  }
}
```

## How It Works

### Message Flow

1. **Client → Server:** HTTP POST request to `/query` or `/query/upload`
2. **Server → Addon:** WebSocket message with prompt data
3. **Addon → ChatGPT:** Background script finds/creates ChatGPT tab
4. **Content Script:** Injects prompt and image into ChatGPT interface
5. **Content Script:** Monitors DOM for ChatGPT's response using MutationObserver
6. **Addon → Server:** WebSocket message with response data
7. **Server → Client:** HTTP response with ChatGPT's answer

### Image Injection Methods

The content script attempts multiple methods to inject images (in order):

1. **Drag-and-Drop Simulation** (no focus required)
2. **File Input Injection** (no focus required)
3. **Clipboard API** (requires window focus)

If the ChatGPT window is not focused, the script will wait up to 30 seconds for user interaction.

### Response Detection

The content script uses a sophisticated detection system:

- **MutationObserver:** Watches for new assistant messages in the DOM
- **Stability Checking:** Ensures content has stopped changing (3 consecutive checks)
- **Loading State Detection:** Ignores temporary "thinking" messages
- **Polling Fallback:** 1-second interval polling as a safety net
- **Timeout:** 60-second maximum wait time

### Chat Management

- **New Chat Creation:** Clicks the "create new chat" button before sending
- **Temporary Chat Mode:** Automatically activates temporary chat for privacy
- **Tab Management:** Reuses existing ChatGPT tabs or creates new ones
- **Focus Management:** Brings ChatGPT tab to front when needed

## Chrome Extension Components

### manifest.json

Defines extension metadata, permissions, and scripts:

- **Permissions:** `scripting`, `activeTab`, `storage`
- **Host Permissions:** `https://chat.openai.com/*`, `https://chatgpt.com/*`
- **Background:** Service worker (`background.js`)
- **Content Scripts:** Injected into ChatGPT pages (`content.js`)

### background.js

Service worker that:

- Establishes and maintains WebSocket connection to server
- Handles automatic reconnection (5-second delay)
- Routes messages between server and content scripts
- Manages ChatGPT tab creation and focusing
- Provides connection status to popup UI

### content.js

Content script that:

- Interacts with ChatGPT's DOM elements
- Injects prompts and images into the chat interface
- Monitors for and captures AI responses
- Manages chat creation and temporary chat mode
- Handles multiple image injection strategies
- Provides detailed logging for debugging

### popup.html & popup.js

Extension popup that displays:

- WebSocket connection status (connected/disconnected/connecting)
- Server URL
- Current tab information
- Whether current tab is a ChatGPT page
- Extension version

## Configuration

### Server Configuration

Edit `server/main.py` to customize:

```python
# WebSocket timeout (line 147)
timeout=120  # 2 minutes

# Server host and port (line 413)
uvicorn.run(app, host="0.0.0.0", port=8000)
```

### Extension Configuration

Edit `chrome-addon/background.js` to customize:

```javascript
// WebSocket URL (line 5)
websocket = new WebSocket("ws://localhost:8000/ws");

// Reconnection delay (line 123)
setTimeout(connectWebSocket, 5000); // 5 seconds

// Page load timeout (line 55)
setTimeout(() => {
  /* ... */
}, 30000); // 30 seconds
```

Edit `chrome-addon/content.js` to customize:

```javascript
// Response timeout (line 33)
const MAX_TIMEOUT_ATTEMPTS = 60;  // 60 seconds

// Stability checks (line 38)
const STABLE_CHECKS_REQUIRED = 3;
const STABILITY_CHECK_INTERVAL_MS = 300;

// Image wait timeout (line 485)
async function waitForImageCountIncrease(initialCount, maxWaitMs = 2000)

// User focus timeout (line 257)
async function waitForUserFocus(timeoutMs = 30000)
```

## Troubleshooting

### WebSocket Connection Issues

**Problem:** Extension shows "Disconnected" status

**Solutions:**

1. Ensure Python server is running: `python server/main.py`
2. Check server console for errors
3. Verify no firewall is blocking port 8000
4. Check background service worker console for connection errors
5. Try restarting the extension

---

### DOM Selector Issues

**Problem:** Addon can't find input box, send button, or responses

**Cause:** ChatGPT's website structure has changed

**Solution:**

1. Open https://chatgpt.com and press F12 (DevTools)
2. Right-click the element (input box, send button, message) → Inspect
3. Update selectors in `content.js`:
   - Input box: `#prompt-textarea` (line 670)
   - Send button: `[data-testid="send-button"]` (line 713)
   - Assistant messages: `div[data-message-author-role="assistant"]` (line 7)
   - Markdown content: `.markdown` (line 15)

---

### Image Upload Not Working

**Problem:** Images aren't being attached to prompts

**Solutions:**

1. Ensure the ChatGPT window is focused (click on the tab)
2. Check content script console for detailed error messages
3. Verify image is valid base64 or file format
4. Try a smaller image (< 5MB)
5. Check that ChatGPT supports images (requires Plus subscription)

---

### Incomplete or Missing Responses

**Problem:** Responses are cut off or not captured

**Solutions:**

1. Increase `MAX_TIMEOUT_ATTEMPTS` in `content.js` (line 33)
2. Increase `STABLE_CHECKS_REQUIRED` for longer responses (line 38)
3. Check ChatGPT page console for MutationObserver errors
4. Verify assistant message selector is correct

---

### Timeout Errors

**Problem:** `504 Timeout waiting for response from addon`

**Solutions:**

1. Increase server timeout in `main.py` (line 147): `timeout=180`
2. Increase content script timeout (line 33): `MAX_TIMEOUT_ATTEMPTS = 120`
3. Check if ChatGPT is actually responding (view the tab)
4. Verify network connection is stable

---

### Multiple Tabs Issue

**Problem:** Addon creates multiple ChatGPT tabs

**Cause:** Tab query not finding existing tabs

**Solution:**

- The addon searches for `https://chatgpt.com/*` tabs
- Ensure you're using the correct ChatGPT URL
- Check `background.js` line 18 for tab query logic

## Development

### Running in Development Mode

**Server:**

```bash
cd server
uvicorn main:app --reload --log-level debug
```

**Extension:**

1. Make changes to files in `chrome-addon/`
2. Go to `chrome://extensions`
3. Click the refresh icon on the extension card
4. Check console logs for debugging

### Logging

**Server Logs:**

- Set log level: `logging.basicConfig(level=logging.DEBUG)`
- View in terminal where server is running

**Extension Logs:**

- Background script: Click "Service worker" in `chrome://extensions`
- Content script: Open DevTools on ChatGPT page (F12) → Console tab
- Look for messages prefixed with `[GPT-CHROME-ADDON]`

### Testing

**Test Server Health:**

```bash
curl http://localhost:8000/health
```

**Test Basic Query:**

```bash
curl -X POST "http://localhost:8000/query" \
     -H "Content-Type: application/json" \
     -d '{"prompt": "Hello, world!", "startNewChat": true}'
```

**Test Image Upload:**

```bash
# Create a test image
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" > test.b64

curl -X POST "http://localhost:8000/query" \
     -H "Content-Type: application/json" \
     -d "{\"prompt\": \"Test\", \"image\": \"$(cat test.b64)\", \"startNewChat\": true}"
```

## Security Considerations

- **Local Only:** Server runs on localhost by default (not exposed to internet)
- **No Authentication:** No built-in authentication (add if exposing publicly)
- **Temporary Chat:** Uses temporary chat mode for privacy
- **CORS:** No CORS headers configured (add if needed for web clients)
- **File Uploads:** Limited to images, validated by content type

## Known Limitations

- **Single Connection:** Only one addon instance can connect to the server at a time
- **ChatGPT Plus:** Image uploads require ChatGPT Plus subscription
- **Rate Limits:** Subject to ChatGPT's rate limiting
- **DOM Dependency:** Breaks if ChatGPT's HTML structure changes significantly
- **Focus Requirement:** Some image injection methods require window focus
- **Browser Only:** Chrome/Chromium-based browsers only (Manifest V3)

## Future Enhancements

- [ ] Multi-client support (multiple addon instances)
- [ ] Authentication and API keys
- [ ] Conversation history management
- [ ] Support for GPT-4, GPT-3.5 model selection
- [ ] Streaming responses (SSE or WebSocket)
- [ ] Retry logic with exponential backoff
- [ ] Configuration file for settings
- [ ] Docker containerization
- [ ] Firefox extension support
- [ ] Web UI for server
- [ ] Response caching
- [ ] Batch query support

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is provided as-is for educational and automation purposes. Ensure compliance with OpenAI's Terms of Service when using this tool.

## Acknowledgments

- Built with [FastAPI](https://fastapi.tiangolo.com/)
- Uses [uv](https://github.com/astral-sh/uv) for Python package management
- Chrome Extension Manifest V3

---

**Note:** This tool automates interaction with ChatGPT's web interface. OpenAI provides an official API for programmatic access which may be more appropriate for production use cases.
