let responseObserver = null;
let responseTimeout = null;

// Helper function to download image and convert to base64
async function downloadImageAsBase64(imageUrl) {
    try {
        console.log('[GPT-CHROME-ADDON] Downloading image from:', imageUrl);
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Remove the data URL prefix to get just the base64 string
                const base64 = reader.result.replace(/^data:image\/\w+;base64,/, '');
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[GPT-CHROME-ADDON] Error downloading image:', error);
        throw error;
    }
}

// Helper function to check for generated images in the message
async function extractGeneratedImage(messageElement) {
    try {
        console.log('[GPT-CHROME-ADDON] 🔍 Checking for generated images in message...');

        // Look for image within a div with class containing 'group/imagegen-image'
        const imageContainer = messageElement.querySelector('[class*="group/imagegen-image"]');
        if (!imageContainer) {
            console.log(
                '[GPT-CHROME-ADDON] ❌ No image container found with class "group/imagegen-image"',
            );

            // Debug: Log all elements with "group" or "image" in class
            const allDivsWithGroup = messageElement.querySelectorAll('[class*="group"]');
            const allDivsWithImage = messageElement.querySelectorAll('[class*="image"]');
            console.log(
                `[GPT-CHROME-ADDON] 📊 Found ${allDivsWithGroup.length} elements with "group" in class`,
            );
            console.log(
                `[GPT-CHROME-ADDON] 📊 Found ${allDivsWithImage.length} elements with "image" in class`,
            );

            // Log first few class names for debugging
            if (allDivsWithGroup.length > 0) {
                console.log(
                    '[GPT-CHROME-ADDON] 📝 Sample "group" classes:',
                    Array.from(allDivsWithGroup)
                        .slice(0, 3)
                        .map((el) => el.className),
                );
            }
            if (allDivsWithImage.length > 0) {
                console.log(
                    '[GPT-CHROME-ADDON] 📝 Sample "image" classes:',
                    Array.from(allDivsWithImage)
                        .slice(0, 3)
                        .map((el) => el.className),
                );
            }

            return null;
        }

        console.log('[GPT-CHROME-ADDON] ✅ Found image container:', imageContainer.className);

        // Find the img tag within this container
        const imgElement = imageContainer.querySelector('img');
        if (!imgElement) {
            console.log('[GPT-CHROME-ADDON] ❌ No <img> tag found in container');
            return null;
        }

        if (!imgElement.src) {
            console.log('[GPT-CHROME-ADDON] ❌ Image element found but has no src attribute');
            return null;
        }

        console.log('[GPT-CHROME-ADDON] ✅ Found generated image with src:', imgElement.src);
        console.log('[GPT-CHROME-ADDON] 📥 Starting image download...');

        // Download and encode the image
        const base64Image = await downloadImageAsBase64(imgElement.src);
        console.log(
            '[GPT-CHROME-ADDON] ✅ Image encoded to base64 (length:',
            base64Image.length,
            'characters)',
        );

        return {
            url: imgElement.src,
            base64: base64Image,
            alt: imgElement.alt || 'Generated image',
        };
    } catch (error) {
        console.error('[GPT-CHROME-ADDON] ❌ Error extracting generated image:', error);
        return null;
    }
}

function getLastAIReply() {
    // Use the more specific selector provided by the user for assistant messages
    const messageElements = document.querySelectorAll('article[data-turn="assistant"]');
    if (messageElements.length === 0) return null;

    // Get the last assistant message
    const lastAssistantMessage = messageElements[messageElements.length - 1];

    // Extract the markdown content within this message
    const aiMarkdownContent = lastAssistantMessage.querySelector('.markdown');

    if (aiMarkdownContent) {
        return aiMarkdownContent.innerText;
    }
    return null;
}

