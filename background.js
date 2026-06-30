// Background service worker for HeyGen Helper
// Handles file downloads via chrome.downloads API (bypasses CORS restrictions)
// + checks GitHub Releases for new versions and prompts the user to upgrade.

// ─── Update check (GitHub Releases) ─────────────────────────────────────────
const HVT_REPO = 'secure-artifacts/hgvoice';
const HVT_RELEASES_API = `https://api.github.com/repos/${HVT_REPO}/releases/latest`;

function hvtParseVer(v) {
    return String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}
// 语义化比较：latest 是否严格高于 current
function hvtIsNewer(latest, current) {
    const a = hvtParseVer(latest);
    const b = hvtParseVer(current);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0;
        const y = b[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
    }
    return false;
}

async function hvtCheckForUpdate() {
    try {
        const resp = await fetch(HVT_RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data || !data.tag_name) return;
        const asset = (data.assets || []).find((a) => /\.zip$/i.test(a.name));
        await chrome.storage.local.set({
            hvt_update: {
                latest: data.tag_name,
                htmlUrl: data.html_url,
                zipUrl: asset ? asset.browser_download_url : null,
                zipName: asset ? asset.name : null,
                checkedAt: Date.now()
            }
        });
    } catch (_e) {
        // 网络错误不致命，下次 alarm 再试
    }
}

chrome.runtime.onInstalled.addListener(() => {
    hvtCheckForUpdate();
    chrome.alarms.create('hvt_update_check', { periodInMinutes: 360 }); // 每 6 小时
});
chrome.runtime.onStartup.addListener(hvtCheckForUpdate);
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'hvt_update_check') hvtCheckForUpdate();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // content.js 询问是否有可用更新
    if (msg.type === 'hvt_get_update') {
        (async () => {
            const current = chrome.runtime.getManifest().version;
            const { hvt_update, hvt_update_ignored } = await chrome.storage.local.get([
                'hvt_update',
                'hvt_update_ignored'
            ]);
            if (!hvt_update || !hvt_update.latest) {
                sendResponse({ hasUpdate: false });
                return;
            }
            const hasUpdate =
                hvtIsNewer(hvt_update.latest, current) && hvt_update_ignored !== hvt_update.latest;
            sendResponse({
                hasUpdate,
                latest: hvt_update.latest,
                current,
                htmlUrl: hvt_update.htmlUrl
            });
        })();
        return true;
    }

    // content.js 点「立即升级」：下载新版 zip
    if (msg.type === 'hvt_download_update') {
        (async () => {
            const { hvt_update } = await chrome.storage.local.get('hvt_update');
            const url = hvt_update && hvt_update.zipUrl;
            if (!url) {
                sendResponse({ ok: false, error: '未找到新版下载地址' });
                return;
            }
            chrome.downloads.download(
                { url, filename: hvt_update.zipName || undefined, saveAs: false },
                (downloadId) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ ok: true, downloadId });
                    }
                }
            );
        })();
        return true;
    }

    // content.js 点「忽略此版本」：记下被忽略的版本号
    if (msg.type === 'hvt_ignore_update') {
        chrome.storage.local.set({ hvt_update_ignored: msg.version });
        sendResponse({ ok: true });
        return true;
    }
});

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
