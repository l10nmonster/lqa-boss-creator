const CAPTURED_PAGES_INDEX_KEY = 'lqaBossCapturedPagesIndex'; // Stores [{id, url, timestamp, estScreenshotSize, hasContent}, ...]
const PAGE_DATA_PREFIX = 'lqa_page_'; // Prefix for storing full page data: lqa_page_PAGE_ID

const capturePageBtn = document.getElementById('capturePageBtn');
const resetCaptureBtn = document.getElementById('resetCaptureBtn');
const saveFlowBtn = document.getElementById('saveFlowBtn');
const openViewerBtn = document.getElementById('openViewerBtn');
const flowNameInput = document.getElementById('flowNameInput');

const pagesCountSpan = document.getElementById('pagesCount');
const memoryUsageSpan = document.getElementById('memoryUsage');
const statusDiv = document.getElementById('status');

// --- Initialization ---
// Load captured pages from storage when popup opens
async function initializePopupState() {
    try {
        const result = await new Promise(resolve => chrome.storage.local.get([CAPTURED_PAGES_INDEX_KEY], resolve));
        const storedPageIndex = result[CAPTURED_PAGES_INDEX_KEY] || [];
        updateCaptureInfoUI(Array.isArray(storedPageIndex) ? storedPageIndex : []);
    } catch (e) {
        console.error("Error initializing popup state from storage:", e);
        updateCaptureInfoUI([]);
    }
}
initializePopupState(); // Call on load


// --- Event Listeners ---
capturePageBtn.addEventListener('click', handleCapturePage);
resetCaptureBtn.addEventListener('click', handleResetCapture);
saveFlowBtn.addEventListener('click', handleSaveFlow);
openViewerBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://l10nmonster.github.io/lqa-boss/' });
});