function startObservingResponses(requestId, sendResponseCallback) {
    console.log('[GPT-CHROME-ADDON] Starting observation for new assistant responses...');

    // Store the initial count of assistant messages to detect new ones
    const initialAssistantCount = document.querySelectorAll(
        'article[data-turn="assistant"]',
    ).length;
    console.log(`[GPT-CHROME-ADDON] 📊 Initial assistant message count: ${initialAssistantCount}`);
    let timeoutAttempts = 0;
    const MAX_TIMEOUT_ATTEMPTS = 60; // 60 seconds max wait time

    // Track content stability to detect when streaming has finished
    let lastResponseText = null;
    let stableCheckCount = 0;
    const STABLE_CHECKS_REQUIRED = 3; // Number of consecutive checks with same content before considering it stable
    const STABILITY_CHECK_INTERVAL_MS = 300; // Check every 300ms

    // Function to check if a new complete assistant message has appeared
    const checkForNewAssistantMessage = async () => {
        const assistantMessages = document.querySelectorAll('article[data-turn="assistant"]');

        console.log(
            `[GPT-CHROME-ADDON] 🔄 Checking for new messages. Current count: ${assistantMessages.length}, Initial: ${initialAssistantCount}`,
        );

        // Check if we have a new assistant message
        if (assistantMessages.length > initialAssistantCount) {
            const newMessage = assistantMessages[assistantMessages.length - 1];
            console.log('[GPT-CHROME-ADDON] ✅ New assistant message detected!');

            // Check if the message has the markdown content (indicating it's fully loaded)
            const markdownContent = newMessage.querySelector('.markdown');
            console.log('[GPT-CHROME-ADDON] 📝 Markdown content present:', !!markdownContent);

            // IMPORTANT: Check if this is a temporary "thinking" message by looking for loading-shimmer
            // These messages appear during image analysis or other processing states
            const hasLoadingShimmer = newMessage.querySelector('.loading-shimmer');
            if (hasLoadingShimmer) {
                console.log(
                    '[GPT-CHROME-ADDON] ⏳ Detected temporary loading message (loading-shimmer present), skipping...',
                );
                // Reset stability tracking since this is a temporary message
                lastResponseText = null;
                stableCheckCount = 0;
                return false;
            }

            // Also check if the message has the data-is-last-node attribute which indicates completion
            const lastNode = markdownContent?.querySelector('[data-is-last-node]');
            console.log('[GPT-CHROME-ADDON] 🏁 Last node marker present:', !!lastNode);

            // Check for image generation container (image responses may not have lastNode marker)
            const hasImageContainer = newMessage.querySelector('[class*="group/imagegen-image"]');
            console.log('[GPT-CHROME-ADDON] 🖼️ Image container present:', !!hasImageContainer);

            // Process response if we have:
            // 1. Markdown content with lastNode (normal text response)
            // 2. Markdown content with image container (text + image response)
            // 3. Image container alone (image-only response, no markdown needed)
            if ((markdownContent && lastNode) || hasImageContainer) {
                // Get the current response text (may be empty for image-only responses)
                const responseText = markdownContent ? markdownContent.innerText : '';
                const textLength = responseText ? responseText.trim().length : 0;
                console.log(`[GPT-CHROME-ADDON] 📄 Response text length: ${textLength} characters`);

                // Check if content has stabilized (stopped changing)
                if (lastResponseText === responseText) {
                    stableCheckCount++;
                    console.log(
                        `[GPT-CHROME-ADDON] ⏱️ Content stable (${stableCheckCount}/${STABLE_CHECKS_REQUIRED})...`,
                    );

                    // If content has been stable for required number of checks, it's complete
                    if (stableCheckCount >= STABLE_CHECKS_REQUIRED) {
                        console.log(
                            '[GPT-CHROME-ADDON] ✅ Complete AI Reply detected (content stabilized)!',
                        );

                        // Check for generated image FIRST (before checking text content)
                        console.log('[GPT-CHROME-ADDON] 🔍 Checking for generated image...');
                        const generatedImage = await extractGeneratedImage(newMessage);

                        // If there's no text and no image, this is likely an incomplete response
                        // (but only fail if we expected a lastNode - for image responses, we accept empty text)
                        if (textLength === 0 && !generatedImage) {
                            if (lastNode) {
                                // Has lastNode but no content - likely an error
                                console.log(
                                    '[GPT-CHROME-ADDON] ⚠️ Response is empty (no text and no image)',
                                );
                                return false;
                            } else {
                                // Image container present but image not ready yet - keep waiting
                                console.log(
                                    '[GPT-CHROME-ADDON] ⏳ Image container present but image not loaded yet, continuing to wait...',
                                );
                                // Don't reset stability - keep counting
                                return false;
                            }
                        }

                        if (textLength > 0) {
                            console.log(
                                '[GPT-CHROME-ADDON] 📝 Response preview:',
                                responseText.substring(0, 100) + '...',
                            );
                        }

                        stopObservingResponses();

                        const responseData = {
                            status: 'success',
                            id: requestId,
                            response: responseText || '', // Empty string if no text
                        };

                        // Add image data if present
                        if (generatedImage) {
                            console.log(
                                '[GPT-CHROME-ADDON] 🖼️ Including generated image in response',
                            );
                            responseData.generatedImage = generatedImage;
                        } else {
                            console.log(
                                '[GPT-CHROME-ADDON] ℹ️ No generated image found in response',
                            );
                        }

                        sendResponseCallback(responseData);
                        return true;
                    }
                } else {
                    // Content changed, reset stability counter
                    const oldLength = lastResponseText ? lastResponseText.length : 0;
                    const newLength = responseText.length;
                    console.log(
                        `[GPT-CHROME-ADDON] 🔄 Content still changing (${oldLength} → ${newLength} chars), resetting stability counter...`,
                    );
                    lastResponseText = responseText;
                    stableCheckCount = 0;
                }
            } else {
                // Reset stability tracking if completion markers not present
                if (!markdownContent) {
                    console.log('[GPT-CHROME-ADDON] ⚠️ No markdown content found yet');
                } else if (!lastNode && !hasImageContainer) {
                    console.log(
                        '[GPT-CHROME-ADDON] ⚠️ Markdown content present but no completion markers (no last node or image container)',
                    );
                }
                lastResponseText = null;
                stableCheckCount = 0;
            }
        } else {
            console.log('[GPT-CHROME-ADDON] ⏳ No new assistant messages yet...');
        }

        return false;
    };

    // Use MutationObserver on the document body to catch the assistant div appearing
    responseObserver = new MutationObserver((mutations) => {
        // Check if any mutation added a node with data-message-author-role="assistant"
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    // Check if the added node itself or any of its descendants is an assistant message
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const isAssistantMessage = node.getAttribute?.('data-turn') === 'assistant';
                        const hasAssistantChild = node.querySelector?.(
                            'article[data-turn="assistant"]',
                        );

                        if (isAssistantMessage || hasAssistantChild) {
                            console.log(
                                '[GPT-CHROME-ADDON] 🔔 Mutation detected: New assistant message node added',
                            );
                            // Debounce to wait for content to fully render
                            clearTimeout(responseTimeout);
                            responseTimeout = setTimeout(async () => {
                                await checkForNewAssistantMessage();
                            }, STABILITY_CHECK_INTERVAL_MS);
                            return;
                        }
                    }
                }
            }

            // Also check for attribute changes on existing nodes (for streaming content)
            if (mutation.type === 'attributes' || mutation.type === 'characterData') {
                console.log(
                    '[GPT-CHROME-ADDON] 🔔 Mutation detected: Content change (',
                    mutation.type,
                    ')',
                );
                clearTimeout(responseTimeout);
                responseTimeout = setTimeout(async () => {
                    await checkForNewAssistantMessage();
                }, STABILITY_CHECK_INTERVAL_MS);
            }
        }
    });

    // Observe the entire document body for maximum coverage
    responseObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-is-last-node', 'data-turn'],
        characterData: true,
        characterDataOldValue: false,
    });

    console.log('[GPT-CHROME-ADDON] 👀 MutationObserver attached and watching for changes...');

    // Fallback: Poll regularly as a safety net in case MutationObserver misses something
    const pollInterval = setInterval(async () => {
        timeoutAttempts++;
        console.log(`[GPT-CHROME-ADDON] 🔄 Poll check #${timeoutAttempts}/${MAX_TIMEOUT_ATTEMPTS}`);

        if (await checkForNewAssistantMessage()) {
            clearInterval(pollInterval);
            return;
        }

        // Timeout after MAX_TIMEOUT_ATTEMPTS
        if (timeoutAttempts >= MAX_TIMEOUT_ATTEMPTS) {
            clearInterval(pollInterval);
            console.error('[GPT-CHROME-ADDON] ❌ Timed out waiting for assistant response.');
            stopObservingResponses();
            sendResponseCallback({
                status: 'error',
                reason: 'Timed out waiting for assistant response.',
            });
        }
    }, 1000);

    // Store the interval ID so we can clear it when stopping observation
    responseObserver.pollInterval = pollInterval;
}

