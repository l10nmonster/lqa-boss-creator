# LQA Boss Chrome Extension

The LQA Boss Chrome Extension is a tool designed to capture web page content, including screenshots and specific embedded text metadata, into a portable `.lqaboss` flow file. These files can then be opened and edited using the LQA Boss PWA Viewer.

## Features

*   **Current Page Capture:** Capture the currently active browser tab.
*   **Full Page Screenshot:** Takes a screenshot of the entire scrollable page content.
*   **Targeted Text & Metadata Extraction:**
    *   Identifies and extracts text segments that match a specific embedded pattern (using zero-width spaces and encoded metadata).
    *   Records the text content, its on-page coordinates (x, y, width, height), and any decoded custom metadata.
*   **Multi-Page Flow Creation:** Capture multiple pages sequentially. The extension keeps track of captured pages.
*   **In-Popup Summary:**
    *   Displays the number of pages captured so far in the current flow.
    *   Provides an estimated memory usage for the captured data.
*   **Flow Management:**
    *   **Reset Captures:** Clear all currently captured pages to start a new flow.
    *   **Save Flow:** Package all captured pages (screenshots as PNGs and a consolidated `flow_metadata.json` file) into a single `.lqaboss` ZIP archive. You can name your flow before saving.
*   **Open Viewer:** A quick button to open the LQA Boss PWA Viewer (if you have the PWA hosted and the URL configured).

## Installation

1.  **Download the Extension Files:**
    *   If you have the source code, ensure you have all the files in a single directory (e.g., `lqa-boss-extension/`).
    *   If you received a `.zip` file of the extension, extract it to a dedicated folder on your computer.

2.  **Open Chrome Extensions Page:**
    *   Open Google Chrome.
    *   Navigate to `chrome://extensions` in the address bar.

3.  **Enable Developer Mode:**
    *   In the top right corner of the Extensions page, toggle the "**Developer mode**" switch to the "on" position.

4.  **Load Unpacked Extension:**
    *   Click the "**Load unpacked**" button that appears (usually on the top left).
    *   A file dialog will open. Navigate to and select the folder where you saved/extracted the extension files (e.g., the `lqa-boss-extension/` folder, not any individual file inside it).
    *   Click "Select Folder."

5.  **Extension Installed:**
    *   The LQA Boss extension icon should now appear in your Chrome toolbar (you might need to click the puzzle piece icon to pin it).

## How to Use

1.  **Open the Extension Popup:**
    *   Navigate to a web page you want to capture.
    *   Click the LQA Boss extension icon in your Chrome toolbar to open its popup interface.

2.  **Capturing a Page:**
    *   Click the "**📸 Capture Current Page**" button.
    *   The extension will process the active tab, take a full-page screenshot, and extract relevant text segments and their metadata.
    *   **Important:** The page must contain the specific metadata patterns the extension is looking for. If no such metadata is found, the popup will indicate an error, and the page won't be added to the flow.
    *   The "Pages Captured" count and "Est. Memory" in the popup will update.
    *   You can navigate to other pages or tabs and repeat this step to add more pages to the current flow. All captured data is stored temporarily by the extension until reset or saved.

3.  **Viewing Capture Information:**
    *   The popup always shows the current number of captured pages and an estimated memory footprint.

4.  **Resetting Captures:**
    *   If you want to clear all currently captured pages and start a new flow, click the "**Reset All Captures**" button.
    *   You will be asked to confirm this action.

5.  **Saving a Flow:**
    *   Once you have captured all desired pages for a flow:
        *   Optionally, enter a descriptive name for your flow in the "**Enter Flow Name (optional)**" input field. If left blank, a default name will be generated.
        *   Click the "**💾 Save Flow (.lqaboss)**" button.
    *   The extension will package all captured screenshots (as individual PNG files) and a `flow_metadata.json` file (containing all text, coordinates, and metadata for all segments across all pages) into a single ZIP archive.
    *   This archive will be named using your flow name (or the default) and will have the `.lqaboss` extension.
    *   Your browser's download process will begin. Depending on your Chrome settings, you might be prompted to choose a save location, or it might save automatically to your default downloads folder.
    *   After saving, the captures in the popup are typically reset automatically (as per current implementation).

6.  **Opening a `.lqaboss` File in the Viewer:**
    *   Click the "**📂 Open LQA Boss File**" button in the extension popup.
    *   This will open the LQA Boss PWA Viewer in a new tab (this requires the PWA to be hosted at a known URL configured in the extension).
    *   In the PWA Viewer, use its "Load .lqaboss File" button to select the `.lqaboss` file you previously saved.

## Important Notes

*   **Permissions:** The extension requires permissions to access your active tab's content (`activeTab`), inject scripts (`scripting`), manage downloads (`downloads`), and store captured data temporarily (`storage`). It also requires broad host permissions (`<all_urls>`) to enable scripting on any page you wish to capture.
*   **Metadata Format:** For successful text and metadata extraction, the web pages being captured must contain text embedded with the specific zero-width space and encoded metadata patterns that this extension is programmed to recognize.
*   **Screenshot Quality:** The extension uses `html2canvas` for screenshots. While it aims for accuracy, extremely complex pages or certain CSS features might have minor rendering differences compared to the live browser view.

## Troubleshooting

*   **"No LQA metadata segments found":** Ensure the page you are trying to capture has the correctly formatted embedded metadata that the extension targets.
*   **Extension Not Working:**
    *   Make sure Developer Mode is enabled in `chrome://extensions`.
    *   Try reloading the extension (click the reload icon for the extension on the `chrome://extensions` page).
    *   Check the browser console for errors on the page you are trying to capture, and also check the extension's own "background page" console (you can access this from the `chrome://extensions` page by clicking the "Service worker" link for the LQA Boss extension).
