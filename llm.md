# LLM Development Guide: LQA Boss Chrome Extension

This document provides context for Large Language Models (LLMs) assisting with the development and maintenance of the LQA Boss Chrome Extension.

## Project Overview

The LQA Boss Chrome Extension captures web page content, including full-page screenshots and specially formatted embedded text metadata. It allows users to build a "flow" of multiple captured pages and then save this flow as a `.lqaboss` ZIP archive. This archive can then be opened by the LQA Boss PWA Viewer.

**Core Functionality:**
1.  Capture data from the currently active tab.
2.  Store captured page data (screenshot, URL, timestamp, extracted text segments with coordinates and metadata) persistently across popup sessions using `chrome.storage.local`.
3.  Manage a collection of these captured pages (display count, estimated memory, reset).
4.  Package all captured data into a `.lqaboss` ZIP file for download.

**Core Technologies:**
*   Chrome Extension APIs (Manifest V3): `chrome.tabs`, `chrome.scripting`, `chrome.downloads`, `chrome.storage.local`, `chrome.runtime`.
*   JavaScript (ES6+)
*   HTML5, CSS3 (for the popup)
*   `html2canvas.min.js`: For taking screenshots by rendering DOM to canvas.
*   `jszip.min.js`: For creating ZIP archives.

## File Structure (Key Files)

*   `manifest.json`: Defines extension permissions, popup, background service worker, icons, etc.
*   `popup.html`: The UI for the extension's popup.
*   `popup.css`: Styles for `popup.html`.
*   `popup.js`: Logic for the popup UI, managing captured pages (via `chrome.storage`), initiating captures, and handling the "Save Flow" process (including zipping).
*   `background.js`: The service worker. Handles messages from `popup.js` to inject content scripts and execute page scraping. Contains the `contentScriptScraper` function.
*   `contentScriptScraper` (function within `background.js`): This function is injected into the target web page. It uses `html2canvas` for the screenshot and `TreeWalker` to find and process text nodes for metadata extraction based on a specific regex.
*   `libs/html2canvas.min.js`: The html2canvas library.
*   `libs/jszip.min.js`: The JSZip library.
*   `icons/`: Directory for extension icons.

## Data Flow and Storage

1.  **Capture Request (`popup.js` -> `background.js`):**
    *   User clicks "Capture Current Page" in `popup.html`.
    *   `popup.js` (`handleCapturePage`) sends a `scrapeCurrentPage` message to `background.js` with the active `tabId` and `url`.

2.  **Scraping (`background.js` -> `contentScriptScraper`):**
    *   `background.js` receives the message.
    *   It uses `chrome.scripting.executeScript` to inject `html2canvas.min.js` and then the `contentScriptScraper` function into the target tab.
    *   **`contentScriptScraper` (runs in target page context):**
        *   Calls `html2canvas` on `document.body` with `scale: window.devicePixelRatio` to get a high-resolution screenshot.
        *   Uses `document.createTreeWalker(NodeFilter.SHOW_TEXT)` to iterate through text nodes.
        *   Applies the target regex: `/(?<!["'<])\u200B([\uFE00-\uFE0F]+)([^\u200B]*?)\u200B(?![^<>]*">)/g` to `node.nodeValue`.
            *   Group 1: Encoded metadata.
            *   Group 2: Text content.
        *   Decodes metadata from Group 1 using `fe00RangeToUtf8()`.
        *   Uses `range.getBoundingClientRect()` on the matched text segment to get `x, y, width, height` (these are logical 1x coordinates relative to the viewport, adjusted by `window.scrollX/Y`).
        *   Returns an object `{ screenshotBase64, textElements: [{ text, x, y, width, height, ...decodedMetadata }] }`.

3.  **Data Storage (`background.js` -> `popup.js` -> `chrome.storage.local`):**
    *   The result from `contentScriptScraper` is sent back to `background.js`, then relayed to `popup.js`'s message response callback.
    *   `popup.js` (`handleCapturePage`):
        *   If `response.data.text_content` is not empty (meaning LQA metadata was found):
            *   Generates a unique `pageId`.
            *   Creates `fullPageData` (ID, URL, timestamp, screenshot Base64, full `text_content` array).
            *   Creates `pageIndexEntry` (ID, URL, timestamp, `estScreenshotSize`, `estTextContentSize`, `hasContent: true`).
            *   **Storage Strategy:**
                *   Saves `fullPageData` to `chrome.storage.local` under key: `${PAGE_DATA_PREFIX}${pageId}` (e.g., `lqa_page_xyz123`).
                *   Appends `pageIndexEntry` to an array stored under `chrome.storage.local` key: `CAPTURED_PAGES_INDEX_KEY`.
        *   Updates the popup UI (`updateCaptureInfoUI`).

4.  **Popup State Initialization (`popup.js`):**
    *   On load, `initializePopupState` reads `CAPTURED_PAGES_INDEX_KEY` from `chrome.storage.local`.
    *   `updateCaptureInfoUI` uses this index to display page count and estimated memory (based on `estScreenshotSize` stored in the index entries). Full screenshots are NOT loaded into memory in the popup at this stage.