function stopObservingResponses() {
    if (responseObserver) {
        console.log('[GPT-CHROME-ADDON] Stopping response observation.');
        responseObserver.disconnect();

        // Clear the polling interval if it exists
        if (responseObserver.pollInterval) {
            clearInterval(responseObserver.pollInterval);
        }

        responseObserver = null;
        clearTimeout(responseTimeout);
        responseTimeout = null;
    }
}

console.log('[GPT-CHROME-ADDON] ChatGPT Control content script loaded.');

// Helper to ensure temporary chat is active
async function ensureTemporaryChatActive(startNewChat = true, useTemporaryChat = true) {
    // First, create a new chat before switching to temporary chat (if requested)
    if (startNewChat) {
        const newChatButton = document.querySelector('[data-testid="create-new-chat-button"]');

        if (newChatButton) {
            console.log('[GPT-CHROME-ADDON] New chat button found. Creating new chat...');
            newChatButton.click();
            // Wait for the UI to settle after creating new chat
            await new Promise((resolve) => setTimeout(resolve, 1000));
            console.log('[GPT-CHROME-ADDON] New chat created.');
        } else {
            console.log(
                '[GPT-CHROME-ADDON] New chat button not found. Proceeding without creating new chat.',
            );
        }
    } else {
        console.log('[GPT-CHROME-ADDON] Skipping new chat creation (startNewChat=false).');
    }

    // Activate temporary chat if requested
    if (useTemporaryChat) {
        const tempChatButton = document.querySelector('[aria-label="Temporären Chat aktivieren"]'); // Use aria-label as provided
        // A common data-testid for this button is 'temp-chat-button', but we'll use aria-label for now
        // const tempChatButton = document.querySelector('[data-testid="temp-chat-button"]');

        if (tempChatButton) {
            console.log('[GPT-CHROME-ADDON] Temporary chat button found. Clicking to activate...');
            tempChatButton.click();
            // Wait for the UI to settle after clicking the button
            await new Promise((resolve) => setTimeout(resolve, 1000));
            console.log('[GPT-CHROME-ADDON] Temporary chat activated.');
        } else {
            console.log(
                '[GPT-CHROME-ADDON] Temporary chat button not found. Assuming temporary chat is already active or feature not available.',
            );
        }
    } else {
        console.log(
            '[GPT-CHROME-ADDON] Skipping temporary chat activation (useTemporaryChat=false).',
        );
    }
}