// --- Functions ---
async function handleCapturePage() {
    statusDiv.textContent = 'Capturing page...';
    capturePageBtn.disabled = true;

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
        statusDiv.textContent = "Error: Could not identify active tab.";
        capturePageBtn.disabled = false;
        return;
    }
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        statusDiv.textContent = "Cannot capture Chrome internal pages or blank pages.";
        capturePageBtn.disabled = false;
        return;
    }

    // Promisify chrome.runtime.sendMessage
    const sendMessageToBackground = (message) => new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });

    try {
        const response = await sendMessageToBackground({ type: "scrapeCurrentPage", tabId: tab.id, url: tab.url });

        if (response && response.success) {
            if (response.data && response.data.text_content && response.data.text_content.length > 0) {
                const pageId = `page_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                const fullPageData = { // This includes the large screenshot
                    id: pageId,
                    url: response.data.url,
                    timestamp: response.data.timestamp,
                    screenshot: response.data.screenshot,
                    text_content: response.data.text_content
                };

                const pageIndexEntry = { // This is small and goes into the index
                    id: pageId,
                    url: response.data.url,
                    timestamp: response.data.timestamp,
                    // Estimate size here for the index, or fetch later if "Calculate Memory" is added
                    estScreenshotSize: response.data.screenshot.length * 0.75,
                    estTextContentSize: JSON.stringify(response.data.text_content).length,
                    hasContent: true // Flag that it had LQA segments
                };

                // 1. Save full page data under its own key
                await new Promise((resolve, reject) => {
                    chrome.storage.local.set({ [`${PAGE_DATA_PREFIX}${pageId}`]: fullPageData }, () => {
                        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                        else resolve();
                    });
                });

                // 2. Update the page index
                const result = await new Promise(resolve => chrome.storage.local.get([CAPTURED_PAGES_INDEX_KEY], resolve));
                let currentPageIndexArr = result[CAPTURED_PAGES_INDEX_KEY] || [];
                if (!Array.isArray(currentPageIndexArr)) currentPageIndexArr = [];
                currentPageIndexArr.push(pageIndexEntry);

                await new Promise((resolve, reject) => {
                    chrome.storage.local.set({ [CAPTURED_PAGES_INDEX_KEY]: currentPageIndexArr }, () => {
                        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                        else resolve();
                    });
                });

                updateCaptureInfoUI(currentPageIndexArr);
                statusDiv.textContent = `Page captured! (${currentPageIndexArr.length} total)`;

            } else {
                statusDiv.textContent = 'Error: Page captured, but no metadata segments found.';
                alert('No LQA metadata segments were found on this page...');
            }
        } else {
            statusDiv.textContent = `Capture failed: ${response ? response.error : 'No response'}`;
        }
    } catch (error) {
        statusDiv.textContent = `Error during capture: ${error.message}`;
        console.error("Error in handleCapturePage:", error);
    } finally {
        capturePageBtn.disabled = false;
    }
}

function updateCaptureInfoUI(pageIndex) { // pageIndex is an array of index entries
    if (!pagesCountSpan || !memoryUsageSpan || !resetCaptureBtn || !saveFlowBtn) {
        // ... (guard for UI elements) ...
        return;
    }
    pagesCountSpan.textContent = pageIndex.length;
    let totalMemory = 0;
    pageIndex.forEach(pageEntry => {
        if (pageEntry.estScreenshotSize) { // Use the stored estimated size
            totalMemory += pageEntry.estScreenshotSize;
        }
        if (pageEntry.estTextContentSize) {
            totalMemory += pageEntry.estTextContentSize;
        }
    });
    memoryUsageSpan.textContent = (totalMemory / (1024 * 1024)).toFixed(2) + ' MB';

    resetCaptureBtn.disabled = pageIndex.length === 0;
    saveFlowBtn.disabled = pageIndex.length === 0;
}

async function handleResetCapture() {
    if (confirm('Are you sure you want to delete all captured pages? This will remove their detailed data too.')) {
        try {
            // 1. Get the current index to know which page data items to remove
            const indexResult = await new Promise(resolve => chrome.storage.local.get([CAPTURED_PAGES_INDEX_KEY], resolve));
            const pageIndexToDelete = indexResult[CAPTURED_PAGES_INDEX_KEY] || [];

            // 2. Create a list of keys for individual page data
            const pageDataKeysToRemove = pageIndexToDelete.map(entry => `${PAGE_DATA_PREFIX}${entry.id}`);

            // 3. Remove all individual page data items
            if (pageDataKeysToRemove.length > 0) {
                await new Promise((resolve, reject) => {
                    chrome.storage.local.remove(pageDataKeysToRemove, () => {
                        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                        else resolve();
                    });
                });
            }

            // 4. Remove/clear the index itself
            await new Promise((resolve, reject) => {
                chrome.storage.local.set({ [CAPTURED_PAGES_INDEX_KEY]: [] }, () => { // Or .remove
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve();
                });
            });

            updateCaptureInfoUI([]);
            statusDiv.textContent = 'All captures have been reset.';
            if(flowNameInput) flowNameInput.value = '';
        } catch (error) {
            statusDiv.textContent = 'Error resetting captures.';
            console.error("Error resetting storage:", error);
        }
    }
}

async function handleSaveFlow() {
    statusDiv.textContent = 'Preparing flow for download...';
    saveFlowBtn.disabled = true;

    const getStoredPages = () => new Promise((resolve, reject) => {
        chrome.storage.local.get([CAPTURED_PAGES_INDEX_KEY], (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(result[CAPTURED_PAGES_INDEX_KEY] || []);
            }
        });
    });

    const resetStoredPages = () => new Promise((resolve, reject) => {
        chrome.storage.local.get([CAPTURED_PAGES_INDEX_KEY], async (idxResult) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            const pageIndexToDelete = idxResult[CAPTURED_PAGES_INDEX_KEY] || [];
            const pageDataKeysToRemove = pageIndexToDelete.map(entry => `${PAGE_DATA_PREFIX}${entry.id}`);
            let allKeysToRemove = [...pageDataKeysToRemove, CAPTURED_PAGES_INDEX_KEY];

            if (allKeysToRemove.length === 1 && allKeysToRemove[0] === CAPTURED_PAGES_INDEX_KEY && pageIndexToDelete.length === 0) {
                chrome.storage.local.set({ [CAPTURED_PAGES_INDEX_KEY]: [] }, () => { // Ensure index is at least empty
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve();
                });
                return;
            }
            if (pageDataKeysToRemove.length > 0) { // Only remove page data if keys exist
                 await new Promise((res, rej) => chrome.storage.local.remove(pageDataKeysToRemove, () => {
                    if(chrome.runtime.lastError) rej(chrome.runtime.lastError); else res();
                 }));
            }
            // Always reset the index
            chrome.storage.local.set({ [CAPTURED_PAGES_INDEX_KEY]: [] }, () => {
                 if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                 else resolve();
            });
        });
    });


    try {
        const currentCapturedPages = await getStoredPages();

        if (!Array.isArray(currentCapturedPages) || currentCapturedPages.length === 0) {
            alert("No pages captured to save.");
            statusDiv.textContent = 'Ready.';
            saveFlowBtn.disabled = false;
            return;
        }

        const flowName = flowNameInput.value.trim() || `lqa_flow_${new Date().toISOString().slice(0,10).replace(/-/g, '')}`;
        const sanitizedFlowName = flowName.replace(/[^a-z0-9_.-]/gi, '_');
        const targetFilename = `${sanitizedFlowName}.lqaboss`;
        console.log("Target filename for download:", targetFilename);

        const zip = new JSZip();
        const flowMetadata = {
            flowName: flowName,
            createdAt: new Date().toISOString(),
            pages: []
        };

        // Iterate through the index and fetch full data for each page
        for (let i = 0; i < currentCapturedPages.length; i++) { // Use currentCapturedPages here
            const pageEntry = currentCapturedPages[i]; // Corrected to use the fetched array
            const fullPageData = await new Promise(resolve => { // Re-fetch fullPageData for each
                 chrome.storage.local.get([`${PAGE_DATA_PREFIX}${pageEntry.id}`], result => resolve(result[`${PAGE_DATA_PREFIX}${pageEntry.id}`]));
            });


            if (!fullPageData) {
                console.warn(`Could not retrieve full data for page ID ${pageEntry.id}. Skipping.`);
                continue;
            }

            const imageName = `page_${i + 1}_${fullPageData.id}.png`;
            const imageBase64Data = fullPageData.screenshot.substring(fullPageData.screenshot.indexOf(',') + 1);
            zip.file(imageName, imageBase64Data, { base64: true });

            flowMetadata.pages.push({
                pageId: fullPageData.id,
                originalUrl: fullPageData.url,
                timestamp: fullPageData.timestamp,
                imageFile: imageName,
                segments: fullPageData.text_content.map(segment => ({
                    text: segment.text,
                    x: segment.x,
                    y: segment.y,
                    width: segment.width,
                    height: segment.height,
                    ...(Object.keys(segment).reduce((obj, key) => {
                        if (!['text', 'x', 'y', 'width', 'height', 'screenshot', 'id', 'url', 'timestamp'].includes(key)) {
                            obj[key] = segment[key];
                        }
                        return obj;
                    }, {}))
                }))
            });
        }

        if (flowMetadata.pages.length === 0 && currentCapturedPages.length > 0) {
            throw new Error("Failed to process any pages for the flow; full page data might be missing.");
        }
         if (flowMetadata.pages.length === 0 && currentCapturedPages.length === 0) {
            throw new Error("No pages were available to include in the flow.");
        }


        zip.file("flow_metadata.json", JSON.stringify(flowMetadata, null, 2));
        const zipContentBlob = await zip.generateAsync({ type: "blob" });
        const finalBlobForDownload = new Blob([zipContentBlob], { type: 'application/vnd.lqaboss-flow' });
        const downloadUrl = URL.createObjectURL(finalBlobForDownload);

        await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: downloadUrl,
                filename: targetFilename,
            }, (downloadId) => {
                URL.revokeObjectURL(downloadUrl);
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else if (downloadId === undefined) {
                    reject(new Error("Download was cancelled or failed to start."));
                } else {
                    resolve(downloadId);
                }
            });
        });

        statusDiv.textContent = 'Flow saved successfully!';
        if(flowNameInput) flowNameInput.value = ''; // Clear flow name input

        // --- SILENTLY RESET CAPTURES ---
        console.log("Silently resetting captures after successful save.");
        await resetStoredPages();
        const updatedPagesAfterReset = await getStoredPages(); // Should be empty
        updateCaptureInfoUI(updatedPagesAfterReset); // Update UI to reflect reset
        // You might want a different status message if you reset
        // statusDiv.textContent = 'Flow saved and captures reset.';
        // --- End of Silent Reset ---

    } catch (err) {
        statusDiv.textContent = `Error during save flow: ${err.message}`;
        console.error("Save Flow Process Error:", err);
    } finally {
        saveFlowBtn.disabled = false;
    }
}