5.  **Reset Captures (`popup.js`):**
    *   `handleResetCapture` reads `CAPTURED_PAGES_INDEX_KEY`.
    *   Removes all individual page data items (`${PAGE_DATA_PREFIX}${id}`) from storage.
    *   Clears/resets `CAPTURED_PAGES_INDEX_KEY` in storage.
    *   Updates UI.

6.  **Save Flow (`popup.js`):**
    *   `handleSaveFlow`:
        *   Reads `CAPTURED_PAGES_INDEX_KEY`.
        *   For each `pageEntry` in the index:
            *   Fetches the `fullPageData` (including screenshot) from storage using `${PAGE_DATA_PREFIX}${pageEntry.id}`.
            *   Adds the screenshot (decoded from Base64) to a `JSZip` instance as `page_X_uniqueId.png`.
            *   Constructs metadata for this page (pageId, URL, `imageFile` name, and an array of its `segments` with their text, logical 1x coordinates, and other decoded metadata).
        *   Adds a `flow_metadata.json` file to the ZIP containing all this collated metadata.
        *   Generates the ZIP blob (using `application/octet-stream` to help with filename extension).
        *   Uses `chrome.downloads.download()` to save the file with a `.lqaboss` extension.
        *   Optionally (currently implemented): Silently resets captures in storage after successful save.

## Key `popup.js` Variables and Functions:

*   `CAPTURED_PAGES_INDEX_KEY`: Storage key for the array of page index entries.
*   `PAGE_DATA_PREFIX`: Prefix for storage keys of full page data.
*   `initializePopupState()`: Loads index from storage on popup open.
*   `handleCapturePage()`: Orchestrates capture and storage of new page data.
*   `updateCaptureInfoUI(pageIndex)`: Updates popup display based on the loaded page index.
*   `handleResetCapture()`: Clears all stored captured data.
*   `handleSaveFlow()`: Fetches all full page data, creates ZIP, initiates download, and resets.

## Key `background.js` Components:

*   Message listener for `scrapeCurrentPage`.
*   `chrome.scripting.executeScript` calls.
*   `contentScriptScraper()` function (see details in "Scraping" section above).
    *   `getFullPageDimensions()`: Helper to get scrollWidth/Height.
    *   `html2canvas()` call with `scale: window.devicePixelRatio`.
    *   `TreeWalker` and regex logic for text/metadata.
    *   `fe00RangeToUtf8()`: Helper to decode metadata.

## Regex for Metadata Extraction (in `contentScriptScraper`):

*   `/(?<!["'<])\u200B([\uFE00-\uFE0F]+)([^\u200B]*?)\u200B(?![^<>]*">)/g`
    *   Group 1 (`match[1]`): Encoded metadata (using `\uFE00-\uFE0F` characters).
    *   Group 2 (`match[2]`): The actual text content.

## High-DPI Handling:

*   **Capture (`contentScriptScraper`):** `html2canvas` is called with `scale: window.devicePixelRatio`. This produces a screenshot whose pixel dimensions are `logical_dimensions * dpr`.
*   **Coordinate Storage:** The `x, y, width, height` extracted via `getBoundingClientRect()` are **logical 1x pixel values** relative to the document. These are stored as is.
*   **Viewer Responsibility:** The PWA Viewer is responsible for:
    1.  Displaying the high-resolution screenshot image by scaling it down by the *viewer's* `devicePixelRatio` (e.g., `img.style.width = img.naturalWidth / viewerDPR`).
    2.  Overlaying highlights using the stored logical 1x coordinates, possibly applying minor scale factors if the CSS-styled image size doesn't perfectly match `naturalWidth / viewerDPR`. (This is what "Option A" in `viewer.js` refers to).

## Important Considerations for LLM Modifications:

*   **Storage Structure:** Changes to how data is captured or what's stored will impact both `popup.js` (saving to storage, creating ZIP) and potentially `background.js` (what `contentScriptScraper` returns). The PWA Viewer would also need to be updated if the `flow_metadata.json` structure changes.
*   **Asynchronous Operations:** Extensive use of Promises and `async/await` for Chrome APIs (`storage`, `scripting`, `downloads`, `tabs`, `runtime.sendMessage`). Ensure these are handled correctly to avoid race conditions.
*   **Error Handling:** Robust error handling is important, especially for `chrome.runtime.lastError` after API calls.
*   **Content Script Context:** Remember `contentScriptScraper` runs in the context of the target web page, not the extension's background or popup. It can only communicate back via its return value.
*   **Permissions (`manifest.json`):** Adding new Chrome APIs might require new permissions.
*   **Data Size in `chrome.storage.local`:** Screenshots (Base64 strings) can be large. `chrome.storage.local` has quotas (around 5MB total, though it can be higher). The current strategy of storing each page's full data separately helps manage this, but for extremely large numbers of very large pages, IndexedDB might be a more robust long-term storage solution if `chrome.storage.local` limits are hit. The index itself is small.
