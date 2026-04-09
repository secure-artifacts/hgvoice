// Background service worker for HeyGen Helper
// Handles file downloads via chrome.downloads API (bypasses CORS restrictions)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'hvt_download') {
        chrome.downloads.download(
            { url: msg.url, filename: msg.filename, saveAs: false },
            (downloadId) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ ok: true, downloadId });
                }
            }
        );
        return true; // keep message channel open for async sendResponse
    }
});
