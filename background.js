const HTML2CANVAS_PATH = 'html2canvas.min.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "scrapeCurrentPage") {
        console.log("Background received scrapeCurrentPage request for tab:", request.tabId, "url:", request.url);

        if (!request.tabId) {
            console.error("Missing tabId in request", request);
            sendResponse({ success: false, error: "Missing tabId." });
            return true; // Indicates asynchronous response
        }

        // Inject html2canvas first, then our scraper script into the main frame (frameId: 0)
        chrome.scripting.executeScript({
            target: { tabId: request.tabId, frameIds: [0] }, // Target main frame
            files: [HTML2CANVAS_PATH]
        })
        .then(() => {
            console.log("html2canvas injected successfully into main frame of tab:", request.tabId);
            return chrome.scripting.executeScript({
                target: { tabId: request.tabId, frameIds: [0] }, // Target main frame
                function: contentScriptScraper
            });
        })
        .then((injectionResults) => {
            if (chrome.runtime.lastError) { // Check for errors during script execution
                console.error("Error during script execution:", chrome.runtime.lastError);
                sendResponse({ success: false, error: `Script execution failed: ${chrome.runtime.lastError.message}` });
                return;
            }

            if (injectionResults && injectionResults.length > 0 && injectionResults[0].result) {
                const scrapedData = injectionResults[0].result;
                if (scrapedData.error) {
                    sendResponse({ success: false, error: `Content script error: ${scrapedData.error}` });
                    return;
                }

                // Just send the data back, popup will handle storage and eventual download
                const dataForPopup = {
                    url: request.url,
                    timestamp: new Date().toISOString(),
                    screenshot: scrapedData.screenshotBase64,
                    text_content: scrapedData.textElements
                };
                sendResponse({ success: true, data: dataForPopup });

            } else {
                console.error("Content script did not return expected results or failed:", injectionResults);
                let errorMsg = "Content script failed or returned no data.";
                // More detailed error extraction if available
                if (injectionResults && injectionResults.length > 0 && injectionResults[0] && typeof injectionResults[0].result === 'object' && injectionResults[0].result.error) {
                     errorMsg = `Content script error: ${injectionResults[0].result.error}`;
                } else if (injectionResults && injectionResults.length > 0 && injectionResults[0] && injectionResults[0].error) {
                    errorMsg = `Injection failed: ${injectionResults[0].error.message || JSON.stringify(injectionResults[0].error)}`;
                }
                sendResponse({ success: false, error: errorMsg });
            }
        })
        .catch(err => {
            console.error("Error executing script in active tab:", err);
            sendResponse({ success: false, error: `Scripting error: ${err.message}` });
        });

        return true; // Crucial for asynchronous sendResponse
    }
});