// Helper function to wait for user to focus the window
async function waitForUserFocus(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        // Check if already focused
        if (document.hasFocus()) {
            console.log('[GPT-CHROME-ADDON] Document already has focus.');
            resolve();
            return;
        }

        console.log('[GPT-CHROME-ADDON] ⚠️ Waiting for user to focus the ChatGPT window...');
        console.log('[GPT-CHROME-ADDON] 👉 Please click on the ChatGPT tab/window to continue.');

        const timeoutId = setTimeout(() => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            reject(
                new Error(
                    'Timeout waiting for user to focus window. Please click on the ChatGPT tab.',
                ),
            );
        }, timeoutMs);

        const onFocus = () => {
            console.log('[GPT-CHROME-ADDON] ✓ Window focused by user!');
            clearTimeout(timeoutId);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            resolve();
        };

        const onVisibilityChange = () => {
            if (!document.hidden && document.hasFocus()) {
                onFocus();
            }
        };

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);
    });
}

// Helper function to paste image using clipboard API (requires focus)
async function pasteImageViaClipboardAPI(blob, inputElement) {
    // Create ClipboardItem with the image
    const clipboardItem = new ClipboardItem({ 'image/png': blob });

    // Write to clipboard (requires document focus)
    await navigator.clipboard.write([clipboardItem]);
    console.log('[GPT-CHROME-ADDON] Image written to clipboard successfully.');

    // Wait a bit after writing to clipboard
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create a proper File object
    const file = new File([blob], 'image.png', { type: 'image/png' });

    // Create DataTransfer object
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Create and dispatch paste event with proper clipboardData
    const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
    });

    // Dispatch the paste event on the input element
    inputElement.dispatchEvent(pasteEvent);

    console.log('[GPT-CHROME-ADDON] Paste event dispatched via Clipboard API.');
}

