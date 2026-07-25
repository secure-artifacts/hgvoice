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
    if (msg.type === 'hvt_notify') {
        chrome.notifications.create({
            type: 'basic', iconUrl: 'icon.png',
            title: msg.title || '人声筛选工具',
            message: msg.message || '',
        }, () => sendResponse({ ok: !chrome.runtime.lastError }));
        return true;
    }
    if (msg.type === 'hvt_download') {
        chrome.downloads.download(
            { url: msg.url, filename: msg.filename, saveAs: false, conflictAction: msg.conflictAction || 'uniquify' },
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

// content.js 请求 Gemini 分析头像图片 → 声音设计提示词。
// 在 service worker 里 fetch，绕开页面 CSP 限制（generativelanguage 已在 host_permissions）。

// 进行中的 AI 分析请求，供 hvt_ai_abort 中止（SW 若被回收，fetch 也随之终止，无需持久化）
const hvtAiAborts = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'hvt_ai_abort') {
        const ctl = hvtAiAborts.get(msg.reqId);
        if (ctl) ctl.abort();
        hvtAiAborts.delete(msg.reqId);
        sendResponse({ ok: true });
        return;
    }

    if (msg.type === 'hvt_gemini_generate') {
        (async () => {
            const ctl = new AbortController();
            if (msg.reqId) hvtAiAborts.set(msg.reqId, ctl);
            try {
                const { apiKey, model, systemPrompt, images, userNote } = msg;
                const parts = images.map((img) => ({
                    inline_data: { mime_type: 'image/jpeg', data: img }
                }));
                parts.push({ text: userNote || '请分析图中人物并按格式输出声音设计提示词。' });
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
                const res = await fetch(url, {
                    method: 'POST',
                    signal: ctl.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify({
                        system_instruction: { parts: [{ text: systemPrompt }] },
                        contents: [{ role: 'user', parts }],
                        generationConfig: { temperature: 0.7 }
                    })
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    const apiMsg = data && data.error && data.error.message;
                    throw new Error(apiMsg || `HTTP ${res.status}`);
                }
                const cand = data && data.candidates && data.candidates[0];
                const text = cand && cand.content && cand.content.parts
                    ? cand.content.parts.map((p) => p.text || '').join('')
                    : '';
                if (!text) {
                    const reason = (cand && cand.finishReason) || (data && data.promptFeedback && data.promptFeedback.blockReason);
                    throw new Error(reason ? `Gemini 未返回内容 (${reason})` : 'Gemini 未返回内容');
                }
                sendResponse({ ok: true, text });
            } catch (e) {
                sendResponse({ ok: false, error: ctl.signal.aborted ? '已中止' : e.message });
            } finally {
                if (msg.reqId) hvtAiAborts.delete(msg.reqId);
            }
        })();
        return true;
    }

    if (msg.type === 'hvt_gemini_list_models') {
        (async () => {
            try {
                const models = [];
                let pageToken = '';
                do {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
                    const res = await fetch(url, { headers: { 'x-goog-api-key': msg.apiKey } });
                    const data = await res.json().catch(() => null);
                    if (!res.ok) {
                        const apiMsg = data && data.error && data.error.message;
                        throw new Error(apiMsg || `HTTP ${res.status}`);
                    }
                    for (const m of (data.models || [])) {
                        models.push({
                            id: String(m.name || '').replace(/^models\//, ''),
                            methods: m.supportedGenerationMethods || []
                        });
                    }
                    pageToken = data.nextPageToken || '';
                } while (pageToken);
                sendResponse({ ok: true, models });
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }

    // OpenRouter：OpenAI 兼容 chat/completions，图片走 data URI
    if (msg.type === 'hvt_or_generate') {
        (async () => {
            const ctl = new AbortController();
            if (msg.reqId) hvtAiAborts.set(msg.reqId, ctl);
            try {
                const { apiKey, model, systemPrompt, images, userNote } = msg;
                const content = images.map((img) => ({
                    type: 'image_url',
                    image_url: { url: 'data:image/jpeg;base64,' + img }
                }));
                content.push({ type: 'text', text: userNote || '请分析图中人物并按格式输出声音设计提示词。' });
                // 免费模型托管方偶发宕机（502 Provider returned error）；OpenRouter 每次请求
                // 重新路由节点，自动重试大概率落到健康节点
                const MAX_RETRIES = 2;
                let res, data;
                for (let attempt = 0; ; attempt++) {
                    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        signal: ctl.signal,
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + apiKey
                        },
                        body: JSON.stringify({
                            model,
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content }
                            ],
                            temperature: 0.7
                        })
                    });
                    data = await res.json().catch(() => null);
                    if (res.ok) break;
                    const retriable = res.status === 429 || res.status >= 500;
                    if (!retriable || attempt >= MAX_RETRIES) {
                        const apiMsg = data && data.error && data.error.message;
                        const retried = retriable ? `（已自动重试 ${MAX_RETRIES} 次）` : '';
                        throw new Error((apiMsg || `HTTP ${res.status}`) + retried);
                    }
                    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
                    if (ctl.signal.aborted) throw new Error('已中止');
                }
                const choice = data && data.choices && data.choices[0];
                const text = choice && choice.message && choice.message.content;
                if (!text) throw new Error('OpenRouter 未返回内容');
                sendResponse({ ok: true, text });
            } catch (e) {
                sendResponse({ ok: false, error: ctl.signal.aborted ? '已中止' : e.message });
            } finally {
                if (msg.reqId) hvtAiAborts.delete(msg.reqId);
            }
        })();
        return true;
    }

    // OpenRouter 模型列表：公开接口，无需 API Key
    if (msg.type === 'hvt_or_list_models') {
        (async () => {
            try {
                const res = await fetch('https://openrouter.ai/api/v1/models');
                const data = await res.json().catch(() => null);
                if (!res.ok) throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
                const models = (data.data || []).map((m) => {
                    const out = (m.architecture && m.architecture.output_modalities) || [];
                    return {
                        id: m.id,
                        free: !!m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0',
                        image: !!m.architecture && (m.architecture.input_modalities || []).includes('image'),
                        // 纯文本输出（排除 lyria 等音乐/多模态生成模型）
                        text: out.includes('text') && !out.includes('audio') && !out.includes('image')
                    };
                });
                sendResponse({ ok: true, models });
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }

    // OpenRouter 模型节点健康度：每个模型取其所有托管节点的最高在线率（30 分钟优先，缺数据退 1 天）
    if (msg.type === 'hvt_or_models_health') {
        (async () => {
            try {
                const uptime = {};
                await Promise.all(msg.ids.map(async (id) => {
                    try {
                        const res = await fetch(`https://openrouter.ai/api/v1/models/${id}/endpoints`);
                        const data = await res.json();
                        const eps = (data.data && data.data.endpoints) || [];
                        uptime[id] = eps.reduce((best, e) => {
                            const u = e.uptime_last_30m != null ? e.uptime_last_30m : e.uptime_last_1d;
                            return u != null && u > best ? u : best;
                        }, 0);
                    } catch {
                        uptime[id] = null; // 单个查询失败视为未知，不误杀
                    }
                }));
                sendResponse({ ok: true, uptime });
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }
});