// This function will be injected and executed in the context of the target PAGE
function contentScriptScraper() {
    // --- Helper function provided by user ---
    function fe00RangeToUtf8(encoded) {
      const encodingOffset = 0xfe00;
      const decoder = new TextDecoder(); // Default is 'utf-8'
      const length = encoded.length;

      if (length % 2 !== 0) {
        // console.warn("Invalid encoded metadata input length:", encoded);
        // Instead of throwing, which might break the whole script,
        // return an error or an empty string/object.
        // For now, let's assume the caller (JSON.parse) will handle bad output.
        // Or, we can return a specific marker that indicates an error.
        throw new Error("Invalid encoded input length for fe00RangeToUtf8");
      }
      const bytes = new Uint8Array(length / 2);
      let byteIndex = 0;
      for (let i = 0; i < length; i += 2) {
        const highNibble = encoded.charCodeAt(i) - encodingOffset;
        const lowNibble = encoded.charCodeAt(i + 1) - encodingOffset;
        // Basic validation for nibble values (0-15)
        if (highNibble < 0 || highNibble > 15 || lowNibble < 0 || lowNibble > 15) {
            // console.warn("Invalid character code in encoded metadata:", encoded);
            throw new Error("Invalid character code in fe00RangeToUtf8 input");
        }
        bytes[byteIndex++] = (highNibble << 4) | lowNibble;
      }
      return decoder.decode(bytes);
    }
    // --- End of helper function ---

    if (typeof html2canvas === 'undefined') {
        return { error: "html2canvas is not loaded in the page context." };
    }

    const getFullPageDimensions = () => {
        const body = document.body;
        const html = document.documentElement;
        const height = Math.max(
            body.scrollHeight, body.offsetHeight,
            html.clientHeight, html.scrollHeight, html.offsetHeight
        );
        const width = Math.max(
            body.scrollWidth, body.offsetWidth,
            html.clientWidth, html.scrollWidth, html.offsetWidth
        );
        return { width, height };
    };

    if (!document.body) {
        return { error: "Document body not found. Cannot take screenshot." };
    }

    const dimensions = getFullPageDimensions();
    const currentDevicePixelRatio = window.devicePixelRatio || 1;

    return html2canvas(document.body, {
        allowTaint: true,
        useCORS: true,
        // scrollX: 0,
        // scrollY: 0,
        windowWidth: dimensions.width,
        windowHeight: dimensions.height,
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height,
        scale: currentDevicePixelRatio,
        logging: true
    }).then(canvas => {
        const screenshotBase64 = canvas.toDataURL('image/png');
        const textElements = [];

        // The regex provided by the user
        const TARGET_REGEX = /(?<!["'<])\u200B([\uFE00-\uFE0F]+)([^\u200B]*?)\u200B(?![^<>]*">)/g;

        const treeWalker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while (node = treeWalker.nextNode()) {
            const parentElement = node.parentElement;
            if (parentElement) {
                const styles = window.getComputedStyle(parentElement);
                if (styles.display === 'none' || styles.visibility === 'hidden' || parseFloat(styles.opacity) === 0) {
                    continue;
                }
                if (parentElement.tagName === 'SCRIPT' ||
                    parentElement.tagName === 'STYLE' ||
                    parentElement.tagName === 'NOSCRIPT' ||
                    parentElement.tagName === 'TEXTAREA' // Often contains text not meant for this kind of extraction
                   ) {
                    continue;
                }
            } else { // Text node without a proper parent, unlikely to be relevant visible content
                continue;
            }

            const nodeTextContent = node.nodeValue; // Get the raw text content of the node
            let match;

            // Reset lastIndex for global regex on new string
            TARGET_REGEX.lastIndex = 0;

            while ((match = TARGET_REGEX.exec(nodeTextContent)) !== null) {
                const entireMatchedSegment = match[0];   // The entire matched string
                const encodedMetadata = match[1];        // Group 1: Encoded metadata
                const capturedText = match[2];           // Group 2: The actual text content

                let parsedMetadata = {};
                try {
                    const decodedJsonMetadata = fe00RangeToUtf8(encodedMetadata);
                    if (decodedJsonMetadata) { // Ensure it's not empty before parsing
                        parsedMetadata = JSON.parse(decodedJsonMetadata);
                    } else {
                        // console.warn("Decoded metadata is empty for:", encodedMetadata);
                        parsedMetadata.decodingWarning = "Decoded metadata was empty";
                    }
                } catch (e) {
                    console.warn(`Failed to decode/parse metadata for segment. Text: "${capturedText}", Encoded: "${encodedMetadata}", Error: ${e.message}`);
                    parsedMetadata.decodingError = e.message;
                }

                // Create a Range to get the bounding box of the *specific matched segment*
                const range = document.createRange();
                try {
                    range.setStart(node, match.index); // Start of the full match in the text node
                    range.setEnd(node, match.index + entireMatchedSegment.length); // End of the full match
                } catch (rangeError) {
                    // This can happen if the text node's content changed concurrently, very rare.
                    console.warn("Error setting range for matched text:", rangeError, "Node:", node, "Match:", match);
                    continue; // Skip this problematic match
                }

                const rect = range.getBoundingClientRect(); // Coordinates relative to the viewport

                // Check if the matched segment has visible dimensions
                if (rect.width > 0 || rect.height > 0) { // Allow zero width OR zero height for certain inline cases
                                                        // but not both zero. Or more strictly: rect.width > 0 && rect.height > 0
                    textElements.push({
                        text: capturedText, // The text from the first capture group
                        x: rect.left + window.scrollX,
                        y: rect.top + window.scrollY,
                        width: rect.width,
                        height: rect.height,
                        ...parsedMetadata // Spread the parsed metadata from group 2
                    });
                }
            }
        }
        return { screenshotBase64, textElements };
    }).catch(error => {
        console.error("Error in contentScriptScraper (html2canvas or text extraction):", error);
        return { error: (error.message || "Unknown error in content script during processing.") };
    });
}