// Helper function to inject image via drag-and-drop simulation (NO FOCUS REQUIRED!)
async function injectImageViaDragDrop(blob) {
    try {
        console.log('[GPT-CHROME-ADDON] Attempting to inject image via drag-and-drop...');

        // Find the prompt textarea or its container
        const inputElement = document.querySelector('#prompt-textarea');
        if (!inputElement) {
            throw new Error('Could not find input element.');
        }

        // Create a File object from the blob
        const file = new File([blob], 'image.png', { type: 'image/png' });

        // Create a DataTransfer to hold the file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        console.log('[GPT-CHROME-ADDON] File created:', file.name, file.size, 'bytes');

        // Simulate drag and drop sequence
        const dragEnterEvent = new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
        });

        const dragOverEvent = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
        });

        const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
        });

        // Dispatch events in sequence
        inputElement.dispatchEvent(dragEnterEvent);
        console.log('[GPT-CHROME-ADDON] DragEnter event dispatched.');

        await new Promise((resolve) => setTimeout(resolve, 50));

        inputElement.dispatchEvent(dragOverEvent);
        console.log('[GPT-CHROME-ADDON] DragOver event dispatched.');

        await new Promise((resolve) => setTimeout(resolve, 50));

        inputElement.dispatchEvent(dropEvent);
        console.log('[GPT-CHROME-ADDON] Drop event dispatched.');

        // Also try dispatching on the document body as fallback
        document.body.dispatchEvent(dropEvent);
        console.log('[GPT-CHROME-ADDON] Drop event also dispatched on body.');

        return true;
    } catch (error) {
        console.error('[GPT-CHROME-ADDON] Error injecting via drag-drop:', error);
        throw error;
    }
}

// Helper function to inject image via file input (NO FOCUS REQUIRED!)
async function injectImageViaFileInput(blob) {
    try {
        console.log('[GPT-CHROME-ADDON] Attempting to inject image via file input...');

        // Find or create a hidden file input element
        let fileInput = document.querySelector('#gpt-addon-file-input');

        if (!fileInput) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.id = 'gpt-addon-file-input';
            fileInput.accept = 'image/*';
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);
        }

        // Create a File object from the blob
        const file = new File([blob], 'image.png', { type: 'image/png' });

        // Create a DataTransfer to hold the file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        console.log('[GPT-CHROME-ADDON] File added to hidden input:', fileInput.files[0]);

        // Find the prompt textarea
        const inputElement = document.querySelector('#prompt-textarea');
        if (!inputElement) {
            throw new Error('Could not find input element.');
        }

        // Dispatch a change event on the file input
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Try paste event with the file
        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer,
        });

        inputElement.dispatchEvent(pasteEvent);
        console.log('[GPT-CHROME-ADDON] Paste event dispatched on textarea.');

        return true;
    } catch (error) {
        console.error('[GPT-CHROME-ADDON] Error injecting via file input:', error);
        throw error;
    }
}

// Helper function to count attached images
function countAttachedImages() {
    // Count buttons with background-image style that contain image data
    const imageButtons = document.querySelectorAll(
        'button[aria-haspopup="dialog"] span[style*="background-image"]',
    );

    // Filter to only count those with actual image data (data:image or url)
    const validImages = Array.from(imageButtons).filter((span) => {
        const bgImage = span.style.backgroundImage;
        return bgImage && (bgImage.includes('data:image') || bgImage.includes('url('));
    });

    console.log(`[GPT-CHROME-ADDON] Current attached image count: ${validImages.length}`);
    return validImages.length;
}

