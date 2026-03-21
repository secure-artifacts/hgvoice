/* Heygen Helper T3 / Voice Tester - content.js */
(function () {
    'use strict';
    if (document.getElementById('hvt-fab')) return;

    // ─── Constants ────────────────────────────────────────────────────────────
    const STORE_KEY = 'hvt_data_v1';
    const API_BASE  = 'https://api2.heygen.com';

    // ── 语言 / 地区设置（按需修改，供不同地区用户使用）──────────────────────
    // 同时用于：① 拉取人声 API 参数  ② 启动后语言筛选默认值
    // 可选值：'English' | 'Chinese' | 'Spanish' | 'French' | 'German' | 'Japanese' | 'Korean' 等
    const LANGUAGE = 'English';

    // 启动后地区筛选默认值（值必须存在于 HeyGen 返回的数据中，否则留空 ''）
    // 示例：'en-US' | 'en-GB' | 'zh-CN'
    const DEFAULT_LOCALE = 'en-US';

    // ─── State ────────────────────────────────────────────────────────────────
    let db = { voices: {}, lastSync: null };
    let audioEl = null;
    let playingId = null;
    let selectedVoiceId = null; // row highlighted by click in paste-filter mode
    let pasteFilterIds = null; // null = off, Set = filter to these IDs
    let showMissingOnly = false;
    let isMinimized = false;
    let fetchInProgress = false;
    let fetchCancelled  = false;
    let fetchPaused     = false;
    let downloadInProgress = false;
    let downloadCancelled  = false;
    let activeFilterMode = 'dropdown'; // 'paste' | 'dropdown' — last-applied wins

    // ─── Storage ──────────────────────────────────────────────────────────────
    function loadDb() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) db = JSON.parse(raw);
        } catch (e) {}
        if (!db || typeof db !== 'object') db = { voices: {}, lastSync: null };
        if (!db.voices) db.voices = {};
    }

    function saveDb() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(db));
        } catch (e) {
            console.error('[HVT] saveDb failed:', e);
        }
    }

    // ─── API ──────────────────────────────────────────────────────────────────
    async function heygenApi(path, options = {}, _retries = 2) {
        const isPost = (options.method || 'GET').toUpperCase() !== 'GET';
        const res = await fetch(`${API_BASE}${path}`, {
            ...options,
            credentials: 'include',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'x-ver': '4.1.0',
                'x-language-override': 'en-US',
                'origin': 'https://app.heygen.com',
                'referer': 'https://app.heygen.com/',
                ...(isPost ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {}),
            },
        });
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            const txt = await res.text();
            throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
        }
        const j = await res.json();
        if (j.code === 400140 && _retries > 0) {
            const match = (j.msg || j.message || '').match(/try again in (\d+)/);
            const wait = Math.max((match ? parseInt(match[1], 10) : 1) * 1000, 1200);
            await new Promise(r => setTimeout(r, wait));
            return heygenApi(path, options, _retries - 1);
        }
        if (j.code !== 100) throw new Error(j.msg || j.message || `code=${j.code}`);
        return j.data;
    }

    // ─── Fetch & merge ────────────────────────────────────────────────────────
    // langFilter : 语言筛选值（如 'English'）；空字符串 = 不限语言（拉全量）
    // localeFilter: 地区筛选值（如 'en-US'）；客户端过滤，空 = 不限
    async function fetchAllVoices(onProgress, langFilter, localeFilter) {
        // 只把本次目标范围内的声音先标为不存在，其它语言数据保留
        const filterLang   = (langFilter   || '').toLowerCase();
        const filterLocale = (localeFilter || '').toLowerCase();

        for (const id in db.voices) {
            const v = db.voices[id];
            const langMatch   = !filterLang   || (v.language || '').toLowerCase() === filterLang;
            const localeMatch = !filterLocale || (v.locale   || '').toLowerCase() === filterLocale;
            if (langMatch && localeMatch) v.existsOnHeygen = false;
        }

        let fetched = 0;
        let cursor  = null;

        do {
            // 暂停：等待直到继续或终止
            while (fetchPaused && !fetchCancelled) {
                await new Promise(r => setTimeout(r, 200));
            }
            if (fetchCancelled) break;

            const p = new URLSearchParams({ limit: '50' });
            if (langFilter) p.set('language', langFilter);
            if (cursor)     p.set('cursor',   cursor);
            if (onProgress) onProgress(`获取中… 已加载 ${fetched} 条`);

            const data = await heygenApi('/v2/public_voices?' + p);
            const list = data.list || [];

            for (const v of list) {
                if (!v.voice_id) continue;
                // 地区客户端过滤
                if (filterLocale && (v.locale || '').toLowerCase() !== filterLocale) continue;

                const id       = v.voice_id;
                const existing = db.voices[id] || {};
                db.voices[id] = {
                    voice_id:      id,
                    display_name:  v.display_name  || existing.display_name  || '',
                    gender:        v.gender         || existing.gender         || '',
                    language:      v.language       || langFilter || LANGUAGE,
                    locale:        v.locale         || existing.locale         || '',
                    labels:        v.labels         || existing.labels         || [],
                    description:   v.description    || existing.description    || '',
                    preview_audio: (v.preview && v.preview.movio) || existing.preview_audio || '',
                    age:           normalizeAge(v.age || existing.age || ''),
                    notes:         existing.notes || '',
                    existsOnHeygen: true,
                    lastSeen:      Date.now(),
                    firstAdded:    existing.firstAdded || Date.now(),
                };
                fetched++;
            }

            cursor = (data.has_more && data.next_cursor) ? data.next_cursor : null;
            if (cursor) await new Promise(r => setTimeout(r, 120));
        } while (cursor);

        db.lastSync = Date.now();
        saveDb();
        return fetched;
    }

    // ─── Audio ────────────────────────────────────────────────────────────────
    function stopAudio() {
        if (audioEl) { try { audioEl.pause(); } catch(e){} audioEl.src = ''; audioEl = null; }
        if (playingId) {
            const btn = document.querySelector(`.hvt-play-btn[data-play-id="${CSS.escape(playingId)}"]`);
            if (btn) btn.dataset.playing = '';
            playingId = null;
        }
    }

    function togglePlay(voiceId, url) {
        // Same voice: toggle off
        if (playingId === voiceId) { stopAudio(); return; }

        // Different voice: stop old, update UI, then start new — all in one click
        stopAudio();
        if (!url) return;

        // Mark new button as playing BEFORE audio starts so UI is instant
        playingId = voiceId;
        const btn = document.querySelector(`.hvt-play-btn[data-play-id="${CSS.escape(voiceId)}"]`);
        if (btn) { btn.dataset.playing = '1'; delete btn.dataset.errored; }

        const a = new Audio(url);
        a.onended = () => stopAudio();
        a.onerror = () => {
            // URL expired / unavailable: mark button red, don't toast
            if (playingId === voiceId) stopAudio();
            if (btn) { btn.dataset.errored = '1'; btn.title = '音频链接失效，请重新「获取/更新人声」刷新 URL'; }
        };
        a.play().catch(() => { if (playingId === voiceId) stopAudio(); });
        audioEl = a;
    }

    // ─── Download MP3 ─────────────────────────────────────────────────────────
    async function downloadMp3List(voices) {
        const withAudio = voices.filter(v => v.preview_audio);
        if (withAudio.length === 0) { showToast('当前列表没有可下载的音频', 'error'); return; }

        downloadInProgress = true;
        downloadCancelled  = false;
        const dlBtn     = document.getElementById('hvt-btn-dl-mp3');
        const progressEl = document.getElementById('hvt-progress');
        if (dlBtn) { dlBtn.textContent = '⏹ 停止下载'; dlBtn.classList.add('hvt-btn-stop'); }

        let done = 0, failed = 0;

        for (const v of withAudio) {
            if (downloadCancelled) break;
            if (progressEl) progressEl.textContent = `下载中 ${done + 1} / ${withAudio.length}…`;
            try {
                const res  = await fetch(v.preview_audio);
                const blob = await res.blob();
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = `${v.voice_id}.mp3`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                done++;
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {
                failed++;
                console.warn('[HVT] download failed:', v.voice_id, e);
            }
        }

        downloadInProgress = false;
        if (dlBtn)     { dlBtn.textContent = '⬇ 下载 MP3'; dlBtn.classList.remove('hvt-btn-stop'); }
        if (progressEl) progressEl.textContent = '';

        if (downloadCancelled) {
            showToast(`已停止，已下载 ${done} 个`, 'info', 3000);
        } else if (failed > 0) {
            showToast(`下载完成：${done} 成功，${failed} 失败`, 'info', 4000);
        } else {
            showToast(`✅ 已下载 ${done} 个 MP3 文件`, 'success', 3000);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function normalizeAge(s) {
        if (!s) return '';
        return s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    function localeToFlag(locale) {
        if (!locale) return '';
        const cc = locale.split('-').pop().toUpperCase();
        if (cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) return '🌐';
        return [...cc].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
    }

    function debounce(fn, ms) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    function extractVoiceIds(text) {
        // Match any 32-char hex string (voice ID), regardless of surrounding context:
        //   - "Name - Style/3fb832c2f0f24a0d839b52bd087301a3"  (Google Sheets format)
        //   - "3fb832c2f0f24a0d839b52bd087301a3"               (plain ID per line)
        const regex = /\b([0-9a-f]{32})\b/gi;
        const ids = new Set();
        let m;
        while ((m = regex.exec(text)) !== null) ids.add(m[1].toLowerCase());
        return ids;
    }

    // ─── Filters ──────────────────────────────────────────────────────────────
    function getFilteredVoices() {
        const q       = (document.getElementById('hvt-search')?.value  || '').toLowerCase().trim();
        const fLocale = (document.getElementById('hvt-f-locale')?.value || '').toLowerCase();
        const fGender = (document.getElementById('hvt-f-gender')?.value || '').toLowerCase();
        const fLang   = (document.getElementById('hvt-f-lang')?.value   || '').toLowerCase();
        const fAge    = (document.getElementById('hvt-f-age')?.value    || '').toLowerCase();
        const fTag    = (document.getElementById('hvt-f-tag')?.value    || '').toLowerCase();

        let list = Object.values(db.voices);

        if (pasteFilterIds !== null && activeFilterMode === 'paste') {
            // Paste filter active (and was applied last): only show matched IDs, skip all other filters
            list = list.filter(v => pasteFilterIds.has((v.voice_id || '').toLowerCase()));
            list.sort((a, b) => {
                if (a.existsOnHeygen !== b.existsOnHeygen) return a.existsOnHeygen ? -1 : 1;
                return (a.display_name || '').localeCompare(b.display_name || '');
            });
            return list;
        }

        if (showMissingOnly) { list = list.filter(v => v.existsOnHeygen === false); return list; }
        if (fLang)   list = list.filter(v => (v.language || '').toLowerCase() === fLang);
        if (fLocale) list = list.filter(v => (v.locale   || '').toLowerCase() === fLocale);
        if (fGender) list = list.filter(v => (v.gender   || '').toLowerCase() === fGender);
        if (fAge) list = list.filter(v => {
            const hay = ((v.age || '') + ' ' + (v.labels || []).join(' ')).toLowerCase();
            return hay.includes(fAge);
        });
        if (fTag) list = list.filter(v =>
            (v.labels || []).some(l => normalizeAge(l).toLowerCase() === fTag)
        );

        if (q) {
            list = list.filter(v => {
                const name  = (v.display_name || '').toLowerCase();
                const id    = (v.voice_id     || '').toLowerCase();
                const tags  = (v.labels || []).join(' ').toLowerCase();
                const notes = (v.notes        || '').toLowerCase();
                return name.includes(q) || id.includes(q) || tags.includes(q) || notes.includes(q);
            });
        }

        list.sort((a, b) => {
            if (a.existsOnHeygen !== b.existsOnHeygen) return a.existsOnHeygen ? -1 : 1;
            return (a.display_name || '').localeCompare(b.display_name || '');
        });

        return list;
    }

    // ─── Populate filter dropdowns ────────────────────────────────────────────
    function populateFilters() {
        const voices  = Object.values(db.voices);
        const langs   = [...new Set(voices.map(v => v.language).filter(Boolean))].sort();
        const locales = [...new Set(voices.map(v => v.locale).filter(Boolean))].sort();

        // Collect ages: from v.age + age-related labels, normalized to Title Case
        const AGE_KEYWORDS = ['young', 'teen', 'middle', 'adult', 'mature', 'senior', 'elderly', 'old', 'child', 'kid'];
        const ages = new Set();
        voices.forEach(v => {
            if (v.age) ages.add(normalizeAge(v.age));
            (v.labels || []).forEach(l => {
                if (AGE_KEYWORDS.some(k => l.toLowerCase().includes(k)))
                    ages.add(normalizeAge(l));
            });
        });

        // All unique labels for tag filter – normalized to Title Case to deduplicate
        const allTags = new Set();
        voices.forEach(v => (v.labels || []).forEach(l => { if (l.trim()) allTags.add(normalizeAge(l.trim())); }));

        const langSel   = document.getElementById('hvt-f-lang');
        const localeSel = document.getElementById('hvt-f-locale');
        const ageSel    = document.getElementById('hvt-f-age');
        const tagSel    = document.getElementById('hvt-f-tag');
        if (!langSel) return;

        langs.forEach(l => { const o = document.createElement('option'); o.value = l; o.textContent = l; langSel.appendChild(o); });
        locales.forEach(l => { const o = document.createElement('option'); o.value = l; o.textContent = l; localeSel.appendChild(o); });
        [...ages].sort().forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; ageSel.appendChild(o); });
        [...allTags].sort().forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; tagSel?.appendChild(o); });
    }

    function refreshFilters() {
        const langSel   = document.getElementById('hvt-f-lang');
        const localeSel = document.getElementById('hvt-f-locale');
        const ageSel    = document.getElementById('hvt-f-age');
        const tagSel    = document.getElementById('hvt-f-tag');
        if (!langSel) return;
        const prevLang = langSel.value, prevLocale = localeSel.value;
        const prevAge  = ageSel.value,  prevTag    = tagSel?.value || '';
        while (langSel.options.length   > 1) langSel.remove(1);
        while (localeSel.options.length > 1) localeSel.remove(1);
        while (ageSel.options.length    > 1) ageSel.remove(1);
        while (tagSel && tagSel.options.length > 1) tagSel.remove(1);
        populateFilters();
        langSel.value   = prevLang;
        localeSel.value = prevLocale;
        ageSel.value    = prevAge;
        if (tagSel) tagSel.value = prevTag;
    }

    // ─── Export / Import ──────────────────────────────────────────────────────
    function exportData() {
        const json = JSON.stringify(db, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `hvt-voices-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importData(json) {
        const imported = JSON.parse(json);
        if (!imported || typeof imported.voices !== 'object') throw new Error('无效的导入格式');
        let count = 0;
        for (const id in imported.voices) {
            const existing = db.voices[id] || {};
            db.voices[id]  = {
                ...imported.voices[id],
                notes: existing.notes || imported.voices[id].notes || '',
            };
            count++;
        }
        if (imported.lastSync && !db.lastSync) db.lastSync = imported.lastSync;
        saveDb();
        return count;
    }

    // ─── Toast ────────────────────────────────────────────────────────────────
    function showToast(msg, type = 'info', duration = 2800) {
        const t = document.createElement('div');
        t.className = `hvt-toast hvt-toast-${type}`;
        t.textContent = msg;
        document.body.appendChild(t);
        requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('hvt-toast-show')));
        setTimeout(() => {
            t.classList.remove('hvt-toast-show');
            setTimeout(() => { if (t.parentNode) t.remove(); }, 350);
        }, duration);
    }

    // ─── Check if description column has any content ──────────────────────────
    function hasAnyDescription() {
        return Object.values(db.voices).some(v => v.description && v.description.trim());
    }

    // ─── Render table ─────────────────────────────────────────────────────────
    function renderTable() {
        const tbody = document.getElementById('hvt-tbody');
        if (!tbody) return;

        const list        = getFilteredVoices();
        const totalVoices = Object.keys(db.voices).length;
        const statsEl     = document.getElementById('hvt-stats');
        if (statsEl) {
            if (totalVoices === 0) {
                statsEl.innerHTML = '暂无数据，请点击「获取/更新人声」';
            } else {
                const q       = (document.getElementById('hvt-search')?.value  || '').trim();
                const fLocale = document.getElementById('hvt-f-locale')?.value || '';
                const fGender = document.getElementById('hvt-f-gender')?.value || '';
                const fAge    = document.getElementById('hvt-f-age')?.value    || '';
                const fTag    = document.getElementById('hvt-f-tag')?.value    || '';
                const hasDropdown = fLocale || fGender || fAge || fTag || q;

                let modeTag = '';
                if (pasteFilterIds !== null && activeFilterMode === 'paste') {
                    modeTag = '<span class="hvt-mode-tag hvt-mode-paste">📋 快速试听</span>';
                } else if (showMissingOnly) {
                    modeTag = '<span class="hvt-mode-tag hvt-mode-missing">⚠️ 已下架</span>';
                } else if (hasDropdown) {
                    modeTag = '<span class="hvt-mode-tag hvt-mode-filter">🔍 筛选过滤</span>';
                }
                statsEl.innerHTML = `显示 ${list.length} / 共 ${totalVoices} 个人声${modeTag ? ' · ' + modeTag : ''}`;
            }
        }

        // Show/hide description column based on data content
        const showDesc = hasAnyDescription();
        const table    = document.getElementById('hvt-table');
        if (table) table.classList.toggle('hvt-no-desc', !showDesc);

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="hvt-empty">
                <span class="hvt-empty-icon">${totalVoices === 0 ? '🎙' : '🔍'}</span>
                ${totalVoices === 0 ? '暂无人声数据，请点击上方「获取/更新人声」按钮' : '没有符合条件的人声'}
            </td></tr>`;
            return;
        }

        const frag = document.createDocumentFragment();
        list.forEach((v, i) => {
            const tr = document.createElement('tr');
            if (!v.existsOnHeygen) tr.classList.add('hvt-row-missing');
            if (pasteFilterIds && activeFilterMode === 'paste' && pasteFilterIds.has((v.voice_id || '').toLowerCase())) {
                tr.classList.add('hvt-row-paste-match');
            }

            const flag       = localeToFlag(v.locale);
            const localeCode = v.locale || '—';
            const gender     = (v.gender || '').toLowerCase();
            const genderIcon  = gender === 'female' ? '♀' : (gender === 'male' ? '♂' : '—');
            const genderClass = gender === 'female' ? 'hvt-f' : (gender === 'male' ? 'hvt-m' : '');
            const shortId    = v.voice_id ? (v.voice_id.slice(0, 8) + '…') : '—';
            const previewUrl = v.preview_audio || '';
            const statusIcon  = v.existsOnHeygen !== false ? '✅' : '⚠️';
            const statusTitle = v.existsOnHeygen !== false ? '在 HeyGen 中存在' : '此人声已从 HeyGen 下架或找不到';

            const tagsHtml = (v.labels || [])
                .map(t => `<span class="hvt-tag">${esc(t)}</span>`)
                .join('');

            // Play button (last column)
            tr.innerHTML = `
                <td class="c-num">${i + 1}</td>
                <td class="c-status" title="${statusTitle}">${statusIcon}</td>
                <td class="c-country" title="${esc(localeCode)}（双击复制）">${esc(localeCode)}</td>
                <td class="c-flag" title="${esc(localeCode)}">${flag}</td>
                <td class="c-gender"><span class="${genderClass}">${genderIcon}</span></td>
                <td class="c-name" title="${esc(v.display_name)}（双击复制）">${esc(v.display_name || '—')}</td>
                <td class="c-id" title="${esc(v.voice_id)}（双击复制完整 ID）" data-copy="${esc(v.voice_id)}">${esc(shortId)}</td>
                <td class="c-combo" title="${esc((v.display_name || '').trim())}/${esc(v.voice_id)}（双击复制）" data-copy="${esc((v.display_name || '').trim() + '/' + (v.voice_id || ''))}">${esc((v.display_name || '').trim() + '/' + (v.voice_id ? v.voice_id.slice(0, 8) + '…' : ''))}</td>
                <td class="c-desc" title="${esc(v.description)}（双击复制）">${esc(v.description || '')}</td>
                <td class="c-tags" title="双击复制标签">${tagsHtml}</td>
                <td class="c-notes">
                    <input class="hvt-notes-input" data-id="${esc(v.voice_id)}"
                        value="${esc(v.notes || '')}" placeholder="备注…">
                </td>
                <td class="c-play">
                    <button class="hvt-play-btn" data-play-id="${esc(v.voice_id)}" data-url="${esc(previewUrl)}"
                        ${!previewUrl ? 'disabled' : ''} title="${previewUrl ? '试听' : '无预览音频'}">
                        <svg class="ic-play"  viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                        <svg class="ic-stop"  viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
                    </button>
                </td>
            `;
            frag.appendChild(tr);
        });

        tbody.innerHTML = '';
        tbody.appendChild(frag);

        // Row click: select row (highlight) for Delete key support in paste-filter mode
        tbody.querySelectorAll('tr').forEach(tr => {
            tr.addEventListener('click', () => {
                if (!pasteFilterIds || activeFilterMode !== 'paste') return;
                const id = tr.querySelector('.hvt-play-btn')?.dataset.playId;
                if (!id) return;
                tbody.querySelectorAll('tr.hvt-row-selected').forEach(r => r.classList.remove('hvt-row-selected'));
                tr.classList.add('hvt-row-selected');
                selectedVoiceId = id;
            });
        });

        // Play buttons – single click switches voice instantly (togglePlay handles all state)
        tbody.querySelectorAll('.hvt-play-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Clicking play also selects the row
                if (pasteFilterIds && activeFilterMode === 'paste') {
                    tbody.querySelectorAll('tr.hvt-row-selected').forEach(r => r.classList.remove('hvt-row-selected'));
                    btn.closest('tr')?.classList.add('hvt-row-selected');
                    selectedVoiceId = btn.dataset.playId;
                }
                togglePlay(btn.dataset.playId, btn.dataset.url);
            });
        });

        // Double-click any cell to copy text (备注列不支持双击复制)
        tbody.addEventListener('dblclick', async (e) => {
            const td = e.target.closest('td');
            if (!td) return;
            if (td.classList.contains('c-notes')) return;
            // Notes input: copy input value; other cells: copy text
            const input = td.querySelector('.hvt-notes-input');
            const copyVal = td.dataset.copy
                ? td.dataset.copy                          // voice ID cell: copy full ID
                : (input ? input.value : td.textContent.trim());
            if (!copyVal) return;
            try {
                await navigator.clipboard.writeText(copyVal);
                // Flash the cell to confirm copy
                td.classList.add('hvt-copied');
                setTimeout(() => td.classList.remove('hvt-copied'), 600);
                showToast('✅ 已复制', 'success', 1200);
            } catch(err) {
                showToast('复制失败', 'error');
            }
        });

        // Notes inputs – save on change
        tbody.querySelectorAll('.hvt-notes-input').forEach(input => {
            input.addEventListener('change', () => {
                const id = input.dataset.id;
                if (db.voices[id] !== undefined) {
                    db.voices[id].notes = input.value;
                    saveDb();
                }
            });
        });
    }

    // ─── Sync info footer ─────────────────────────────────────────────────────
    function updateSyncInfo() {
        const el = document.getElementById('hvt-sync-info');
        if (!el) return;
        if (db.lastSync) {
            const d       = new Date(db.lastSync);
            const total   = Object.keys(db.voices).length;
            const missing = Object.values(db.voices).filter(v => v.existsOnHeygen === false).length;
            const missingSpan = missing > 0
                ? ` | <span id="hvt-missing-btn" style="cursor:pointer;text-decoration:underline;color:${showMissingOnly ? '#dc2626' : '#b45309'}">⚠️ ${missing} 个已下架</span>`
                : '';
            el.innerHTML = `语言: ${LANGUAGE} | 上次同步: ${d.toLocaleString('zh-CN')} | 本地共 ${total} 个人声${missingSpan}`;
            if (missing > 0) {
                document.getElementById('hvt-missing-btn').addEventListener('click', () => {
                    showMissingOnly = !showMissingOnly;
                    renderTable();
                    updateSyncInfo();
                });
            }
        } else {
            el.textContent = '尚未同步 — 点击「获取/更新人声」开始';
        }
    }

    // ─── Build UI ─────────────────────────────────────────────────────────────
    function buildUI() {
        const fab  = document.createElement('button');
        fab.id     = 'hvt-fab';
        fab.title  = 'Heygen Helper T3 / Voice Tester';
        fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
            <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
        </svg>`;
        document.body.appendChild(fab);

        const root = document.createElement('div');
        root.id    = 'hvt-root';
        root.innerHTML = `
<div id="hvt-modal">

  <div id="hvt-header">
    <span id="hvt-title">🎙 Heygen Helper T3 / Voice Tester</span>
    <div id="hvt-header-btns">
      <button id="hvt-btn-fetch"    class="hvt-btn hvt-btn-primary">获取 / 更新人声</button>
      <button id="hvt-btn-fetch-pause"  class="hvt-btn" style="display:none">暂停</button>
      <button id="hvt-btn-fetch-abort"  class="hvt-btn hvt-btn-danger" style="display:none">终止</button>
      <button id="hvt-btn-dl-mp3"   class="hvt-btn" title="下载当前列表所有 MP3，以 Voice ID 命名">⬇ 下载 MP3</button>
      <button id="hvt-btn-export"   class="hvt-btn">⬇ 导出</button>
      <button id="hvt-btn-import"   class="hvt-btn">⬆ 导入</button>
      <button id="hvt-close" title="最小化">—</button>
    </div>
  </div>

  <div id="hvt-filters">
    <div class="hvt-filter-row">
      <select id="hvt-f-lang"   class="hvt-select"><option value="">所有语言</option></select>
      <select id="hvt-f-locale" class="hvt-select"><option value="">所有地区</option></select>
      <select id="hvt-f-gender" class="hvt-select">
        <option value="">所有性别</option>
        <option value="male">男声 ♂</option>
        <option value="female">女声 ♀</option>
      </select>
      <select id="hvt-f-age" class="hvt-select"><option value="">所有年龄段</option></select>
      <select id="hvt-f-tag" class="hvt-select"><option value="">所有属性</option></select>
      <input  id="hvt-search" class="hvt-input" placeholder="关键词搜索（名称 / ID / 标签 / 备注）" />
      <button id="hvt-btn-default-filters" class="hvt-btn" title="恢复默认语言和地区">默认</button>
      <button id="hvt-btn-clear-filters" class="hvt-btn" title="清空此行所有筛选条件">清空</button>
      <button id="hvt-btn-apply-filters" class="hvt-btn hvt-btn-primary" title="应用当前筛选条件">提交</button>
    </div>
    <div class="hvt-filter-row">
      <span   id="hvt-stats"></span>

      <button id="hvt-paste-toggle" class="hvt-btn hvt-paste-action-btn" style="margin-left:auto">📋 快速试听（粘贴列表）</button>
    </div>
    <div id="hvt-paste-panel" style="display:none">
      <textarea id="hvt-paste-area" placeholder="粘贴从 Google 表格复制的人声列表，每行格式如：&#10;Sophia - Narration - Friendly/3fb832c2f0f24a0d839b52bd087301a3&#10;Spunky Sandra - Excited 🤩/f43ba83bc30749cc8e8680a317323422"></textarea>
      <div class="hvt-paste-btns">
        <span   id="hvt-paste-hint" style="font-size:14px;color:#8b8abf;"></span>
        <button id="hvt-btn-clear-paste" class="hvt-btn hvt-paste-action-btn" style="margin-left:auto">清除</button>
        <button id="hvt-btn-apply-paste" class="hvt-btn hvt-btn-primary hvt-paste-action-btn">应用筛选</button>
      </div>
    </div>
  </div>

  <div id="hvt-table-wrap">
    <table id="hvt-table">
      <thead>
        <tr>
          <th class="c-num">#</th>
          <th class="c-status" data-col="c-status" title="双击复制整列">状态</th>
          <th class="c-country" data-col="c-country" title="双击复制整列">国家 / 地区</th>
          <th class="c-flag">国旗</th>
          <th class="c-gender" data-col="c-gender" title="双击复制整列">性别</th>
          <th class="c-name" data-col="c-name" title="双击复制整列">人声名称</th>
          <th class="c-id" data-col="c-id" title="双击复制整列">人声ID</th>
          <th class="c-combo" data-col="c-combo" title="双击复制整列">人声名称/人声ID</th>
          <th class="c-desc" data-col="c-desc" title="双击复制整列">人声介绍</th>
          <th class="c-tags" data-col="c-tags" title="双击复制整列">属性标签</th>
          <th class="c-notes" data-col="c-notes" title="双击复制整列">备注</th>
          <th class="c-play">试听</th>
        </tr>
      </thead>
      <tbody id="hvt-tbody"></tbody>
    </table>
  </div>

  <div id="hvt-footer">
    <span id="hvt-sync-info"></span>
    <span id="hvt-progress"></span>
  </div>

</div>
<input type="file" id="hvt-file-input" accept=".json" style="display:none">
        `;
        document.body.appendChild(root);

        bindEvents();
        updateSyncInfo();
        populateFilters();
        // Pre-select defaults (only if value exists in loaded data)
        const langEl   = document.getElementById('hvt-f-lang');
        const localeEl = document.getElementById('hvt-f-locale');
        if (LANGUAGE       && [...langEl.options].some(o => o.value === LANGUAGE))
            langEl.value   = LANGUAGE;
        if (DEFAULT_LOCALE && [...localeEl.options].some(o => o.value === DEFAULT_LOCALE))
            localeEl.value = DEFAULT_LOCALE;
        renderTable();
    }

    // ─── Event binding ────────────────────────────────────────────────────────
    function bindEvents() {
        // Double-click table header → copy entire column data
        document.querySelector('#hvt-table thead tr').addEventListener('dblclick', e => {
            const th = e.target.closest('th[data-col]');
            if (!th) return;
            const col = th.dataset.col;
            const rows = document.querySelectorAll('#hvt-tbody tr');
            if (!rows.length) return;

            const values = [];
            rows.forEach(tr => {
                const td = tr.querySelector(`td.${col}`);
                if (!td) return;
                // c-id / c-combo: use data-copy (full value), others: text / input value
                if (col === 'c-id' || col === 'c-combo') {
                    values.push(td.dataset.copy || td.textContent.trim());
                } else if (col === 'c-notes') {
                    const inp = td.querySelector('input');
                    values.push(inp ? inp.value : '');
                } else if (col === 'c-tags') {
                    values.push([...td.querySelectorAll('.hvt-tag')].map(t => t.textContent.trim()).join(', '));
                } else {
                    values.push(td.textContent.trim());
                }
            });

            navigator.clipboard.writeText(values.join('\n')).then(() => {
                showToast(`✅ 已复制「${th.textContent.trim()}」列 ${values.length} 条数据`, 'success', 2000);
            }).catch(() => {
                showToast('复制失败，请检查浏览器权限', 'error');
            });
        });

        document.getElementById('hvt-fab').addEventListener('click', () => {
            const root = document.getElementById('hvt-root');
            isMinimized = !isMinimized;
            root.classList.toggle('hvt-minimized', isMinimized);
        });

        document.getElementById('hvt-close').addEventListener('click', () => {
            document.getElementById('hvt-root').classList.add('hvt-minimized');
            isMinimized = true;
        });

        document.getElementById('hvt-search').addEventListener('input', debounce(() => {
            activeFilterMode = 'dropdown';
            showMissingOnly = false;
            updateSyncInfo();
            renderTable();
        }, 280));

        ['hvt-f-lang', 'hvt-f-locale', 'hvt-f-gender', 'hvt-f-age', 'hvt-f-tag'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                activeFilterMode = 'dropdown';
                showMissingOnly = false;
                updateSyncInfo();
                renderTable();
            });
        });

        document.getElementById('hvt-btn-default-filters').addEventListener('click', () => {
            const langEl   = document.getElementById('hvt-f-lang');
            const localeEl = document.getElementById('hvt-f-locale');
            if (LANGUAGE       && [...langEl.options].some(o => o.value === LANGUAGE))
                langEl.value   = LANGUAGE;
            else langEl.value = '';
            if (DEFAULT_LOCALE && [...localeEl.options].some(o => o.value === DEFAULT_LOCALE))
                localeEl.value = DEFAULT_LOCALE;
            else localeEl.value = '';
            activeFilterMode = 'dropdown';
            showMissingOnly = false;
            updateSyncInfo();
            renderTable();
        });

        document.getElementById('hvt-btn-clear-filters').addEventListener('click', () => {
            document.getElementById('hvt-f-lang').value   = '';
            document.getElementById('hvt-f-locale').value = '';
            document.getElementById('hvt-f-gender').value = '';
            document.getElementById('hvt-f-age').value    = '';
            document.getElementById('hvt-f-tag').value    = '';
            document.getElementById('hvt-search').value   = '';
            activeFilterMode = 'dropdown';
            showMissingOnly = false;
            updateSyncInfo();
            renderTable();
        });

        document.getElementById('hvt-btn-apply-filters').addEventListener('click', () => {
            activeFilterMode = 'dropdown';
            showMissingOnly = false;
            updateSyncInfo();
            renderTable();
        });

        document.getElementById('hvt-paste-toggle').addEventListener('click', () => {
            const panel = document.getElementById('hvt-paste-panel');
            panel.style.display = panel.style.display === 'none' ? '' : 'none';
        });

        document.getElementById('hvt-btn-apply-paste').addEventListener('click', () => {
            const text = document.getElementById('hvt-paste-area').value.trim();
            if (!text) { showToast('请先粘贴人声列表内容', 'error'); return; }
            const ids = extractVoiceIds(text);
            if (ids.size === 0) {
                showToast('未找到有效的 Voice ID（格式：名称/32位十六进制ID）', 'error', 3500);
                return;
            }
            pasteFilterIds = ids;
            activeFilterMode = 'paste';
            document.getElementById('hvt-paste-hint').textContent = `解析到 ${ids.size} 个 ID`;
            renderTable();
            showToast(`✅ 已筛选出 ${ids.size} 个人声`, 'success');
        });

        document.getElementById('hvt-btn-clear-paste').addEventListener('click', () => {
            pasteFilterIds = null;
            activeFilterMode = 'dropdown';
            document.getElementById('hvt-paste-area').value           = '';
            document.getElementById('hvt-paste-hint').textContent      = '';
            renderTable();
        });

        // Download MP3s – or cancel if in progress
        document.getElementById('hvt-btn-dl-mp3').addEventListener('click', () => {
            if (downloadInProgress) {
                downloadCancelled = true;
                return;
            }
            const fLang   = (document.getElementById('hvt-f-lang')?.value   || '').toLowerCase();
            const fLocale = (document.getElementById('hvt-f-locale')?.value || '').toLowerCase();
            let voices = Object.values(db.voices);
            if (fLang)   voices = voices.filter(v => (v.language || '').toLowerCase() === fLang);
            if (fLocale) voices = voices.filter(v => (v.locale   || '').toLowerCase() === fLocale);
            voices.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
            if (voices.length === 0) { showToast('当前范围没有人声', 'error'); return; }
            const scopeLabel = [fLang, fLocale].filter(Boolean).join(' / ') || '全部';
            if (voices.length > 50) {
                if (!confirm(`将下载 ${scopeLabel} 范围内 ${voices.length} 个人声的 MP3，继续？`)) return;
            }
            downloadMp3List(voices);
        });

        const btnFetch = document.getElementById('hvt-btn-fetch');
        const btnPause = document.getElementById('hvt-btn-fetch-pause');
        const btnAbort = document.getElementById('hvt-btn-fetch-abort');

        function showFetchControls(show) {
            btnFetch.style.display = show ? 'none'  : '';
            btnPause.style.display = show ? ''      : 'none';
            btnAbort.style.display = show ? ''      : 'none';
            if (!show) {
                btnPause.textContent = '暂停';
                btnAbort.disabled    = false;
            }
        }

        btnFetch.addEventListener('click', async () => {
            if (fetchInProgress) return;

            fetchInProgress = true;
            fetchCancelled  = false;
            fetchPaused     = false;

            const progress = document.getElementById('hvt-progress');
            const langFilter   = document.getElementById('hvt-f-lang')?.value   || '';
            const localeFilter = document.getElementById('hvt-f-locale')?.value || '';
            const scopeLabel   = [langFilter, localeFilter].filter(Boolean).join(' / ') || '全部';

            showFetchControls(true);
            btnFetch.classList.add('hvt-loading');
            if (progress) progress.textContent = '';
            try {
                const count = await fetchAllVoices((msg) => {
                    if (progress) progress.textContent = msg;
                    const stats = document.getElementById('hvt-stats');
                    if (stats) stats.textContent = msg;
                }, langFilter, localeFilter);
                refreshFilters();
                renderTable();
                updateSyncInfo();
                if (progress) progress.textContent = '';
                if (fetchCancelled) {
                    showToast(`已终止，已加载 ${count} 个人声`, 'info', 3000);
                } else {
                    showToast(`✅ 同步完成（${scopeLabel}），共 ${count} 个人声`, 'success', 3000);
                }
            } catch (e) {
                console.error('[HVT] fetch error:', e);
                if (progress) progress.textContent = '获取失败';
                showToast('获取失败: ' + e.message, 'error', 4000);
            } finally {
                fetchInProgress = false;
                fetchCancelled  = false;
                fetchPaused     = false;
                btnFetch.classList.remove('hvt-loading');
                showFetchControls(false);
            }
        });

        btnPause.addEventListener('click', () => {
            if (!fetchInProgress) return;
            fetchPaused = !fetchPaused;
            btnPause.textContent = fetchPaused ? '继续' : '暂停';
        });

        btnAbort.addEventListener('click', () => {
            if (!fetchInProgress) return;
            fetchCancelled = true;
            fetchPaused    = false;   // 如果处于暂停中，解除暂停让循环能检测到终止
            btnAbort.disabled   = true;
            btnPause.textContent = '暂停';
        });

        document.getElementById('hvt-btn-export').addEventListener('click', () => {
            if (Object.keys(db.voices).length === 0) { showToast('没有数据可导出', 'error'); return; }
            exportData();
            showToast('✅ 数据已导出', 'success');
        });

        document.getElementById('hvt-btn-import').addEventListener('click', () => {
            document.getElementById('hvt-file-input').click();
        });

        // Delete key: remove selected (or playing) row from paste filter results
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Delete') return;
            if (pasteFilterIds === null || activeFilterMode !== 'paste') return;
            const targetId = (selectedVoiceId || playingId || '').toLowerCase();
            if (!targetId) return;
            if (playingId && playingId.toLowerCase() === targetId) stopAudio();
            if (selectedVoiceId && selectedVoiceId.toLowerCase() === targetId) selectedVoiceId = null;
            pasteFilterIds.delete(targetId);
            const hint = document.getElementById('hvt-paste-hint');
            if (hint) hint.textContent = `解析到 ${pasteFilterIds.size} 个 ID`;
            renderTable();
        });

        document.getElementById('hvt-file-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text  = await file.text();
                const count = importData(text);
                refreshFilters();
                renderTable();
                updateSyncInfo();
                showToast(`✅ 导入成功，共 ${count} 条人声`, 'success', 3000);
            } catch (err) {
                showToast('导入失败: ' + err.message, 'error', 4000);
            }
            e.target.value = '';
        });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────
    function init() {
        loadDb();
        buildUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
