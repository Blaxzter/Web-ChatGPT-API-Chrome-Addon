let websocket;
let keepAliveInterval;

const connectWebSocket = () => {
    console.log('Attempting to connect to WebSocket server...');
    websocket = new WebSocket('ws://localhost:8000/ws');

    websocket.onopen = () => {
        console.log('WebSocket connection established.');

        // Keep the service worker alive by pinging every 20 seconds
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
        }
        keepAliveInterval = setInterval(() => {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                console.log('Sending keep-alive ping...');
                // Send a ping message to keep connection alive
                try {
                    websocket.send(
                        JSON.stringify({
                            id: 'keep-alive-' + Date.now(),
                            type: 'control',
                            data: 'ping',
                        }),
                    );
                } catch (e) {
                    console.error('Failed to send keep-alive:', e);
                }
            }
        }, 20000); // Every 20 seconds
    };

    websocket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('Message from server: ', message);

            if (message.type === 'prompt') {
                // First, try to find an existing ChatGPT tab
                chrome.tabs.query({ url: 'https://chatgpt.com/*' }, async (tabs) => {
                    let targetTab = null;

                    if (tabs.length > 0) {
                        // Use the first ChatGPT tab found
                        targetTab = tabs[0];
                        console.log(`Found existing ChatGPT tab: ${targetTab.id}`);

                        // Focus the tab and window
                        chrome.windows.update(targetTab.windowId, { focused: true });
                        chrome.tabs.update(targetTab.id, { active: true });
                    } else {
                        // No ChatGPT tab found, create a new one
                        console.log('No ChatGPT tab found. Creating a new one...');
                        try {
                            targetTab = await chrome.tabs.create({
                                url: 'https://chatgpt.com',
                                active: true,
                            });
                            console.log(`Created new ChatGPT tab: ${targetTab.id}`);

                            // Wait for the page to load before sending the prompt
                            // We'll listen for the tab to complete loading
                            await new Promise((resolve) => {
                                const listener = (tabId, changeInfo) => {
                                    if (
                                        tabId === targetTab.id &&
                                        changeInfo.status === 'complete'
                                    ) {
                                        chrome.tabs.onUpdated.removeListener(listener);
                                        // Give the content script a moment to initialize
                                        setTimeout(resolve, 2000);
                                    }
                                };
                                chrome.tabs.onUpdated.addListener(listener);

                                // Timeout after 30 seconds
                                setTimeout(() => {
                                    chrome.tabs.onUpdated.removeListener(listener);
                                    resolve();
                                }, 30000);
                            });
                        } catch (error) {
                            console.error('Failed to create ChatGPT tab:', error);
                            const errorResponse = {
                                id: message.id,
                                type: 'response',
                                data: {
                                    status: 'error',
                                    response: 'Failed to create ChatGPT tab.',
                                },
                            };
                            websocket.send(JSON.stringify(errorResponse));
                            return;
                        }
                    }

                    // Now send the prompt to the target tab
                    console.log(`Forwarding prompt to content script in tab ${targetTab.id}...`);

                    // Support both string (legacy) and object (with image) data formats
                    const messageData =
                        typeof message.data === 'string' ? { prompt: message.data } : message.data;

                    chrome.tabs
                        .sendMessage(targetTab.id, {
                            command: 'execute_prompt',
                            id: message.id,
                            data: messageData,
                        })
                        .catch((error) => {
                            // Handle the case where the content script is not available
                            console.error(
                                'Error sending message to content script:',
                                error.message,
                            );
                            const errorResponse = {
                                id: message.id,
                                type: 'response',
                                data: {
                                    status: 'error',
                                    response:
                                        'Could not connect to the content script. The page may still be loading.',
                                },
                            };
                            websocket.send(JSON.stringify(errorResponse));
                        });
                });
            } else {
                console.warn('Received unknown message type from server:', message.type);
            }
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e, event.data);
        }
    };

    websocket.onclose = () => {
        console.log('WebSocket connection closed. Reconnecting in 5 seconds...');
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
        }
        setTimeout(connectWebSocket, 5000);
    };

    websocket.onerror = (error) => {
        console.error('WebSocket error: ', error);
        // The onclose event will fire next, which will handle reconnection.
    };
};

// Combined message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle connection status requests from popup
    if (message.command === 'get_connection_status') {
        const status = {
            connected: websocket && websocket.readyState === WebSocket.OPEN,
            readyState: websocket ? websocket.readyState : null,
            serverUrl: 'ws://localhost:8000/ws',
        };
        sendResponse(status);
        return true; // Keep the message channel open for async response
    }

    // Messages from content scripts have a `sender.tab`
    if (sender.tab) {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            console.log('Forwarding message to server:', message);
            const responseData = {
                status: message.status,
                response: message.response,
            };
            // Include image data if present
            if (message.generatedImage) {
                responseData.generatedImage = message.generatedImage;
            }
            const serverMessage = {
                id: message.id,
                type: 'response',
                data: responseData,
            };
            websocket.send(JSON.stringify(serverMessage));
        } else {
            console.error('WebSocket is not connected. Cannot send message to server.');
        }
    }

    return false;
});

// Initial connection attempt
connectWebSocket();