// Helper function to wait for image count to increase
async function waitForImageCountIncrease(initialCount, maxWaitMs = 2000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        const currentCount = countAttachedImages();
        if (currentCount > initialCount) {
            console.log(
                `[GPT-CHROME-ADDON] ✓ Image count increased from ${initialCount} to ${currentCount}`,
            );
            return true;
        }
        // Poll every 100ms
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`[GPT-CHROME-ADDON] Image count did not increase after ${maxWaitMs}ms`);
    return false;
}

// Helper function to paste image from clipboard into ChatGPT
async function pasteImageIntoChat(base64Image) {
    try {
        // Remove data URL prefix if present (e.g., "data:image/png;base64,")
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

        // Convert base64 to blob
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/png' });

        // Find the input element
        const inputElement = document.querySelector('#prompt-textarea');
        if (!inputElement) {
            throw new Error('Could not find input element to paste image.');
        }

        // Get initial image count before attempting to add
        const initialImageCount = countAttachedImages();
        console.log(
            `[GPT-CHROME-ADDON] Starting image insertion. Current count: ${initialImageCount}`,
        );

        // METHOD 1: Try drag-and-drop injection first (NO FOCUS REQUIRED)
        console.log('[GPT-CHROME-ADDON] Trying drag-and-drop injection method...');
        try {
            await injectImageViaDragDrop(blob);

            // Wait and check if image count increased
            const success = await waitForImageCountIncrease(initialImageCount, 2000);
            if (success) {
                console.log('[GPT-CHROME-ADDON] ✓ Image successfully added via drag-and-drop!');
                return true;
            } else {
                console.warn(
                    "[GPT-CHROME-ADDON] Drag-drop method didn't work, trying file input method...",
                );
            }
        } catch (error) {
            console.warn('[GPT-CHROME-ADDON] Drag-drop method failed:', error);
        }

        // METHOD 2: Try file input injection (NO FOCUS REQUIRED)
        console.log('[GPT-CHROME-ADDON] Trying file input injection method...');
        try {
            await injectImageViaFileInput(blob);

            // Wait and check if image count increased
            const success = await waitForImageCountIncrease(initialImageCount, 2000);
            if (success) {
                console.log('[GPT-CHROME-ADDON] ✓ Image successfully added via file input!');
                return true;
            } else {
                console.warn(
                    "[GPT-CHROME-ADDON] File input method didn't work, trying clipboard method...",
                );
            }
        } catch (error) {
            console.warn('[GPT-CHROME-ADDON] File input method failed:', error);
        }

        // METHOD 3: Try clipboard method (requires focus)
        console.log('[GPT-CHROME-ADDON] Trying clipboard-based method (requires focus)...');

        // Try to focus the document and input element first
        window.focus();
        inputElement.focus();
        inputElement.click();

        // Wait for focus to settle
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Check if document has focus, if not wait for user to focus
        if (!document.hasFocus()) {
            console.log('[GPT-CHROME-ADDON] Document not focused. Waiting for user interaction...');
            await waitForUserFocus(30000); // Wait up to 30 seconds

            // Focus again after user focuses window
            inputElement.focus();
            inputElement.click();
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        // Try clipboard API approach (requires focus)
        try {
            await pasteImageViaClipboardAPI(blob, inputElement);
        } catch (clipboardError) {
            console.error('[GPT-CHROME-ADDON] Clipboard API failed:', clipboardError);
            console.log('[GPT-CHROME-ADDON] Falling back to direct DataTransfer method...');

            // Fallback: Direct DataTransfer without clipboard API
            const file = new File([blob], 'image.png', { type: 'image/png' });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer,
            });

            inputElement.dispatchEvent(pasteEvent);
            console.log('[GPT-CHROME-ADDON] Paste event dispatched via fallback.');
        }

        // Wait and check if image count increased
        const success = await waitForImageCountIncrease(initialImageCount, 2000);
        if (success) {
            console.log('[GPT-CHROME-ADDON] ✓ Image successfully added via clipboard!');
            return true;
        } else {
            console.error('[GPT-CHROME-ADDON] ✗ Failed to add image - no method worked.');
            throw new Error('Failed to add image to chat after trying all methods.');
        }
    } catch (error) {
        console.error('[GPT-CHROME-ADDON] Error pasting image:', error);
        throw error;
    }
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    console.log('[GPT-CHROME-ADDON] Content script received message:', request);

    if (request.command === 'execute_prompt') {
        // Support both legacy string format and new object format
        const data = typeof request.data === 'string' ? { prompt: request.data } : request.data;

        const prompt = data.prompt;
        const image = data.image;
        const startNewChat = data.startNewChat !== undefined ? data.startNewChat : true;
        const useTemporaryChat = data.useTemporaryChat !== undefined ? data.useTemporaryChat : true;
        const requestId = request.id;
        console.log(`Executing prompt: ${prompt} for ID: ${requestId}`);
        console.log(`[GPT-CHROME-ADDON] startNewChat: ${startNewChat}`);
        console.log(`[GPT-CHROME-ADDON] useTemporaryChat: ${useTemporaryChat}`);
        if (image) {
            console.log(`[GPT-CHROME-ADDON] Image data provided (length: ${image.length})`);
        }

        // First, ensure temporary chat mode is active (if requested)
        await ensureTemporaryChatActive(startNewChat, useTemporaryChat);

        const inputElement = document.querySelector('#prompt-textarea');

        if (!inputElement) {
            console.error("Could not find the input element ('#prompt-textarea').");
            chrome.runtime.sendMessage({
                id: requestId,
                response: {
                    status: 'error',
                    reason: 'Could not find page input element.',
                },
            });
            return true;
        }

        // If an image is provided, paste it first
        if (image) {
            try {
                console.log('[GPT-CHROME-ADDON] Attempting to paste image...');
                await pasteImageIntoChat(image);
                console.log('[GPT-CHROME-ADDON] Image pasted successfully.');
            } catch (error) {
                console.error('[GPT-CHROME-ADDON] Failed to paste image:', error);
                chrome.runtime.sendMessage({
                    id: requestId,
                    response: {
                        status: 'error',
                        reason: `Failed to paste image: ${error.message}`,
                    },
                });
                return true;
            }
        }

        // Step 1: Interact with the input element to trigger the send button's appearance
        inputElement.click(); // Simulate a user click to focus the element
        inputElement.innerHTML = `<p>${prompt}</p>`;
        inputElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

        // Step 2: Poll for the send button to appear and be enabled
        let attempts = 0;
        const pollForSendButton = setInterval(() => {
            const sendButton = document.querySelector('[data-testid="send-button"]');

            // Check if button exists and is not disabled
            if (sendButton && !sendButton.disabled) {
                clearInterval(pollForSendButton); // Stop polling

                // Step 3: Click the button and start observing for a response
                console.log('[GPT-CHROME-ADDON] Send button found and enabled. Clicking...');
                sendButton.click();
                console.log('[GPT-CHROME-ADDON] Prompt submitted.');

                startObservingResponses(requestId, (response) => {
                    const message = {
                        id: requestId,
                        response: response.response,
                        status: response.status,
                    };
                    // Include image data if present
                    if (response.generatedImage) {
                        message.generatedImage = response.generatedImage;
                    }
                    chrome.runtime.sendMessage(message);
                });
            } else {
                attempts++;
                if (attempts > 25) {
                    // Timeout after 5 seconds (25 * 200ms)
                    clearInterval(pollForSendButton);
                    console.error(
                        'Timed out waiting for the send button to appear or become enabled.',
                    );
                    chrome.runtime.sendMessage({
                        id: requestId,
                        response: {
                            status: 'error',
                            reason: 'Timed out waiting for send button.',
                        },
                    });
                }
            }
        }, 200);

        return true; // We are handling this asynchronously
    }
});
