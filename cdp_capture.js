// cdp_capture.js

/**
 * Captures a full-page screenshot of the specified tab using the Chrome DevTools Protocol.
 * @param {number} tabId The ID of the tab to capture.
 * @returns {Promise<string>} A promise that resolves with the Base64 encoded PNG data URL.
 */
export async function captureFullPageScreenshotCDP(tabId) {
    const debuggee = { tabId: tabId };
    const protocolVersion = "1.3"; // A commonly supported version

    console.log(`CDP: Initiating capture for tab ${tabId}`);

    // Helper to promisify chrome.debugger.attach
    const attachDebugger = () => new Promise((resolve, reject) => {
        chrome.debugger.attach(debuggee, protocolVersion, () => {
            if (chrome.runtime.lastError) {
                console.error(`CDP: Failed to attach debugger to tab ${tabId}:`, chrome.runtime.lastError.message);
                reject(chrome.runtime.lastError);
            } else {
                console.log(`CDP: Debugger attached to tab ${tabId}`);
                resolve();
            }
        });
    });

    // Helper to promisify chrome.debugger.sendCommand
    const sendCommand = (command, params = {}) => new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(debuggee, command, params, (result) => {
            if (chrome.runtime.lastError) {
                console.error(`CDP: Error sending command "${command}" to tab ${tabId}:`, chrome.runtime.lastError.message);
                reject(chrome.runtime.lastError);
            } else if (result && result.error) { // Some commands return errors in the result object
                console.error(`CDP: Command "${command}" failed for tab ${tabId}:`, result.error.message || result.error);
                reject(new Error(result.error.message || JSON.stringify(result.error)));
            }
            else {
                resolve(result);
            }
        });
    });

    // Helper to promisify chrome.debugger.detach
    const detachDebugger = () => new Promise((resolve, reject) => {
        chrome.debugger.detach(debuggee, () => {
            if (chrome.runtime.lastError) {
                // Log as warning, as we might want to proceed even if detach fails silently
                console.warn(`CDP: Error detaching debugger from tab ${tabId}:`, chrome.runtime.lastError.message);
                // Don't necessarily reject the whole screenshot promise for a detach error,
                // but it's good to know.
            } else {
                console.log(`CDP: Debugger detached from tab ${tabId}`);
            }
            resolve(); // Resolve even if there's a detach error, screenshot might be fine
        });
    });


    try {
        await attachDebugger();

        console.log("CDP: Sending Page.captureScreenshot command...");
        const screenshotResult = await sendCommand(
            "Page.captureScreenshot",
            {
                format: "png",
                // quality: 90, // Only for jpeg/webp
                captureBeyondViewport: true,
                fromSurface: true // Often gives better results for complex pages / iframes
            }
        );

        if (screenshotResult && screenshotResult.data) {
            console.log("CDP: Screenshot data received.");
            return `data:image/png;base64,${screenshotResult.data}`;
        } else {
            console.error("CDP: Page.captureScreenshot returned no data or an unexpected response.", screenshotResult);
            throw new Error("CDP: Screenshot command returned no data.");
        }

    } catch (error) {
        console.error(`CDP: Full screenshot process failed for tab ${tabId}:`, error.message, error);
        // Re-throw to be caught by the caller in background.js
        throw error; // Or return a specific error object/message
    } finally {
        // Ensure debugger is always detached
        await detachDebugger().catch(detachErr => console.warn("CDP: Silent detach error in finally block:", detachErr.message));
    }
}