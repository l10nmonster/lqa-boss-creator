// background.js
import { captureFullPageScreenshotCDP } from './cdp_capture.js'; // Assuming cdp_capture.js is in the same directory

// This function is injected into the target page to extract text and metadata
function extractTextAndMetadataContentScript() {
    // --- Helper function fe00RangeToUtf8 ---
    function fe00RangeToUtf8(encoded) {
        const encodingOffset = 0xfe00;
        const decoder = new TextDecoder();
        const length = encoded.length;
        if (length % 2 !== 0) throw new Error("Invalid fe00 encoded input length");
        const bytes = new Uint8Array(length / 2);
        let byteIndex = 0;
        for (let i = 0; i < length; i += 2) {
            const highNibble = encoded.charCodeAt(i) - encodingOffset;
            const lowNibble = encoded.charCodeAt(i + 1) - encodingOffset;
            if (highNibble < 0 || highNibble > 15 || lowNibble < 0 || lowNibble > 15) {
                throw new Error("Invalid char code in fe00 encoded input");
            }
            bytes[byteIndex++] = (highNibble << 4) | lowNibble;
        }
        return decoder.decode(bytes);
    }
    // --- End of helper ---

    try {
        const textElements = [];
        const TARGET_REGEX = /(?<!["'<])\u200B([\uFE00-\uFE0F]+)([^\u200B]*?)\u200B(?![^<>]*">)/g;

        if (!document.body) {
            return { error: "Document body not found for text extraction." };
        }

        const treeWalker = document.createTreeWalker(
            document.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => NodeFilter.FILTER_ACCEPT }, false
        ); // Note: acceptNode simplified, might need more filtering if issues
        let node;
        while (node = treeWalker.nextNode()) {
            const parentElement = node.parentElement;
            if (parentElement) { // Basic visibility and tag checks
                const styles = window.getComputedStyle(parentElement);
                if (styles.display === 'none' || styles.visibility === 'hidden' || parseFloat(styles.opacity) === 0) continue;
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'HEAD'].includes(parentElement.tagName)) continue;
            } else { continue; } // Skip text nodes without a parent element

            const nodeTextContent = node.nodeValue;
            let match;
            TARGET_REGEX.lastIndex = 0; // Reset regex for each text node
            while ((match = TARGET_REGEX.exec(nodeTextContent)) !== null) {
                const encodedMetadata = match[1];
                const capturedText = match[2];
                let parsedMetadata = {};
                try {
                    const decodedJsonMetadata = fe00RangeToUtf8(encodedMetadata);
                    if (decodedJsonMetadata && decodedJsonMetadata.trim() !== "") {
                         parsedMetadata = JSON.parse(decodedJsonMetadata);
                    }
                } catch (e) {
                    console.warn(`LQA ContentScript: Failed to decode/parse metadata. Encoded: "${encodedMetadata}", Error: ${e.message}`);
                    parsedMetadata.decodingError = e.message;
                }

                const range = document.createRange();
                try {
                    range.setStart(node, match.index);
                    range.setEnd(node, match.index + match[0].length);
                    const rect = range.getBoundingClientRect();

                    if (rect.width > 0 || rect.height > 0) { // Basic check for visibility/size
                        textElements.push({
                            text: capturedText,
                            x: rect.left + window.scrollX,
                            y: rect.top + window.scrollY,
                            width: rect.width,
                            height: rect.height,
                            ...parsedMetadata
                        });
                    }
                } catch (rangeError) {
                    console.warn("LQA ContentScript: Range error:", rangeError, "Match index:", match.index, "Node length:", node.nodeValue.length);
                }
            }
        }
        // It's okay if textElements is empty, popup will check.
        return { textElements };
    } catch (e) {
        console.error("LQA ContentScript: Error during text/metadata extraction:", e);
        return { error: `Content script execution failed: ${e.message || String(e)}` };
    }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "scrapeCurrentPage") {
        console.log("BG: Received scrapeCurrentPage for tab:", request.tabId, "url:", request.url);

        if (!request.tabId) {
            console.error("BG: Missing tabId in scrapeCurrentPage request.");
            sendResponse({ success: false, error: "Missing tabId." });
            return true; // Keep message channel open for async response
        }

        // 1. Get text data and other metadata using content script
        const getTextDataPromise = chrome.scripting.executeScript({
            target: { tabId: request.tabId, frameIds: [0] }, // Main frame
            function: extractTextAndMetadataContentScript
        })
        .then(injectionResults => {
            if (chrome.runtime.lastError) {
                throw new Error(`Content script injection failed: ${chrome.runtime.lastError.message}`);
            }
            if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                if (injectionResults[0].result.error) {
                    throw new Error(`Content script error: ${injectionResults[0].result.error}`);
                }
                console.log("BG: Text data extracted successfully.");
                return injectionResults[0].result; // Should be { textElements: [...] }
            }
            throw new Error("Content script for text extraction returned no result.");
        });

        // 2. Get screenshot using CDP
        const getScreenshotPromise = captureFullPageScreenshotCDP(request.tabId)
            .then(screenshotBase64 => {
                console.log("BG: CDP Screenshot captured successfully.");
                return screenshotBase64;
            });

        // 3. Combine results
        Promise.all([getScreenshotPromise, getTextDataPromise])
            .then(([screenshotBase64, textDataResult]) => {
                // Check if textDataResult itself indicates no LQA content was found (not an error, but specific condition)
                if (!textDataResult.textElements || textDataResult.textElements.length === 0) {
                     console.log("BG: No LQA metadata segments found by content script.");
                     sendResponse({ success: false, error: "No LQA metadata segments found on the page." });
                     return;
                }

                const dataForPopup = {
                    url: request.url,
                    timestamp: new Date().toISOString(),
                    screenshot: screenshotBase64, // This is now the CDP screenshot
                    text_content: textDataResult.textElements
                };
                console.log("BG: Sending combined data to popup.");
                sendResponse({ success: true, data: dataForPopup });
            })
            .catch(err => {
                console.error("BG: Error during combined capture (CDP screenshot or Text extraction):", err);
                sendResponse({ success: false, error: `Capture process failed: ${err.message}` });
            });

        return true; // Crucial for asynchronous sendResponse
    }
    // ... other message listeners if any ...
});

console.log("LQA Boss Background Service Worker started.");