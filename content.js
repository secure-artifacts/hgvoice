/* Heygen Helper T3 / Voice Tester - content.js */
(function () {
    'use strict';
    if (document.getElementById('hvt-fab')) return;

    // ─── Constants ────────────────────────────────────────────────────────────
    const STORE_KEY = 'hvt_data_v1';
    const MV_CACHE_KEY = 'hvt_mv_cache_v1';
    const MV_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
    const SPACE_CACHE_KEY = 'hvt_space_voices_cache_v1'; // 社区（Space）声音缓存
    // 分享到期清理（Share Expiry Cleanup）
    const EXP_LEDGER_KEY = 'hvt_share_ledger_v1'; // { "voiceId::email": 首次发现时间戳 }
    const EXP_DAYS_KEY = 'hvt_share_expiry_days';  // 用户配置的过期天数
    const EXP_WL_KEY = 'hvt_share_whitelist_v1';   // 白名单邮箱数组（永不列出/撤销）
    const EXP_DAYS_DEFAULT = 60;
    const EXP_AUTO_KEY = 'hvt_share_auto_clean';   // '1'/'0'：是否自动清理超期分享
    const EXP_AUTO_LAST_KEY = 'hvt_share_auto_last'; // 上次自动清理时间戳（节流用）
    const API_BASE = 'https://api2.heygen.com';

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
    let pasteFilterOrder = null; // Map<id, index> — preserves paste input order
    let showMissingOnly = false;
    let isMinimized = true; // 默认最小化启动，避免每次页面加载就渲染全表
    let tableRendered = false; // 首次展开面板时才渲染表格
    const RENDER_CHUNK = 200; // 限量渲染：大列表先渲染前 N 行，点「加载更多」追加
    let renderLimit = RENDER_CHUNK;
    let lastFilterSig = '';
    let fetchInProgress = false;
    let fetchCancelled = false;
    let fetchPaused = false;
    let downloadInProgress = false;
    let downloadCancelled = false;
    let activeFilterMode = 'dropdown'; // 'paste' | 'dropdown' — last-applied wins
    let vdAudioEl = null; // audio element for voice design preview
    let vdAvatarGroupId = null; // cached avatar_group_id used as carrier for photo.prompt
    let selectedTags = new Set(); // multi-select tag chip filter

    // ─── Tag / Age translation tables (module-scope so filter logic can use them) ─
    const TAG_ZH = {
        // ── 广告 ──────────────────────────────────────────────
        'ads':'广告','advertisement':'广告','advertising':'广告',

        // ── 商务（合并 corporate / business / professional / formal / 企业培训 / 商业教育）──
        'corporate':'商务','business':'商务',
        'professional':'商务','formal':'商务',
        'corporate training':'商务','business education':'商务',

        // ── 教育（合并 educational / educational narration / informative educational / e-learning / instructional / tutorial）──
        'education':'教育','educational':'教育',
        'educational narration':'教育','informative educational':'教育',
        'e-learning':'教育','elearning':'教育',
        'instructional':'教育','tutorial':'教育',

        // ── 培训（保留，与教育有场景区别）────────────────────
        'training':'培训',

        // ── 讲座（保留，正式演讲场景）────────────────────────
        'lecture':'讲座',

        // ── 解说（合并 explainer + tech explainer）──────────
        'explainer':'解说','tech explainer':'解说',

        // ── 知性 / 清晰易懂 ───────────────────────────────────
        'intellectual':'知性','intelligible':'清晰易懂',

        // ── 有声书 ────────────────────────────────────────────
        'audiobook':'有声书','audiobooks':'有声书',
        'audio books':'有声书','audio book':'有声书',

        // ── 叙事旁白（合并 narration / storytelling / storyteller / narrative）──
        'narration':'叙事旁白','storytelling':'叙事旁白',
        'storyteller':'叙事旁白','story telling':'叙事旁白',
        'narrative & story':'叙事旁白','narrative story':'叙事旁白',

        // ── 配音 / 演讲 ───────────────────────────────────────
        'voice over':'配音','speech':'演讲',

        // ── 纪录片 / 新闻 ─────────────────────────────────────
        'documentary':'纪录片','news':'新闻',

        // ── 播客（合并 podcast hosting / crypto podcast）──────
        'podcast':'播客','podcasts':'播客',
        'podcast hosting':'播客','crypto podcast':'播客',

        // ── 轻松聆听 ──────────────────────────────────────────
        'easy listening':'轻松聆听',

        // ── 媒体 / 娱乐（合并 entertainment tv）──────────────
        'media':'媒体',
        'entertainment':'娱乐','entertainment tv':'娱乐',

        // ── 社交媒体（合并 social + social media）────────────
        'social':'社交媒体','social media':'社交媒体',

        // ── 游戏 ──────────────────────────────────────────────
        'games':'游戏','gaming':'游戏',

        // ── 多语言 ────────────────────────────────────────────
        'multilingual':'多语言',

        // ── 对话式（合并 conversation / conversations 变体）──
        'conversational':'对话式','conversation':'对话式',
        'conversations':'对话式','conversationa':'对话式',

        // ── 动画配音（合并 animation + characters animation）──
        'animation':'动画配音','characters animation':'动画配音',

        // ── 运动 ──────────────────────────────────────────────
        'sports':'运动',

        // ── 情绪 / 声音个性 ────────────────────────────────────
        'anxious':'焦虑',
        'approachable':'亲切','kind':'亲切','friendly':'亲切',  // 合并
        'articulate':'口齿清晰',
        'authoritative':'权威',
        'calm':'平静','peaceful':'平静',                        // 合并
        'captivating':'迷人',
        'casual':'随意',
        'cheerful':'欢快',
        'cheeky':'俏皮','playful':'俏皮','sassy':'俏皮',         // 合并
        'chill':'放松','relaxed':'放松','relaxing':'放松',       // 合并
        'comforting':'安慰',
        'confident':'自信',
        'cute':'可爱',
        'deep':'低沉',
        'classy':'优雅','elegant':'优雅',                       // 合并
        'energetic':'活力','vibrant':'活力','spirited':'活力',   // 合并
        'engaging':'引人入胜',
        'enthusiastic':'热情洋溢',
        'enticing':'诱人',
        'excited':'兴奋','exciting':'兴奋',                     // 合并
        'expressive':'富有表现力',
        'gentle':'温柔','tender':'温柔',                        // 合并
        'happy':'开心',
        'husky':'沙哑','raspy':'沙哑',                          // 合并
        'hyped':'亢奋',
        'intense':'强烈',
        'inviting':'邀请感',
        'lively':'活泼',
        'masculine':'阳刚',
        'mature':'成熟',
        'meditative':'冥想','meditation':'冥想','mindfulness':'冥想', // 合并
        'modulated':'调节',
        'motivational':'激励',
        'natural':'自然',
        'neutral':'中性',
        'passionate':'热情',
        'pleasant':'愉悦',
        'powerful':'有力','strong':'有力',                      // 合并
        'rich':'浑厚',
        'robotic':'机械',
        'rough':'粗犷',
        'sad':'悲伤',
        'serious':'严肃',
        'smooth':'流畅',
        'soft':'柔和',
        'soothing':'舒缓',
        'sweet':'甜美',
        'trustworthy':'可信赖',
        'upbeat':'积极',
        'velvety':'丝绒般',
        'warm':'温暖',
        'whispery':'低语','whispering':'低语',                  // 合并
        'wise':'睿智',
        'witty':'机智',
        'youthful':'年轻',
        'bold':'大胆',
        'bright':'明亮',
        'crisp':'清脆',
        'dynamic':'动感',
        'empathetic':'共情',
        'melodic':'悦耳',
        'refined':'精致','sophisticated':'精致',               // 合并
        'sincere':'真诚',
        'steady':'稳重',
        'uplifting':'振奋',
        'versatile':'多变',

        // ── 年龄标签 ──────────────────────────────────────────
        'kids':'儿童','child':'儿童','childish':'童声','kid':'小孩',
        'young':'年轻','youth':'年轻','youthful':'年轻','teen':'青少年',
        'middle age':'中年','middle aged':'中年',
        'middle-aged':'中年','middle_aged':'中年',
        'senior':'老年','elderly':'老年','old':'老年','older':'年长',

        // ── 其他 ──────────────────────────────────────────────
        'pvc':'PVC',
    };
    let mvAudioEl = null; // audio element for my-voices preview
    let mvPlayingId = null; // currently playing voice id in my-voices panel
    let mvVoices = []; // cached my-voices list
    let mvSelectedIds = new Set(); // checked voices for batch download
    let mvDelRunning = false;      // batch-delete in progress
    let mvDelAbort = false;        // set by 停止 to break the delete loop
    let mvShareVoice = null; // voice currently targeted by the share dialog
    let mvShareDone = []; // emails successfully shared in the current share-dialog session
    let mvShareAbort = false; // set by 停止 to break the batch-remove loop
    let mvShareWaitCancel = null; // cancels the in-progress inter-delete delay
    let expAbort = false;       // set by 停止 to break the expiry-cleanup loop
    let expRows = [];           // current scan result rows
    let expMyUsername = null;   // cached current-user username for owner check
    let expAutoRunning = false; // guards against concurrent auto-clean runs
    let mainSelectedIds = new Set(); // checked voices in main table for download
    // ─── 社区（Space）声音 ───
    let spaceVoices = [];            // Space 作用域声音，每条带 _space/_spaceName/_origin
    let spaceMembers = new Set();    // 所有所属 Space 的成员 username 合集（用于判定 自生成/分享进来）
    let spacesList = [];             // [{id, name}]
    let spaceFetchRunning = false;   // 后台拉取进行中
    let spaceSelectedIds = new Set();// 社区声音视图下勾选的声音
    let spaceDelRunning = false;     // 社区声音批量删除进行中
    let spaceDelAbort = false;       // 停止社区删除循环
    let mvViewMode = 'self';         // 'self'=本号自带声音 | 'space'=社区声音
    let myUsername = null;           // 当前用户 username（创建者判定）

    // ─── Storage ──────────────────────────────────────────────────────────────
    function loadDb() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) db = JSON.parse(raw);
        } catch (e) { }
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
    const HVT_FETCH_HEADERS = {
        'accept': 'application/json, text/plain, */*',
        'x-ver': '4.1.0',
        'x-language-override': 'en-US',
        'origin': 'https://app.heygen.com',
        'referer': 'https://app.heygen.com/',
    };

    async function heygenApi(path, options = {}, _retries = 2) {
        const isPost = (options.method || 'GET').toUpperCase() !== 'GET';
        const res = await fetch(`${API_BASE}${path}`, {
            ...options,
            credentials: 'include',
            headers: {
                ...HVT_FETCH_HEADERS,
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

    // Fetch voice-design preview via v2 NDJSON stream endpoint.
    // Required headers: Accept: application/x-ndjson + x-heygen-service: voice
    // Audio generation takes ~8-12 s, so poll on 404 until ready.
    async function vdPreviewStream(requestId, optionId) {
        const url = `${API_BASE}/v2/voice_design/preview.stream?request_id=${encodeURIComponent(requestId)}&option_id=${encodeURIComponent(optionId)}`;
        const headers = { ...HVT_FETCH_HEADERS, 'accept': 'application/x-ndjson', 'x-heygen-service': 'voice' };

        const MAX_TRIES = 15;
        const RETRY_MS  = 2000;

        // Audio generation typically takes ~8-12 s; wait 6 s before first attempt
        await new Promise(r => setTimeout(r, 6000));

        for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
            const res = await fetch(url, { credentials: 'include', headers });

            if (res.status === 404 && attempt < MAX_TRIES) {
                // Audio not ready yet — wait and retry
                await new Promise(r => setTimeout(r, RETRY_MS));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            // Response is NDJSON: 270 lines of base64 chunks (many are 1-byte heartbeats).
            // Each chunk must be decoded individually — concatenating base64 strings
            // breaks because intermediate == padding corrupts the combined string.
            const text = await res.text();
            const decodedChunks = [];
            let totalLen = 0;
            for (const line of text.split('\n')) {
                const t = line.trim();
                if (!t) continue;
                try {
                    const obj = JSON.parse(t);
                    if (obj.audio_bytes) {
                        const bin = atob(obj.audio_bytes);
                        const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                        decodedChunks.push(arr);
                        totalLen += arr.length;
                    }
                } catch { /* skip non-JSON lines */ }
            }
            if (totalLen === 0) throw new Error('无音频数据');
            const combined = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of decodedChunks) { combined.set(chunk, offset); offset += chunk.length; }
            return combined; // Uint8Array of MP3 bytes
        }
        throw new Error('音频生成超时，请稍后重试');
    }

    // ─── Fetch & merge ────────────────────────────────────────────────────────
    // langFilter : 语言筛选值（如 'English'）；空字符串 = 不限语言（拉全量）
    // localeFilter: 地区筛选值（如 'en-US'）；客户端过滤，空 = 不限
    async function fetchAllVoices(onProgress, langFilter, localeFilter) {
        const filterLang = (langFilter || '').toLowerCase();
        const filterLocale = (localeFilter || '').toLowerCase();
        const seenIds = new Set();

        let fetched = 0;
        let cursor = null;

        do {
            // 暂停：等待直到继续或终止
            while (fetchPaused && !fetchCancelled) {
                await new Promise(r => setTimeout(r, 200));
            }
            if (fetchCancelled) break;

            const p = new URLSearchParams({ limit: '50' });
            if (langFilter) p.set('language', langFilter);
            if (cursor) p.set('cursor', cursor);
            if (onProgress) onProgress(`获取中… 已加载 ${fetched} 条`);

            const data = await heygenApi('/v2/public_voices?' + p);
            const list = data.list || [];

            for (const v of list) {
                if (!v.voice_id) continue;
                // 地区客户端过滤
                if (filterLocale && (v.locale || '').toLowerCase() !== filterLocale) continue;

                const id = v.voice_id;
                seenIds.add(id);
                const existing = db.voices[id] || {};
                db.voices[id] = {
                    voice_id: id,
                    display_name: v.display_name || existing.display_name || '',
                    gender: v.gender || existing.gender || '',
                    language: v.language || langFilter || LANGUAGE,
                    locale: v.locale || existing.locale || '',
                    labels: v.labels || existing.labels || [],
                    description: v.description || existing.description || '',
                    preview_audio: (v.preview && v.preview.movio) || existing.preview_audio || '',
                    age: normalizeAge(v.age || existing.age || ''),
                    notes: existing.notes || '',
                    existsOnHeygen: true,
                    lastSeen: Date.now(),
                    firstAdded: existing.firstAdded || Date.now(),
                };
                fetched++;
            }

            cursor = (data.has_more && data.next_cursor) ? data.next_cursor : null;
            if (cursor) await new Promise(r => setTimeout(r, 120));
        } while (cursor);

        // 仅在完整同步成功后才标记下架；中途终止 / 抛错不动旧状态，避免误标
        if (!fetchCancelled) {
            for (const id in db.voices) {
                const v = db.voices[id];
                const langMatch = !filterLang || (v.language || '').toLowerCase() === filterLang;
                const localeMatch = !filterLocale || (v.locale || '').toLowerCase() === filterLocale;
                if (langMatch && localeMatch && !seenIds.has(id)) v.existsOnHeygen = false;
            }
        }

        db.lastSync = Date.now();
        saveDb();
        return fetched;
    }

    // ─── Audio ────────────────────────────────────────────────────────────────
    function stopAudio() {
        if (audioEl) { try { audioEl.pause(); } catch (e) { } audioEl.src = ''; audioEl = null; }
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
        downloadCancelled = false;
        const dlBtn = document.getElementById('hvt-btn-dl-mp3');
        const progressEl = document.getElementById('hvt-progress');
        if (dlBtn) { dlBtn.textContent = '⏹ 停止下载'; dlBtn.classList.add('hvt-btn-stop'); }

        let done = 0, failed = 0;

        for (const v of withAudio) {
            if (downloadCancelled) break;
            if (progressEl) progressEl.textContent = `下载中 ${done + 1} / ${withAudio.length}…`;
            try {
                const res = await fetch(v.preview_audio);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
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
        if (dlBtn) { dlBtn.textContent = '⬇ 下载 MP3'; dlBtn.classList.remove('hvt-btn-stop'); }
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
    function getFilteredVoices(skipTagFilter = false) {
        const q = (document.getElementById('hvt-search')?.value || '').toLowerCase().trim();
        const fLocale = (document.getElementById('hvt-f-locale')?.value || '').toLowerCase();
        const fGender = (document.getElementById('hvt-f-gender')?.value || '').toLowerCase();
        const fLang = (document.getElementById('hvt-f-lang')?.value || '').toLowerCase();
        const fAge = (document.getElementById('hvt-f-age')?.value || '').toLowerCase();

        let list = Object.values(db.voices);

        if (pasteFilterIds !== null && activeFilterMode === 'paste') {
            // Paste filter active: only show matched IDs, sorted by input order
            list = list.filter(v => pasteFilterIds.has((v.voice_id || '').toLowerCase()));
            if (pasteFilterOrder) {
                list.sort((a, b) => {
                    const ai = pasteFilterOrder.get((a.voice_id || '').toLowerCase()) ?? Infinity;
                    const bi = pasteFilterOrder.get((b.voice_id || '').toLowerCase()) ?? Infinity;
                    return ai - bi;
                });
            }
            return list;
        }

        // Helper: read all merged values stored in data-vals attribute of selected option
        function selVals(selId, fallback) {
            const sel = document.getElementById(selId);
            const opt = sel?.options[sel.selectedIndex];
            const raw = opt?.dataset?.vals || fallback || '';
            return raw.split('|').filter(Boolean);
        }

        if (showMissingOnly) { list = list.filter(v => v.existsOnHeygen === false); return list; }
        // locale 比 language 更具体：选了 locale 时跳过 language 过滤，避免 language 字段缺失导致漏声音
        if (fLang && !fLocale) list = list.filter(v => (v.language || '').toLowerCase() === fLang);
        if (fLocale) {
            const localeVals = selVals('hvt-f-locale', fLocale);
            list = list.filter(v => localeVals.includes((v.locale || '').trim().toLowerCase()));
        }
        if (fGender) list = list.filter(v => (v.gender || '').toLowerCase() === fGender);
        if (fAge) {
            const ageVals = selVals('hvt-f-age', fAge);
            list = list.filter(v => {
                const hay = ((v.age || '') + ' ' + (v.labels || []).join(' ')).toLowerCase();
                return ageVals.some(val => hay.includes(val));
            });
        }
        if (selectedTags.size > 0 && !skipTagFilter) {
            // AND 逻辑：声音必须同时包含所有选中标签
            const voiceLabelSet = (v) => new Set(
                (v.labels || []).map(l => TAG_ZH[l.toLowerCase()] || normalizeAge(l))
            );
            list = list.filter(v => {
                const ls = voiceLabelSet(v);
                return [...selectedTags].every(tag => ls.has(tag));
            });
        }

        if (q) {
            list = list.filter(v => {
                const name = (v.display_name || '').toLowerCase();
                const id = (v.voice_id || '').toLowerCase();
                const tags = (v.labels || []).join(' ').toLowerCase();
                const notes = (v.notes || '').toLowerCase();
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
        const voices = Object.values(db.voices);
        const langs = [...new Set(voices.map(v => v.language).filter(Boolean))].sort();
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
        // Exclude gender labels (male/female) — already covered by the gender dropdown
        const GENDER_LABELS = new Set(['male', 'female']);
        const allTags = new Set();
        voices.forEach(v => (v.labels || []).forEach(l => {
            if (l.trim() && !GENDER_LABELS.has(l.trim().toLowerCase()))
                allTags.add(normalizeAge(l.trim()));
        }));

        const langSel = document.getElementById('hvt-f-lang');
        const localeSel = document.getElementById('hvt-f-locale');
        const ageSel = document.getElementById('hvt-f-age');
        const tagChipPanel = document.getElementById('hvt-tag-chip-panel');
        if (!langSel) return;

        const LANG_ZH = {
            'arabic':'阿拉伯语','bangla':'孟加拉语','bulgarian':'保加利亚语',
            'catalan':'加泰罗尼亚语','chinese':'中文','croatian':'克罗地亚语',
            'czech':'捷克语','danish':'丹麦语','dutch':'荷兰语',
            'english':'英语','estonian':'爱沙尼亚语','filipino':'菲律宾语',
            'finnish':'芬兰语','french':'法语','georgian':'格鲁吉亚语',
            'german':'德语','greek':'希腊语','gujarati':'古吉拉特语',
            'hebrew':'希伯来语','hindi':'印地语','hungarian':'匈牙利语',
            'indonesian':'印尼语','italian':'意大利语','japanese':'日语',
            'kannada':'卡纳达语','kiswahili':'斯瓦希里语','korean':'韩语',
            'latvian':'拉脱维亚语','lithuanian':'立陶宛语','malay':'马来语',
            'marathi':'马拉地语','multilingual':'多语言','nepali':'尼泊尔语',
            'norwegian':'挪威语','persian':'波斯语','polish':'波兰语',
            'portuguese':'葡萄牙语','romanian':'罗马尼亚语','russian':'俄语',
            'sinhala':'僧伽罗语','slovak':'斯洛伐克语','spanish':'西班牙语',
            'swedish':'瑞典语','tamil':'泰米尔语','telugu':'泰卢固语',
            'thai':'泰语','turkey':'土耳其语','turkish':'土耳其语',
            'ukrainian':'乌克兰语','urdu':'乌尔都语','vietnamese':'越南语',
            'en':'英语','es':'西班牙语','unknown':'未知',
        };
        const LOCALE_ZH = {
            // 英语
            'en-US':'英语（美国）','en-GB':'英语（英国）','en-UK':'英语（英国）',
            'en_UK':'英语（英国）','en-AU':'英语（澳大利亚）','en-CA':'英语（加拿大）',
            'en-IN':'英语（印度）','en-IE':'英语（爱尔兰）','en-NZ':'英语（新西兰）',
            'en-ZA':'英语（南非）','en-SG':'英语（新加坡）','en-HK':'英语（香港）',
            'en-GH':'英语（加纳）','en-KE':'英语（肯尼亚）','en-NG':'英语（尼日利亚）',
            'en-ES':'英语（西班牙）',
            // 中文
            'zh-CN':'中文（中国大陆）','zh-TW':'中文（台湾）','zh-HK':'中文（香港）',
            // 日韩
            'ja-JP':'日语（日本）','ko-KR':'韩语（韩国）',
            // 法语
            'fr-FR':'法语（法国）','fr-CA':'法语（加拿大）',
            'fr-BE':'法语（比利时）','fr-CH':'法语（瑞士）',
            // 德语
            'de-DE':'德语（德国）','de-AT':'德语（奥地利）','de-CH':'德语（瑞士）',
            // 西班牙语
            'es-ES':'西班牙语（西班牙）','es-MX':'西班牙语（墨西哥）',
            'es-US':'西班牙语（美国）','es-AR':'西班牙语（阿根廷）',
            'es-CO':'西班牙语（哥伦比亚）','es-CL':'西班牙语（智利）',
            'es-BO':'西班牙语（玻利维亚）','es-GT':'西班牙语（危地马拉）',
            'es-PE':'西班牙语（秘鲁）','es-SV':'西班牙语（萨尔瓦多）',
            'es-UY':'西班牙语（乌拉圭）','es-VE':'西班牙语（委内瑞拉）',
            // 葡萄牙语
            'pt-BR':'葡萄牙语（巴西）','pt-PT':'葡萄牙语（葡萄牙）',
            // 意大利 / 俄语
            'it-IT':'意大利语（意大利）','ru-RU':'俄语（俄罗斯）',
            // 阿拉伯语
            'ar-SA':'阿拉伯语（沙特阿拉伯）','ar-AE':'阿拉伯语（阿联酋）',
            'ar-EG':'阿拉伯语（埃及）','ar-MA':'阿拉伯语（摩洛哥）',
            'ar-BH':'阿拉伯语（巴林）','ar-DZ':'阿拉伯语（阿尔及利亚）',
            'ar-IQ':'阿拉伯语（伊拉克）','ar-JO':'阿拉伯语（约旦）',
            'ar-KW':'阿拉伯语（科威特）','ar-LY':'阿拉伯语（利比亚）',
            'ar-QA':'阿拉伯语（卡塔尔）','ar-SY':'阿拉伯语（叙利亚）',
            'ar-TN':'阿拉伯语（突尼斯）','ar-YE':'阿拉伯语（也门）',
            // 南亚
            'hi-IN':'印地语（印度）','bn-BD':'孟加拉语（孟加拉）',
            'bn-IN':'孟加拉语（印度）','ur-PK':'乌尔都语（巴基斯坦）',
            'ur-IN':'乌尔都语（印度）','fa-IR':'波斯语（伊朗）',
            'ne-NP':'尼泊尔语（尼泊尔）','si-LK':'僧伽罗语（斯里兰卡）',
            'gu-IN':'古吉拉特语（印度）','mr-IN':'马拉地语（印度）',
            'ta-IN':'泰米尔语（印度）','ta-LK':'泰米尔语（斯里兰卡）',
            'te-IN':'泰卢固语（印度）','kn-IN':'卡纳达语（印度）',
            'ml-IN':'马拉雅拉姆语（印度）','pa-IN':'旁遮普语（印度）',
            // 东南亚
            'id-ID':'印尼语（印度尼西亚）','ms-MY':'马来语（马来西亚）',
            'th-TH':'泰语（泰国）','vi-VN':'越南语（越南）',
            'tl-PH':'菲律宾语（菲律宾）','fil-PH':'菲律宾语（菲律宾）',
            'ceb-PH':'宿务语（菲律宾）','jv-ID':'爪哇语（印度尼西亚）',
            // 欧洲
            'nl-NL':'荷兰语（荷兰）','nl-BE':'荷兰语（比利时）',
            'pl-PL':'波兰语（波兰）','tr-TR':'土耳其语（土耳其）',
            'sv-SE':'瑞典语（瑞典）','da-DK':'丹麦语（丹麦）',
            'fi-FI':'芬兰语（芬兰）','nb-NO':'挪威语（挪威）',
            'cs-CZ':'捷克语（捷克）','sk-SK':'斯洛伐克语（斯洛伐克）',
            'hu-HU':'匈牙利语（匈牙利）','ro-RO':'罗马尼亚语（罗马尼亚）',
            'bg-BG':'保加利亚语（保加利亚）','hr-HR':'克罗地亚语（克罗地亚）',
            'uk-UA':'乌克兰语（乌克兰）','el-GR':'希腊语（希腊）',
            'he-IL':'希伯来语（以色列）','lt-LT':'立陶宛语（立陶宛）',
            'lv-LV':'拉脱维亚语（拉脱维亚）','et-EE':'爱沙尼亚语（爱沙尼亚）',
            'ca-ES':'加泰罗尼亚语（西班牙）',
            // 高加索 / 中亚
            'ka-GE':'格鲁吉亚语（格鲁吉亚）',
            // 非洲
            'sw-KE':'斯瓦希里语（肯尼亚）','sw-TZ':'斯瓦希里语（坦桑尼亚）',
            'af-ZA':'南非荷兰语（南非）',
            // 特殊
            'multi':'多语言','unknown':'未知',
        };
        langs.forEach(l => {
            const o = document.createElement('option');
            o.value = l;
            o.textContent = LANG_ZH[l.trim().toLowerCase()] || l;
            langSel.appendChild(o);
        });

        // Locale: group by Chinese name to deduplicate (e.g. en-GB / en-UK / en_UK → 英语（英国）)
        {
            const localeGroups = new Map(); // chineseName → { display, vals[] }
            locales.forEach(l => {
                const key = l.trim();
                const cn = LOCALE_ZH[key];
                const groupKey = cn || key;
                if (!localeGroups.has(groupKey)) {
                    localeGroups.set(groupKey, { cn, primaryKey: key, vals: [] });
                }
                localeGroups.get(groupKey).vals.push(key.toLowerCase());
            });
            const isEnLocale = ({ primaryKey }) =>
                /^en[-_]/i.test(primaryKey);

            // English locales first (en-US at top), then rest sorted by Chinese name
            const EN_ORDER = ['en-US','en-GB','en-AU','en-CA','en-IN','en-IE','en-NZ','en-ZA','en-SG','en-HK','en-GH','en-KE','en-NG','en-ES'];
            [...localeGroups.entries()].sort(([keyA, a], [keyB, b]) => {
                const aEn = isEnLocale(a), bEn = isEnLocale(b);
                if (aEn && !bEn) return -1;
                if (!aEn && bEn) return 1;
                if (aEn && bEn) {
                    const ai = EN_ORDER.findIndex(c => a.vals.includes(c.toLowerCase()));
                    const bi = EN_ORDER.findIndex(c => b.vals.includes(c.toLowerCase()));
                    if (ai === -1 && bi === -1) return keyA.localeCompare(keyB, 'zh');
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                }
                return keyA.localeCompare(keyB, 'zh');
            }).forEach(([, { cn, primaryKey, vals }]) => {
                const o = document.createElement('option');
                o.value = vals[0];
                o.dataset.vals = vals.join('|');
                // If merged multiple codes, show only the Chinese name; otherwise show code too
                o.textContent = cn ? (vals.length > 1 ? cn : `${cn}（${primaryKey}）`) : primaryKey;
                localeSel.appendChild(o);
            });
        }

        const AGE_ZH = {
            'child': '儿童', 'childish': '童声', 'kid': '小孩',
            'teen': '青少年', 'teenager': '青少年', 'young': '年轻',
            'young adult': '青年', 'adult': '成人',
            'middle age': '中年', 'middle aged': '中年', 'middle-aged': '中年', 'middle_aged': '中年',
            'mature': '成熟', 'senior': '老年', 'elderly': '老年',
            'old': '老年', 'older': '年长',
        };

        // Age: group by Chinese label to deduplicate
        {
            const ageGroups = new Map(); // chineseLabel → vals[]
            [...ages].sort().forEach(a => {
                const label = AGE_ZH[a.toLowerCase()] || a;
                if (!ageGroups.has(label)) ageGroups.set(label, []);
                ageGroups.get(label).push(a.toLowerCase());
            });
            [...ageGroups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh')).forEach(([label, vals]) => {
                const o = document.createElement('option');
                o.value = vals[0];
                o.dataset.vals = vals.join('|');
                o.textContent = label;
                ageSel.appendChild(o);
            });
        }
        // Tag chips: group by Chinese label, render as clickable chips
        if (tagChipPanel) {
            tagChipPanel.innerHTML = '';
            const tagGroups = new Map(); // chineseLabel → raw English vals[]
            [...allTags].sort().forEach(t => {
                const label = TAG_ZH[t.toLowerCase()] || t;
                if (!tagGroups.has(label)) tagGroups.set(label, []);
                tagGroups.get(label).push(t.toLowerCase());
            });
            [...tagGroups.keys()].sort((a, b) => a.localeCompare(b, 'zh')).forEach(label => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'hvt-tag-chip' + (selectedTags.has(label) ? ' active' : '');
                chip.textContent = label;
                chip.addEventListener('click', () => {
                    if (selectedTags.has(label)) {
                        selectedTags.delete(label);
                        chip.classList.remove('active');
                    } else {
                        selectedTags.add(label);
                        chip.classList.add('active');
                    }
                    updateTagBadge();
                    activeFilterMode = 'dropdown';
                    showMissingOnly = false;
                    updateSyncInfo();
                    renderTable();
                });
                tagChipPanel.appendChild(chip);
            });
        }
    }

    function updateTagBadge() {
        const badge = document.getElementById('hvt-tag-badge');
        const btn = document.getElementById('hvt-tag-panel-toggle');
        if (badge) {
            if (selectedTags.size > 0) {
                badge.textContent = selectedTags.size;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
        if (btn) btn.classList.toggle('hvt-tag-btn-active', selectedTags.size > 0);
    }

    // 根据当前语言/地区/性别/年龄筛选结果，更新 chip 可用性（置灰不在当前范围内的标签）
    function updateChipAvailability(preTagVoices) {
        const panel = document.getElementById('hvt-tag-chip-panel');
        if (!panel) return;
        // 收集当前可见声音范围内存在的所有中文标签
        const available = new Set();
        preTagVoices.forEach(v => {
            (v.labels || []).forEach(l => {
                available.add(TAG_ZH[l.toLowerCase()] || normalizeAge(l));
            });
        });
        panel.querySelectorAll('.hvt-tag-chip').forEach(chip => {
            const label = chip.textContent.trim();
            // 选中的标签始终保持正常显示；未选中且不在当前范围的置灰
            const inRange = available.has(label);
            const isSelected = selectedTags.has(label);
            chip.classList.toggle('hvt-chip-dim', !inRange && !isSelected);
            chip.title = (!inRange && !isSelected)
                ? `当前筛选范围内没有「${label}」标签的声音`
                : '';
        });
    }

    function refreshFilters() {
        const langSel = document.getElementById('hvt-f-lang');
        const localeSel = document.getElementById('hvt-f-locale');
        const ageSel = document.getElementById('hvt-f-age');
        if (!langSel) return;
        const prevLang = langSel.value, prevLocale = localeSel.value;
        const prevAge = ageSel.value;
        while (langSel.options.length > 1) langSel.remove(1);
        while (localeSel.options.length > 1) localeSel.remove(1);
        while (ageSel.options.length > 1) ageSel.remove(1);
        populateFilters(); // re-renders tag chips too (keeps selectedTags state)
        langSel.value = prevLang;
        localeSel.value = prevLocale;
        ageSel.value = prevAge;
        updateTagBadge();
    }

    // ─── Export / Import ──────────────────────────────────────────────────────
    function exportData() {
        const json = JSON.stringify(db, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
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
            db.voices[id] = {
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

        // 先用「不含标签筛选」的结果更新 chip 可用性，让用户看到哪些标签在当前范围内有效
        const preTagList = getFilteredVoices(true);
        updateChipAvailability(preTagList);

        const list = getFilteredVoices();
        const totalVoices = Object.keys(db.voices).length;
        const statsEl = document.getElementById('hvt-stats');
        if (statsEl) {
            if (totalVoices === 0) {
                statsEl.innerHTML = '暂无数据，请点击「获取/更新人声」';
            } else {
                const q = (document.getElementById('hvt-search')?.value || '').trim();
                const fLocale = document.getElementById('hvt-f-locale')?.value || '';
                const fGender = document.getElementById('hvt-f-gender')?.value || '';
                const fAge = document.getElementById('hvt-f-age')?.value || '';
                const fTag = document.getElementById('hvt-f-tag')?.value || '';
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
        const table = document.getElementById('hvt-table');
        if (table) table.classList.toggle('hvt-no-desc', !showDesc);

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="hvt-empty">
                <span class="hvt-empty-icon">${totalVoices === 0 ? '🎙' : '🔍'}</span>
                ${totalVoices === 0 ? '暂无人声数据，请点击上方「获取/更新人声」按钮' : '没有符合条件的人声'}
            </td></tr>`;
            return;
        }

        // 筛选条件变化时重置渲染上限；条件不变（如「加载更多」触发的重渲染）则保留
        const sig = [
            document.getElementById('hvt-search')?.value || '',
            document.getElementById('hvt-f-lang')?.value || '',
            document.getElementById('hvt-f-locale')?.value || '',
            document.getElementById('hvt-f-gender')?.value || '',
            document.getElementById('hvt-f-age')?.value || '',
            [...selectedTags].join(','),
            activeFilterMode,
            pasteFilterIds ? pasteFilterIds.size : -1,
            showMissingOnly,
        ].join('|');
        if (sig !== lastFilterSig) { lastFilterSig = sig; renderLimit = RENDER_CHUNK; }
        const shown = list.slice(0, renderLimit);

        const frag = document.createDocumentFragment();
        shown.forEach((v) => {
            const tr = document.createElement('tr');
            if (!v.existsOnHeygen) tr.classList.add('hvt-row-missing');
            if (pasteFilterIds && activeFilterMode === 'paste' && pasteFilterIds.has((v.voice_id || '').toLowerCase())) {
                tr.classList.add('hvt-row-paste-match');
            }

            const flag = localeToFlag(v.locale);
            const localeCode = v.locale || '—';
            const gender = (v.gender || '').toLowerCase();
            const genderIcon = gender === 'female' ? '♀' : (gender === 'male' ? '♂' : '—');
            const genderClass = gender === 'female' ? 'hvt-f' : (gender === 'male' ? 'hvt-m' : '');
            const shortId = v.voice_id ? (v.voice_id.slice(0, 8) + '…') : '—';
            const previewUrl = v.preview_audio || '';
            const statusTitle = v.existsOnHeygen !== false ? esc(v.display_name || '') : '此人声已从 HeyGen 下架或找不到';

            const tagsHtml = (v.labels || [])
                .map(t => `<span class="hvt-tag">${esc(t)}</span>`)
                .join('');

            // Play button (last column)
            tr.innerHTML = `
                <td class="c-chk"><input type="checkbox" class="hvt-main-chk" data-id="${esc(v.voice_id)}"></td>
                <td class="c-flag" title="${esc(localeCode)}（双击复制）" data-copy="${esc(localeCode)}">${flag} <span class="c-flag-code">${esc(localeCode)}</span></td>
                <td class="c-gender"><span class="${genderClass}">${genderIcon}</span></td>
                <td class="c-name" title="${statusTitle}" data-copy="${esc((v.display_name || '') + '/' + (v.voice_id || ''))}">
                    <div class="hvt-name-main">${esc(v.display_name || '—')}</div>
                    <button class="hvt-copy-id-btn" data-copy="${esc((v.display_name || '') + '/' + (v.voice_id || ''))}" title="复制 名称/ID">${esc(shortId)}</button>
                </td>
                <td class="c-tags" title="双击复制标签">${tagsHtml}</td>
                <td class="c-notes">
                    <input class="hvt-notes-input" data-id="${esc(v.voice_id)}"
                        value="${esc(v.notes || '')}" placeholder="备注…">
                </td>
                <td class="c-play">
                    <div class="hvt-action-strip">
                        <button class="hvt-play-btn" data-play-id="${esc(v.voice_id)}" data-url="${esc(previewUrl)}"
                            ${!previewUrl ? 'disabled' : ''} title="${previewUrl ? '听音' : '无预览音频'}">
                            <svg class="ic-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                            <svg class="ic-stop" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
                        </button>
                        <button class="hvt-vd-btn" title="AI 生音">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                                <path d="M20 3v4m2-2h-4"/>
                            </svg>
                        </button>
                        <button class="hvt-dl-one-btn hvt-btn" title="下载 MP3">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>
                    </div>
                </td>
            `;
            frag.appendChild(tr);
        });

        tbody.innerHTML = '';
        tbody.appendChild(frag);

        // 超出渲染上限时追加「加载更多 / 显示全部」行
        if (list.length > shown.length) {
            const moreTr = document.createElement('tr');
            moreTr.className = 'hvt-load-more-row';
            moreTr.innerHTML = `<td colspan="7" style="text-align:center;padding:10px">
                <button id="hvt-load-more" class="hvt-btn">⬇ 加载更多（已显示 ${shown.length} / ${list.length}）</button>
                <button id="hvt-load-all" class="hvt-btn">显示全部</button>
            </td>`;
            moreTr.querySelector('#hvt-load-more').addEventListener('click', (e) => {
                e.stopPropagation();
                renderLimit += RENDER_CHUNK;
                renderTable();
            });
            moreTr.querySelector('#hvt-load-all').addEventListener('click', (e) => {
                e.stopPropagation();
                renderLimit = list.length;
                renderTable();
            });
            tbody.appendChild(moreTr);
        }
        // Restore checkboxes for IDs still in selection (preserve selection across re-renders)
        tbody.querySelectorAll('.hvt-main-chk').forEach(chk => {
            if (mainSelectedIds.has(chk.dataset.id)) chk.checked = true;
        });
        mainUpdateSelectionUI();

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

        // 生音 buttons – open voice design modal
        tbody.querySelectorAll('.hvt-vd-btn').forEach(btn => {
            btn.addEventListener('click', () => openVoiceDesign());
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

        // Checkboxes for download selection
        tbody.querySelectorAll('.hvt-main-chk').forEach(chk => {
            chk.addEventListener('click', e => e.stopPropagation()); // prevent row-click handler
            chk.addEventListener('change', () => {
                const id = chk.dataset.id;
                if (chk.checked) mainSelectedIds.add(id);
                else mainSelectedIds.delete(id);
                mainUpdateSelectionUI();
            });
        });

        // Per-row download buttons
        tbody.querySelectorAll('.hvt-dl-one-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tr = btn.closest('tr');
                const id = tr?.querySelector('.hvt-main-chk')?.dataset.id;
                if (!id || !db.voices[id]) return;
                mainDownloadOne(db.voices[id]);
            });
        });
    }

    // ─── Sync info footer ─────────────────────────────────────────────────────
    function updateSyncInfo() {
        const el = document.getElementById('hvt-sync-info');
        if (!el) return;
        if (db.lastSync) {
            const d = new Date(db.lastSync);
            const total = Object.keys(db.voices).length;
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

    // ─── Voice Design ─────────────────────────────────────────────────────────
    function openVoiceDesign() {
        const overlay = document.getElementById('hvt-vd-overlay');
        if (overlay) overlay.style.display = 'flex';
        vdRenderSavedList();
    }

    function closeVoiceDesign() {
        const overlay = document.getElementById('hvt-vd-overlay');
        if (overlay) overlay.style.display = 'none';
        if (vdAudioEl) { vdAudioEl.pause(); vdAudioEl = null; }
        document.querySelectorAll('.hvt-vd-preview-btn[data-playing="1"]')
            .forEach(b => { b.dataset.playing = ''; });
    }

    async function vdGenerate() {
        const promptEl  = document.getElementById('hvt-vd-prompt');
        const genBtn    = document.getElementById('hvt-vd-generate');
        const statusEl  = document.getElementById('hvt-vd-status');
        const optionsEl = document.getElementById('hvt-vd-options');

        const name   = 'Voice';
        const prompt = (promptEl.value || '').trim();
        if (!prompt) { showToast('请输入提示词', 'error'); return; }

        genBtn.disabled = true;
        genBtn.textContent = '⏳ 生成中…';
        statusEl.textContent = '';
        optionsEl.innerHTML = '';
        if (vdAudioEl) { vdAudioEl.pause(); vdAudioEl = null; }

        try {
            const data = await heygenApi('/v1/voice/voice_design/create', {
                method: 'POST',
                body: JSON.stringify({ name, prompt, prefer_stream: true }),
            });
            const { request_id, options } = data;
            if (!options || options.length === 0) throw new Error('未返回声音选项');

            optionsEl.innerHTML = options.map(opt => `
                <div class="hvt-vd-card">
                    <div class="hvt-vd-card-top">
                        <button class="hvt-vd-preview-btn" data-req="${esc(request_id)}" data-opt="${esc(opt.id)}" data-url="${esc(opt.audio_url || '')}" title="试听">
                            <svg class="ic-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                            <svg class="ic-stop" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
                        </button>
                        <span class="hvt-vd-opt-name" title="点击改名">${esc(opt.name)}</span>
                        <input class="hvt-vd-opt-name-input" value="${esc(opt.name)}">
                        <button class="hvt-vd-save-btn hvt-btn"
                            data-req="${esc(request_id)}" data-opt="${esc(opt.id)}">选用</button>
                    </div>
                </div>
            `).join('');

            // Preview buttons
            optionsEl.querySelectorAll('.hvt-vd-preview-btn').forEach(btn => {
                btn.addEventListener('click', () =>
                    vdPlayPreview(btn.dataset.req, btn.dataset.opt, btn));
            });

            // Click name → edit
            optionsEl.querySelectorAll('.hvt-vd-opt-name').forEach(span => {
                span.addEventListener('click', () => {
                    const inp = span.nextElementSibling;
                    span.style.display = 'none';
                    inp.style.display = 'block';
                    inp.focus(); inp.select();
                });
            });
            optionsEl.querySelectorAll('.hvt-vd-opt-name-input').forEach(inp => {
                const commit = () => {
                    const span = inp.previousElementSibling;
                    if (inp.value.trim()) span.textContent = inp.value.trim();
                    inp.style.display = 'none';
                    span.style.display = '';
                };
                inp.addEventListener('blur', commit);
                inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
            });

            // Save buttons
            optionsEl.querySelectorAll('.hvt-vd-save-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const card = btn.closest('.hvt-vd-card');
                    const nameSpan = card.querySelector('.hvt-vd-opt-name');
                    const nameInp  = card.querySelector('.hvt-vd-opt-name-input');
                    const displayName = (nameInp.style.display !== 'none'
                        ? nameInp.value : nameSpan.textContent).trim();
                    vdSave(btn.dataset.req, btn.dataset.opt, displayName, btn, card);
                });
            });

        } catch (e) {
            statusEl.textContent = '生成失败: ' + e.message;
            showToast('生成失败: ' + e.message, 'error', 4000);
        } finally {
            genBtn.disabled = false;
            genBtn.textContent = '⚡ 生成';
        }
    }

    async function vdPlayPreview(requestId, optionId, btn) {
        if (btn.dataset.playing === '1') {
            if (vdAudioEl) { vdAudioEl.pause(); vdAudioEl = null; }
            btn.dataset.playing = '';
            return;
        }
        document.querySelectorAll('.hvt-vd-preview-btn[data-playing="1"]')
            .forEach(b => { b.dataset.playing = ''; });
        if (vdAudioEl) { vdAudioEl.pause(); vdAudioEl = null; }

        btn.disabled = true;
        btn.dataset.loading = '1';
        try {
            const audioData = await vdPreviewStream(requestId, optionId); // Uint8Array
            btn.dataset.loading = '';
            btn.dataset.playing = '1';
            const blobUrl = URL.createObjectURL(new Blob([audioData], { type: 'audio/mpeg' }));
            vdAudioEl = new Audio(blobUrl);
            vdAudioEl.onended = () => { btn.dataset.playing = ''; URL.revokeObjectURL(blobUrl); vdAudioEl = null; };
            vdAudioEl.onerror = () => { btn.dataset.playing = ''; URL.revokeObjectURL(blobUrl); vdAudioEl = null; showToast('音频播放失败', 'error'); };
            await vdAudioEl.play();
        } catch (e) {
            btn.dataset.playing = '';
            btn.dataset.loading = '';
            showToast('试听失败: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function vdSave(requestId, optionId, displayName, btn, card) {
        btn.disabled = true;
        btn.textContent = '保存中…';
        try {
            const saved = await heygenApi('/v1/voice/voice_design/select', {
                method: 'POST',
                body: JSON.stringify({ request_id: requestId, option_id: optionId, is_hidden: false }),
            });
            const voiceId = saved.voice_id;

            if (displayName) {
                await heygenApi('/v1/voice/rename', {
                    method: 'POST',
                    body: JSON.stringify({ voice_id: voiceId, display_name: displayName }),
                });
            }

            // Add minimal entry to local db
            db.voices[voiceId] = Object.assign(db.voices[voiceId] || {}, {
                voice_id: voiceId,
                display_name: displayName || voiceId,
                language: LANGUAGE,
                locale: DEFAULT_LOCALE,
                gender: '',
                age: '',
                labels: [],
                preview_audio: '',
                existsOnHeygen: true,
                notes: '',
                source: 'ai_design',
            });
            saveDb();
            refreshFilters();
            renderTable();
            vdRenderSavedList();

            btn.textContent = '✅ 已选用';
            btn.disabled = true;
            btn.style.background = '#059669';
            btn.style.borderColor = '#059669';
            showToast(`✅ 已选用「${displayName}」`, 'success', 3000);
        } catch (e) {
            btn.disabled = false;
            btn.textContent = '选用';
            showToast('保存失败: ' + e.message, 'error', 4000);
        }
    }

    // ─── Voice Design: 头像 → 提示词 ──────────────────────────────────────────
    // HeyGen 把"分析人脸生成声音提示词"放在 GET /v1/avatar_group/photo.prompt。
    // 该接口要求一个用户真实拥有的 avatar_group_id（仅作载体，与图片无关），
    // 且 image_url 须是 HeyGen 能读取的地址；data:URL 会超 GET URL 长度上限，
    // 故先把图片 PUT 到 temp.create 给的 S3 预签名地址，再用返回的 s3:// 地址调用。
    async function vdEnsureAvatarGroupId() {
        if (vdAvatarGroupId) return vdAvatarGroupId;
        const data = await heygenApi('/v2/avatar_group.private.list?limit=8&page=1&display_type=LIST&look_limit=1');
        const groups = (data && data.avatar_groups_with_looks) || [];
        const id = groups.map(g => g.avatar_group && g.avatar_group.id).find(Boolean);
        if (!id) throw new Error('未找到可用的虚拟形象（avatar group），请先在 HeyGen 创建一个');
        vdAvatarGroupId = id;
        return id;
    }

    // 缩放图片到最长边 ≤ maxSide，输出 JPEG Blob（控制上传体积）
    function vdResizeImage(file, maxSide = 1024) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                let { width: w, height: h } = img;
                const scale = Math.min(1, maxSide / Math.max(w, h));
                w = Math.round(w * scale); h = Math.round(h * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片处理失败')), 'image/jpeg', 0.9);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取图片')); };
            img.src = url;
        });
    }

    // 上传图片 Blob 到 HeyGen 临时存储，返回可供 photo.prompt 使用的 s3:// 地址
    async function vdUploadPhoto(blob) {
        const data = await heygenApi('/v1/avatar_group/photo/temp.create?num_photos=1');
        const putUrl = data.upload_urls && data.upload_urls[0];
        const s3Url  = data.s3_urls && data.s3_urls[0];
        if (!putUrl || !s3Url) throw new Error('获取上传地址失败');
        const res = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'x-amz-server-side-encryption': 'AES256', 'Content-Type': 'image/jpeg' },
            body: blob,
        });
        if (!res.ok) throw new Error(`图片上传失败 HTTP ${res.status}`);
        return s3Url;
    }

    async function vdHandlePhotoFile(file) {
        const statusEl = document.getElementById('hvt-vd-photo-status');
        const thumbEl  = document.getElementById('hvt-vd-photo-thumb');
        const phEl     = document.getElementById('hvt-vd-photo-placeholder');
        const promptEl = document.getElementById('hvt-vd-prompt');
        if (!file) return;

        // 缩略图预览
        const previewUrl = URL.createObjectURL(file);
        thumbEl.src = previewUrl;
        thumbEl.style.display = 'block';
        if (phEl) phEl.style.display = 'none';

        statusEl.textContent = '⏳ 分析头像中…';
        statusEl.className = 'hvt-vd-photo-busy';
        try {
            const groupId = await vdEnsureAvatarGroupId();
            const blob    = await vdResizeImage(file);
            const s3Url   = await vdUploadPhoto(blob);
            const path    = `/v1/avatar_group/photo.prompt?avatar_group_id=${encodeURIComponent(groupId)}&image_url=${encodeURIComponent(s3Url)}`;
            const data    = await heygenApi(path);
            const prompt  = data && data.prompt;
            if (!prompt) throw new Error('未返回提示词');
            promptEl.value = prompt;
            statusEl.textContent = '✅ 已生成提示词，可编辑后点「生成」';
            statusEl.className = 'hvt-vd-photo-ok';
            showToast('✅ 已根据头像生成提示词', 'success', 3000);
        } catch (e) {
            statusEl.textContent = '分析失败: ' + e.message;
            statusEl.className = 'hvt-vd-photo-err';
            showToast('头像分析失败: ' + e.message, 'error', 4000);
        }
    }

    function vdRenderSavedList() {
        const el = document.getElementById('hvt-vd-saved-list');
        if (!el) return;
        const aiVoices = Object.values(db.voices)
            .filter(v => v.source === 'ai_design')
            .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
        if (aiVoices.length === 0) {
            el.innerHTML = '<span class="hvt-vd-saved-empty">暂无已生成的声音</span>';
            return;
        }
        el.innerHTML = aiVoices.map(v => `
            <div class="hvt-vd-saved-row">
                <span class="hvt-vd-saved-name">${esc(v.display_name || v.voice_id)}</span>
                <span class="hvt-vd-saved-id">${esc(v.voice_id)}</span>
            </div>
        `).join('');
    }

    // ─── My Voices ────────────────────────────────────────────────────────────
    // API: GET /v2/pacific/voice_clone/voice.list?page_size=N
    // Response: { code:100, data:{ data:[{ voice_id, display_name, gender, language,
    //             preview:{ movio:"s3://heygen-product/..." }, ... }] } }
    // Audio:  preview.movio  →  s3://heygen-product/PATH  →  https://static.heygen.ai/PATH

    function s3ToHttps(s3url) {
        if (!s3url) return '';
        if (s3url.startsWith('https://') || s3url.startsWith('http://')) return s3url;
        const m = s3url.match(/^s3:\/\/heygen-product\/(.+)$/);
        return m ? `https://static.heygen.ai/${m[1]}` : '';
    }

    function mvGetAudioUrl(v) {
        // preview.movio is the confirmed field from the API
        const raw = (v.preview && v.preview.movio)
            || v.preview_audio || v.audio_url || v.sample_audio || v.sample || '';
        return s3ToHttps(raw);
    }

    function openMyVoices() {
        const overlay = document.getElementById('hvt-mv-overlay');
        if (overlay) { overlay.style.display = 'flex'; mvSetViewMode('self'); }
    }

    function closeMyVoices() {
        const overlay = document.getElementById('hvt-mv-overlay');
        if (overlay) overlay.style.display = 'none';
        mvStopAudio();
    }

    function mvSetViewMode(mode) {
        mvViewMode = mode;
        mvStopAudio();
        const btn = document.getElementById('hvt-mv-space-toggle');
        const title = document.getElementById('hvt-mv-title');
        const expBtn = document.getElementById('hvt-mv-exp');
        if (mode === 'space') {
            if (btn) { btn.textContent = '🎤 本号自带'; btn.classList.add('hvt-btn-primary'); }
            if (title) title.textContent = '🌐 社区声音';
            if (expBtn) expBtn.style.display = 'none'; // 到期清理只针对本号自带
            if (!spaceVoices.length && !spaceFetchRunning) spacePrefetch();
            const searchEl = document.getElementById('hvt-mv-search');
            if (searchEl) searchEl.value = '';
            mvRenderList();
        } else {
            if (btn) { btn.textContent = '🌐 社区声音'; btn.classList.remove('hvt-btn-primary'); }
            if (title) title.textContent = '🎤 我的声音';
            if (expBtn) expBtn.style.display = '';
            mvLoadVoices();
        }
    }

    // ─── Share Voice (batch email) ──────────────────────────────────────────────
    function mvExtractEmails(text) {
        const matches = (text || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
        return [...new Set(matches)];
    }

    async function mvOpenShare(v) {
        mvShareVoice = v;
        mvShareDone = [];
        const overlay = document.getElementById('hvt-mv-share-overlay');
        if (!overlay) return;
        const id = v.voice_id || '';
        const name = v.display_name || id;
        document.getElementById('hvt-mv-share-voice').innerHTML =
            `共享声音：<b>${esc(name)}</b> <span style="color:#94a3b8">${esc(id.slice(0,8))}…</span>`;
        const ta = document.getElementById('hvt-mv-share-ta');
        const status = document.getElementById('hvt-mv-share-status');
        if (ta) ta.value = '';
        if (status) status.textContent = '';
        mvShareRenderDone();
        overlay.style.display = 'flex';
        if (ta) ta.focus();

        // 拉取该声音当前所有已共享邮箱（shared_resources 的键）
        const section = document.getElementById('hvt-mv-share-done');
        const countEl = document.getElementById('hvt-mv-share-done-count');
        section.style.display = 'block';
        countEl.textContent = '加载已共享邮箱…';
        try {
            const data = await heygenApi(`/v1/acl/voice/${encodeURIComponent(id)}`);
            if (mvShareVoice !== v) return; // 弹框已关闭或切换
            const existing = Object.keys(data?.shared_resources || {});
            mvShareDone = [...new Set([...existing, ...mvShareDone])];
            mvShareRenderDone();
        } catch (e) {
            if (mvShareVoice !== v) return;
            if (!mvShareDone.length) countEl.textContent = '已共享邮箱加载失败';
        }
    }

    function mvCloseShare() {
        const overlay = document.getElementById('hvt-mv-share-overlay');
        if (overlay) overlay.style.display = 'none';
        mvShareVoice = null;
        mvShareDone = [];
    }

    // Render the "本次已共享" list (highlighted) with per-row checkbox + delete
    function mvShareRenderDone() {
        const section = document.getElementById('hvt-mv-share-done');
        const listEl = document.getElementById('hvt-mv-share-done-list');
        if (!section || !listEl) return;

        if (!mvShareDone.length) {
            section.style.display = 'none';
            listEl.innerHTML = '';
            return;
        }
        section.style.display = 'block';
        document.getElementById('hvt-mv-share-done-count').textContent = `已共享 ${mvShareDone.length} 个`;

        listEl.innerHTML = '';
        const frag = document.createDocumentFragment();
        mvShareDone.forEach(email => {
            const row = document.createElement('div');
            row.className = 'hvt-mv-share-done-row';
            row.innerHTML = `
                <input type="checkbox" class="hvt-mv-share-cb">
                <span class="hvt-mv-share-email" title="${esc(email)}">${esc(email)}</span>
                <button class="hvt-mv-share-del hvt-btn" title="取消共享">✕</button>
            `;
            row.querySelector('.hvt-mv-share-del').addEventListener('click', () => mvShareRemove([email]));
            frag.appendChild(row);
        });
        listEl.appendChild(frag);
        const selAll = document.getElementById('hvt-mv-share-selall');
        if (selAll) selAll.checked = false;
    }

    async function mvShareGo() {
        if (!mvShareVoice) return;
        const ta = document.getElementById('hvt-mv-share-ta');
        const status = document.getElementById('hvt-mv-share-status');
        const btn = document.getElementById('hvt-mv-share-go');
        const emails = mvExtractEmails(ta.value).filter(e => !mvShareDone.includes(e));

        if (!emails.length) { status.textContent = '⚠️ 未检测到有效邮箱（或都已共享）'; return; }

        const voiceId = mvShareVoice.voice_id || '';
        btn.disabled = true;
        let shared = 0, failed = 0;

        for (let i = 0; i < emails.length; i++) {
            status.textContent = `共享中 ${i + 1}/${emails.length}…`;
            try {
                await heygenApi('/v1/share_resources', {
                    method: 'POST',
                    body: JSON.stringify({
                        resource_type: 'VOICE',
                        resource_id: voiceId,
                        destination_email_address: emails[i],
                    }),
                });
                shared++;
                mvShareDone.push(emails[i]);
                mvShareRenderDone();
            } catch (e) {
                failed++;
            }
            // 4~8 秒随机延迟，避免操作太快被服务器拒绝
            if (i < emails.length - 1) await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));
        }

        status.textContent = failed > 0 ? `✅ 已共享 ${shared} 个，${failed} 个失败` : `✅ 已共享 ${shared} 个`;
        if (shared > 0) ta.value = '';
        btn.disabled = false;
    }

    // 可被「停止」立即打断的等待
    function mvShareSleep(ms) {
        return new Promise(resolve => {
            const t = setTimeout(() => { mvShareWaitCancel = null; resolve(); }, ms);
            mvShareWaitCancel = () => { clearTimeout(t); mvShareWaitCancel = null; resolve(); };
        });
    }

    // Un-share one or more emails (used by single ✕ and 删除选中)
    async function mvShareRemove(emails) {
        if (!mvShareVoice || !emails.length) return;
        const voiceId = mvShareVoice.voice_id || '';
        const status = document.getElementById('hvt-mv-share-done-status');
        const delBtn = document.getElementById('hvt-mv-share-delsel');
        const stopBtn = document.getElementById('hvt-mv-share-stop');
        mvShareAbort = false;
        if (delBtn) delBtn.disabled = true;
        if (stopBtn && emails.length > 1) stopBtn.style.display = 'inline-flex';

        let removed = 0, failed = 0;
        for (let i = 0; i < emails.length; i++) {
            if (mvShareAbort) break;
            if (status) status.textContent = `删除中 ${i + 1}/${emails.length}…`;
            try {
                await heygenApi('/v1/share_resources/remove', {
                    method: 'POST',
                    body: JSON.stringify({
                        resource_type: 'VOICE',
                        resource_id: voiceId,
                        destination_email_address: emails[i],
                    }),
                });
                mvShareDone = mvShareDone.filter(e => e !== emails[i]);
                removed++;
                mvShareRenderDone();
            } catch (e) {
                failed++;
            }
            if (i < emails.length - 1 && !mvShareAbort) await mvShareSleep(4000 + Math.random() * 4000);
        }

        if (stopBtn) stopBtn.style.display = 'none';
        if (delBtn) delBtn.disabled = false;
        if (status) {
            const tail = mvShareAbort ? '（已停止）' : '';
            status.textContent = (failed > 0 ? `已取消 ${removed} 个，${failed} 个失败` : `已取消 ${removed} 个`) + tail;
        }
    }

    // ─── Share Expiry Cleanup（分享到期清理） ───────────────────────────────
    // HeyGen 不返回分享创建时间，所以用本地台账记录每个 (voiceId::email) 的首次
    // 发现时间，以此判断分享存在了多久。撤销复用 share_resources/remove 接口。
    function expReadLedger() {
        try { return JSON.parse(localStorage.getItem(EXP_LEDGER_KEY)) || {}; } catch { return {}; }
    }
    function expWriteLedger(l) {
        try { localStorage.setItem(EXP_LEDGER_KEY, JSON.stringify(l)); } catch {}
    }
    function expGetDays() {
        const n = parseInt(localStorage.getItem(EXP_DAYS_KEY), 10);
        return Number.isFinite(n) && n > 0 ? n : EXP_DAYS_DEFAULT;
    }
    function expSetDays(n) {
        if (Number.isFinite(n) && n > 0) localStorage.setItem(EXP_DAYS_KEY, String(n));
    }
    function expReadWhitelist() {
        try { return JSON.parse(localStorage.getItem(EXP_WL_KEY)) || []; } catch { return []; }
    }
    function expWriteWhitelist(arr) {
        const clean = [...new Set(arr.map(e => (e || '').trim().toLowerCase()).filter(Boolean))];
        try { localStorage.setItem(EXP_WL_KEY, JSON.stringify(clean)); } catch {}
    }

    async function expGetMyUsername() {
        if (expMyUsername) return expMyUsername;
        try { const d = await heygenApi('/v1/user.get'); expMyUsername = d?.username || null; } catch { expMyUsername = null; }
        return expMyUsername;
    }

    // Scan own voices, refresh the ledger (record new shares, drop vanished
    // ones), and return non-whitelisted rows sorted oldest-first.
    async function expScan() {
        const me = await expGetMyUsername();
        const voices = await mvFetchAllVoices();
        const ledger = expReadLedger();
        const wl = new Set(expReadWhitelist());
        const now = Date.now();
        const seen = new Set();
        const rows = [];
        for (const v of voices) {
            if (me && v.creator_username !== me) continue; // 只能撤销自己创建的声音
            for (const email of Object.keys(v.spaces_or_users_shared_to || {})) {
                const key = v.voice_id + '::' + email;
                seen.add(key);
                if (!ledger[key]) ledger[key] = now;
                if (wl.has(email.toLowerCase())) continue;
                const days = Math.floor((now - ledger[key]) / 86400000);
                rows.push({ voiceId: v.voice_id, voiceName: v.display_name || v.voice_id, email, days });
            }
        }
        for (const key of Object.keys(ledger)) if (!seen.has(key)) delete ledger[key];
        expWriteLedger(ledger);
        rows.sort((a, b) => b.days - a.days);
        expRows = rows;
        return rows;
    }

    // Batch un-share selected (voiceId,email) pairs. Same 4–8s randomized delay
    // + stop support as the manual share-remove flow.
    async function expRemoveSelected(items) {
        if (!items.length) return;
        const status = document.getElementById('hvt-exp-status');
        const delBtn = document.getElementById('hvt-exp-remove');
        const stopBtn = document.getElementById('hvt-exp-stop');
        expAbort = false;
        if (delBtn) delBtn.disabled = true;
        if (stopBtn) stopBtn.style.display = 'inline-flex';

        const ledger = expReadLedger();
        let removed = 0, failed = 0;
        for (let i = 0; i < items.length; i++) {
            if (expAbort) break;
            if (status) status.textContent = `撤销中 ${i + 1}/${items.length}…`;
            try {
                await heygenApi('/v1/share_resources/remove', {
                    method: 'POST',
                    body: JSON.stringify({
                        resource_type: 'VOICE',
                        resource_id: items[i].voiceId,
                        destination_email_address: items[i].email,
                    }),
                });
                delete ledger[items[i].voiceId + '::' + items[i].email];
                expWriteLedger(ledger);
                removed++;
            } catch (e) { failed++; }
            if (i < items.length - 1 && !expAbort) await mvShareSleep(4000 + Math.random() * 4000);
        }
        if (stopBtn) stopBtn.style.display = 'none';
        if (delBtn) delBtn.disabled = false;
        const tail = expAbort ? '（已停止）' : '';
        if (status) status.textContent = (failed > 0 ? `已撤销 ${removed} 个，${failed} 个失败` : `已撤销 ${removed} 个`) + tail;
        await expRefresh();
    }

    function openExpPanel() {
        const overlay = document.getElementById('hvt-exp-overlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        const daysEl = document.getElementById('hvt-exp-days');
        if (daysEl) daysEl.value = expGetDays();
        const autoEl = document.getElementById('hvt-exp-auto');
        if (autoEl) autoEl.checked = expGetAuto();
        expRenderWhitelist();
        expRefresh();
    }
    function closeExpPanel() {
        const overlay = document.getElementById('hvt-exp-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    async function expRefresh() {
        const listEl = document.getElementById('hvt-exp-list');
        const status = document.getElementById('hvt-exp-status');
        if (listEl) listEl.innerHTML = '<div class="hvt-mv-empty">扫描中…</div>';
        try {
            await expScan();
            expRender();
            if (status) status.textContent = '';
        } catch (e) {
            if (listEl) listEl.innerHTML = `<div class="hvt-mv-empty" style="color:#dc2626">扫描失败: ${esc(e.message)}</div>`;
        }
    }

    function expRender() {
        const listEl = document.getElementById('hvt-exp-list');
        const countEl = document.getElementById('hvt-exp-count');
        if (!listEl) return;
        const days = expGetDays();
        const expiredCount = expRows.filter(r => r.days >= days).length;
        if (countEl) countEl.textContent = `共 ${expRows.length} 个分享 · ${expiredCount} 个已超 ${days} 天`;
        if (!expRows.length) {
            listEl.innerHTML = '<div class="hvt-mv-empty">没有检测到你分享出去的声音</div>';
            return;
        }
        listEl.innerHTML = '';
        const frag = document.createDocumentFragment();
        expRows.forEach((r, idx) => {
            const expired = r.days >= days;
            const row = document.createElement('div');
            row.className = 'hvt-exp-row' + (expired ? ' hvt-exp-expired' : '');
            row.innerHTML = `
                <input type="checkbox" class="hvt-exp-cb" data-idx="${idx}" ${expired ? 'checked' : ''}>
                <span class="hvt-exp-voice" title="${esc(r.voiceName)}">${esc(r.voiceName)}</span>
                <span class="hvt-exp-email" title="${esc(r.email)}">${esc(r.email)}</span>
                <span class="hvt-exp-days">${r.days} 天</span>
                <button class="hvt-exp-wl-add" data-email="${esc(r.email)}" title="加入白名单（永不列出）">☆</button>
            `;
            frag.appendChild(row);
        });
        listEl.appendChild(frag);
        const expBtn = document.getElementById('hvt-exp-remove-expired');
        if (expBtn) {
            expBtn.textContent = expiredCount ? `撤销全部超期（${expiredCount}）` : '撤销全部超期';
            expBtn.disabled = expiredCount === 0;
        }
        const selAll = document.getElementById('hvt-exp-selall');
        if (selAll) selAll.checked = expiredCount > 0;
    }

    function expRenderWhitelist() {
        const wlListEl = document.getElementById('hvt-exp-wl-list');
        if (!wlListEl) return;
        const wl = expReadWhitelist();
        if (!wl.length) { wlListEl.innerHTML = '<span class="hvt-exp-wl-empty">（白名单为空）</span>'; return; }
        wlListEl.innerHTML = '';
        wl.forEach(email => {
            const chip = document.createElement('span');
            chip.className = 'hvt-exp-wl-chip';
            chip.innerHTML = `<span>${esc(email)}</span><button class="hvt-exp-wl-del" data-email="${esc(email)}" title="移出白名单">✕</button>`;
            wlListEl.appendChild(chip);
        });
    }

    function expWhitelistAdd(emails) {
        if (!emails || !emails.length) return;
        expWriteWhitelist([...expReadWhitelist(), ...emails]);
        expRenderWhitelist();
        expRefresh();
    }
    function expWhitelistRemove(email) {
        expWriteWhitelist(expReadWhitelist().filter(e => e !== (email || '').toLowerCase()));
        expRenderWhitelist();
        expRefresh();
    }

    function expGetAuto() { return localStorage.getItem(EXP_AUTO_KEY) === '1'; }
    function expSetAuto(on) { localStorage.setItem(EXP_AUTO_KEY, on ? '1' : '0'); }

    // Auto-clean (opt-in): on each HeyGen load, silently revoke shares that have
    // exceeded the configured age. Throttled to once per 30 min and guarded
    // against concurrent runs (multiple tabs).
    async function expAutoCleanRun() {
        if (!expGetAuto() || expAutoRunning) return;
        const last = parseInt(localStorage.getItem(EXP_AUTO_LAST_KEY), 10) || 0;
        if (Date.now() - last < 30 * 60 * 1000) return; // 30 分钟节流
        expAutoRunning = true;
        localStorage.setItem(EXP_AUTO_LAST_KEY, String(Date.now()));
        try {
            await expScan();
            const days = expGetDays();
            const items = expRows.filter(r => r.days >= days).map(r => ({ voiceId: r.voiceId, email: r.email }));
            if (items.length) await expRemoveSelected(items);
        } catch {}
        expAutoRunning = false;
    }

    function mvStopAudio() {
        if (mvAudioEl) { try { mvAudioEl.pause(); } catch (e) { } mvAudioEl = null; }
        if (mvPlayingId) {
            const btn = document.querySelector(`.hvt-mv-play-btn[data-mv-id="${CSS.escape(mvPlayingId)}"]`);
            if (btn) btn.dataset.playing = '';
            mvPlayingId = null;
        }
    }

    // Stream preview audio from HeyGen API → Uint8Array of MP3 bytes
    // Endpoint: POST /v2/online/voice.stream_preview  body: {voice_id, language}
    // Response: application/x-ndjson, each line = {audio_bytes: base64} | heartbeat
    async function mvStreamPreview(voiceId, language) {
        const res = await fetch(`${API_BASE}/v2/online/voice.stream_preview`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                ...HVT_FETCH_HEADERS,
                'content-type': 'application/json',
                'accept': 'application/x-ndjson',
            },
            body: JSON.stringify({ voice_id: voiceId, language: language || 'English' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const chunks = [];
        let totalLen = 0;
        for (const line of text.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            try {
                const obj = JSON.parse(t);
                if (obj.audio_bytes) {
                    const bin = atob(obj.audio_bytes);
                    const arr = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                    chunks.push(arr);
                    totalLen += arr.length;
                }
            } catch { /* skip non-JSON or heartbeat lines */ }
        }
        if (totalLen === 0) throw new Error('无音频数据');
        const combined = new Uint8Array(totalLen);
        let off = 0;
        for (const c of chunks) { combined.set(c, off); off += c.length; }
        return combined;
    }

    async function mvTogglePlay(v) {
        const id = v.voice_id;
        if (mvPlayingId === id) { mvStopAudio(); return; }
        mvStopAudio();
        const btn = document.querySelector(`.hvt-mv-play-btn[data-mv-id="${CSS.escape(id)}"]`);
        if (btn) { btn.dataset.loading = '1'; btn.disabled = true; delete btn.dataset.errored; }
        try {
            const audioBytes = await mvStreamPreview(id, v.language || 'English');
            const blob = new Blob([audioBytes], { type: 'audio/mpeg' });
            const blobUrl = URL.createObjectURL(blob);
            mvPlayingId = id;
            if (btn) { btn.dataset.loading = ''; btn.dataset.playing = '1'; btn.disabled = false; }
            const a = new Audio(blobUrl);
            a.onended = () => { mvStopAudio(); URL.revokeObjectURL(blobUrl); };
            a.onerror = () => {
                if (mvPlayingId === id) mvStopAudio();
                if (btn) { btn.dataset.errored = '1'; btn.title = '播放失败'; }
                URL.revokeObjectURL(blobUrl);
            };
            a.play().catch(() => { if (mvPlayingId === id) mvStopAudio(); URL.revokeObjectURL(blobUrl); });
            mvAudioEl = a;
        } catch (e) {
            if (btn) { btn.dataset.loading = ''; btn.dataset.errored = '1'; btn.disabled = false; btn.title = e.message; }
            showToast(`播放失败: ${e.message}`, 'error', 3000);
        }
    }

    async function mvDownloadOne(v) {
        const name = (v.display_name || v.voice_id || 'voice').replace(/[\\/:*?"<>|]/g, '_');
        try {
            const audioBytes = await mvStreamPreview(v.voice_id, v.language || 'English');
            const blob = new Blob([audioBytes], { type: 'audio/mpeg' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${name}.mp3`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
            return true;
        } catch (e) {
            showToast(`下载「${name}」失败: ${e.message}`, 'error', 4000);
            return false;
        }
    }

    async function mvDownloadSelected() {
        const sel = mvActiveSel();
        const voices = mvActiveVoices();
        const pool = sel.size > 0
            ? voices.filter(v => sel.has(v.voice_id || ''))
            : [...voices];
        if (pool.length === 0) { showToast('没有可下载的音频', 'error'); return; }
        const dlSelBtn = document.getElementById('hvt-mv-dl-sel');
        const dlAllBtn = document.getElementById('hvt-mv-dl-all');
        const activeBtn = sel.size > 0 ? dlSelBtn : dlAllBtn;
        if (activeBtn) activeBtn.disabled = true;
        let done = 0, failed = 0;
        for (const v of pool) {
            if (activeBtn) activeBtn.textContent = `下载中 ${done + failed + 1}/${pool.length}…`;
            if (await mvDownloadOne(v)) done++;
            else failed++;
            await new Promise(r => setTimeout(r, 700));
        }
        if (dlAllBtn) { dlAllBtn.disabled = false; dlAllBtn.textContent = '⬇ 全部下载'; }
        if (dlSelBtn) { dlSelBtn.disabled = false; mvUpdateSelectionUI(); }
        showToast(failed > 0
            ? `完成：${done} 成功，${failed} 失败`
            : `✅ 已下载 ${done} 个音频`, 'success', 3000);
    }

    function mainUpdateSelectionUI() {
        const bar = document.getElementById('hvt-dl-bar');
        const info = document.getElementById('hvt-dl-bar-info');
        if (!bar) return;
        const n = mainSelectedIds.size;
        bar.style.display = n > 0 ? 'flex' : 'none';
        if (info) info.textContent = `已选 ${n} 条`;
    }

    async function mainDownloadOne(v) {
        const name = (v.display_name || v.voice_id || 'voice').replace(/[\\/:*?"<>|]/g, '_');
        try {
            const audioBytes = await mvStreamPreview(v.voice_id, v.language || 'English');
            const blob = new Blob([audioBytes], { type: 'audio/mpeg' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${name}.mp3`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
            return true;
        } catch (e) {
            showToast(`下载「${name}」失败: ${e.message}`, 'error', 4000);
            return false;
        }
    }

    async function mainDownloadSelected() {
        const ids = [...mainSelectedIds];
        if (ids.length === 0) { showToast('请先勾选要下载的人声', 'error'); return; }
        const pool = ids.map(id => db.voices[id]).filter(Boolean);
        const btn = document.getElementById('hvt-dl-bar-btn');
        if (btn) btn.disabled = true;
        let done = 0, failed = 0;
        for (const v of pool) {
            if (btn) btn.textContent = `下载中 ${done + failed + 1}/${pool.length}…`;
            if (await mainDownloadOne(v)) done++;
            else failed++;
            await new Promise(r => setTimeout(r, 500));
        }
        if (btn) { btn.disabled = false; btn.textContent = '⬇ 下载已选'; }
        showToast(failed > 0 ? `完成：${done} 成功，${failed} 失败` : `✅ 已下载 ${done} 个音频`, 'success', 3000);
    }

    // Batch-delete selected voices — only ones the current user created.
    // Endpoint: POST /v1/pacific/voice.delete  body {voice_id}
    async function mvDeleteSelected() {
        if (mvViewMode === 'space') return spaceDeleteSelected();
        if (mvDelRunning) return;
        const ids = [...mvSelectedIds];
        if (!ids.length) return;
        const me = await expGetMyUsername();
        const targets = mvVoices.filter(v => ids.includes(v.voice_id || ''));
        const mine = targets.filter(v => !me || v.creator_username === me);
        const notMine = targets.length - mine.length;
        if (!mine.length) { showToast('选中的声音都不是你创建的，无法删除', 'error', 3500); return; }

        let msg = `确定永久删除 ${mine.length} 个你创建的声音？此操作不可逆！\n\n`
            + mine.slice(0, 12).map(v => '· ' + (v.display_name || v.voice_id)).join('\n')
            + (mine.length > 12 ? `\n…等共 ${mine.length} 个` : '');
        if (notMine) msg += `\n\n（选中的另有 ${notMine} 个是他人分享给你的，会自动跳过）`;
        if (!confirm(msg)) return;

        const delBtn = document.getElementById('hvt-mv-del-sel');
        mvDelRunning = true; mvDelAbort = false;
        let removed = 0, failed = 0;
        for (let i = 0; i < mine.length; i++) {
            if (mvDelAbort) break;
            if (delBtn) delBtn.textContent = `■ 停止 (${i + 1}/${mine.length})`;
            try {
                await heygenApi('/v1/pacific/voice.delete', { method: 'POST', body: JSON.stringify({ voice_id: mine[i].voice_id }) });
                mvSelectedIds.delete(mine[i].voice_id);
                mvVoices = mvVoices.filter(x => x.voice_id !== mine[i].voice_id);
                removed++;
            } catch (e) { failed++; }
            if (i < mine.length - 1 && !mvDelAbort) await mvShareSleep(1500 + Math.random() * 1500);
        }
        try { localStorage.setItem(MV_CACHE_KEY, JSON.stringify({ ts: Date.now(), voices: mvVoices })); } catch {}
        mvDelRunning = false;
        mvRenderList();
        const tail = mvDelAbort ? '（已停止）' : '';
        showToast(failed ? `已删除 ${removed} 个，${failed} 个失败${tail}` : `✅ 已删除 ${removed} 个声音${tail}`, failed ? 'error' : 'success', 3500);
    }

    function mvUpdateSelectionUI() {
        const dlSelBtn = document.getElementById('hvt-mv-dl-sel');
        const selCountEl = document.getElementById('hvt-mv-sel-count');
        if (!dlSelBtn) return;
        const n = mvActiveSel().size;
        dlSelBtn.style.display = n > 0 ? 'inline-flex' : 'none';
        dlSelBtn.textContent = `⬇ 下载已选 (${n})`;
        const delSelBtn = document.getElementById('hvt-mv-del-sel');
        if (delSelBtn) {
            delSelBtn.style.display = n > 0 ? 'inline-flex' : 'none';
            if (!mvDelRunning && !spaceDelRunning) delSelBtn.textContent = `🗑 删除选中 (${n})`;
        }
        if (selCountEl) selCountEl.textContent = n > 0 ? `已选 ${n} 个` : '';
    }

    // default_voice_engine → 展示用标签（短名 / 全名 / 配色 class）
    function mvEngineInfo(e) {
        switch ((e || '').trim()) {
            case 'elevenLabsV3': return { short: '11Labs v3', full: 'ElevenLabs v3', cls: 'eng-elv3' };
            case 'elevenLabs':   return { short: '11Labs',    full: 'ElevenLabs',    cls: 'eng-el' };
            case 'panda':        return { short: 'Panda',     full: 'Panda',         cls: 'eng-panda' };
            case 'fish':         return { short: 'Fish',      full: 'Fish',          cls: 'eng-fish' };
            case 'auto':         return { short: 'Auto',      full: 'Auto（自动选择）', cls: 'eng-auto' };
            default: return e ? { short: e, full: e, cls: 'eng-auto' } : null;
        }
    }

    // 当前视图对应的数据集与选择集（self=本号自带 / space=社区）
    function mvActiveVoices() { return mvViewMode === 'space' ? spaceVoices : mvVoices; }
    function mvActiveSel()    { return mvViewMode === 'space' ? spaceSelectedIds : mvSelectedIds; }

    function mvRenderList() {
        if (mvViewMode === 'space') return spaceRenderList();
        const listEl = document.getElementById('hvt-mv-list');
        if (!listEl) return;

        const q = (document.getElementById('hvt-mv-search')?.value || '').toLowerCase().trim();
        const visible = q
            ? mvVoices.filter(v => (v.display_name || '').toLowerCase().includes(q) || (v.voice_id || '').toLowerCase().includes(q))
            : mvVoices;

        const countEl = document.getElementById('hvt-mv-count');
        if (countEl) countEl.textContent = q ? `显示 ${visible.length} / 共 ${mvVoices.length} 个` : `共 ${mvVoices.length} 个声音`;

        if (visible.length === 0) {
            listEl.innerHTML = `<div class="hvt-mv-empty">${mvVoices.length === 0 ? '没有找到声音' : '无匹配结果'}</div>`;
            return;
        }
        listEl.innerHTML = '';
        mvSelectedIds.clear();
        mvUpdateSelectionUI();
        const frag = document.createDocumentFragment();
        visible.forEach(v => {
            const id = v.voice_id || '';
            const name = v.display_name || id;
            const gender = (v.gender || '').toLowerCase();
            const genderIcon = gender === 'female' ? '♀' : (gender === 'male' ? '♂' : '');
            const lang = v.language || '';
            const eng = mvEngineInfo(v.default_voice_engine);

            const row = document.createElement('div');
            row.className = 'hvt-mv-row';
            row.innerHTML = `
                <input type="checkbox" class="hvt-mv-chk" title="选择下载">
                <button class="hvt-mv-play-btn" data-mv-id="${esc(id)}" title="试听（需几秒加载）">
                    <svg class="ic-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                    <svg class="ic-stop" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
                    <svg class="ic-spin" viewBox="0 0 24 24" style="display:none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="28" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
                </button>
                <span class="hvt-mv-name" title="${esc(name)}">${esc(name)}</span>
                ${genderIcon ? `<span class="hvt-mv-gender ${gender === 'female' ? 'hvt-f' : 'hvt-m'}">${genderIcon}</span>` : ''}
                ${lang ? `<span class="hvt-mv-locale">${esc(lang)}</span>` : ''}
                ${eng ? `<span class="hvt-mv-engine ${eng.cls}" title="引擎: ${esc(eng.full)}">${esc(eng.short)}</span>` : ''}
                <span class="hvt-mv-id" title="${esc(id)}">${esc(id.slice(0,8))}…</span>
                <button class="hvt-mv-copy-btn hvt-btn" data-id="${esc(id)}" title="复制 Voice ID">复制ID</button>
                <button class="hvt-mv-share-btn hvt-btn" title="共享给团队成员（批量邮箱）">🔗 共享</button>
                <button class="hvt-mv-dl-btn hvt-btn" title="下载 MP3">⬇</button>
            `;
            const chk = row.querySelector('.hvt-mv-chk');
            chk.addEventListener('change', () => {
                if (chk.checked) mvSelectedIds.add(id);
                else mvSelectedIds.delete(id);
                mvUpdateSelectionUI();
            });
            row.querySelector('.hvt-mv-play-btn').addEventListener('click', () => mvTogglePlay(v));
            row.querySelector('.hvt-mv-copy-btn').addEventListener('click', e => {
                navigator.clipboard.writeText(id).then(() => {
                    const btn = e.currentTarget;
                    const orig = btn.textContent;
                    btn.textContent = '已复制';
                    setTimeout(() => { btn.textContent = orig; }, 1200);
                });
            });
            row.querySelector('.hvt-mv-share-btn').addEventListener('click', () => mvOpenShare(v));
            row.querySelector('.hvt-mv-dl-btn').addEventListener('click', () => mvDownloadOne(v));
            frag.appendChild(row);
        });
        listEl.appendChild(frag);
    }

    // 社区声音列表渲染：区分「自生成/分享进来」（文字+颜色），支持单选/多选删除。
    function spaceRenderList() {
        const listEl = document.getElementById('hvt-mv-list');
        if (!listEl) return;

        const q = (document.getElementById('hvt-mv-search')?.value || '').toLowerCase().trim();
        const visible = q
            ? spaceVoices.filter(v => (v.display_name || '').toLowerCase().includes(q) || (v.voice_id || '').toLowerCase().includes(q))
            : spaceVoices;

        const selfN = spaceVoices.filter(v => v._origin !== 'shared').length;
        const sharedN = spaceVoices.length - selfN;
        const countEl = document.getElementById('hvt-mv-count');
        if (countEl) {
            const base = q ? `显示 ${visible.length} / 共 ${spaceVoices.length} 个` : `共 ${spaceVoices.length} 个`;
            const loading = spaceFetchRunning ? ' · 后台加载中…' : '';
            countEl.textContent = `${base}（🟢自生成 ${selfN} · 🟠分享 ${sharedN}）${loading}`;
        }

        if (visible.length === 0) {
            listEl.innerHTML = `<div class="hvt-mv-empty">${spaceVoices.length === 0 ? (spaceFetchRunning ? '社区声音加载中…' : '没有社区声音') : '无匹配结果'}</div>`;
            return;
        }
        listEl.innerHTML = '';
        spaceSelectedIds.clear();
        // 默认只勾选「你自己创建的」（方案甲）
        visible.forEach(v => { if (myUsername && v.creator_username === myUsername) spaceSelectedIds.add(v.voice_id); });
        mvUpdateSelectionUI();

        const frag = document.createDocumentFragment();
        visible.forEach(v => {
            const id = v.voice_id || '';
            const name = v.display_name || id;
            const gender = (v.gender || '').toLowerCase();
            const genderIcon = gender === 'female' ? '♀' : (gender === 'male' ? '♂' : '');
            const lang = v.language || '';
            const eng = mvEngineInfo(v.default_voice_engine);
            const isShared = v._origin === 'shared';
            const checked = myUsername && v.creator_username === myUsername;

            const row = document.createElement('div');
            row.className = 'hvt-mv-row';
            row.innerHTML = `
                <input type="checkbox" class="hvt-mv-chk" title="选择删除/下载" ${checked ? 'checked' : ''}>
                <button class="hvt-mv-play-btn" data-mv-id="${esc(id)}" title="试听（需几秒加载）">
                    <svg class="ic-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                    <svg class="ic-stop" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
                    <svg class="ic-spin" viewBox="0 0 24 24" style="display:none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="28" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
                </button>
                <span class="hvt-sp-origin ${isShared ? 'hvt-sp-shared' : 'hvt-sp-self'}" title="${isShared ? '由社区外账号分享进来' : '在本社区内创建'}">${isShared ? '分享进来' : '自生成'}</span>
                <span class="hvt-mv-name" title="${esc(name)}">${esc(name)}</span>
                ${genderIcon ? `<span class="hvt-mv-gender ${gender === 'female' ? 'hvt-f' : 'hvt-m'}">${genderIcon}</span>` : ''}
                ${lang ? `<span class="hvt-mv-locale">${esc(lang)}</span>` : ''}
                ${eng ? `<span class="hvt-mv-engine ${eng.cls}" title="引擎: ${esc(eng.full)}">${esc(eng.short)}</span>` : ''}
                <span class="hvt-mv-id" title="${esc(id)}">${esc(id.slice(0,8))}…</span>
                <button class="hvt-mv-copy-btn hvt-btn" data-id="${esc(id)}" title="复制 Voice ID">复制ID</button>
                <button class="hvt-mv-dl-btn hvt-btn" title="下载 MP3">⬇</button>
            `;
            const chk = row.querySelector('.hvt-mv-chk');
            chk.addEventListener('change', () => {
                if (chk.checked) spaceSelectedIds.add(id);
                else spaceSelectedIds.delete(id);
                mvUpdateSelectionUI();
            });
            row.querySelector('.hvt-mv-play-btn').addEventListener('click', () => mvTogglePlay(v));
            row.querySelector('.hvt-mv-copy-btn').addEventListener('click', e => {
                navigator.clipboard.writeText(id).then(() => {
                    const btn = e.currentTarget; const orig = btn.textContent;
                    btn.textContent = '已复制';
                    setTimeout(() => { btn.textContent = orig; }, 1200);
                });
            });
            row.querySelector('.hvt-mv-dl-btn').addEventListener('click', () => mvDownloadOne(v));
            frag.appendChild(row);
        });
        listEl.appendChild(frag);
    }

    // 社区声音批量删除（方案甲）：全部尝试删除，逐个上报成功/失败；
    // 自己创建的可删，他人/分享进来的若无权限会被后端拒绝并计为失败。
    async function spaceDeleteSelected() {
        if (spaceDelRunning) return;
        const ids = [...spaceSelectedIds];
        if (!ids.length) return;
        if (!myUsername) myUsername = await expGetMyUsername();
        const targets = spaceVoices.filter(v => ids.includes(v.voice_id || ''));
        const mine = targets.filter(v => v.creator_username === myUsername);
        const others = targets.length - mine.length;

        let msg = `确定永久删除选中的 ${targets.length} 个社区声音？此操作不可逆！\n\n`
            + `· 你创建的：${mine.length} 个（可删除）\n`
            + `· 他人/分享进来：${others} 个（将尝试删除，无权限会显示失败）`;
        if (!confirm(msg)) return;

        const delBtn = document.getElementById('hvt-mv-del-sel');
        spaceDelRunning = true; spaceDelAbort = false;
        let removed = 0, failed = 0;
        for (let i = 0; i < targets.length; i++) {
            if (spaceDelAbort) break;
            if (delBtn) delBtn.textContent = `■ 停止 (${i + 1}/${targets.length})`;
            const v = targets[i];
            try {
                await heygenApi('/v1/pacific/voice.delete', { method: 'POST', headers: v._space ? { 'x-space-id': v._space } : {}, body: JSON.stringify({ voice_id: v.voice_id }) });
                spaceSelectedIds.delete(v.voice_id);
                spaceVoices = spaceVoices.filter(x => x.voice_id !== v.voice_id);
                removed++;
            } catch (e) { failed++; }
            if (i < targets.length - 1 && !spaceDelAbort) await mvShareSleep(1500 + Math.random() * 1500);
        }
        try { localStorage.setItem(SPACE_CACHE_KEY, JSON.stringify({ ts: Date.now(), voices: spaceVoices, members: [...spaceMembers] })); } catch {}
        spaceDelRunning = false;
        mvRenderList();
        const tail = spaceDelAbort ? '（已停止）' : '';
        showToast(failed ? `已删除 ${removed} 个，${failed} 个失败${tail}` : `✅ 已删除 ${removed} 个声音${tail}`, failed ? 'error' : 'success', 4000);
    }

    function mvReadCache() {
        try {
            const raw = localStorage.getItem(MV_CACHE_KEY);
            if (!raw) return null;
            const c = JSON.parse(raw);
            if (!c || !Array.isArray(c.voices) || typeof c.ts !== 'number') return null;
            return c;
        } catch { return null; }
    }

    function mvCacheAgeText(ts) {
        const min = Math.floor((Date.now() - ts) / 60000);
        if (min < 1) return '刚刚';
        if (min < 60) return `${min} 分钟前`;
        const h = Math.floor(min / 60);
        return h < 24 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`;
    }

    async function mvLoadVoices(force = false) {
        const statusEl = document.getElementById('hvt-mv-status');
        const listEl   = document.getElementById('hvt-mv-list');
        const countEl  = document.getElementById('hvt-mv-count');
        const dlAllBtn = document.getElementById('hvt-mv-dl-all');
        if (!listEl) return;

        // 命中未过期缓存 → 秒开
        if (!force) {
            const c = mvReadCache();
            if (c && Date.now() - c.ts < MV_CACHE_TTL) {
                mvVoices = c.voices;
                if (dlAllBtn) dlAllBtn.disabled = false;
                if (statusEl) statusEl.textContent = `📦 缓存于 ${mvCacheAgeText(c.ts)} · 点「↺ 刷新」更新`;
                const searchEl = document.getElementById('hvt-mv-search');
                if (searchEl) searchEl.value = '';
                mvRenderList();
                return;
            }
        }

        if (statusEl) statusEl.textContent = '加载中…';
        if (dlAllBtn) dlAllBtn.disabled = true;
        listEl.innerHTML = '';
        mvVoices = [];

        try {
            // Fetch all pages using next_token param (verified working param name).
            // API returns page 1 again when exhausted, so use voice_id dedup as real terminator.
            let allVoices = [];
            let seenIds = new Set();
            let nextToken = null;
            for (let page = 0; page < 20; page++) {
                let url = `/v2/pacific/voice_clone/voice.list?page_size=50`;
                if (nextToken) url += `&next_token=${encodeURIComponent(nextToken)}`;
                const data = await heygenApi(url);
                const list = data.data || data.list || data.voices || [];
                const fresh = list.filter(v => v.voice_id && !seenIds.has(v.voice_id));
                if (fresh.length === 0) break;
                fresh.forEach(v => seenIds.add(v.voice_id));
                allVoices = allVoices.concat(fresh);
                nextToken = data.next_pagination_token || null;
                if (!nextToken) break;
            }

            mvVoices = allVoices;
            try { localStorage.setItem(MV_CACHE_KEY, JSON.stringify({ ts: Date.now(), voices: allVoices })); } catch {}
            if (statusEl) statusEl.textContent = '';
            if (dlAllBtn) dlAllBtn.disabled = false;
            const searchEl = document.getElementById('hvt-mv-search');
            if (searchEl) searchEl.value = '';
            mvRenderList();
        } catch (e) {
            if (statusEl) statusEl.textContent = '加载失败: ' + e.message;
            listEl.innerHTML = `<div class="hvt-mv-empty" style="color:#dc2626">加载失败: ${esc(e.message)}</div>`;
        }
    }

    // Fetch every page of the voice clone list. Returns the full voice array.
    async function mvFetchAllVoices() {
        let allVoices = [], seenIds = new Set(), nextToken = null;
        for (let page = 0; page < 20; page++) {
            let url = `/v2/pacific/voice_clone/voice.list?page_size=50`;
            if (nextToken) url += `&next_token=${encodeURIComponent(nextToken)}`;
            const data = await heygenApi(url);
            const list = data.data || data.list || data.voices || [];
            const fresh = list.filter(v => v.voice_id && !seenIds.has(v.voice_id));
            if (fresh.length === 0) break;
            fresh.forEach(v => seenIds.add(v.voice_id));
            allVoices = allVoices.concat(fresh);
            nextToken = data.next_pagination_token || null;
            if (!nextToken) break;
        }
        return allVoices;
    }

    // Populate mvVoices for the AIS panel. Cache-first for an instant open, then
    // ALWAYS revalidate in the background: voices shared by other accounts only
    // live in voice_clone/voice.list and are absent from an older cached snapshot,
    // so we must not wait for the 24h TTL to expire before they become searchable.
    async function mvEnsureCache() {
        const c = mvReadCache();
        if (c && mvVoices.length === 0) mvVoices = c.voices;
        try {
            const allVoices = await mvFetchAllVoices();
            mvVoices = allVoices;
            try { localStorage.setItem(MV_CACHE_KEY, JSON.stringify({ ts: Date.now(), voices: allVoices })); } catch {}
            // Panel still open → re-run the current search so freshly fetched
            // shared voices surface without the user touching the input again.
            const overlay = document.getElementById('hvt-ais-overlay');
            if (overlay && overlay.style.display !== 'none') {
                const searchEl = document.getElementById('hvt-ais-search');
                aisSearchVoices(searchEl ? searchEl.value : '');
            }
        } catch {}
    }

    // ─── 社区（Space）声音 ───────────────────────────────────────────────────
    // 根因：voice.list 不带 x-space-id 头时只返回分享到本人邮箱的声音；
    // 带上所属 Space 的 x-space-id 头才能拿到整个社区的声音。

    function spaceReadCache() {
        try {
            const c = JSON.parse(localStorage.getItem(SPACE_CACHE_KEY));
            if (!c || !Array.isArray(c.voices)) return null;
            return c;
        } catch { return null; }
    }

    async function fetchSpaces() {
        try {
            const d = await heygenApi('/v1/space.list');
            spacesList = (d.list || []).map(s => ({ id: s.space_id, name: s.space_name }));
        } catch { spacesList = []; }
        return spacesList;
    }

    async function fetchSpaceMembers(spaceId) {
        try {
            const d = await heygenApi('/v1/space/user.list?include_superadmins=true', { headers: { 'x-space-id': spaceId } });
            const arr = Array.isArray(d) ? d : (d.list || d.users || []); // user.list 的 data 直接是数组
            return arr.map(u => u.username).filter(Boolean);
        } catch { return []; }
    }

    // creator ∈ Space 成员 → 自生成；否则分享进来。
    // 成员名单暂未取到时，用 shared_to 是否含邮箱兜底判定。
    function classifyOrigin(v) {
        if (spaceMembers.size) return spaceMembers.has(v.creator_username) ? 'self' : 'shared';
        const keys = Object.keys(v.spaces_or_users_shared_to || {});
        return keys.some(k => k.includes('@')) ? 'shared' : 'self';
    }

    // 后台静默慢速拉取：所属 Space 逐页取，页间加随机延迟防风控，不设分页上限。
    async function spacePrefetch() {
        if (spaceFetchRunning) return;
        spaceFetchRunning = true;
        try {
            if (!myUsername) myUsername = await expGetMyUsername();
            await fetchSpaces();

            const memberSet = new Set();
            for (const sp of spacesList) {
                (await fetchSpaceMembers(sp.id)).forEach(u => memberSet.add(u));
                await mvShareSleep(600 + Math.random() * 600);
            }
            spaceMembers = memberSet;

            const collected = [];
            const seen = new Set();
            for (const sp of spacesList) {
                let token = null;
                for (;;) {                                   // 不设上限，拉到 next_token 为空
                    let url = '/v2/pacific/voice_clone/voice.list?page_size=50';
                    if (token) url += '&next_token=' + encodeURIComponent(token);
                    // 单页重试：瞬时错误（限流/非100）不应中断整段分页
                    let data = null;
                    for (let attempt = 0; attempt < 4 && !data; attempt++) {
                        try { data = await heygenApi(url, { headers: { 'x-space-id': sp.id } }); }
                        catch { await mvShareSleep(1500 + Math.random() * 1500); }
                    }
                    if (!data) break; // 多次重试仍失败 → 放弃该 Space（无 token 也无法继续）
                    const list = data.data || data.list || data.voices || [];
                    const fresh = list.filter(v => v.voice_id && !seen.has(v.voice_id));
                    if (!fresh.length) break;                 // 去重终止（API 耗尽会重复返回首页）
                    fresh.forEach(v => {
                        seen.add(v.voice_id);
                        v._space = sp.id;
                        v._spaceName = sp.name;
                        v._origin = classifyOrigin(v);
                        collected.push(v);
                    });
                    token = data.next_pagination_token || null;
                    if (!token) break;
                    await mvShareSleep(700 + Math.random() * 800); // 慢速防风控
                }
            }
            spaceVoices = collected;
            try { localStorage.setItem(SPACE_CACHE_KEY, JSON.stringify({ ts: Date.now(), voices: collected, members: [...spaceMembers] })); } catch {}

            // 面板已打开 → 刷新展示
            const aisOverlay = document.getElementById('hvt-ais-overlay');
            if (aisOverlay && aisOverlay.style.display !== 'none') {
                const s = document.getElementById('hvt-ais-search');
                aisSearchVoices(s ? s.value : '');
            }
            const mvOverlay = document.getElementById('hvt-mv-overlay');
            if (mvOverlay && mvOverlay.style.display !== 'none' && mvViewMode === 'space') mvRenderList();
        } finally {
            spaceFetchRunning = false;
        }
    }

    // 缓存命中即用，并在后台启动一次刷新（SWR）
    function spaceInit() {
        const c = spaceReadCache();
        if (c) {
            spaceVoices = c.voices;
            spaceMembers = new Set(c.members || []);
        }
        setTimeout(spacePrefetch, 3000);
    }

    // ─── AI Studio Quick Voice Switch ────────────────────────────────────────
    let aisSearchResults = [];
    let aisFallbackToken = 0; // incremented to cancel an in-flight fallback search

    // aisIsModalOpen: detects both AI Studio "Select Voice" and Avatar Shots "Choose avatar voice"
    function aisIsModalOpen() {
        return !![...document.querySelectorAll('[role="dialog"]')]
            .find(d => d.textContent.includes('Select Voice') || d.textContent.includes('Choose avatar voice') || d.textContent.includes('Select avatar voice'));
    }

    // On Avatar Shots, the Voice toolbar button has an #audio svg icon
    function aisFindAvatarShotsVoiceBtn() {
        return [...document.querySelectorAll('button')]
            .filter(b => !b.closest('#hvt-root') && !b.closest('#hvt-fab-strip'))
            .find(b => b.querySelector('svg use[href="#audio"]'));
    }

    // On the My Avatars detail page (/avatar/my-avatars/<id>) the voice control is
    // the top-bar dropdown (aria-haspopup="menu" + #chevron-down) sitting next to the
    // #play-s preview button. Clicking it opens a menu with "Switch voice".
    function aisFindAvatarVoiceMenuBtn() {
        const playBtn = [...document.querySelectorAll('button')]
            .find(b => !b.closest('#hvt-root') && !b.closest('#hvt-fab-strip') && b.querySelector('svg use[href="#play-s"]'));
        if (!playBtn) return null;
        let scope = playBtn.parentElement;
        for (let i = 0; i < 3 && scope; i++, scope = scope.parentElement) {
            const btn = [...scope.querySelectorAll('button[aria-haspopup="menu"]')]
                .find(b => b.querySelector('svg use[href="#chevron-down"]'));
            if (btn) return btn;
        }
        return null;
    }

    // aisBridgeSwitch: asks ais-bridge.js (MAIN world) to call onSelect via CustomEvent.
    // Passes full voiceObj so bridge can switch even if the voice isn't rendered in the modal.
    function aisBridgeSwitch(targetVoiceId) {
        const voiceObj = mvVoices.find(v => v.voice_id === targetVoiceId) || spaceVoices.find(v => v.voice_id === targetVoiceId) || db.voices[targetVoiceId] || null;
        return new Promise((resolve) => {
            const handler = (e) => {
                document.removeEventListener('hvt-ais-result', handler);
                clearTimeout(timer);
                resolve(e.detail);
            };
            const timer = setTimeout(() => {
                document.removeEventListener('hvt-ais-result', handler);
                resolve({ success: false });
            }, 5000);
            document.addEventListener('hvt-ais-result', handler);
            document.dispatchEvent(new CustomEvent('hvt-ais-switch', { detail: { id: targetVoiceId, voiceObj } }));
        });
    }

    async function aisQuickSwitch(targetVoiceId) {
        const statusEl = document.getElementById('hvt-ais-status');
        const setStatus = (msg, type = '') => {
            if (!statusEl) return;
            statusEl.textContent = msg;
            statusEl.dataset.type = type;
        };

        const isAvatarShots = location.pathname.includes('/avatar/');
        const isAIStudio   = location.pathname.includes('/create-v4/');
        if (!isAvatarShots && !isAIStudio) {
            setStatus('请在 AI Studio 或 Avatar Shots 页面使用', 'error');
            return;
        }

        setStatus('正在打开切换窗口…');

        if (!aisIsModalOpen()) {
            if (isAvatarShots) {
                let opened = false;
                // 路径一 — Avatar Shots 编辑器：Voice 工具栏按钮(#audio) → Voice 弹窗 → Switch
                const voiceToolbarBtn = aisFindAvatarShotsVoiceBtn();
                if (voiceToolbarBtn) {
                    voiceToolbarBtn.click();
                    await new Promise(r => setTimeout(r, 400));
                    const switchInModal = [...document.querySelectorAll('[role="dialog"] button')]
                        .find(b => b.textContent.includes('Switch'));
                    if (switchInModal) { switchInModal.click(); opened = true; }
                }
                // 路径二 — My Avatars 详情页：顶部声音下拉 → 菜单「Switch voice」
                if (!opened) {
                    const menuBtn = aisFindAvatarVoiceMenuBtn();
                    if (menuBtn) {
                        menuBtn.click();
                        await new Promise(r => setTimeout(r, 350));
                        const switchItem = [...document.querySelectorAll('[role="menuitem"], [role="menu"] button')]
                            .find(b => /switch voice/i.test(b.textContent || ''));
                        if (switchItem) { switchItem.click(); opened = true; }
                    }
                }
                if (!opened) {
                    setStatus('未找到声音入口，请确认在 Avatar Shots 或头像详情页', 'error');
                    return;
                }
            } else {
                // AI Studio: find Switch button directly, or navigate from Avatar & Voice panel
                let heySwitchBtn = [...document.querySelectorAll('button')]
                    .filter(b => !b.closest('#hvt-fab-strip') && !b.closest('#hvt-root') && !b.closest('#hvt-ais-overlay'))
                    .find(b => b.textContent.trim() === 'Switch');

                if (!heySwitchBtn) {
                    // Voice row has no <img> (avatar row does); both share tw-cursor-pointer + tw-rounded-md
                    const voiceRow = [...document.querySelectorAll('div.tw-cursor-pointer')]
                        .filter(el => !el.closest('#hvt-root') && !el.closest('#hvt-fab-strip') &&
                            el.className.includes('tw-rounded-md') && el.className.includes('tw-border'))
                        .find(el => !el.querySelector('img'));
                    if (voiceRow) {
                        voiceRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        await new Promise(r => setTimeout(r, 400));
                        heySwitchBtn = [...document.querySelectorAll('button')]
                            .filter(b => !b.closest('#hvt-fab-strip') && !b.closest('#hvt-root') && !b.closest('#hvt-ais-overlay'))
                            .find(b => b.textContent.trim() === 'Switch');
                    }
                }

                if (!heySwitchBtn) {
                    setStatus('未找到 Switch 按钮，请先在 AI Studio 选中 Avatar 场景', 'error');
                    return;
                }
                heySwitchBtn.click();
            }

            let waited = 0;
            while (!aisIsModalOpen() && waited < 4000) {
                await new Promise(r => setTimeout(r, 150));
                waited += 150;
            }
            if (!aisIsModalOpen()) {
                setStatus('切换窗口未能打开，请重试', 'error');
                return;
            }
            await new Promise(r => setTimeout(r, 400));
        }

        setStatus('正在切换声音…');

        // Try current (first) tab — bridge handles modal search internally if needed
        let result = await aisBridgeSwitch(targetVoiceId);

        // If not found, iterate remaining tabs
        if (!result.success) {
            for (const tabLabel of ['My voices', 'HeyGen library']) {
                const tab = [...document.querySelectorAll('[role="tab"], button')]
                    .filter(el => !el.closest('#hvt-ais-overlay') && !el.closest('#hvt-fab-strip') && !el.closest('#hvt-root'))
                    .find(el => el.textContent.trim() === tabLabel);
                if (!tab) continue;
                tab.click();
                await new Promise(r => setTimeout(r, 600));
                result = await aisBridgeSwitch(targetVoiceId);
                if (result.success) break;
            }
        }

        if (result.success) {
            // Avatar 页需要显式确认才会应用：编辑器是「Save changes」，My Avatars 详情是「Set default」
            if (isAvatarShots) {
                await new Promise(r => setTimeout(r, 200));
                const saveBtn = [...document.querySelectorAll('[role="dialog"] button')]
                    .find(b => { const t = b.textContent.trim(); return t === 'Save changes' || t === 'Set default'; });
                if (saveBtn) saveBtn.click();
            }
            setStatus(`✅ 已切换到「${result.name}」`, 'success');
            showToast(`✅ 已切换到「${result.name}」`, 'success', 2500);
        } else {
            setStatus('未找到该声音（已搜索全部标签）', 'error');
        }
    }

    function aisSearchVoices(q) {
        const myToken = ++aisFallbackToken; // cancel any running fallback
        const query = (q || '').trim().toLowerCase();
        const seen = new Set();
        const results = [];

        // My Voices first, then community (space), then db (library)
        const all = [
            ...mvVoices.map(v => ({ ...v, _src: 'my' })),
            ...spaceVoices.map(v => ({ ...v, _src: 'space' })),
            ...Object.values(db.voices).map(v => ({ ...v, _src: 'lib' })),
        ];

        if (!query) {
            for (const v of all) {
                if (!v.voice_id || seen.has(v.voice_id)) continue;
                seen.add(v.voice_id);
                results.push(v);
                if (results.length >= 50) break;
            }
        } else {
            // Exact / prefix voice_id match first
            for (const v of all) {
                if (!v.voice_id || seen.has(v.voice_id)) continue;
                const id = v.voice_id.toLowerCase();
                if (id === query || id.startsWith(query)) { seen.add(v.voice_id); results.push(v); }
            }
            // Partial name / id match
            for (const v of all) {
                if (!v.voice_id || seen.has(v.voice_id)) continue;
                if ((v.display_name || '').toLowerCase().includes(query) ||
                    (v.voice_id || '').toLowerCase().includes(query)) {
                    seen.add(v.voice_id);
                    results.push(v);
                    if (results.length >= 80) break;
                }
            }
        }

        aisSearchResults = results;
        aisRenderResults();
        // Fall back to a live page-by-page fetch when the local cache can't
        // satisfy the query: nothing matched, or the query is a full voice_id
        // not loaded yet (covers shared voices absent from a stale cache while
        // the background revalidation in mvEnsureCache is still in flight).
        const looksLikeId = /^[a-z0-9]{32}$/.test(query) || /^[a-z0-9]{20}$/.test(query);
        const hasExactId = results.some(v => (v.voice_id || '').toLowerCase() === query);
        if (query && (results.length === 0 || (looksLikeId && !hasExactId))) {
            aisFallbackSearch(query, myToken);
        }
    }

    async function aisFallbackSearch(query, myToken) {
        const listEl = document.getElementById('hvt-ais-list');
        // Only replace the list with a loading hint when there are no local
        // results worth keeping on screen; otherwise revalidate silently.
        if (listEl && aisSearchResults.length === 0) {
            listEl.innerHTML = '<div class="hvt-ais-empty">正在实时搜索…</div>';
        }
        // 逐页搜索：先个人上下文，再每个所属 Space（带 x-space-id），直到搜到。
        if (!spacesList.length) { try { await fetchSpaces(); } catch {} }
        const contexts = [{ id: null }, ...spacesList];
        for (const ctx of contexts) {
            let token = null;
            const seenPage = new Set();
            for (;;) {                                   // 不设上限，拉到 next_token 为空
                if (aisFallbackToken !== myToken) return;
                let url = '/v2/pacific/voice_clone/voice.list?page_size=50';
                if (token) url += '&next_token=' + encodeURIComponent(token);
                let data = null;
                for (let attempt = 0; attempt < 4 && !data; attempt++) {
                    if (aisFallbackToken !== myToken) return;
                    try { data = await heygenApi(url, ctx.id ? { headers: { 'x-space-id': ctx.id } } : {}); }
                    catch { await mvShareSleep(1200 + Math.random() * 1200); }
                }
                if (aisFallbackToken !== myToken) return;
                if (!data) break; // 重试仍失败 → 跳到下一个上下文
                const list = data.data || data.list || data.voices || [];
                if (!list.some(v => v.voice_id && !seenPage.has(v.voice_id))) break; // 去重终止
                list.forEach(v => { if (v.voice_id) seenPage.add(v.voice_id); });
                const matched = list.filter(v =>
                    (v.voice_id || '').toLowerCase().includes(query) ||
                    (v.display_name || '').toLowerCase().includes(query)
                );
                if (matched.length > 0) {
                    if (ctx.id) {
                        const existing = new Set(spaceVoices.map(v => v.voice_id));
                        for (const v of matched) {
                            if (existing.has(v.voice_id)) continue;
                            v._space = ctx.id; v._spaceName = ctx.name;
                            v._origin = classifyOrigin(v);
                            spaceVoices.push(v);
                        }
                    } else {
                        const existing = new Set(mvVoices.map(v => v.voice_id));
                        for (const v of matched) if (!existing.has(v.voice_id)) mvVoices.push(v);
                    }
                    const searchEl = document.getElementById('hvt-ais-search');
                    aisSearchVoices(searchEl ? searchEl.value : query);
                    return;
                }
                token = data.next_pagination_token || null;
                if (!token) break;
            }
        }
        if (aisFallbackToken !== myToken) return;
        if (listEl && aisSearchResults.length === 0) listEl.innerHTML = `<div class="hvt-ais-empty" style="color:#dc2626">实时搜索完毕，未找到「${esc(query)}」</div>`;
    }

    function aisRenderResults() {
        const listEl = document.getElementById('hvt-ais-list');
        if (!listEl) return;
        if (aisSearchResults.length === 0) {
            listEl.innerHTML = '<div class="hvt-ais-empty">无匹配结果，可先「获取/更新人声」或「我的声音」加载数据</div>';
            return;
        }
        listEl.innerHTML = '';
        const frag = document.createDocumentFragment();
        aisSearchResults.forEach(v => {
            const id = v.voice_id || '';
            const name = v.display_name || id;
            const gender = (v.gender || '').toLowerCase();
            const genderIcon = gender === 'female' ? '♀' : gender === 'male' ? '♂' : '';
            let srcIcon = '📚', srcLabel = '声音库';
            if (v._src === 'my') { srcIcon = '🎤'; srcLabel = '我的声音'; }
            else if (v._src === 'space') {
                if (v._origin === 'shared') { srcIcon = '🟠'; srcLabel = '社区·分享进来'; }
                else { srcIcon = '🟢'; srcLabel = '社区·自生成'; }
            }
            const row = document.createElement('div');
            row.className = 'hvt-ais-row';
            row.title = `Voice ID: ${id}\n点击切换`;
            row.innerHTML = `
                <span class="hvt-ais-src" title="${srcLabel}">${srcIcon}</span>
                <span class="hvt-ais-name">${esc(name)}</span>
                ${genderIcon ? `<span class="hvt-ais-gender ${gender === 'female' ? 'hvt-f' : 'hvt-m'}">${genderIcon}</span>` : ''}
                <span class="hvt-ais-id">${esc(id.slice(0, 8))}…</span>
            `;
            row.addEventListener('click', () => aisQuickSwitch(id));
            frag.appendChild(row);
        });
        listEl.appendChild(frag);
    }

    function openAisPanel() {
        const overlay = document.getElementById('hvt-ais-overlay');
        if (overlay) overlay.style.display = 'flex';
        // Ensure mvVoices is populated (from cache immediately, then refresh in background if stale)
        mvEnsureCache();
        const searchEl = document.getElementById('hvt-ais-search');
        if (searchEl) { searchEl.value = ''; searchEl.focus(); }
        aisSearchVoices('');
        const statusEl = document.getElementById('hvt-ais-status');
        if (statusEl) {
            const onSupportedPage = location.pathname.includes('/create-v4/') || location.pathname.includes('/avatar/');
            statusEl.textContent = onSupportedPage ? '' : '⚠️ 请在 AI Studio 或 Avatar Shots 页面使用';
            statusEl.dataset.type = onSupportedPage ? '' : 'warn';
        }
    }

    function closeAisPanel() {
        const overlay = document.getElementById('hvt-ais-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    // ─── Build UI ─────────────────────────────────────────────────────────────
    function buildUI() {
        const fabStrip = document.createElement('div');
        fabStrip.id = 'hvt-fab-strip';
        fabStrip.innerHTML = `
            <button id="hvt-fab" title="人声筛选工具">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
                    <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                </svg>
            </button>
            <div class="hvt-fab-divider"></div>
            <button id="hvt-fab-ais" title="AI Studio 快速换声音">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M7 16V4m0 0L3 8m4-4l4 4"/>
                    <path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
                </svg>
            </button>
            <div class="hvt-fab-divider"></div>
            <button id="hvt-fab-vd" title="生音 — AI 声音设计">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                    <path d="M20 3v4m2-2h-4"/>
                </svg>
            </button>
        `;
        document.body.appendChild(fabStrip);

        const root = document.createElement('div');
        root.id = 'hvt-root';
        root.classList.add('hvt-minimized'); // 默认最小化，点 FAB 展开
        root.innerHTML = `
<div id="hvt-modal">

  <div id="hvt-header">
    <span id="hvt-title">🎙 人声筛选工具</span>
    <div id="hvt-header-btns">
      <button id="hvt-btn-my-voices" class="hvt-btn" title="查看并下载我的声音（My Voices）">🎤 我的声音</button>
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
      <button id="hvt-tag-panel-toggle" class="hvt-btn hvt-tag-toggle-btn" title="展开属性标签面板，支持多选">
        属性标签 <span id="hvt-tag-badge" style="display:none"></span>
      </button>
      <input  id="hvt-search" class="hvt-input" placeholder="关键词搜索（名称 / ID / 标签 / 备注）" />
      <button id="hvt-btn-default-filters" class="hvt-btn" title="恢复默认语言和地区">默认</button>
      <button id="hvt-btn-clear-filters" class="hvt-btn" title="清空此行所有筛选条件">清空</button>
      <button id="hvt-btn-apply-filters" class="hvt-btn hvt-btn-primary" title="应用当前筛选条件">提交</button>
    </div>
    <div class="hvt-filter-row">
      <span   id="hvt-stats"></span>

      <button id="hvt-paste-toggle" class="hvt-btn hvt-paste-action-btn" style="margin-left:auto">📋 快速试听（粘贴列表）</button>
    </div>
    <div id="hvt-tag-panel" style="display:none">
      <div id="hvt-tag-chip-panel"></div>
      <div class="hvt-tag-panel-footer">
        <button id="hvt-tag-clear" class="hvt-btn">清除所有标签</button>
      </div>
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

  <div id="hvt-dl-bar">
    <span id="hvt-dl-bar-info"></span>
    <button id="hvt-dl-bar-btn" class="hvt-btn hvt-btn-primary">⬇ 下载已选</button>
    <button id="hvt-dl-bar-clear" class="hvt-btn">✕ 清除</button>
  </div>
  <div id="hvt-table-wrap">
    <table id="hvt-table">
      <thead>
        <tr>
          <th class="c-chk"><input type="checkbox" id="hvt-chk-all" title="全选当前页"></th>
          <th class="c-flag" data-col="c-flag" title="双击复制整列">地区</th>
          <th class="c-gender" data-col="c-gender" title="双击复制整列">性别</th>
          <th class="c-name" data-col="c-name" title="双击复制整列">人声名称 / ID</th>
          <th class="c-tags" data-col="c-tags" title="双击复制整列">属性标签</th>
          <th class="c-notes" data-col="c-notes" title="双击复制整列">备注</th>
          <th class="c-play">操作</th>
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

        // AI Studio Quick Voice Switch overlay
        const aisRoot = document.createElement('div');
        aisRoot.id = 'hvt-ais-overlay';
        aisRoot.style.display = 'none';
        aisRoot.innerHTML = `
            <div id="hvt-ais-panel">
              <div id="hvt-ais-header">
                <span id="hvt-ais-title">⇄ AI Studio 换声音</span>
                <button id="hvt-ais-close" title="关闭">✕</button>
              </div>
              <div id="hvt-ais-search-row">
                <input id="hvt-ais-search" class="hvt-input" placeholder="搜索名称 / 粘贴 Voice ID…" autocomplete="off">
              </div>
              <div id="hvt-ais-status"></div>
              <div id="hvt-ais-list"></div>
              <div id="hvt-ais-footer">点击声音行即可切换 · 🎤 我的声音 &nbsp;🟢 社区·自生成 &nbsp;🟠 社区·分享 &nbsp;📚 声音库</div>
            </div>
        `;
        document.body.appendChild(aisRoot);

        // Voice Design modal — independent top-level element
        const vdRoot = document.createElement('div');
        vdRoot.id = 'hvt-vd-overlay';
        vdRoot.style.display = 'none';
        vdRoot.innerHTML = `
            <div id="hvt-vd-panel">
              <div id="hvt-vd-header">
                <span id="hvt-vd-title">✨ HeyGen 提示词生成声音</span>
                <button id="hvt-vd-close" title="关闭">✕</button>
              </div>
              <div id="hvt-vd-body">
                <div class="hvt-vd-form-row">
                  <label class="hvt-vd-label">上传头像（HeyGen 分析人脸自动生成提示词，可选）</label>
                  <div id="hvt-vd-photo-row">
                    <label id="hvt-vd-photo-drop" for="hvt-vd-photo-input">
                      <img id="hvt-vd-photo-thumb" alt="">
                      <span id="hvt-vd-photo-placeholder">📷 点击选择头像图片</span>
                    </label>
                    <input id="hvt-vd-photo-input" type="file" accept="image/*" hidden>
                    <span id="hvt-vd-photo-status"></span>
                  </div>
                </div>
                <div class="hvt-vd-form-row">
                  <label class="hvt-vd-label">提示词</label>
                  <textarea id="hvt-vd-prompt" class="hvt-vd-textarea" placeholder="描述声音特征：年龄、性别、风格、口音、情绪……&#10;例：A high-pitched, energetic voice of a 4-year-old American boy with a slight childish lisp."></textarea>
                </div>
                <div class="hvt-vd-form-actions">
                  <button id="hvt-vd-generate" class="hvt-btn hvt-btn-primary">⚡ 生成</button>
                  <span id="hvt-vd-status"></span>
                </div>
                <div id="hvt-vd-options"></div>
                <div id="hvt-vd-saved-section">
                  <div class="hvt-vd-saved-header">已生成的声音</div>
                  <div id="hvt-vd-saved-list"></div>
                </div>
              </div>
            </div>
        `;
        document.body.appendChild(vdRoot);

        // My Voices modal
        const mvRoot = document.createElement('div');
        mvRoot.id = 'hvt-mv-overlay';
        mvRoot.style.display = 'none';
        mvRoot.innerHTML = `
            <div id="hvt-mv-panel">
              <div id="hvt-mv-header">
                <span id="hvt-mv-title">🎤 我的声音</span>
                <div style="display:flex;align-items:center;gap:8px">
                  <span id="hvt-mv-count" style="font-size:13px;color:#8b8abf"></span>
                  <span id="hvt-mv-sel-count" style="font-size:13px;color:#a78bfa"></span>
                  <button id="hvt-mv-space-toggle" class="hvt-btn" title="切换显示：本号自带声音 / 社区（Space）声音">🌐 社区声音</button>
                  <button id="hvt-mv-exp" class="hvt-btn" title="分享到期清理：撤销超过设定天数的对外分享">⏰ 到期清理</button>
                  <button id="hvt-mv-refresh" class="hvt-btn" title="刷新列表">↺ 刷新</button>
                  <button id="hvt-mv-dl-sel" class="hvt-btn hvt-btn-primary" title="下载已勾选的声音" style="display:none">⬇ 下载已选</button>
                  <button id="hvt-mv-del-sel" class="hvt-btn hvt-btn-danger" title="删除已勾选、且是你自己创建的声音（不可逆）" style="display:none">🗑 删除选中</button>
                  <button id="hvt-mv-dl-all" class="hvt-btn" title="下载全部声音 MP3">⬇ 全部下载</button>
                  <button id="hvt-mv-close" title="关闭">✕</button>
                </div>
              </div>
              <div style="padding:8px 16px 4px">
                <input id="hvt-mv-search" class="hvt-input" placeholder="搜索声音名称 / ID…" style="width:100%;box-sizing:border-box">
              </div>
              <div id="hvt-mv-status" style="padding:2px 16px 6px;font-size:13px;color:#8b8abf"></div>
              <div id="hvt-mv-list"></div>
            </div>
        `;
        document.body.appendChild(mvRoot);

        // Share Voice modal (batch email)
        const shareRoot = document.createElement('div');
        shareRoot.id = 'hvt-mv-share-overlay';
        shareRoot.style.display = 'none';
        shareRoot.innerHTML = `
            <div id="hvt-mv-share-panel">
              <div id="hvt-mv-share-header">
                <span id="hvt-mv-share-title">🔗 共享声音给团队成员</span>
                <button id="hvt-mv-share-close" title="关闭">✕</button>
              </div>
              <div id="hvt-mv-share-body">
                <div id="hvt-mv-share-voice"></div>
                <textarea id="hvt-mv-share-ta"
                  placeholder="批量添加：每行一个邮箱（或用逗号 / 空格分隔）"></textarea>
                <div id="hvt-mv-share-actions">
                  <button id="hvt-mv-share-go" class="hvt-btn hvt-btn-primary">批量共享</button>
                  <span id="hvt-mv-share-status"></span>
                </div>
                <div id="hvt-mv-share-done" style="display:none">
                  <div id="hvt-mv-share-done-bar">
                    <input type="checkbox" id="hvt-mv-share-selall">
                    <label for="hvt-mv-share-selall">全选</label>
                    <span id="hvt-mv-share-done-count"></span>
                    <button id="hvt-mv-share-delsel" class="hvt-btn hvt-btn-danger">删除选中</button>
                    <button id="hvt-mv-share-stop" class="hvt-btn" style="display:none">■ 停止</button>
                    <span id="hvt-mv-share-done-status"></span>
                  </div>
                  <div id="hvt-mv-share-done-list"></div>
                </div>
              </div>
            </div>
        `;
        document.body.appendChild(shareRoot);

        // Share Expiry Cleanup modal
        const expRoot = document.createElement('div');
        expRoot.id = 'hvt-exp-overlay';
        expRoot.style.display = 'none';
        expRoot.innerHTML = `
            <div id="hvt-exp-panel">
              <div id="hvt-exp-header">
                <span id="hvt-exp-title">⏰ 分享到期清理</span>
                <button id="hvt-exp-close" title="关闭">✕</button>
              </div>
              <div id="hvt-exp-body">
                <div id="hvt-exp-config">
                  <label>超过</label>
                  <input id="hvt-exp-days" type="number" min="1" class="hvt-input">
                  <label>天视为过期</label>
                  <button id="hvt-exp-rescan" class="hvt-btn">↺ 重新扫描</button>
                  <span id="hvt-exp-count"></span>
                </div>
                <label id="hvt-exp-auto-label">
                  <input type="checkbox" id="hvt-exp-auto">
                  自动清理超期分享（每次打开 HeyGen 时后台执行，不再逐项询问）
                </label>
                <div id="hvt-exp-wl">
                  <input id="hvt-exp-wl-input" class="hvt-input" placeholder="白名单邮箱（永不列出/撤销）— 回车添加，可粘贴多个">
                  <div id="hvt-exp-wl-list"></div>
                </div>
                <div id="hvt-exp-actions">
                  <input type="checkbox" id="hvt-exp-selall">
                  <label for="hvt-exp-selall">全选超期</label>
                  <button id="hvt-exp-remove" class="hvt-btn">撤销选中</button>
                  <button id="hvt-exp-remove-expired" class="hvt-btn hvt-btn-danger">撤销全部超期</button>
                  <button id="hvt-exp-stop" class="hvt-btn" style="display:none">■ 停止</button>
                  <span id="hvt-exp-status"></span>
                </div>
                <div id="hvt-exp-list"></div>
                <div id="hvt-exp-hint">⚠ 计时从插件首次发现该分享起算——启用前的旧分享按“今天”计；撤销不可逆。</div>
              </div>
            </div>
        `;
        document.body.appendChild(expRoot);

        bindEvents();
        updateSyncInfo();
        populateFilters();
        // Pre-select defaults (only if value exists in loaded data)
        const langEl = document.getElementById('hvt-f-lang');
        const localeEl = document.getElementById('hvt-f-locale');
        if (LANGUAGE && [...langEl.options].some(o => o.value === LANGUAGE))
            langEl.value = LANGUAGE;
        if (DEFAULT_LOCALE) {
            const target = DEFAULT_LOCALE.toLowerCase();
            const match = [...localeEl.options].find(o =>
                o.value === target || (o.dataset.vals || '').split('|').includes(target)
            );
            if (match) localeEl.value = match.value;
        }
        // 首屏不渲染表格（默认最小化），首次展开面板时再渲染
    }

    // ─── Event binding ────────────────────────────────────────────────────────
    function bindEvents() {
        // tbody 是常驻元素，复制类监听器只能绑一次（renderTable 里绑会随重渲染累积）
        const tbodyEl = document.getElementById('hvt-tbody');

        // Click on voice ID copy button
        tbodyEl.addEventListener('click', async (e) => {
            const btn = e.target.closest('.hvt-copy-id-btn');
            if (!btn) return;
            const id = btn.dataset.copy;
            if (!id) return;
            try {
                await navigator.clipboard.writeText(id);
                const orig = btn.textContent;
                btn.textContent = '已复制!';
                btn.classList.add('hvt-copied');
                setTimeout(() => { btn.textContent = orig; btn.classList.remove('hvt-copied'); }, 1200);
            } catch (err) { showToast('复制失败', 'error'); }
        });

        // Double-click any cell to copy text (备注列不支持双击复制)
        tbodyEl.addEventListener('dblclick', async (e) => {
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
            } catch (err) {
                showToast('复制失败', 'error');
            }
        });

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
            if (!isMinimized) {
                if (!tableRendered) { renderTable(); tableRendered = true; }
                const wrap = document.getElementById('hvt-table-wrap');
                if (wrap) wrap.scrollLeft = 0;
            }
        });

        document.getElementById('hvt-fab-ais').addEventListener('click', () => {
            openAisPanel();
        });

        document.getElementById('hvt-fab-vd').addEventListener('click', () => {
            openVoiceDesign();
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

        ['hvt-f-lang', 'hvt-f-locale', 'hvt-f-gender', 'hvt-f-age'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                activeFilterMode = 'dropdown';
                showMissingOnly = false;
                updateSyncInfo();
                renderTable();
            });
        });

        document.getElementById('hvt-btn-default-filters').addEventListener('click', () => {
            const langEl = document.getElementById('hvt-f-lang');
            const localeEl = document.getElementById('hvt-f-locale');
            if (LANGUAGE && [...langEl.options].some(o => o.value === LANGUAGE))
                langEl.value = LANGUAGE;
            else langEl.value = '';
            if (DEFAULT_LOCALE) {
                const target = DEFAULT_LOCALE.toLowerCase();
                const match = [...localeEl.options].find(o =>
                    o.value === target || (o.dataset.vals || '').split('|').includes(target)
                );
                localeEl.value = match ? match.value : '';
            } else {
                localeEl.value = '';
            }
            activeFilterMode = 'dropdown';
            showMissingOnly = false;
            updateSyncInfo();
            renderTable();
        });

        document.getElementById('hvt-tag-panel-toggle').addEventListener('click', () => {
            const panel = document.getElementById('hvt-tag-panel');
            panel.style.display = panel.style.display === 'none' ? '' : 'none';
        });

        document.getElementById('hvt-tag-clear').addEventListener('click', () => {
            selectedTags.clear();
            document.querySelectorAll('#hvt-tag-chip-panel .hvt-tag-chip.active').forEach(c => c.classList.remove('active'));
            updateTagBadge();
            activeFilterMode = 'dropdown';
            showMissingOnly = false;
            updateSyncInfo();
            renderTable();
        });

        document.getElementById('hvt-btn-clear-filters').addEventListener('click', () => {
            document.getElementById('hvt-f-lang').value = '';
            document.getElementById('hvt-f-locale').value = '';
            document.getElementById('hvt-f-gender').value = '';
            document.getElementById('hvt-f-age').value = '';
            document.getElementById('hvt-search').value = '';
            selectedTags.clear();
            document.querySelectorAll('#hvt-tag-chip-panel .hvt-tag-chip.active').forEach(c => c.classList.remove('active'));
            updateTagBadge();
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
            pasteFilterOrder = new Map([...ids].map((id, i) => [id, i]));
            activeFilterMode = 'paste';
            document.getElementById('hvt-paste-hint').textContent = `解析到 ${ids.size} 个 ID`;
            renderTable();
            showToast(`✅ 已筛选出 ${ids.size} 个人声`, 'success');
        });

        document.getElementById('hvt-btn-clear-paste').addEventListener('click', () => {
            pasteFilterIds = null;
            pasteFilterOrder = null;
            activeFilterMode = 'dropdown';
            document.getElementById('hvt-paste-area').value = '';
            document.getElementById('hvt-paste-hint').textContent = '';
            renderTable();
        });

        // Download MP3s – or cancel if in progress
        document.getElementById('hvt-btn-dl-mp3').addEventListener('click', () => {
            if (downloadInProgress) {
                downloadCancelled = true;
                return;
            }
            const fLang = (document.getElementById('hvt-f-lang')?.value || '').toLowerCase();
            const fLocale = (document.getElementById('hvt-f-locale')?.value || '').toLowerCase();
            let voices = Object.values(db.voices);
            if (fLang) voices = voices.filter(v => (v.language || '').toLowerCase() === fLang);
            if (fLocale) voices = voices.filter(v => (v.locale || '').toLowerCase() === fLocale);
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
            btnFetch.style.display = show ? 'none' : '';
            btnPause.style.display = show ? '' : 'none';
            btnAbort.style.display = show ? '' : 'none';
            if (!show) {
                btnPause.textContent = '暂停';
                btnAbort.disabled = false;
            }
        }

        btnFetch.addEventListener('click', async () => {
            if (fetchInProgress) return;

            fetchInProgress = true;
            fetchCancelled = false;
            fetchPaused = false;

            const progress = document.getElementById('hvt-progress');
            const langFilter = document.getElementById('hvt-f-lang')?.value || '';
            const localeFilter = document.getElementById('hvt-f-locale')?.value || '';
            const scopeLabel = [langFilter, localeFilter].filter(Boolean).join(' / ') || '全部';

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
                fetchCancelled = false;
                fetchPaused = false;
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
            fetchPaused = false;   // 如果处于暂停中，解除暂停让循环能检测到终止
            btnAbort.disabled = true;
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
                const text = await file.text();
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

        // AI Studio Quick Switch panel
        document.getElementById('hvt-ais-close').addEventListener('click', closeAisPanel);
        document.getElementById('hvt-ais-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('hvt-ais-overlay')) closeAisPanel();
        });
        document.getElementById('hvt-ais-search').addEventListener('input', debounce((e) => {
            aisSearchVoices(e.target.value);
        }, 200));
        document.getElementById('hvt-ais-search').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const q = e.target.value.trim();
                // If it's a bare voice_id (32-char hex or any single token with no spaces), switch directly
                if (/^[0-9a-zA-Z_-]{8,}$/.test(q) && !q.includes(' ')) {
                    aisQuickSwitch(q);
                } else if (aisSearchResults.length === 1) {
                    aisQuickSwitch(aisSearchResults[0].voice_id);
                }
            }
            if (e.key === 'Escape') closeAisPanel();
        });

        // Voice Design modal
        document.getElementById('hvt-vd-close').addEventListener('click', closeVoiceDesign);
        document.getElementById('hvt-vd-generate').addEventListener('click', vdGenerate);
        document.getElementById('hvt-vd-photo-input').addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = ''; // 允许重复选同一文件
            if (file) vdHandlePhotoFile(file);
        });
        document.getElementById('hvt-vd-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('hvt-vd-overlay')) closeVoiceDesign();
        });

        // Main table: select-all checkbox
        document.getElementById('hvt-chk-all').addEventListener('change', (e) => {
            const tb = document.getElementById('hvt-tbody');
            const checked = e.target.checked;
            if (!checked) mainSelectedIds.clear();
            tb.querySelectorAll('.hvt-main-chk').forEach(chk => {
                chk.checked = checked;
                if (checked) mainSelectedIds.add(chk.dataset.id);
            });
            mainUpdateSelectionUI();
        });
        document.getElementById('hvt-dl-bar-btn').addEventListener('click', mainDownloadSelected);
        document.getElementById('hvt-dl-bar-clear').addEventListener('click', () => {
            mainSelectedIds.clear();
            document.getElementById('hvt-tbody').querySelectorAll('.hvt-main-chk').forEach(c => c.checked = false);
            const chkAll = document.getElementById('hvt-chk-all');
            if (chkAll) chkAll.checked = false;
            mainUpdateSelectionUI();
        });

        // My Voices modal
        document.getElementById('hvt-btn-my-voices').addEventListener('click', openMyVoices);
        document.getElementById('hvt-mv-close').addEventListener('click', closeMyVoices);
        document.getElementById('hvt-mv-refresh').addEventListener('click', () => {
            if (mvViewMode === 'space') spacePrefetch();
            else mvLoadVoices(true);
        });
        document.getElementById('hvt-mv-space-toggle').addEventListener('click', () => {
            mvSetViewMode(mvViewMode === 'space' ? 'self' : 'space');
        });
        document.getElementById('hvt-mv-search').addEventListener('input', mvRenderList);
        document.getElementById('hvt-mv-dl-all').addEventListener('click', mvDownloadSelected);
        document.getElementById('hvt-mv-dl-sel').addEventListener('click', mvDownloadSelected);
        document.getElementById('hvt-mv-del-sel').addEventListener('click', () => {
            if (mvDelRunning || spaceDelRunning) { mvDelAbort = true; spaceDelAbort = true; if (mvShareWaitCancel) mvShareWaitCancel(); }
            else mvDeleteSelected();
        });
        document.getElementById('hvt-mv-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('hvt-mv-overlay')) closeMyVoices();
        });

        // Share Voice modal
        document.getElementById('hvt-mv-share-close').addEventListener('click', mvCloseShare);
        document.getElementById('hvt-mv-share-go').addEventListener('click', mvShareGo);
        document.getElementById('hvt-mv-share-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('hvt-mv-share-overlay')) mvCloseShare();
        });
        document.getElementById('hvt-mv-share-selall').addEventListener('change', (e) => {
            document.querySelectorAll('#hvt-mv-share-done-list .hvt-mv-share-cb')
                .forEach(cb => { cb.checked = e.target.checked; });
        });
        document.getElementById('hvt-mv-share-delsel').addEventListener('click', () => {
            const rows = [...document.querySelectorAll('#hvt-mv-share-done-list .hvt-mv-share-done-row')];
            const emails = rows
                .filter(r => r.querySelector('.hvt-mv-share-cb').checked)
                .map(r => r.querySelector('.hvt-mv-share-email').textContent);
            if (emails.length) mvShareRemove(emails);
        });
        document.getElementById('hvt-mv-share-stop').addEventListener('click', () => {
            mvShareAbort = true;
            if (mvShareWaitCancel) mvShareWaitCancel();
        });

        // Share Expiry Cleanup
        document.getElementById('hvt-mv-exp').addEventListener('click', openExpPanel);
        document.getElementById('hvt-exp-close').addEventListener('click', closeExpPanel);
        document.getElementById('hvt-exp-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('hvt-exp-overlay')) closeExpPanel();
        });
        document.getElementById('hvt-exp-rescan').addEventListener('click', expRefresh);
        document.getElementById('hvt-exp-days').addEventListener('change', (e) => {
            expSetDays(parseInt(e.target.value, 10));
            expRender();
        });
        document.getElementById('hvt-exp-auto').addEventListener('change', (e) => {
            if (e.target.checked && !confirm('开启后，每次打开 HeyGen 时会自动撤销超过设定天数的分享，不再逐项询问。撤销不可逆。\n\n确定开启自动清理？')) {
                e.target.checked = false; return;
            }
            expSetAuto(e.target.checked);
        });
        document.getElementById('hvt-exp-selall').addEventListener('change', (e) => {
            const days = expGetDays();
            document.querySelectorAll('#hvt-exp-list .hvt-exp-cb').forEach(cb => {
                const r = expRows[parseInt(cb.dataset.idx, 10)];
                if (r && r.days >= days) cb.checked = e.target.checked; // 只影响超期行
            });
        });
        document.getElementById('hvt-exp-remove').addEventListener('click', () => {
            const status = document.getElementById('hvt-exp-status');
            const items = [...document.querySelectorAll('#hvt-exp-list .hvt-exp-cb:checked')]
                .map(cb => expRows[parseInt(cb.dataset.idx, 10)])
                .filter(Boolean)
                .map(r => ({ voiceId: r.voiceId, email: r.email }));
            if (!items.length) { if (status) status.textContent = '未选择任何分享'; return; }
            if (!confirm(`确定撤销选中的 ${items.length} 个分享？此操作不可逆。`)) return;
            expRemoveSelected(items);
        });
        document.getElementById('hvt-exp-remove-expired').addEventListener('click', () => {
            const days = expGetDays();
            const status = document.getElementById('hvt-exp-status');
            const items = expRows.filter(r => r.days >= days).map(r => ({ voiceId: r.voiceId, email: r.email }));
            if (!items.length) { if (status) status.textContent = '没有超期分享'; return; }
            if (!confirm(`确定撤销全部 ${items.length} 个已超期分享？此操作不可逆。`)) return;
            expRemoveSelected(items);
        });
        document.getElementById('hvt-exp-stop').addEventListener('click', () => {
            expAbort = true;
            if (mvShareWaitCancel) mvShareWaitCancel();
        });
        document.getElementById('hvt-exp-wl-input').addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const emails = mvExtractEmails(e.target.value);
            if (emails.length) { expWhitelistAdd(emails); e.target.value = ''; }
        });
        document.getElementById('hvt-exp-wl-list').addEventListener('click', (e) => {
            const del = e.target.closest('.hvt-exp-wl-del');
            if (del) expWhitelistRemove(del.dataset.email);
        });
        document.getElementById('hvt-exp-list').addEventListener('click', (e) => {
            const add = e.target.closest('.hvt-exp-wl-add');
            if (add) expWhitelistAdd([add.dataset.email]);
        });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────
    function init() {
        loadDb();
        buildUI();
        spaceInit();                       // 加载社区声音缓存并后台慢速刷新
        setTimeout(expAutoCleanRun, 8000); // 若已开启自动清理，加载后在后台执行
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// Share Voice 弹框增强（批量添加邮箱 + 批量删除）
proc11ShareVoice.init();
