/* Heygen Helper T3 / Voice Tester - content.js */
(function () {
    'use strict';
    if (document.getElementById('hvt-fab')) return;

    // ─── Constants ────────────────────────────────────────────────────────────
    const STORE_KEY = 'hvt_data_v1';
    const MV_CACHE_KEY = 'hvt_mv_cache_v1';
    const MV_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
    const SPACE_CACHE_KEY = 'hvt_space_voices_cache_v1'; // 社区（Space）声音缓存
    const SPACE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h：缓存新鲜则不自动全量重扫（点 ↺ 仍可强制刷新）
    const STARTUP_VOICE_SCAN_KEY = 'hvt_startup_voice_scan_v1'; // 当前声音缓存所属账号 + 首次静默扫描摘要
    // 分享到期清理（Share Expiry Cleanup）
    const EXP_LEDGER_KEY = 'hvt_share_ledger_v1'; // { "voiceId::email": 首次发现时间戳 }
    const EXP_DAYS_KEY = 'hvt_share_expiry_days';  // 用户配置的过期天数
    const EXP_WL_KEY = 'hvt_share_whitelist_v1';   // 白名单邮箱数组（永不列出/撤销）
    const EXP_DAYS_DEFAULT = 60;
    const EXP_AUTO_KEY = 'hvt_share_auto_clean';   // '1'/'0'：是否自动清理超期分享
    const EXP_AUTO_LAST_KEY = 'hvt_share_auto_last'; // 上次自动清理时间戳（节流用）
    const PV_LEDGER_KEY = 'hvt_project_video_ledger_v1'; // video key -> 上次所在文件夹
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
    const vdPreviewCache = new Map();    // key `${req}|${opt}` → Uint8Array(MP3)：静默预取缓存
    const vdPreviewInflight = new Map(); // key → Promise：预取与点击去重，避免重复拉取
    let vdPrefetchToken = 0;             // 重新生成时递增，作废上一轮预取队列
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
    let mvShareBatch = [];   // 多声音批量共享：非空表示弹框处于「N 个声音 × M 个邮箱」模式
    let mvShareRunning = false; // 批量共享进行中（按钮变「停止」）
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
    let spaceMemberEmails = new Map(); // username -> email（用于行复制时显示所属邮箱）
    let spacesList = [];             // [{id, name}]
    let mvRefreshPromise = null;     // 个人声音刷新中的共享 Promise（避免启动/AIS 重复请求）
    let spaceFetchPromise = null;    // Space 刷新中的共享 Promise（避免多入口重复请求）
    let spaceFetchRunning = false;   // 后台拉取进行中
    let spaceSelectedIds = new Set();// 社区声音视图下勾选的声音
    let spaceDelRunning = false;     // 社区声音批量删除进行中
    let spaceDelAbort = false;       // 停止社区删除循环
    let mvViewMode = 'self';         // 'self'=本号自带声音 | 'space'=社区声音
    let myUsername = null;           // 当前用户 username（创建者判定）
    let myEmail = null;              // 当前用户邮箱（creator_username 是随机哈希，不是邮箱）
    let pvRows = [];                 // 「我的视频」扫描结果
    let pvScanning = false;
    let pvAbort = false;
    let pvLastScanMeta = null;       // { scanned, totalMine, moved }
    let pvSelected = new Set();      // 勾选待移入回收站的行 key（spaceId::videoId）
    let pvTrashRunning = false;      // 批量移入回收站进行中

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

    // 命中缓存秒返；否则走 preview.stream 生成并缓存。in-flight 去重，预取与点击不重复拉取。
    async function vdGetPreviewBytes(requestId, optionId) {
        const key = requestId + '|' + optionId;
        if (vdPreviewCache.has(key)) return vdPreviewCache.get(key);
        if (vdPreviewInflight.has(key)) return vdPreviewInflight.get(key);
        const p = vdPreviewStream(requestId, optionId)
            .then(bytes => { vdPreviewCache.set(key, bytes); vdPreviewInflight.delete(key); return bytes; })
            .catch(err => { vdPreviewInflight.delete(key); throw err; });
        vdPreviewInflight.set(key, p);
        return p;
    }

    // 生成后台静默预取：严格串行、逐个拉、人为随机停顿，模拟人工逐个试听，避免触发风控。
    async function vdPrefetchPreviews() {
        const token = ++vdPrefetchToken;
        const optionsEl = document.getElementById('hvt-vd-options');
        if (!optionsEl) return;
        const btns = Array.from(optionsEl.querySelectorAll('.hvt-vd-preview-btn'));
        for (const btn of btns) {
            if (token !== vdPrefetchToken) return;      // 已被新一轮生成取代
            if (btn.dataset.cached === '1') continue;   // 已被用户点听缓存
            btn.dataset.caching = '1';
            try {
                await vdGetPreviewBytes(btn.dataset.req, btn.dataset.opt);
                if (token !== vdPrefetchToken) return;
                btn.dataset.cached = '1';
            } catch { /* 预取失败，留待用户点击时重试 */ }
            btn.dataset.caching = '';
            // 人为随机间隔 0.9~3.5s（叠加 preview.stream 自身耗时），避免机械等间隔
            await new Promise(r => setTimeout(r, 900 + Math.random() * 2600));
        }
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

    // ─── Update banner (GitHub Releases) ──────────────────────────────────────
    function initUpdateCheck() {
        const banner = document.getElementById('hvt-update-banner');
        if (!banner || !chrome.runtime?.id) return;
        chrome.runtime.sendMessage({ type: 'hvt_get_update' }, (res) => {
            if (chrome.runtime.lastError || !res || !res.hasUpdate) return;
            renderUpdateBanner(res);
        });
    }

    function renderUpdateBanner(info) {
        const banner = document.getElementById('hvt-update-banner');
        banner.classList.remove('hvt-ub-guide');
        banner.style.display = '';
        // tag_name/html_url 来自 GitHub API 响应，须转义/校验后才能进 innerHTML
        const notesUrl = /^https:\/\/github\.com\//.test(info.htmlUrl || '') ? info.htmlUrl : '';
        banner.innerHTML = `
            <span class="hvt-ub-icon">🔔</span>
            <span class="hvt-ub-text">发现新版本 <b>${esc(info.latest)}</b>（当前 ${esc(info.current)}）</span>
            <button id="hvt-ub-upgrade" class="hvt-btn hvt-btn-primary">立即升级</button>
            ${notesUrl ? `<a id="hvt-ub-notes" class="hvt-btn" href="${esc(notesUrl)}" target="_blank" rel="noopener">查看更新内容</a>` : ''}
            <button id="hvt-ub-ignore" class="hvt-btn">忽略此版本</button>
        `;
        document.getElementById('hvt-ub-upgrade').addEventListener('click', onUpdateUpgrade);
        document.getElementById('hvt-ub-ignore').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'hvt_ignore_update', version: info.latest });
            banner.style.display = 'none';
        });
    }

    function onUpdateUpgrade() {
        const btn = document.getElementById('hvt-ub-upgrade');
        btn.disabled = true;
        btn.textContent = '下载中…';
        chrome.runtime.sendMessage({ type: 'hvt_download_update' }, (res) => {
            if (chrome.runtime.lastError || !res || !res.ok) {
                btn.disabled = false;
                btn.textContent = '立即升级';
                const err = (res && res.error) || chrome.runtime.lastError?.message || '未知错误';
                showToast('下载失败：' + err, 'error', 4000);
                return;
            }
            showUpdateGuide();
        });
    }

    function showUpdateGuide() {
        const banner = document.getElementById('hvt-update-banner');
        banner.classList.add('hvt-ub-guide');
        banner.innerHTML = `
            <span class="hvt-ub-icon">✅</span>
            <span class="hvt-ub-text">新版 zip 已下载到「下载」文件夹。升级步骤：① 打开 <code>chrome://extensions</code> → ② 解压 zip → ③ 移除旧版「人声筛选工具」→ ④ 点「加载已解压的扩展程序」选中解压后的文件夹。</span>
            <button id="hvt-ub-copy" class="hvt-btn hvt-btn-primary">复制 chrome://extensions</button>
            <button id="hvt-ub-done" class="hvt-btn">知道了</button>
        `;
        document.getElementById('hvt-ub-copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText('chrome://extensions');
                showToast('✅ 已复制，粘贴到地址栏回车打开', 'success', 2500);
            } catch {
                showToast('复制失败，请手动在地址栏输入 chrome://extensions', 'error', 3500);
            }
        });
        document.getElementById('hvt-ub-done').addEventListener('click', () => {
            banner.style.display = 'none';
        });
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
                    <div class="hvt-name-line">
                        <span class="hvt-name-main">${esc(v.display_name || '—')}</span>
                        <button class="hvt-copy-id-btn" data-copy="${esc((v.display_name || '') + '/' + (v.voice_id || ''))}" title="复制 名称/ID">${esc(shortId)}</button>
                    </div>
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

    // 依次为每个提示词调 voice_design/create，返回分组结果（每组通常 3 个声音选项）
    async function vdCreateVoices(promptItems, statusEl) {
        const groups = [];
        let lastErr = null;
        for (let i = 0; i < promptItems.length; i++) {
            const it = promptItems[i];
            if (statusEl && promptItems.length > 1) {
                statusEl.textContent = `⏳ 生成中 ${i + 1}/${promptItems.length}（${it.label}）…`;
            }
            try {
                const data = await heygenApi('/v1/voice/voice_design/create', {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Voice', prompt: it.prompt, prefer_stream: true }),
                });
                const { request_id, options } = data;
                if (options && options.length) groups.push({ label: it.label, request_id, options });
            } catch (e) {
                lastErr = e; // 某组失败不丢弃已生成的组
                showToast(`${it.label || '生成'}失败: ${e.message}`, 'error', 3000);
            }
        }
        if (!groups.length) throw new Error(lastErr ? lastErr.message : '未返回声音选项');
        return groups;
    }

    function vdRenderOptionGroups(groups) {
        const optionsEl = document.getElementById('hvt-vd-options');
        if (vdAudioEl) { vdAudioEl.pause(); vdAudioEl = null; }

        optionsEl.innerHTML = groups.map(g => `
            ${g.label ? `<div class="hvt-vd-group-label">${esc(g.label)}</div>` : ''}
            ${g.options.map(opt => `
                <div class="hvt-vd-card">
                    <div class="hvt-vd-card-top">
                        <button class="hvt-vd-preview-btn" data-req="${esc(g.request_id)}" data-opt="${esc(opt.id)}" data-url="${esc(opt.audio_url || '')}" title="试听">
                            <svg class="ic-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                            <svg class="ic-stop" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
                        </button>
                        <span class="hvt-vd-opt-name" title="点击改名">${esc(opt.name)}</span>
                        <input class="hvt-vd-opt-name-input" value="${esc(opt.name)}">
                        <button class="hvt-vd-save-btn hvt-btn"
                            data-req="${esc(g.request_id)}" data-opt="${esc(opt.id)}">保存</button>
                    </div>
                </div>
            `).join('')}
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

        // 生成后静默预取全部试听音频，用户点播放即时出声
        vdPrefetchPreviews();
    }

    async function vdGenerate() {
        const promptEl  = document.getElementById('hvt-vd-prompt');
        const genBtn    = document.getElementById('hvt-vd-generate');
        const statusEl  = document.getElementById('hvt-vd-status');
        const optionsEl = document.getElementById('hvt-vd-options');

        const prompt = (promptEl.value || '').trim();
        if (!prompt) { showToast('请输入提示词', 'error'); return; }

        genBtn.disabled = true;
        genBtn.textContent = '⏳ 生成中…';
        statusEl.textContent = '';
        optionsEl.innerHTML = '';
        if (vdAudioEl) { vdAudioEl.pause(); vdAudioEl = null; }

        try {
            const nGroups = Number(document.getElementById('hvt-vd-count').value) || 1;
            const items = Array.from({ length: nGroups }, (_, i) =>
                ({ label: nGroups > 1 ? `第 ${i + 1} 组` : '', prompt }));
            const groups = await vdCreateVoices(items, statusEl);
            vdRenderOptionGroups(groups);
            if (nGroups > 1) statusEl.textContent = `✅ 共生成 ${groups.reduce((n, g) => n + g.options.length, 0)} 个试听`;
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
            const audioData = await vdGetPreviewBytes(requestId, optionId); // Uint8Array（命中缓存则秒返）
            btn.dataset.cached = '1';
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

            btn.textContent = '✅ 已保存';
            btn.disabled = true;
            btn.style.background = '#059669';
            btn.style.borderColor = '#059669';
            showToast(`✅ 已保存「${displayName}」`, 'success', 3000);
        } catch (e) {
            btn.disabled = false;
            btn.textContent = '保存';
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
            promptEl.value = vdApplyRefine(prompt);
            statusEl.textContent = '✅ 已生成提示词，可编辑后点「生成」';
            statusEl.className = 'hvt-vd-photo-ok';
            showToast('✅ 已根据头像生成提示词', 'success', 3000);
        } catch (e) {
            statusEl.textContent = '分析失败: ' + e.message;
            statusEl.className = 'hvt-vd-photo-err';
            showToast('头像分析失败: ' + e.message, 'error', 4000);
        }
    }

    // ─── 引擎切换 + HeyGen 风格补充 ───────────────────────────────────────────
    const VD_ENGINE_KEY      = 'hvt_vd_engine';
    const VD_REFINE_ON_KEY   = 'hvt_vd_refine_on';
    const VD_REFINE_TEXT_KEY = 'hvt_vd_refine_text';

    function vdSetEngine(engine) {
        try { localStorage.setItem(VD_ENGINE_KEY, engine); } catch {}
        document.querySelectorAll('.hvt-vd-engine-tab').forEach(t =>
            t.classList.toggle('hvt-active', t.dataset.engine === engine));
        document.getElementById('hvt-vd-engine-heygen').style.display = engine === 'heygen' ? '' : 'none';
        document.getElementById('hvt-vd-engine-gemini').style.display = engine === 'gemini' ? '' : 'none';
        document.getElementById('hvt-gm-settings-toggle').style.display = engine === 'gemini' ? '' : 'none';
        if (engine !== 'gemini') document.getElementById('hvt-gm-settings').style.display = 'none';
    }

    // 勾选"追加风格补充"时把模板拼到 HeyGen photo.prompt 结果之后
    function vdApplyRefine(prompt) {
        const on    = document.getElementById('hvt-vd-refine-on');
        const extra = (document.getElementById('hvt-vd-refine-text').value || '').trim();
        if (!on || !on.checked || !extra) return prompt;
        return prompt.trim().replace(/\.?\s*$/, '.') + ' ' + extra;
    }

    // ─── Gemini 引擎：多图 → 3 个声音设计提示词方案 ─────────────────────────────
    const GM_STORE_KEY     = 'hvt_gm_settings';
    const GM_DEFAULT_MODEL = 'gemini-3.5-flash';
    // 保底白名单（2026-07 核对；2.0 系列已关停）。填了 API Key 后会从 models.list 动态拉取覆盖
    const GM_MODELS = ['gemini-3.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    const GM_MODELS_CACHE_KEY = 'hvt_gm_models_cache';
    const GM_MODELS_CACHE_TTL = 24 * 3600 * 1000;
    // OpenRouter 备用服务商（Gemini 限流/不可用时切换）。免费模型池波动大，刷新按钮实时拉取
    const OR_DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
    // 保底白名单（2026-07 从 openrouter.ai/api/v1/models 核对：免费+支持图片输入）
    const OR_MODELS = ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-nano-12b-v2-vl:free'];
    const OR_MODELS_CACHE_KEY = 'hvt_or_models_cache';
    const GM_MAX_IMAGES    = 6;
    // 默认系统指令（框架版，待精调）。用户在设置里改过则以 storage 为准。
    const GM_DEFAULT_SYS_PROMPT = `You are an expert American English voice casting director with deep specialization in Christian faith-based media. You have 20+ years of experience in US religious broadcasting, church media production, and audio content for American Christian audiences across all denominations.

**Your expertise includes:**
- How mainstream American Christian audiences perceive voice-to-appearance matching for AI avatar videos
- All major American English accent types and their regional/cultural associations
- The specific vocal qualities needed for different types of faith content (prayer, Scripture narration, prophetic declaration, devotional sharing, personal intercession)
- Writing voice design prompts for TTS voice-generation systems (such as HeyGen Voice Design), where a short English description of a voice is used to synthesize it

**Your task:**
I produce short AI avatar videos (under 1 minute each) for American English-speaking Christian audiences. I will send you one or more reference images of a person (the AI avatar). Based on the person's appearance, infer the voice that mainstream American Christian audiences would EXPECT and TRUST when hearing this person speak, then write ready-to-use English voice design prompts.

**How to reason (internally, before writing prompts):**
1. From the image(s), assess: gender; perceived age band (Young Adult 20-30 / Adult 30-45 / Mature 45-60 / Senior 60+); overall vibe (clothing, setting, expression — e.g. pastor-like, casual devotional, scholarly, motherly, youthful worship leader).
2. Choose ONE best-fit accent from: General American / Southern / African American English / Midwestern / Northeastern / Texan / Western-Californian. Default to General American unless appearance and cultural context strongly suggest otherwise; never force a stereotyped accent — when in doubt, General American.
3. Choose voice attributes using these vocabularies:
   - Pitch: Deep / Medium-Low / Medium / Medium-High / High
   - Timbre (pick 1-2): Smooth / Husky / Rich / Bright / Warm / Gravelly / Crisp / Breathy
   - Persona (pick 1-2): Steady / Gentle / Authoritative / Passionate / Casual / Solemn / Compassionate / Urgent
   - Pace: Slow / Slow-to-moderate / Moderate / Fast
4. If the user's note specifies a content type (prayer, Scripture narration, personal intercession, prophetic declaration, devotional sharing / testimony), weight the attributes toward that use; otherwise optimize for a versatile devotional/narration voice.
5. If multiple images are provided, treat them as the SAME person from different angles/scenes and synthesize one consistent judgment. If images clearly show different people, analyze only the first person and say so.

**Critical guidelines:**
- Base ALL choices on how well the voice would be received and trusted by mainstream American Christian audiences.
- Be decisive. Do not hedge with "could be either".
- Voice design prompts must be in ENGLISH, 2-4 sentences each, concrete and audio-focused: gender, age, accent, pitch, timbre, delivery/persona, pace, and intended content type. Never mention the image, appearance, ethnicity, or clothing in the prompt itself — describe only the VOICE.
- The three prompts must be meaningfully different renditions (e.g. warmer/intimate vs. more authoritative vs. brighter/younger energy), all still matching the person.
- Do NOT provide any commentary outside the format below.

**Output EXACTLY in the following format (analysis in Chinese, prompts in English):**

### 人物判断
| 维度 | 结果 |
|------|------|
| 性别 | Male / Female |
| 感知年龄段 | 〔四选一〕 |
| 形象气质 | 〔30字以内〕 |
| 口音选择 | 〔七选一 + 10字以内理由〕 |
| 音高/音色/气质/语速 | 〔如 Medium-Low · Warm+Rich · Steady+Compassionate · Slow-to-moderate〕 |
| 最适合内容 | 〔从：信仰祷告/灵修带领、圣经叙事、个人代祷、先知性宣告、日常灵修分享 中选1-2个〕 |

### 声音设计提示词

**方案1（主推 — 最贴合形象）**
\`\`\`prompt
〔English voice design prompt〕
\`\`\`

**方案2（变体 — 〔一句话说明差异方向〕）**
\`\`\`prompt
〔English voice design prompt〕
\`\`\`

**方案3（变体 — 〔一句话说明差异方向〕）**
\`\`\`prompt
〔English voice design prompt〕
\`\`\`

### 使用提示
〔40字以内：推荐语速设置、情感提示词、试听时注意什么〕`;

    let gmImages = []; // base64 (jpeg, 已压缩) 的参考图列表

    function gmGetSettings() {
        let s = {};
        try { s = JSON.parse(localStorage.getItem(GM_STORE_KEY)) || {}; } catch {}
        // 旧版本是自由文本输入，可能存了非法/已关停的模型名 → 回退默认
        const model = String(s.model || '').trim().replace(/^models\//, '');
        const known = gmKnownModels();
        const orModel = String(s.orModel || '').trim();
        const orKnown = orKnownModels();
        return {
            provider:  s.provider === 'openrouter' ? 'openrouter' : 'gemini',
            apiKey:    s.apiKey || '',
            model:     known.includes(model) ? model : (known.includes(GM_DEFAULT_MODEL) ? GM_DEFAULT_MODEL : known[0]),
            orApiKey:  s.orApiKey || '',
            orModel:   orKnown.includes(orModel) ? orModel : (orKnown.includes(OR_DEFAULT_MODEL) ? OR_DEFAULT_MODEL : orKnown[0]),
            sysPrompt: s.sysPrompt || GM_DEFAULT_SYS_PROMPT,
        };
    }

    // 动态模型列表：有效缓存 > 保底白名单
    function gmCachedModels(ignoreTtl, cacheKey) {
        try {
            const c = JSON.parse(localStorage.getItem(cacheKey || GM_MODELS_CACHE_KEY));
            if (c && Array.isArray(c.models) && c.models.length &&
                (ignoreTtl || Date.now() - c.ts < GM_MODELS_CACHE_TTL)) return c.models;
        } catch {}
        return null;
    }

    function gmKnownModels() {
        return gmCachedModels(true) || GM_MODELS;
    }

    function orKnownModels() {
        return gmCachedModels(true, OR_MODELS_CACHE_KEY) || OR_MODELS;
    }

    // 设置面板里当前选中的服务商（未保存也生效，便于切换预览）
    function gmUIProvider() {
        const sel = document.getElementById('hvt-gm-provider');
        return sel && sel.value === 'openrouter' ? 'openrouter' : 'gemini';
    }

    function gmPopulateModelSelect(selected, provider) {
        const sel = document.getElementById('hvt-gm-model');
        const or = provider === 'openrouter';
        const models = or ? orKnownModels() : gmKnownModels();
        const def = or ? OR_DEFAULT_MODEL : GM_DEFAULT_MODEL;
        sel.innerHTML = models.map(id =>
            `<option value="${id}">${id}${id === def ? '（推荐）' : ''}</option>`).join('');
        sel.value = models.includes(selected) ? selected : (models.includes(def) ? def : models[0]);
    }

    // 拉取当前服务商支持图片对话的模型，写入缓存并刷新下拉框
    // Gemini：models.list 需 API Key；OpenRouter：公开接口免 Key，只留免费+图片输入模型
    async function gmRefreshModels(force) {
        const st = gmGetSettings();
        const provider = gmUIProvider();
        const btn = document.getElementById('hvt-gm-models-refresh');
        if (provider === 'openrouter') {
            if (!force && gmCachedModels(false, OR_MODELS_CACHE_KEY)) return; // 缓存未过期
            btn.disabled = true;
            try {
                const resp = await chrome.runtime.sendMessage({ type: 'hvt_or_list_models' });
                if (!resp || !resp.ok) throw new Error((resp && resp.error) || '无响应');
                let models = resp.models
                    .filter(m => m.free && m.image && m.text)
                    .map(m => m.id)
                    .sort();
                if (!models.length) throw new Error('未过滤出免费图片模型');
                // 节点健康度：剔除所有托管节点都宕机的模型，其余按在线率降序（未知视为 50 分排中间）
                const hr = await chrome.runtime.sendMessage({ type: 'hvt_or_models_health', ids: models });
                if (hr && hr.ok) {
                    const score = id => hr.uptime[id] === null ? 50 : hr.uptime[id];
                    const healthy = models.filter(id => score(id) > 0);
                    if (healthy.length) models = healthy.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
                }
                try { localStorage.setItem(OR_MODELS_CACHE_KEY, JSON.stringify({ models, ts: Date.now() })); } catch {}
                gmPopulateModelSelect(document.getElementById('hvt-gm-model').value, 'openrouter');
                if (force) showToast(`✅ 已同步 ${models.length} 个免费图片模型`, 'success');
            } catch (e) {
                if (force) showToast('拉取模型列表失败: ' + e.message, 'error', 4000);
            } finally {
                btn.disabled = false;
            }
            return;
        }
        if (!st.apiKey) { if (force) showToast('请先填写 API Key 再刷新列表', 'error'); return; }
        if (!force && gmCachedModels(false)) return; // 缓存未过期
        btn.disabled = true;
        try {
            const resp = await chrome.runtime.sendMessage({ type: 'hvt_gemini_list_models', apiKey: st.apiKey });
            if (!resp || !resp.ok) throw new Error((resp && resp.error) || '无响应');
            const models = resp.models
                .filter(m => m.methods.includes('generateContent'))
                .filter(m => /^gemini-/.test(m.id))
                .filter(m => !/image|tts|live|embedding|audio|robotics|computer-use/.test(m.id))
                .map(m => m.id)
                .sort().reverse(); // 版本高的排前面
            if (!models.length) throw new Error('未过滤出可用模型');
            try { localStorage.setItem(GM_MODELS_CACHE_KEY, JSON.stringify({ models, ts: Date.now() })); } catch {}
            gmPopulateModelSelect(document.getElementById('hvt-gm-model').value, 'gemini');
            if (force) showToast(`✅ 已同步 ${models.length} 个可用模型`, 'success');
        } catch (e) {
            if (force) showToast('拉取模型列表失败: ' + e.message, 'error', 4000);
        } finally {
            btn.disabled = false;
        }
    }

    // 按服务商切换 Key 输入框/获取链接的显隐，并重灌模型下拉框
    function gmProviderUI() {
        const st = gmGetSettings();
        const or = gmUIProvider() === 'openrouter';
        document.getElementById('hvt-gm-key-row').style.display  = or ? 'none' : '';
        document.getElementById('hvt-or-key-row').style.display  = or ? '' : 'none';
        document.getElementById('hvt-gm-key-link').style.display = or ? 'none' : '';
        document.getElementById('hvt-or-key-link').style.display = or ? '' : 'none';
        gmPopulateModelSelect(or ? st.orModel : st.model, or ? 'openrouter' : 'gemini');
    }

    function gmLoadSettingsUI() {
        const st = gmGetSettings();
        document.getElementById('hvt-gm-provider').value = st.provider;
        document.getElementById('hvt-gm-key').value   = st.apiKey;
        document.getElementById('hvt-or-key').value   = st.orApiKey;
        gmProviderUI();
        document.getElementById('hvt-gm-sys').value   = st.sysPrompt;
    }

    function gmSaveSettings() {
        const prev = gmGetSettings();
        const or = gmUIProvider() === 'openrouter';
        const modelSel = document.getElementById('hvt-gm-model').value;
        const s = {
            provider:  or ? 'openrouter' : 'gemini',
            apiKey:    document.getElementById('hvt-gm-key').value.trim(),
            orApiKey:  document.getElementById('hvt-or-key').value.trim(),
            model:     or ? prev.model : (modelSel || GM_DEFAULT_MODEL),
            orModel:   or ? (modelSel || OR_DEFAULT_MODEL) : prev.orModel,
            sysPrompt: document.getElementById('hvt-gm-sys').value.trim() || GM_DEFAULT_SYS_PROMPT,
        };
        try { localStorage.setItem(GM_STORE_KEY, JSON.stringify(s)); } catch {}
        showToast('✅ AI 分析设置已保存', 'success');
    }

    function gmBlobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload  = () => resolve(String(r.result).split(',')[1]);
            r.onerror = () => reject(new Error('读取图片失败'));
            r.readAsDataURL(blob);
        });
    }

    async function gmAddFiles(files) {
        for (const f of files) {
            if (gmImages.length >= GM_MAX_IMAGES) { showToast(`最多 ${GM_MAX_IMAGES} 张图片`, 'error'); break; }
            try {
                const blob = await vdResizeImage(f);
                gmImages.push(await gmBlobToBase64(blob));
            } catch (e) {
                showToast('图片处理失败: ' + e.message, 'error');
            }
        }
        gmRenderThumbs();
    }

    function gmRenderThumbs() {
        const el = document.getElementById('hvt-gm-thumbs');
        el.innerHTML = gmImages.map((b, i) => `
            <span class="hvt-gm-thumb">
                <img src="data:image/jpeg;base64,${b}" alt="">
                <button data-i="${i}" title="移除">✕</button>
            </span>`).join('');
        el.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                gmImages.splice(Number(btn.dataset.i), 1);
                gmRenderThumbs();
            });
        });
    }

    // 从 Gemini 回复中提取 ```prompt 代码块；没有则退化为任意代码块
    function gmParsePrompts(text) {
        let m = [...text.matchAll(/```prompt\s*\n([\s\S]*?)```/g)].map(x => x[1].trim()).filter(Boolean);
        if (!m.length) m = [...text.matchAll(/```\s*\n([\s\S]*?)```/g)].map(x => x[1].trim()).filter(Boolean);
        return m;
    }

    let gmAnalyzeReq = null; // 进行中的分析请求 id；分析期间再点按钮 = 中止

    async function gmAnalyze() {
        const btn      = document.getElementById('hvt-gm-analyze');
        const statusEl = document.getElementById('hvt-gm-status');
        if (gmAnalyzeReq) { // 中止进行中的请求
            chrome.runtime.sendMessage({ type: 'hvt_ai_abort', reqId: gmAnalyzeReq });
            gmAnalyzeReq = null;
            btn.textContent = '🔮 分析生成提示词';
            statusEl.textContent = '已中止';
            statusEl.className = '';
            return;
        }
        const st = gmGetSettings();
        const or = st.provider === 'openrouter';
        const provName = or ? 'OpenRouter' : 'Gemini';
        if (!(or ? st.orApiKey : st.apiKey)) {
            document.getElementById('hvt-gm-settings').style.display = '';
            showToast(or ? '请先填写 OpenRouter API Key（openrouter.ai 免费获取）'
                         : '请先填写 Gemini API Key（aistudio.google.com 免费获取）', 'error', 4000);
            return;
        }
        if (!gmImages.length) { showToast('请先添加至少一张人物图片', 'error'); return; }

        const resultEl = document.getElementById('hvt-gm-result');
        const reqId = 'gm-' + Date.now();
        gmAnalyzeReq = reqId;
        btn.textContent = '⏳ 分析中…点此中止';
        statusEl.textContent = '';
        try {
            const resp = await chrome.runtime.sendMessage({
                type: or ? 'hvt_or_generate' : 'hvt_gemini_generate',
                reqId,
                apiKey: or ? st.orApiKey : st.apiKey,
                model: or ? st.orModel : st.model,
                systemPrompt: st.sysPrompt,
                images: gmImages,
                userNote: document.getElementById('hvt-gm-note').value.trim(),
            });
            if (gmAnalyzeReq !== reqId) return; // 用户已中止，忽略迟到结果
            if (!resp || !resp.ok) throw new Error((resp && resp.error) || '无响应');
            const prompts = gmParsePrompts(resp.text);
            document.getElementById('hvt-gm-analysis-text').textContent = resp.text;
            if (!prompts.length) {
                resultEl.style.display = '';
                document.getElementById('hvt-gm-analysis').open = true;
                throw new Error('未解析到提示词代码块，可查看完整回复');
            }
            gmRenderPrompts(prompts);
            resultEl.style.display = '';
            statusEl.textContent = `✅ 已生成 ${prompts.length} 个方案，勾选后点「生成所选声音」`;
            statusEl.className = 'hvt-vd-photo-ok';
        } catch (e) {
            if (gmAnalyzeReq !== reqId) return;
            statusEl.textContent = '分析失败: ' + e.message;
            statusEl.className = 'hvt-vd-photo-err';
            showToast(provName + ' 分析失败: ' + e.message, 'error', 4000);
        } finally {
            if (gmAnalyzeReq === reqId) {
                gmAnalyzeReq = null;
                btn.textContent = '🔮 分析生成提示词';
            }
        }
    }

    function gmRenderPrompts(prompts) {
        const el = document.getElementById('hvt-gm-prompts');
        el.innerHTML = prompts.map((p, i) => `
            <div class="hvt-gm-prompt-card">
                <label class="hvt-gm-prompt-head">
                    <input type="checkbox" class="hvt-gm-prompt-check" checked>
                    <span>方案${i + 1}</span>
                </label>
                <textarea class="hvt-vd-textarea hvt-gm-prompt-text">${esc(p)}</textarea>
                <button class="hvt-btn hvt-gm-fill">填入提示词框</button>
            </div>`).join('');
        el.querySelectorAll('.hvt-gm-fill').forEach(btn => {
            btn.addEventListener('click', () => {
                const card = btn.closest('.hvt-gm-prompt-card');
                document.getElementById('hvt-vd-prompt').value =
                    card.querySelector('.hvt-gm-prompt-text').value.trim();
                showToast('已填入提示词框，可编辑后点「⚡ 生成」', 'success');
            });
        });
    }

    async function gmCreateSelected() {
        const items = [...document.querySelectorAll('#hvt-gm-prompts .hvt-gm-prompt-card')]
            .map((card, i) => ({
                checked: card.querySelector('.hvt-gm-prompt-check').checked,
                label: `方案${i + 1}`,
                prompt: card.querySelector('.hvt-gm-prompt-text').value.trim(),
            }))
            .filter(it => it.checked && it.prompt);
        if (!items.length) { showToast('请先勾选至少一个方案', 'error'); return; }

        const btn      = document.getElementById('hvt-gm-create');
        const statusEl = document.getElementById('hvt-gm-status');
        btn.disabled = true;
        btn.textContent = '⏳ 生成中…';
        try {
            const groups = await vdCreateVoices(items, statusEl);
            vdRenderOptionGroups(groups);
            const total = groups.reduce((n, g) => n + g.options.length, 0);
            statusEl.textContent = `✅ 已生成 ${total} 个声音，正在后台缓存试听，点「保存」留存中意的`;
            statusEl.className = 'hvt-vd-photo-ok';
            document.getElementById('hvt-vd-options')
                .scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {
            statusEl.textContent = '生成失败: ' + e.message;
            statusEl.className = 'hvt-vd-photo-err';
            showToast('生成失败: ' + e.message, 'error', 4000);
        } finally {
            btn.disabled = false;
            btn.textContent = '⚡ 生成所选声音';
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
        if (!myUsername || !myEmail) expGetMyUsername().then(u => {
            myUsername = u;
            if (mvViewMode === 'self') mvRenderList();
        });
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
            if (btn) { btn.textContent = '🎤'; btn.title = '切换显示：本号自带声音'; btn.classList.add('hvt-btn-primary'); }
            if (title) title.textContent = '🌐 社区声音';
            if (expBtn) expBtn.style.display = 'none'; // 到期清理只针对本号自带
            if (!spaceVoices.length && !spaceFetchRunning) spacePrefetch();
            const searchEl = document.getElementById('hvt-mv-search');
            if (searchEl) searchEl.value = '';
            mvRenderList();
        } else {
            if (btn) { btn.textContent = '🌐'; btn.title = '切换显示：社区（Space）声音'; btn.classList.remove('hvt-btn-primary'); }
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

    // 多声音批量共享：N 个声音 × M 个邮箱。已共享列表在此模式下不显示（各声音各不相同，
    // 合并展示会误导；要管理单个声音的已共享名单仍走单声音弹框）。
    function mvOpenShareBatch(voices) {
        if (!voices.length) return;
        mvShareVoice = null;
        mvShareBatch = voices;
        mvShareDone = [];
        const overlay = document.getElementById('hvt-mv-share-overlay');
        if (!overlay) return;
        const names = voices.map(v => v.display_name || v.voice_id || '');
        const voiceEl = document.getElementById('hvt-mv-share-voice');
        voiceEl.innerHTML = `共享 <b>${voices.length}</b> 个声音：`
            + `<span style="color:#94a3b8">${esc(names.slice(0, 6).join('、'))}${names.length > 6 ? ` …等 ${names.length} 个` : ''}</span>`;
        voiceEl.style.cursor = 'default';
        voiceEl.title = names.join('\n');
        voiceEl.onclick = null;
        const ta = document.getElementById('hvt-mv-share-ta');
        const status = document.getElementById('hvt-mv-share-status');
        if (ta) ta.value = '';
        if (status) status.textContent = `将对每个邮箱依次共享这 ${voices.length} 个声音`;
        document.getElementById('hvt-mv-share-done').style.display = 'none';
        overlay.style.display = 'flex';
        if (ta) ta.focus();
    }

    async function mvOpenShare(v) {
        mvShareVoice = v;
        mvShareBatch = [];
        mvShareDone = [];
        const overlay = document.getElementById('hvt-mv-share-overlay');
        if (!overlay) return;
        const id = v.voice_id || '';
        const name = v.display_name || id;
        const voiceEl = document.getElementById('hvt-mv-share-voice');
        voiceEl.innerHTML =
            `共享声音：<b>${esc(name)}</b> <span style="color:#94a3b8">${esc(id.slice(0,8))}…</span> <span style="color:#64748b">📋</span>`;
        voiceEl.style.cursor = 'pointer';
        voiceEl.title = '点击复制声音名称和完整ID';
        voiceEl.onclick = () => {
            const parts = [name, id];
            if (v.language) parts.push(v.language);
            if (v.gender) parts.push(v.gender);
            navigator.clipboard.writeText(parts.join('\t')).then(() => {
                const old = voiceEl.innerHTML;
                voiceEl.innerHTML = `共享声音：<b>${esc(name)}</b> <span style="color:#16a34a">✅ 已复制</span>`;
                setTimeout(() => { voiceEl.innerHTML = old; }, 1200);
            });
        };
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
        if (mvShareRunning) { mvShareAbort = true; if (mvShareWaitCancel) mvShareWaitCancel(); }
        if (overlay) overlay.style.display = 'none';
        mvShareVoice = null;
        mvShareBatch = [];
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

    // 单声音（mvShareVoice）与多声音（mvShareBatch）共用：展开成 (声音 × 邮箱) 任务串行执行
    async function mvShareGo() {
        const ta = document.getElementById('hvt-mv-share-ta');
        const status = document.getElementById('hvt-mv-share-status');
        const btn = document.getElementById('hvt-mv-share-go');
        if (mvShareRunning) {                     // 运行中再点 = 停止
            mvShareAbort = true;
            if (mvShareWaitCancel) mvShareWaitCancel();
            return;
        }
        const voices = mvShareBatch.length ? mvShareBatch : (mvShareVoice ? [mvShareVoice] : []);
        if (!voices.length) return;
        const single = !mvShareBatch.length;
        // 单声音模式下已共享过的邮箱直接跳过；多声音模式各声音名单不同，不做过滤
        const emails = mvExtractEmails(ta.value).filter(e => !single || !mvShareDone.includes(e));
        if (!emails.length) { status.textContent = '⚠️ 未检测到有效邮箱（或都已共享）'; return; }

        const jobs = [];
        for (const email of emails) for (const v of voices) jobs.push({ email, v });

        mvShareRunning = true; mvShareAbort = false;
        const oldLabel = btn.textContent;
        let shared = 0, failed = 0;

        for (let i = 0; i < jobs.length; i++) {
            if (mvShareAbort) break;
            const { email, v } = jobs[i];
            btn.textContent = `■ 停止 (${i + 1}/${jobs.length})`;
            status.textContent = single
                ? `共享中 ${i + 1}/${jobs.length}…`
                : `共享中 ${i + 1}/${jobs.length}：${v.display_name || v.voice_id} → ${email}`;
            try {
                await heygenApi('/v1/share_resources', {
                    method: 'POST',
                    body: JSON.stringify({
                        resource_type: 'VOICE',
                        resource_id: v.voice_id || '',
                        destination_email_address: email,
                    }),
                });
                shared++;
                if (single) { mvShareDone.push(email); mvShareRenderDone(); }
            } catch (e) {
                failed++;
            }
            // 4~8 秒随机延迟，避免操作太快被服务器拒绝
            if (i < jobs.length - 1 && !mvShareAbort) await mvShareSleep(4000 + Math.random() * 4000);
        }

        const tail = mvShareAbort ? '（已停止）' : '';
        const scope = single ? '' : `（${voices.length} 个声音 × ${emails.length} 个邮箱）`;
        status.textContent = (failed > 0
            ? `✅ 成功 ${shared} 条，${failed} 条失败${scope}`
            : `✅ 已共享 ${shared} 条${scope}`) + tail;
        if (shared > 0 && !failed && !mvShareAbort) ta.value = '';
        mvShareRunning = false;
        btn.textContent = oldLabel;
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
        try {
            const d = await heygenApi('/v1/user.get');
            expMyUsername = d?.username || null;
            myEmail = d?.email || null;
        } catch { expMyUsername = null; }
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

    // 试听音频长期缓存（IndexedDB，key = voice_id，value = mp3 Blob）
    const MV_AUDIO_DB = 'hvt_audio_cache';
    function mvAudioDbOpen() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(MV_AUDIO_DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore('audio');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async function mvAudioGet(id) {
        try {
            const db = await mvAudioDbOpen();
            return await new Promise((resolve) => {
                const req = db.transaction('audio').objectStore('audio').get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch { return null; }
    }
    async function mvAudioPut(id, blob) {
        try {
            const db = await mvAudioDbOpen();
            db.transaction('audio', 'readwrite').objectStore('audio').put(blob, id);
        } catch {}
    }
    async function mvAudioClearAll() {
        try {
            const db = await mvAudioDbOpen();
            const store = db.transaction('audio', 'readwrite').objectStore('audio');
            const n = await new Promise((resolve) => {
                const req = store.count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(0);
            });
            store.clear();
            showToast(`✅ 已清空 ${n} 条试听缓存，下次试听将重新加载`, 'success', 2500);
        } catch (e) {
            showToast('清空失败: ' + e.message, 'error');
        }
    }

    // Stream preview audio from HeyGen API → Uint8Array of MP3 bytes
    // Endpoint: POST /v2/online/voice.stream_preview  body: {voice_id, language}
    // Response: application/x-ndjson, each line = {audio_bytes: base64} | heartbeat
    async function mvStreamPreview(voiceId, language, spaceId) {
        const res = await fetch(`${API_BASE}/v2/online/voice.stream_preview`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                ...HVT_FETCH_HEADERS,
                'content-type': 'application/json',
                'accept': 'application/x-ndjson',
                'x-heygen-service': 'voice',
                ...(spaceId ? { 'x-space-id': spaceId } : {}),
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

    async function mvTogglePlay(v, force) {
        const id = v.voice_id;
        if (mvPlayingId === id) { mvStopAudio(); return; }
        mvStopAudio();
        const btn = document.querySelector(`.hvt-mv-play-btn[data-mv-id="${CSS.escape(id)}"]`);
        if (btn) { btn.dataset.loading = '1'; btn.disabled = true; delete btn.dataset.errored; }
        try {
            let blob = force ? null : await mvAudioGet(id);
            if (!blob) {
                if (!myUsername) myUsername = await expGetMyUsername();
                const spaceId = v._space || myUsername;
                const audioBytes = await mvStreamPreview(id, v.language || 'English', spaceId);
                blob = new Blob([audioBytes], { type: 'audio/mpeg' });
                mvAudioPut(id, blob);
            }
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
        const shareSelBtn = document.getElementById('hvt-mv-share-sel');
        if (shareSelBtn) {
            shareSelBtn.style.display = n > 0 ? 'inline-flex' : 'none';
            shareSelBtn.textContent = `🔗 共享选中 (${n})`;
        }
        const delSelBtn = document.getElementById('hvt-mv-del-sel');
        if (delSelBtn) {
            delSelBtn.style.display = n > 0 ? 'inline-flex' : 'none';
            if (!mvDelRunning && !spaceDelRunning) delSelBtn.textContent = `🗑 删除选中 (${n})`;
        }
        const clearSelBtn = document.getElementById('hvt-mv-clear-sel');
        if (clearSelBtn) clearSelBtn.style.display = n > 0 ? 'inline-flex' : 'none';
        if (selCountEl) selCountEl.textContent = n > 0 ? `已选 ${n} 个` : '';
    }

    function mvClearSelection() {
        mvActiveSel().clear();
        document.querySelectorAll('#hvt-mv-list .hvt-mv-chk').forEach(chk => { chk.checked = false; });
        mvUpdateSelectionUI();
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

    // 名称/ID 交互：单击复制、名称双击改名（替代原来的复制小按钮）
    function mvBindCopyRename(row, v, canRename, persist) {
        const nameEl = row.querySelector('.hvt-mv-name');
        const idEl = row.querySelector('.hvt-mv-id');
        idEl.addEventListener('click', () => {
            navigator.clipboard.writeText(v.voice_id || '').then(() => showToast('✅ 已复制 Voice ID', 'success', 1500));
        });
        let clickTimer = null; // 延迟单击，给双击让路
        nameEl.addEventListener('click', () => {
            if (nameEl.dataset.editing) return;
            clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                navigator.clipboard.writeText(v.display_name || v.voice_id || '').then(() => showToast('✅ 已复制名称', 'success', 1500));
            }, 280);
        });
        nameEl.addEventListener('dblclick', () => {
            clearTimeout(clickTimer);
            if (!canRename) { showToast('只能改名自己创建的声音', 'error'); return; }
            mvStartRename(nameEl, v, persist);
        });
    }

    // creator_username 是随机哈希，不是邮箱；真实邮箱要么是自己（myEmail），
    // 要么从 Space 成员表（spaceMemberEmails，spacePrefetch 时填充）里查。
    function mvResolveCreatorEmail(v) {
        if (spaceMemberEmails.has(v.creator_username)) return spaceMemberEmails.get(v.creator_username);
        if (myUsername && v.creator_username === myUsername) return myEmail || '';
        return '';
    }

    // 行内非按钮区域单击：复制该声音完整信息（名称/ID/引擎/所属邮箱），每项一行
    function mvBindRowCopy(row, v) {
        row.addEventListener('click', (e) => {
            if (e.target.closest('input, button, a, .hvt-mv-name, .hvt-mv-id')) return;
            const name = v.display_name || v.voice_id || '';
            const id = v.voice_id || '';
            const eng = mvEngineInfo(v.default_voice_engine);
            const text = [name, id, eng ? eng.full : '', mvResolveCreatorEmail(v)].join('\n');
            navigator.clipboard.writeText(text).then(() => showToast('✅ 已复制完整信息', 'success', 1500));
        });
    }

    function mvStartRename(nameEl, v, persist) {
        if (nameEl.dataset.editing) return;
        nameEl.dataset.editing = '1';
        const old = v.display_name || v.voice_id || '';
        const input = document.createElement('input');
        input.className = 'hvt-mv-rename-input';
        input.value = v.display_name || '';
        nameEl.replaceChildren(input);
        input.focus();
        input.select();
        let done = false;
        const finish = async (save) => {
            if (done) return;
            done = true;
            const newName = input.value.trim();
            if (!save || !newName || newName === v.display_name) {
                delete nameEl.dataset.editing;
                nameEl.textContent = old;
                return;
            }
            nameEl.textContent = '保存中…';
            try {
                await heygenApi('/v1/voice/rename', {
                    method: 'POST',
                    body: JSON.stringify({ voice_id: v.voice_id, display_name: newName }),
                });
                v.display_name = newName;
                nameEl.textContent = newName;
                nameEl.title = `${newName}（单击复制 · 双击改名）`;
                persist();
                showToast('✅ 已改名', 'success');
            } catch (e) {
                nameEl.textContent = old;
                showToast('改名失败: ' + e.message, 'error', 4000);
            } finally {
                delete nameEl.dataset.editing;
            }
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') finish(true);
            else if (e.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
    }

    function mvPersistCache() {
        try {
            localStorage.setItem(MV_CACHE_KEY, JSON.stringify({ ts: Date.now(), voices: mvVoices }));
            return true;
        } catch { return false; }
    }

    // 仅保留 UI 用到的字段，砍掉 preview 嵌套对象/shared_to 等重元数据，
    // 避免 3000+ 条完整对象序列化超 localStorage ~5MB 配额导致写盘静默失败、缓存永不命中。
    function spaceSlimVoice(v) {
        return {
            voice_id: v.voice_id,
            display_name: v.display_name,
            gender: v.gender,
            language: v.language,
            default_voice_engine: v.default_voice_engine,
            creator_username: v.creator_username,
            preview_audio: v.preview_audio || mvGetAudioUrl(v) || '', // 展平试听地址，丢弃 preview 对象
            _space: v._space,
            _spaceName: v._spaceName,
            _origin: v._origin,
        };
    }

    function spacePersistCache() {
        try {
            const slim = spaceVoices.map(spaceSlimVoice);
            localStorage.setItem(SPACE_CACHE_KEY, JSON.stringify({ ts: Date.now(), voices: slim, members: [...spaceMembers] }));
            return true;
        } catch { return false; }
    }

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
            const isMine = myUsername ? v.creator_username === myUsername : null;
            const originDot = isMine === null ? '' : `<span class="hvt-mv-origin-dot ${isMine ? 'hvt-origin-self' : 'hvt-origin-shared'}" title="${isMine ? '本账号创建' : '其他账号分享给本账号'}"></span>`;

            const row = document.createElement('div');
            row.className = 'hvt-mv-row';
            row.innerHTML = `
                <input type="checkbox" class="hvt-mv-chk" title="选择下载">
                <button class="hvt-mv-play-btn" data-mv-id="${esc(id)}" title="试听（首次加载后长期缓存；Shift+点击强制重新加载）">
                    <svg class="ic-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                    <svg class="ic-stop" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
                    <svg class="ic-spin" viewBox="0 0 24 24" style="display:none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="28" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
                </button>
                ${originDot}
                <span class="hvt-mv-name" title="${esc(name)}（单击复制 · 双击改名）">${esc(name)}</span>
                <span class="hvt-mv-gender ${gender === 'female' ? 'hvt-f' : (gender === 'male' ? 'hvt-m' : '')}">${genderIcon}</span>
                <span class="hvt-mv-locale">${esc(lang) || '—'}</span>
                <span class="hvt-mv-engine ${eng ? eng.cls : ''}" title="${eng ? `引擎: ${esc(eng.full)}` : ''}">${eng ? esc(eng.short) : '—'}</span>
                <span class="hvt-mv-id" title="${esc(id)}（单击复制）">${esc(id.slice(0,16))}…</span>
                <button class="hvt-mv-share-btn hvt-btn" title="共享给团队成员（批量邮箱）">🔗</button>
                <button class="hvt-mv-dl-btn hvt-btn" title="下载 MP3">⬇</button>
            `;
            const chk = row.querySelector('.hvt-mv-chk');
            chk.addEventListener('change', () => {
                if (chk.checked) mvSelectedIds.add(id);
                else mvSelectedIds.delete(id);
                mvUpdateSelectionUI();
            });
            row.querySelector('.hvt-mv-play-btn').addEventListener('click', (e) => mvTogglePlay(v, e.shiftKey));
            mvBindCopyRename(row, v, true, mvPersistCache);
            mvBindRowCopy(row, v);
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
        const filtered = q
            ? spaceVoices.filter(v => (v.display_name || '').toLowerCase().includes(q) || (v.voice_id || '').toLowerCase().includes(q))
            : spaceVoices;
        // 自生成置顶：稳定排序，自生成在前、分享进来在后，组内保持原有相对顺序
        const visible = filtered
            .map((v, i) => [v, i])
            .sort((a, b) => {
                const sa = a[0]._origin === 'shared' ? 1 : 0;
                const sb = b[0]._origin === 'shared' ? 1 : 0;
                return sa - sb || a[1] - b[1];
            })
            .map(pair => pair[0]);

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
        spaceSelectedIds.clear();      // 默认不勾选任何行：删除后重渲染也不再全选自生成
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

            const row = document.createElement('div');
            row.className = 'hvt-mv-row';
            row.innerHTML = `
                <input type="checkbox" class="hvt-mv-chk" title="选择删除/下载">
                <button class="hvt-mv-play-btn" data-mv-id="${esc(id)}" title="试听（首次加载后长期缓存；Shift+点击强制重新加载）">
                    <svg class="ic-play" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
                    <svg class="ic-stop" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>
                    <svg class="ic-spin" viewBox="0 0 24 24" style="display:none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="28" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
                </button>
                <span class="hvt-sp-origin ${isShared ? 'hvt-sp-shared' : 'hvt-sp-self'}" title="${isShared ? '由社区外账号分享进来' : '在本社区内创建'}">${isShared ? '分享进来' : '自生成'}</span>
                <span class="hvt-mv-name" title="${esc(name)}（单击复制 · 双击改名）">${esc(name)}</span>
                <span class="hvt-mv-gender ${gender === 'female' ? 'hvt-f' : (gender === 'male' ? 'hvt-m' : '')}">${genderIcon}</span>
                ${lang ? `<span class="hvt-mv-locale">${esc(lang)}</span>` : ''}
                ${eng ? `<span class="hvt-mv-engine ${eng.cls}" title="引擎: ${esc(eng.full)}">${esc(eng.short)}</span>` : ''}
                <span class="hvt-mv-id" title="${esc(id)}（单击复制）">${esc(id.slice(0,16))}…</span>
                <button class="hvt-mv-dl-btn hvt-btn" title="下载 MP3">⬇</button>
            `;
            const chk = row.querySelector('.hvt-mv-chk');
            chk.addEventListener('change', () => {
                if (chk.checked) spaceSelectedIds.add(id);
                else spaceSelectedIds.delete(id);
                mvUpdateSelectionUI();
            });
            row.querySelector('.hvt-mv-play-btn').addEventListener('click', (e) => mvTogglePlay(v, e.shiftKey));
            mvBindCopyRename(row, v, !!(myUsername && v.creator_username === myUsername), spacePersistCache);
            mvBindRowCopy(row, v);
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
        spacePersistCache();
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
            await mvRefreshVoices();
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
        for (;;) {
            let url = `/v2/pacific/voice_clone/voice.list?page_size=50`;
            if (nextToken) url += `&next_token=${encodeURIComponent(nextToken)}`;
            const data = await heygenApi(url);
            const list = data.data || data.list || data.voices || [];
            const fresh = list.filter(v => v.voice_id && !seenIds.has(v.voice_id));
            if (fresh.length === 0) break; // API 耗尽后可能重复首页，以去重作为真实终止条件
            fresh.forEach(v => seenIds.add(v.voice_id));
            allVoices = allVoices.concat(fresh);
            nextToken = data.next_pagination_token || null;
            if (!nextToken) break;
        }
        return allVoices;
    }

    function mvRefreshVoices() {
        if (mvRefreshPromise) return mvRefreshPromise;
        mvRefreshPromise = (async () => {
            const allVoices = await mvFetchAllVoices();
            mvVoices = allVoices;
            return { voices: allVoices, persisted: mvPersistCache() };
        })().finally(() => { mvRefreshPromise = null; });
        return mvRefreshPromise;
    }

    // Populate mvVoices for the AIS panel. Cache-first for an instant open, then
    // ALWAYS revalidate in the background: voices shared by other accounts only
    // live in voice_clone/voice.list and are absent from an older cached snapshot,
    // so we must not wait for the 24h TTL to expire before they become searchable.
    async function mvEnsureCache() {
        const c = mvReadCache();
        if (c && mvVoices.length === 0) mvVoices = c.voices;
        try {
            await mvRefreshVoices();
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

    async function fetchSpaces(throwOnError = false) {
        try {
            const d = await heygenApi('/v1/space.list');
            spacesList = (d.list || []).map(s => ({ id: s.space_id, name: s.space_name }));
        } catch (e) {
            spacesList = [];
            if (throwOnError) throw e;
        }
        return spacesList;
    }

    async function fetchSpaceMembers(spaceId) {
        try {
            const d = await heygenApi('/v1/space/user.list?include_superadmins=true', { headers: { 'x-space-id': spaceId } });
            const arr = Array.isArray(d) ? d : (d.list || d.users || []); // user.list 的 data 直接是数组
            return arr.filter(u => u.username);
        } catch { return []; }
    }

    // creator === 当前账号 → 自生成（与实际删除权限一致）；否则分享进来。
    // myUsername 尚未取到时，退化用「creator ∈ Space 成员」/ shared_to 是否含邮箱兜底判定
    // （仅为展示用近似值，不影响实际删除仍按 creator_username === myUsername 严格校验）。
    function classifyOrigin(v) {
        if (myUsername) return v.creator_username === myUsername ? 'self' : 'shared';
        if (spaceMembers.size) return spaceMembers.has(v.creator_username) ? 'self' : 'shared';
        const keys = Object.keys(v.spaces_or_users_shared_to || {});
        return keys.some(k => k.includes('@')) ? 'shared' : 'self';
    }

    // 后台静默慢速拉取：所属 Space 逐页取，页间加随机延迟防风控，不设分页上限。
    async function runSpacePrefetch() {
        if (!myUsername) myUsername = await expGetMyUsername();
        await fetchSpaces(true);

        const memberSet = new Set();
        spaceMemberEmails = new Map();
        for (const sp of spacesList) {
            (await fetchSpaceMembers(sp.id)).forEach(u => {
                memberSet.add(u.username);
                if (u.email) spaceMemberEmails.set(u.username, u.email);
            });
            await mvShareSleep(600 + Math.random() * 600);
        }
        spaceMembers = memberSet;

        const collected = [];
        const collectedIds = new Set();
        for (const sp of spacesList) {
            let token = null;
            const seenInSpace = new Set();
            for (;;) {                                   // 不设上限，拉到 next_token 为空
                let url = '/v2/pacific/voice_clone/voice.list?page_size=50';
                if (token) url += '&next_token=' + encodeURIComponent(token);
                // 单页重试：瞬时错误（限流/非100）不应中断整段分页
                let data = null;
                let lastError = null;
                for (let attempt = 0; attempt < 4 && !data; attempt++) {
                    try { data = await heygenApi(url, { headers: { 'x-space-id': sp.id } }); }
                    catch (e) {
                        lastError = e;
                        if (attempt < 3) await mvShareSleep(1500 + Math.random() * 1500);
                    }
                }
                if (!data) throw new Error(`Space「${sp.name || sp.id}」声音拉取失败: ${lastError?.message || '未知错误'}`);
                const list = data.data || data.list || data.voices || [];
                const freshInSpace = list.filter(v => v.voice_id && !seenInSpace.has(v.voice_id));
                if (!freshInSpace.length) break;          // 仅以当前 Space 的重复页判断耗尽
                freshInSpace.forEach(v => {
                    seenInSpace.add(v.voice_id);
                    if (collectedIds.has(v.voice_id)) return; // 展示层仍按 voice_id 去重，但不能提前截断后续分页
                    collectedIds.add(v.voice_id);
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
        const persisted = spacePersistCache();

        // 面板已打开 → 刷新展示
        const aisOverlay = document.getElementById('hvt-ais-overlay');
        if (aisOverlay && aisOverlay.style.display !== 'none') {
            const s = document.getElementById('hvt-ais-search');
            aisSearchVoices(s ? s.value : '');
        }
        const mvOverlay = document.getElementById('hvt-mv-overlay');
        if (mvOverlay && mvOverlay.style.display !== 'none' && mvViewMode === 'space') mvRenderList();
        return { voices: collected, spaces: spacesList.length, persisted };
    }

    function spacePrefetch({ throwOnError = false } = {}) {
        if (!spaceFetchPromise) {
            spaceFetchRunning = true;
            spaceFetchPromise = runSpacePrefetch().finally(() => {
                spaceFetchRunning = false;
                spaceFetchPromise = null;
            });
        }
        if (throwOnError) return spaceFetchPromise;
        return spaceFetchPromise.catch(e => {
            console.warn('[HVT] Space voice prefetch failed:', e);
            return null;
        });
    }

    // 缓存命中即用，并在后台启动一次刷新（SWR）
    function spaceInit() {
        const c = spaceReadCache();
        if (c) {
            spaceVoices = c.voices;
            spaceMembers = new Set(c.members || []);
        }
        // 缓存新鲜（24h 内）→ 直接用缓存、不后台全量重扫；缺失或过期才自动拉。想要最新点 ↺ 强制刷新。
        if (!c || Date.now() - (c.ts || 0) >= SPACE_CACHE_TTL) {
            setTimeout(() => {
                // 首次扫描由 scheduleStartupVoiceScan 的跨标签锁统一负责；这里只处理后续 TTL 刷新。
                const startupState = readStartupVoiceScanState();
                if (!myUsername || startupState.username !== myUsername || !startupState.completedAt) return;
                const latest = spaceReadCache();
                if (!latest || Date.now() - (latest.ts || 0) >= SPACE_CACHE_TTL) spacePrefetch();
            }, 3000);
        }
    }

    function readStartupVoiceScanState() {
        try {
            const state = JSON.parse(localStorage.getItem(STARTUP_VOICE_SCAN_KEY));
            return state && typeof state === 'object' ? state : {};
        } catch { return {}; }
    }

    function writeStartupVoiceScanState(state) {
        localStorage.setItem(STARTUP_VOICE_SCAN_KEY, JSON.stringify(state));
    }

    async function runStartupVoiceScan() {
        const username = await expGetMyUsername();
        if (!username) throw new Error('无法读取当前 HeyGen 账号');
        myUsername = username;

        const scan = async () => {
            const state = readStartupVoiceScanState();
            const personalCache = mvReadCache();
            const spaceCache = spaceReadCache();
            if (state.username === username && state.completedAt && personalCache && spaceCache) {
                mvVoices = personalCache.voices;
                spaceVoices = spaceCache.voices;
                spaceMembers = new Set(spaceCache.members || []);
                return;
            }

            if (state.username && state.username !== username) {
                localStorage.removeItem(MV_CACHE_KEY);
                localStorage.removeItem(SPACE_CACHE_KEY);
                mvVoices = [];
                spaceVoices = [];
                spaceMembers = new Set();
                spaceMemberEmails = new Map();
                spacesList = [];
            }

            const personalResult = await mvRefreshVoices();
            const spaceResult = await spacePrefetch({ throwOnError: true });
            if (!personalResult.persisted || !spaceResult.persisted) throw new Error('声音缓存写入失败');

            const completed = {
                username,
                completedAt: Date.now(),
                personalCount: personalResult.voices.length,
                spaceCount: spaceResult.voices.length,
                spacesScanned: spaceResult.spaces,
            };
            writeStartupVoiceScanState(completed);
            console.info('[HVT] First voice scan completed:', completed);
        };

        if (!navigator.locks) return scan();
        return navigator.locks.request(`hvt_startup_voice_scan_v1:${username}`, { mode: 'exclusive' }, scan);
    }

    function scheduleStartupVoiceScan() {
        setTimeout(() => {
            runStartupVoiceScan().catch(e => {
                console.warn('[HVT] First voice scan failed; it will retry on the next page load:', e);
            });
        }, 1500);
    }

    // ─── Project Videos（找我的视频）──────────────────────────────────────────
    const PV_PROJECT_TYPES = [
        'video_translate', 'video', 'mixed',
        'batch_video_translate', 'batch_avatar_video_translate', 'batch_video',
    ];
    const PV_ITEM_TYPES = [
        'video_translate', 'video_translate_proofread', 'heygen_video',
        'heygen_video_draft', 'interactive_video', 'video_repurpose',
        'video_agent', 'video_agent_edit', 'batch_video', 'batch_video_translate',
        'batch_avatar_video_translate', 'heygen_podcast', 'seedance_2',
        'upscale_video', 'filler_removal',
    ];
    const PV_SCAN_CONCURRENCY = 4;
    const PV_SCAN_MAX_PAGES_PER_FOLDER = 2; // 默认快速扫描：每夹最多 200 条，避免团队大库卡太久

    function pvReadLedger() {
        try { return JSON.parse(localStorage.getItem(PV_LEDGER_KEY)) || {}; } catch { return {}; }
    }
    function pvWriteLedger(ledger) {
        try { localStorage.setItem(PV_LEDGER_KEY, JSON.stringify(ledger)); } catch {}
    }
    function pvLedgerKey(spaceId, videoId) {
        return `${spaceId || 'personal'}::${videoId || ''}`;
    }
    function pvItemId(item) {
        return item.video_id || item.item_id || item.id || item.resource_id || '';
    }
    function pvItemOwner(item) {
        return item.username || item.creator_username || item.creator || item.created_by || '';
    }
    function pvProjectIdOf(item) {
        return item.project_id || item.folder_id || item.parent_id || '';
    }
    function pvAppendAll(params, key, values) {
        values.forEach(v => params.append(key, v));
        return params;
    }
    function pvNormalizePath(project) {
        const raw = project.project_path || project.path || project.paths || [];
        let parts = [];
        if (Array.isArray(raw)) {
            parts = raw.map(p => typeof p === 'string' ? p : (p?.name || p?.title || '')).filter(Boolean);
        } else if (typeof raw === 'string') {
            parts = raw.split('/').map(s => s.trim()).filter(Boolean);
        }
        const name = project.name || project.title || project.project_name || '';
        if (name && parts[parts.length - 1] !== name) parts.push(name);
        return parts.length ? parts.join(' / ') : (name || '未命名文件夹');
    }
    function pvFormatDate(value) {
        if (!value) return '-';
        let d = null;
        if (typeof value === 'number') d = new Date(value < 1000000000000 ? value * 1000 : value);
        else d = new Date(String(value).replace(' ', 'T'));
        if (!d || Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function pvDateMs(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value < 1000000000000 ? value * 1000 : value;
        const t = new Date(String(value).replace(' ', 'T')).getTime();
        return Number.isFinite(t) ? t : 0;
    }
    function pvIsOlderThan(row, days) {
        if (!days) return true;
        const t = pvDateMs(row.createdTs);
        if (!t) return false;
        return t <= Date.now() - days * 24 * 60 * 60 * 1000;
    }
    function pvAgeDays() {
        const ageEl = document.getElementById('hvt-pv-age');
        const customEl = document.getElementById('hvt-pv-age-custom');
        if (ageEl?.value === 'custom') {
            return Math.max(0, parseInt(customEl?.value || '0', 10) || 0);
        }
        return Math.max(0, parseInt(ageEl?.value || '0', 10) || 0);
    }
    function pvUpdateAgeCustomVisibility() {
        const ageEl = document.getElementById('hvt-pv-age');
        const customEl = document.getElementById('hvt-pv-age-custom');
        if (!ageEl || !customEl) return;
        customEl.style.display = ageEl.value === 'custom' ? 'block' : 'none';
        if (ageEl.value === 'custom') customEl.focus();
    }
    function pvFolderUrl(row) {
        const base = 'https://app.heygen.com/projects';
        return row.projectId ? `${base}?project_id=${encodeURIComponent(row.projectId)}` : base;
    }
    function pvDownloadUrl(row) {
        return row.downloadUrl || row.videoUrl || '';
    }
    function pvDownloadFilename(row) {
        const raw = (row.name || row.id || 'heygen-video')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
        const id = row.id ? `-${String(row.id).slice(0, 8)}` : '';
        return `HeyGenVideos/${raw || 'heygen-video'}${id}.mp4`;
    }
    function pvDownloadVideo(row) {
        const url = pvDownloadUrl(row);
        if (!url) {
            showToast('这个视频暂时没有下载链接，可能还在生成中', 'info', 3000);
            return;
        }
        const filename = pvDownloadFilename(row);
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'hvt_download', url, filename }, (res) => {
                if (chrome.runtime.lastError || !res?.ok) {
                    showToast('下载失败: ' + (chrome.runtime.lastError?.message || res?.error || '未知错误'), 'error', 4000);
                } else {
                    showToast('已开始下载视频', 'success', 2500);
                }
            });
            return;
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('已开始下载视频', 'success', 2500);
    }

    async function pvFetchProjects(space) {
        const params = pvAppendAll(new URLSearchParams({
            traverse_deep: 'true',
            is_trash: 'false',
            limit: '999',
        }), 'project_types', PV_PROJECT_TYPES);
        const data = await heygenApi('/v1/projects?' + params, space.id ? { headers: { 'x-space-id': space.id } } : {});
        const items = data.items || data.list || data.projects || [];
        const root = {
            id: '',
            name: '根目录',
            path: '根目录',
            spaceId: space.id || '',
            spaceName: space.name || '当前空间',
        };
        const projects = items.map(p => ({
            id: p.id || p.project_id || '',
            name: p.name || p.title || p.project_name || '未命名文件夹',
            path: pvNormalizePath(p),
            spaceId: space.id || '',
            spaceName: space.name || '当前空间',
        })).filter(p => p.id);
        return [root, ...projects];
    }

    async function pvFetchItemsForProject(space, project) {
        const rows = [];
        const seen = new Set();
        let token = null;
        for (let page = 0; page < PV_SCAN_MAX_PAGES_PER_FOLDER; page++) {
            if (pvAbort) break;
            const params = pvAppendAll(new URLSearchParams({
                limit: '100',
                sort_key: 'created_ts',
                sort_order: 'desc',
                is_trash: 'false',
            }), 'item_types', PV_ITEM_TYPES);
            if (project.id) params.set('project_id', project.id);
            if (token) params.set('token', token);
            const data = await heygenApi('/v1/project/items?' + params, space.id ? { headers: { 'x-space-id': space.id } } : {});
            const items = data.items || data.list || data.projects || [];
            const fresh = items.filter(item => {
                const id = pvItemId(item);
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            });
            rows.push(...fresh);
            token = data.token || data.next_token || data.next_pagination_token || null;
            if (!token || fresh.length === 0) break;
            await mvShareSleep(120 + Math.random() * 180);
        }
        return rows;
    }

    async function pvFetchItemsForProjects(space, projects, onProgress) {
        const allItems = [];
        let nextIndex = 0;
        let done = 0;
        async function worker() {
            for (;;) {
                if (pvAbort) break;
                const idx = nextIndex++;
                if (idx >= projects.length) break;
                const p = projects[idx];
                if (onProgress) onProgress(done + 1, projects.length, p);
                try {
                    const items = await pvFetchItemsForProject(space, p);
                    items.forEach(item => {
                        item._spaceId = space.id || '';
                        item._spaceName = space.name || '当前空间';
                        item._projectId = p.id || '';
                    });
                    allItems.push(...items);
                } catch (e) {
                    console.warn('[hvt] 读取文件夹视频失败:', p.path, e);
                } finally {
                    done++;
                    if (onProgress) onProgress(done, projects.length, p);
                }
            }
        }
        const workers = Array.from({ length: Math.min(PV_SCAN_CONCURRENCY, projects.length) }, () => worker());
        await Promise.all(workers);
        return allItems;
    }

    function pvBuildRows(items, projectMap, me, oldLedger) {
        const nextLedger = {};
        const rows = [];
        const seenRows = new Set();
        for (const item of items) {
            const owner = pvItemOwner(item);
            if (me && owner !== me) continue;
            const videoId = pvItemId(item);
            if (!videoId) continue;
            const spaceId = item._spaceId || '';
            const rowKey = pvLedgerKey(spaceId, videoId);
            if (seenRows.has(rowKey)) continue;
            seenRows.add(rowKey);
            const itemProjectId = pvProjectIdOf(item) || item._projectId || '';
            // 非根 project_id 解析失败时不得回退到根目录条目，否则台账/位置变更
            // 文案会把「未知文件夹」误记成「根目录」
            const folder = projectMap.get(`${spaceId}::${itemProjectId}`)
                || (itemProjectId ? null : projectMap.get(`${spaceId}::`))
                || {
                id: itemProjectId,
                name: itemProjectId ? '未知文件夹' : '根目录',
                path: itemProjectId ? '未知文件夹' : '根目录',
                spaceName: item._spaceName || '当前空间',
            };
            const key = rowKey;
            const previous = oldLedger[key];
            const moved = !!(previous && previous.projectId !== itemProjectId);
            nextLedger[key] = {
                projectId: itemProjectId,
                folderPath: folder.path,
                name: item.name || item.title || item.video_title || videoId,
                seenAt: Date.now(),
            };
            rows.push({
                id: videoId,
                itemType: item.item_type || item.type || 'heygen_video',
                name: item.name || item.title || item.video_title || videoId,
                status: item.status || item.item_status || item.video_status || '',
                createdTs: item.created_ts || item.created_at || item.create_time || '',
                thumbnail: item.thumbnail_url || item.cover_url || item.cover || item.image_url || '',
                downloadUrl: item.video_download_url || item.download_url || '',
                videoUrl: item.video_url || '',
                projectId: itemProjectId,
                folderName: folder.name,
                folderPath: folder.path,
                spaceId,
                spaceName: folder.spaceName || item._spaceName || '当前空间',
                owner,
                moved,
                movedFrom: previous ? previous.folderPath : '',
            });
        }
        rows.sort((a, b) => {
            return pvDateMs(b.createdTs) - pvDateMs(a.createdTs);
        });
        return { rows, nextLedger };
    }

    async function pvScan() {
        if (pvScanning) return;
        const listEl = document.getElementById('hvt-pv-list');
        const statusEl = document.getElementById('hvt-pv-status');
        const scanBtn = document.getElementById('hvt-pv-scan');
        const stopBtn = document.getElementById('hvt-pv-stop');
        pvScanning = true;
        pvAbort = false;
        pvRows = [];
        pvSelected.clear();
        if (scanBtn) scanBtn.disabled = true;
        if (stopBtn) stopBtn.style.display = 'inline-flex';
        if (listEl) listEl.innerHTML = '<div class="hvt-pv-empty">扫描中…</div>';
        try {
            const me = await expGetMyUsername();
            if (!me) throw new Error('无法识别当前登录账号，请确认 HeyGen 已登录');
            await fetchSpaces();
            const spaces = spacesList.length ? spacesList : [{ id: '', name: '当前空间' }];
            const projectMap = new Map();
            const allItems = [];
            let folderCount = 0;
            for (const sp of spaces) {
                if (pvAbort) break;
                if (statusEl) statusEl.textContent = `读取 ${sp.name || '当前空间'} 文件夹…`;
                let projects = [];
                try {
                    projects = await pvFetchProjects(sp);
                } catch (e) {
                    console.warn('[hvt] 读取项目文件夹失败:', sp.name, e);
                    continue;
                }
                projects.forEach(p => projectMap.set(`${p.spaceId || ''}::${p.id || ''}`, p));
                folderCount += projects.length;
                const items = await pvFetchItemsForProjects(sp, projects, (done, total) => {
                    if (statusEl) statusEl.textContent = `扫描 ${sp.name || '当前空间'}：${Math.min(done, total)}/${total} 个文件夹…`;
                });
                allItems.push(...items);
            }
            const oldLedger = pvReadLedger();
            const built = pvBuildRows(allItems, projectMap, me, oldLedger);
            if (!pvAbort) pvWriteLedger(built.nextLedger);
            pvRows = built.rows;
            pvLastScanMeta = {
                scanned: allItems.length,
                totalMine: pvRows.length,
                moved: pvRows.filter(r => r.moved).length,
                folders: folderCount,
                user: me,
            };
            pvRender();
            if (statusEl) statusEl.textContent = pvAbort
                ? `已停止：已找到 ${pvRows.length} 个你创建的视频`
                : `完成：快速扫描 ${folderCount} 个文件夹 / ${allItems.length} 条，找到 ${pvRows.length} 个你创建的视频`;
            showToast(pvAbort ? '已停止扫描' : `✅ 找到 ${pvRows.length} 个你创建的视频`, pvAbort ? 'info' : 'success', 3000);
        } catch (e) {
            if (statusEl) statusEl.textContent = '扫描失败: ' + e.message;
            if (listEl) listEl.innerHTML = `<div class="hvt-pv-empty" style="color:#dc2626">扫描失败: ${esc(e.message)}</div>`;
            showToast('扫描失败: ' + e.message, 'error', 4000);
        } finally {
            pvScanning = false;
            if (scanBtn) scanBtn.disabled = false;
            if (stopBtn) stopBtn.style.display = 'none';
        }
    }

    function openProjectVideos() {
        const overlay = document.getElementById('hvt-pv-overlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        const q = document.getElementById('hvt-pv-search');
        if (q) q.focus();
        if (!pvRows.length && !pvScanning) pvScan();
        else pvRender();
    }
    function closeProjectVideos() {
        const overlay = document.getElementById('hvt-pv-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function pvVisibleRows() {
        const q = (document.getElementById('hvt-pv-search')?.value || '').trim().toLowerCase();
        const movedOnly = !!document.getElementById('hvt-pv-moved-only')?.checked;
        const oldDays = pvAgeDays();
        let visible = pvRows;
        if (movedOnly) visible = visible.filter(r => r.moved);
        if (oldDays) visible = visible.filter(r => pvIsOlderThan(r, oldDays));
        if (q) {
            visible = visible.filter(r =>
                (r.name || '').toLowerCase().includes(q) ||
                (r.folderPath || '').toLowerCase().includes(q) ||
                (r.status || '').toLowerCase().includes(q) ||
                (r.id || '').toLowerCase().includes(q)
            );
        }
        return visible;
    }

    // 同步「全选」勾选态和「移入回收站」按钮的数量/可用性
    function pvSyncSelectionUI(visible) {
        visible = visible || pvVisibleRows();
        const selAll = document.getElementById('hvt-pv-selall');
        const trashBtn = document.getElementById('hvt-pv-trash');
        if (selAll) {
            const visKeys = visible.map(r => pvLedgerKey(r.spaceId, r.id));
            const checkedCount = visKeys.filter(k => pvSelected.has(k)).length;
            selAll.checked = visible.length > 0 && checkedCount === visible.length;
            selAll.indeterminate = checkedCount > 0 && checkedCount < visible.length;
        }
        if (trashBtn && !pvTrashRunning) {
            trashBtn.textContent = pvSelected.size ? `移入回收站 (${pvSelected.size})` : '移入回收站';
            trashBtn.disabled = pvSelected.size === 0;
        }
    }

    function pvRender() {
        const listEl = document.getElementById('hvt-pv-list');
        const countEl = document.getElementById('hvt-pv-count');
        if (!listEl) return;
        const q = (document.getElementById('hvt-pv-search')?.value || '').trim().toLowerCase();
        const movedOnly = !!document.getElementById('hvt-pv-moved-only')?.checked;
        const oldDays = pvAgeDays();
        const visible = pvVisibleRows();
        // 清掉已不存在于结果中的勾选（重扫/删除后）
        const validKeys = new Set(pvRows.map(r => pvLedgerKey(r.spaceId, r.id)));
        pvSelected.forEach(k => { if (!validKeys.has(k)) pvSelected.delete(k); });
        const movedCount = pvRows.filter(r => r.moved).length;
        if (countEl) {
            const base = pvLastScanMeta
                ? `共 ${pvRows.length} 个 · 位置变更 ${movedCount} 个`
                : '尚未扫描';
            countEl.textContent = q || movedOnly || oldDays ? `${base} · 显示 ${visible.length} 个` : base;
        }
        if (!visible.length) {
            listEl.innerHTML = `<div class="hvt-pv-empty">${pvRows.length ? '没有匹配的视频' : '还没有扫描结果'}</div>`;
            pvSyncSelectionUI(visible);
            return;
        }
        listEl.innerHTML = '';
        const frag = document.createDocumentFragment();
        visible.forEach(row => {
            const el = document.createElement('div');
            el.className = 'hvt-pv-row' + (row.moved ? ' hvt-pv-moved' : '');
            const rowKey = pvLedgerKey(row.spaceId, row.id);
            const thumb = row.thumbnail
                ? `<img class="hvt-pv-thumb" src="${esc(row.thumbnail)}" alt="">`
                : '<div class="hvt-pv-thumb hvt-pv-thumb-empty">VID</div>';
            const hasDownload = !!pvDownloadUrl(row);
            el.innerHTML = `
                <input type="checkbox" class="hvt-pv-check" title="勾选后可批量移入回收站" ${pvSelected.has(rowKey) ? 'checked' : ''}>
                ${thumb}
                <div class="hvt-pv-main">
                  <div class="hvt-pv-name" title="${esc(row.name)}">${esc(row.name)}</div>
                  <div class="hvt-pv-meta">
                    <span title="团队空间">${esc(row.spaceName)}</span>
                    <span title="${esc(row.folderPath)}">${esc(row.folderPath)}</span>
                    <span>${esc(pvFormatDate(row.createdTs))}</span>
                    ${row.status ? `<span>${esc(row.status)}</span>` : ''}
                  </div>
                  ${row.moved ? `<div class="hvt-pv-move-note">位置变更：从「${esc(row.movedFrom || '未知位置')}」到了「${esc(row.folderPath)}」</div>` : ''}
                </div>
                <div class="hvt-pv-actions">
                  <button class="hvt-btn hvt-pv-download" title="${hasDownload ? '下载这个视频 MP4' : '暂时没有下载链接'}" ${hasDownload ? '' : 'disabled'}>下载</button>
                  <button class="hvt-btn hvt-pv-open" title="打开这个视频所在文件夹">打开文件夹</button>
                  <button class="hvt-btn hvt-pv-copy-loc" title="复制所在文件夹路径">复制位置</button>
                  <button class="hvt-btn hvt-pv-copy" title="复制 Video ID">复制ID</button>
                </div>
            `;
            el.querySelector('.hvt-pv-check').addEventListener('change', (e) => {
                if (e.currentTarget.checked) pvSelected.add(rowKey);
                else pvSelected.delete(rowKey);
                pvSyncSelectionUI();
            });
            el.querySelector('.hvt-pv-download').addEventListener('click', () => pvDownloadVideo(row));
            el.querySelector('.hvt-pv-open').addEventListener('click', () => window.open(pvFolderUrl(row), '_blank'));
            el.querySelector('.hvt-pv-copy-loc').addEventListener('click', async (e) => {
                try {
                    await navigator.clipboard.writeText(`${row.spaceName} / ${row.folderPath}`);
                    const btn = e.currentTarget;
                    const old = btn.textContent;
                    btn.textContent = '已复制';
                    setTimeout(() => { btn.textContent = old; }, 1200);
                } catch { showToast('复制失败', 'error'); }
            });
            el.querySelector('.hvt-pv-copy').addEventListener('click', async (e) => {
                try {
                    await navigator.clipboard.writeText(row.id);
                    const btn = e.currentTarget;
                    const old = btn.textContent;
                    btn.textContent = '已复制';
                    setTimeout(() => { btn.textContent = old; }, 1200);
                } catch { showToast('复制失败', 'error'); }
            });
            frag.appendChild(el);
        });
        listEl.appendChild(frag);
        pvSyncSelectionUI(visible);
    }

    // 批量移入回收站：接口原生支持批量（items 数组），按 spaceId 分组、每组一次请求。
    // Endpoint: DELETE /v1/project/item.trash  body {items:[{id,item_type}]} + x-space-id
    // 语义是移入回收站（可在 HeyGen 回收站恢复），非永久删除。
    const PV_TRASH_CHUNK = 50;
    async function pvTrashSelected() {
        if (pvTrashRunning || pvScanning) return;
        const targets = pvRows.filter(r => pvSelected.has(pvLedgerKey(r.spaceId, r.id)));
        if (!targets.length) return;

        const preview = targets.slice(0, 8).map(r => `· ${r.name}`).join('\n');
        const more = targets.length > 8 ? `\n· … 等共 ${targets.length} 个` : '';
        if (!confirm(`把选中的 ${targets.length} 个你创建的视频移入回收站？\n（可在 HeyGen 回收站中恢复）\n\n${preview}${more}`)) return;

        const trashBtn = document.getElementById('hvt-pv-trash');
        const statusEl = document.getElementById('hvt-pv-status');
        pvTrashRunning = true;
        if (trashBtn) { trashBtn.disabled = true; trashBtn.textContent = '移入回收站中…'; }

        const bySpace = new Map();
        targets.forEach(r => {
            const list = bySpace.get(r.spaceId) || [];
            list.push(r);
            bySpace.set(r.spaceId, list);
        });

        let ok = 0, failed = 0;
        for (const [spaceId, rows] of bySpace) {
            for (let i = 0; i < rows.length; i += PV_TRASH_CHUNK) {
                const chunk = rows.slice(i, i + PV_TRASH_CHUNK);
                if (statusEl) statusEl.textContent = `移入回收站：${ok + failed + chunk.length}/${targets.length}…`;
                try {
                    await heygenApi('/v1/project/item.trash', {
                        method: 'DELETE',
                        headers: spaceId ? { 'x-space-id': spaceId } : {},
                        body: JSON.stringify({ items: chunk.map(r => ({ id: r.id, item_type: r.itemType || 'heygen_video' })) }),
                    });
                    ok += chunk.length;
                    const doneKeys = new Set(chunk.map(r => pvLedgerKey(r.spaceId, r.id)));
                    pvRows = pvRows.filter(r => !doneKeys.has(pvLedgerKey(r.spaceId, r.id)));
                    doneKeys.forEach(k => pvSelected.delete(k));
                    const ledger = pvReadLedger();
                    doneKeys.forEach(k => delete ledger[k]);
                    pvWriteLedger(ledger);
                } catch (e) {
                    failed += chunk.length;
                    console.warn('[hvt] 移入回收站失败:', spaceId, e);
                }
                await mvShareSleep(300 + Math.random() * 300);
            }
        }

        pvTrashRunning = false;
        pvRender();
        if (statusEl) statusEl.textContent = failed
            ? `移入回收站：成功 ${ok} 个，失败 ${failed} 个`
            : `已把 ${ok} 个视频移入回收站（可在 HeyGen 回收站恢复）`;
        showToast(failed ? `移入回收站：成功 ${ok}，失败 ${failed}` : `✅ 已移入回收站 ${ok} 个视频`, failed ? 'error' : 'success', 4000);
    }

    // ─── AI Studio Quick Voice Switch ────────────────────────────────────────
    let aisSearchResults = [];
    let aisFallbackToken = 0; // incremented to cancel an in-flight fallback search

    // 兜底跳转目标:随手可开、自带语音控件的编辑器(用户不知道链接时一键切过去)。
    // 注意:是否"可换声音"由 DOM 探测判定(路由无关);这里的跳转 URL 是唯一保留的路由依赖,
    // 若 HeyGen 改了此路径,只改这一处即可,不影响换声音本身的可用性判断。
    const AIS_EDITOR_URL = '/avatar/avatar-shots';

    // 页面无换声音入口时,给出可操作的提示 + 一键跳转按钮(解决"用户不知道编辑器链接"的问题)
    function aisShowNoEntry(statusEl) {
        if (!statusEl) return;
        statusEl.dataset.type = 'warn';
        statusEl.innerHTML =
            '当前页面没有换声音入口 '
          + '<button id="hvt-ais-goto" style="margin-left:6px;padding:2px 8px;border-radius:6px;'
          + 'border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;'
          + 'font:inherit;white-space:nowrap">→ 打开 Avatar Shots 编辑器</button>';
        const goto = statusEl.querySelector('#hvt-ais-goto');
        if (goto) goto.onclick = () => location.assign(AIS_EDITOR_URL);
    }

    // ── Language-independent UI matchers ─────────────────────────────────────
    // HeyGen localizes every button label (en / 简体 / 繁體 / …), so matching on
    // English text breaks the moment the user changes language. We anchor on
    // language-independent signals — sprite-icon ids, ARIA roles, primary-button
    // styling — and only fall back to text patterns (covering en + 简 + 繁).
    //
    // Verified on AI Studio / My Avatars / Avatar Shots in zh-Hans and zh-Hant:
    //   · the "Switch" control's icon differs per page (#transition / #refresh /
    //     #arrow-right) → match a set, not one id
    //   · the open voice-picker dialog always contains a #play-s preview button
    //   · voice tabs carry role="tab"
    //   · the confirm button is the only primary-styled button that also has text
    const SWITCH_ICON_SET = ['#transition', '#refresh', '#arrow-right'];
    const SWITCH_TEXT_RE  = /switch|切换|切換/i;
    const CONFIRM_TEXT_RE = /save changes|set default|保存更改|儲存更改|设为默认|設為預設/i;

    const elHasAnyIcon = (el, ids) => ids.some(id => el.querySelector(`svg use[href="${id}"]`));
    const isHvtUI = (el) => !!(el.closest('#hvt-root') || el.closest('#hvt-fab-strip') || el.closest('#hvt-ais-overlay') || el.closest('#hvt-pv-overlay'));
    // a "switch voice" control: matched by icon first, text fallback second
    const isSwitchEl = (el) => !isHvtUI(el) && (elHasAnyIcon(el, SWITCH_ICON_SET) || SWITCH_TEXT_RE.test(el.textContent || ''));
    // the modal's apply/confirm button: the primary-styled button carrying text
    // (icon-only primary controls like #play-s/#arrow-right are excluded)
    const isConfirmBtn = (b) => !isHvtUI(b) &&
        ((b.className.includes('tw-bg-btn-primary') && b.textContent.trim()) || CONFIRM_TEXT_RE.test(b.textContent || ''));

    // aisIsModalOpen: the voice-picker dialog. Title text varies by language, so
    // detect an open radix dialog containing a #play-s preview, with a localized
    // title fallback (en / 简 / 繁).
    function aisIsModalOpen() {
        return [...document.querySelectorAll('[role="dialog"][data-state="open"]')]
            .some(d => !isHvtUI(d) && (
                d.querySelector('svg use[href="#play-s"]') ||
                /select voice|avatar voice|选择音色|選擇音色|的声音|的語音|的语音/i.test(d.textContent)
            ));
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

    // AI Studio 语音行:可点击、圆角带边框、且不含 <img>(头像行才有 img)。
    // 实测 /create-v4/ 页面精确命中 1 个,用作路由无关的入口信号。
    function aisFindAIStudioVoiceRow() {
        return [...document.querySelectorAll('div.tw-cursor-pointer')]
            .filter(el => !el.closest('#hvt-root') && !el.closest('#hvt-fab-strip') &&
                el.className.includes('tw-rounded-md') && el.className.includes('tw-border'))
            .find(el => !el.querySelector('img')) || null;
    }

    // 当前页面是否存在"换声音"入口 —— 取代写死的 /avatar/ + /create-v4/ 白名单,
    // 复用已有的语言无关探测器;HeyGen 改路由/改样式都不影响判断。
    function aisVoiceEntryPresent() {
        return !!(aisIsModalOpen()
            || aisFindAvatarShotsVoiceBtn()
            || aisFindAvatarVoiceMenuBtn()
            || aisFindAIStudioVoiceRow()
            || [...document.querySelectorAll('button')].some(isSwitchEl));
    }

    function aisTargetVoiceObj(targetVoiceId) {
        return mvVoices.find(v => v.voice_id === targetVoiceId) || spaceVoices.find(v => v.voice_id === targetVoiceId) || db.voices[targetVoiceId] || null;
    }

    function aisCurrentVoiceDialog() {
        return [...document.querySelectorAll('[role="dialog"][data-state="open"]')]
            .find(d => !isHvtUI(d) && (
                d.querySelector('svg use[href="#play-s"]') ||
                /select voice|avatar voice|选择音色|選擇音色|的声音|的語音|的语音/i.test(d.textContent)
            )) || null;
    }

    // aisBridgeSwitch: asks ais-bridge.js (MAIN world) to call onSelect via CustomEvent.
    // Passes full voiceObj so bridge can switch even if the voice isn't rendered in the modal.
    function aisBridgeSwitch(targetVoiceId, opts = {}) {
        const voiceObj = aisTargetVoiceObj(targetVoiceId);
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
            document.dispatchEvent(new CustomEvent('hvt-ais-switch', { detail: { id: targetVoiceId, voiceObj, visibleOnly: !!opts.visibleOnly } }));
        });
    }

    async function aisBridgeSwitchUntil(targetVoiceId, opts = {}, timeoutMs = 2500) {
        const start = Date.now();
        let last = { success: false };
        do {
            last = await aisBridgeSwitch(targetVoiceId, opts);
            if (last.success) return last;
            await new Promise(r => setTimeout(r, 250));
        } while (Date.now() - start < timeoutMs);
        return last;
    }

    function aisSetInputValue(input, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function aisSearchOpenModal(targetVoiceId, opts) {
        const dialog = aisCurrentVoiceDialog();
        if (!dialog) return { success: false };
        const input = [...dialog.querySelectorAll('input')]
            .find(el => !isHvtUI(el) && !el.disabled && (!el.type || ['text', 'search'].includes(el.type)));
        if (!input) return { success: false };

        const voiceObj = aisTargetVoiceObj(targetVoiceId);
        const terms = [voiceObj && voiceObj.display_name, voiceObj && voiceObj.name, targetVoiceId]
            .filter(Boolean)
            .map(t => String(t).trim())
            .filter(Boolean);
        const original = input.value || '';
        for (const term of [...new Set(terms)]) {
            aisSetInputValue(input, term);
            await new Promise(r => setTimeout(r, 900));
            const result = await aisBridgeSwitchUntil(targetVoiceId, opts, 2500);
            if (result.success) return result;
        }
        aisSetInputValue(input, original);
        await new Promise(r => setTimeout(r, 300));
        return { success: false };
    }

    function aisFindSeeMoreBtn() {
        const dialog = aisCurrentVoiceDialog();
        if (!dialog) return null;
        const textRe = /^(see more(?:\s*\(\d+\))?|查看更多(?:\s*\(\d+\))?|顯示更多(?:\s*\(\d+\))?)$/i;
        return [...dialog.querySelectorAll('button,[role="button"],[tabindex],div')]
            .filter(el => !isHvtUI(el) && !el.closest('button[disabled]') && el.offsetParent !== null)
            .find(el => textRe.test((el.textContent || '').trim().replace(/\s+/g, ' '))) || null;
    }

    async function aisExpandOpenModalUntilFound(targetVoiceId, opts) {
        let last = { success: false };
        for (;;) {
            const moreBtn = aisFindSeeMoreBtn();
            if (!moreBtn) break;
            moreBtn.click();
            await new Promise(r => setTimeout(r, 900));
            last = await aisBridgeSwitchUntil(targetVoiceId, opts, 2500);
            if (last.success) return last;
        }
        return last;
    }

    async function aisQuickSwitch(targetVoiceId) {
        const statusEl = document.getElementById('hvt-ais-status');
        const setStatus = (msg, type = '') => {
            if (!statusEl) return;
            statusEl.textContent = msg;
            statusEl.dataset.type = type;
        };

        if (!aisIsModalOpen()) {
            // 入口探测取代写死的 URL 白名单:直接看页面上有没有换声音入口,改版换路由都不受影响。
            const shotsBtn  = aisFindAvatarShotsVoiceBtn();
            const menuBtn   = aisFindAvatarVoiceMenuBtn();
            const studioRow = (!shotsBtn && !menuBtn) ? aisFindAIStudioVoiceRow() : null;
            let   switchBtn = (!shotsBtn && !menuBtn) ? [...document.querySelectorAll('button')].find(isSwitchEl) : null;

            if (!shotsBtn && !menuBtn && !studioRow && !switchBtn) {
                aisShowNoEntry(statusEl);   // 无入口 → 提示 + 一键跳转编辑器
                return;
            }

            setStatus('正在打开切换窗口…');

            if (shotsBtn || menuBtn) {
                let opened = false;
                // 路径一 — Avatar Shots 编辑器：Voice 工具栏按钮(#audio) → Voice 弹窗 → Switch
                if (shotsBtn) {
                    shotsBtn.click();
                    await new Promise(r => setTimeout(r, 400));
                    const switchInModal = [...document.querySelectorAll('[role="dialog"][data-state="open"] button')]
                        .find(isSwitchEl);
                    if (switchInModal) { switchInModal.click(); opened = true; }
                }
                // 路径二 — My Avatars 详情页：顶部声音下拉 → 菜单「Switch voice」
                if (!opened && menuBtn) {
                    menuBtn.click();
                    await new Promise(r => setTimeout(r, 350));
                    const switchItem = [...document.querySelectorAll('[role="menuitem"], [role="menu"] button')]
                        .find(isSwitchEl);
                    if (switchItem) { switchItem.click(); opened = true; }
                }
                if (!opened) {
                    setStatus('未找到声音入口，请确认在 Avatar Shots 或头像详情页', 'error');
                    return;
                }
            } else {
                // AI Studio: Switch 按钮直达,或点语音行后再找 Switch(语音行无 <img>,头像行才有)
                if (!switchBtn && studioRow) {
                    studioRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 400));
                    switchBtn = [...document.querySelectorAll('button')].find(isSwitchEl);
                }
                if (!switchBtn) {
                    setStatus('未找到 Switch 按钮，请先在 AI Studio 选中 Avatar 场景', 'error');
                    return;
                }
                switchBtn.click();
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

        // Prefer a real, rendered modal row (visibleOnly): safest, and avoids the
        // "假成功" where a cached object is accepted without the voice actually changing.
        // The native list is virtualized, so a valid voice may simply not be rendered
        // (scrolled out / other tab / not surfaced by search) — for that case we fall
        // back to the cached object below (visibleOnly:false), guarded by the
        // confirm+close verification so a non-applying selection still reports failure.
        const bridgeOpts = { visibleOnly: true };

        // Try current (first) tab — bridge handles modal search internally if needed
        let result = await aisBridgeSwitchUntil(targetVoiceId, bridgeOpts, 2000);
        if (!result.success) result = await aisSearchOpenModal(targetVoiceId, bridgeOpts);
        if (!result.success) result = await aisExpandOpenModalUntilFound(targetVoiceId, bridgeOpts);

        // If not found, iterate the modal's tabs (我的语音 / HeyGen 库 / …).
        // Tabs carry role="tab" (language-independent), so iterate them all.
        if (!result.success) {
            const tabs = [...document.querySelectorAll('[role="dialog"][data-state="open"] [role="tab"]')]
                .filter(el => !isHvtUI(el));
            for (const tab of tabs) {
                if (tab.getAttribute('aria-selected') === 'true') continue;
                tab.click();
                await new Promise(r => setTimeout(r, 600));
                result = await aisBridgeSwitchUntil(targetVoiceId, bridgeOpts, 3000);
                if (!result.success) result = await aisSearchOpenModal(targetVoiceId, bridgeOpts);
                if (!result.success) result = await aisExpandOpenModalUntilFound(targetVoiceId, bridgeOpts);
                if (result.success) break;
            }
        }

        // Last-resort fallback (restores pre-1.14 capability): the target is a valid
        // voice whose row the virtualized native modal never rendered and no tab/search
        // surfaced. Reuse the captured onSelect with the cached voice object. The
        // confirm+close verification below still guards against a fake success: if the
        // selection does not really change, the confirm button stays disabled and the
        // dialog won't close, so we report failure instead of a false ✅.
        if (!result.success) {
            result = await aisBridgeSwitchUntil(targetVoiceId, { visibleOnly: false }, 1500);
        }

        if (result.success) {
            // 弹窗内选中声音后，各页面都需要点确认按钮才会真正应用（编辑器是「保存更改」，
            // My Avatars 详情是「设为默认」，AI Studio 是「選擇語音」等，文案随语言/页面变）。
            // 按钮定位用语言无关规则：主按钮样式+带文字（纯图标主按钮 #play-s/#arrow-right 自动排除）。
            await new Promise(r => setTimeout(r, 200));
            const dlg = document.querySelector('[role="dialog"][data-state="open"]');
            if (dlg) {
                const confirmBtn = [...dlg.querySelectorAll('button')].find(b => isConfirmBtn(b) && !b.disabled);
                if (confirmBtn) confirmBtn.click();
                // 点了确认后必须等弹窗真正关闭才算数；没关就说明并未真正生效，不能报成功
                const closeStart = Date.now();
                while (Date.now() - closeStart < 2000 && document.querySelector('[role="dialog"][data-state="open"]')) {
                    await new Promise(r => setTimeout(r, 150));
                }
                if (document.querySelector('[role="dialog"][data-state="open"]')) {
                    setStatus(`切换未确认：已选中「${result.name}」但弹窗未关闭，请手动检查`, 'error');
                    return;
                }
            }
            setStatus(`✅ 已切换到「${result.name}」`, 'success');
            showToast(`✅ 已切换到「${result.name}」`, 'success', 2500);
        } else {
            setStatus(isAvatarShots ? '未在弹窗列表/搜索/分页中找到该声音，请确认 My voices 可搜索到它' : '未找到该声音（已搜索全部标签）', 'error');
        }
    }

    function aisSearchVoices(q, internal = false) {
        // internal=true: called mid-scan by aisFallbackSearch to refresh the list
        // without cancelling its own in-flight token or re-triggering a new scan.
        const myToken = internal ? aisFallbackToken : ++aisFallbackToken;
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
        if (internal) return;
        // 本地缓存（mvVoices/spaceVoices）可能还没同步完（分享声音、其他 Space 的声音等），
        // 凑巧命中几条不代表已经找全——只要有关键字就顺带发起一次全量扫描兜底。
        if (query) {
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
                    // 增量刷新界面，但不中断扫描——同一上下文剩余分页、以及其他 Space
                    // 可能还有更多匹配，必须扫完才能确认"找全了"。
                    const searchEl = document.getElementById('hvt-ais-search');
                    aisSearchVoices(searchEl ? searchEl.value : query, true);
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
            if (aisVoiceEntryPresent()) {
                statusEl.textContent = '';
                statusEl.dataset.type = '';
            } else {
                aisShowNoEntry(statusEl);
            }
        }
    }

    function closeAisPanel() {
        const overlay = document.getElementById('hvt-ais-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    // ─── 批量流水线 (bp*)：免 UI 批量提交视频 ────────────────────────────────
    // 链路：图片 → temp.create/PUT S3/temp.convert 建头像 →
    //       POST /v2/avatar/shortcut/submit（Avatar Shots 通道，一步提交渲染）→
    //       video.get 轮询 → 完成后下载
    // 关键：必须走 shortcut/submit 且带 use_unlimited_mode:true +
    //       source_type:"avatar_video_shortcut_modal"，才进不限额度的正常队列；
    //       AI Studio 的 text_draft.generate 路径会被标 low_priority+未付费，
    //       额度用尽时永远排不上（2026-07-09 实测踩坑）
    // 约束：仅在 HeyGen 页面开启期间运行（content script 生命周期）

    const BP_DB_KEY = 'hvt_bp_db_v1';
    const BP_IDB    = 'hvt_bp_images';
    let bpDb = null;
    let bpWorkerTimer  = null;   // 提交循环 setTimeout 句柄
    let bpPollTimer    = null;   // 轮询 setInterval 句柄
    let bpRunning      = false;
    let bpCurrentTask  = null;   // 正在执行链路的任务 id（防重入）
    let bpPreflighting = false;  // 预审阶段进行中（防重入）
    let bpHasLock      = false;  // 跨标签页单实例锁：仅持锁标签才提交/轮询

    // 单标签页选主：多个 HeyGen 标签页只允许一个真正提交渲染 + 轮询，
    // 否则各标签页 worker 挑到同一条 待渲染 任务会重复出片。
    // 锁随标签页上下文销毁自动释放，排队中的其它标签页自动接管（onAcquire 再次触发）。
    function bpTryLock(onAcquire) {
        if (!navigator.locks) { bpHasLock = true; onAcquire(); return; } // 极老环境兜底
        navigator.locks.request('hvt_bp_leader_v1', { mode: 'exclusive' },
            () => new Promise(() => {   // 永不 resolve → 持锁至本标签关闭
                bpHasLock = true;
                onAcquire();
            })
        );
    }

    // 语速显示归一化：整数补 ".0"（"1"→"1.0"），其余原样；提交时走 parseFloat 不受影响
    const bpNormSpeed = (v) => { const s = String(v ?? '').trim(); return /^\d+$/.test(s) ? s + '.0' : (s || '1.0'); };
    function bpLoadDb() {
        try { bpDb = JSON.parse(localStorage.getItem(BP_DB_KEY)) || null; } catch { bpDb = null; }
        if (!bpDb) bpDb = {};
        const bpOldSettings = bpDb.settings || {};
        bpDb.settings = Object.assign({
            voiceId: '', forceIII: true,
            voiceEngine: 'auto', voiceSpeed: '1.0',   // 声音引擎/语速（与 ARH 设置对齐；ARH 导入 meta 可覆盖）
            spaceId: '',                        // 提交到哪个 Space（'' = 个人）
            groupName: '',                      // 整批共享头像组的名称（空 = 自动「批量-日期」）
            titlePrefix: '',                    // 视频名代号（前缀）：提交时拼到 task.title 最前
            orientation: 'portrait', resolution: '1080p',
            intervalMin: 40, intervalMax: 120,  // 秒
            hourlyCap: 25, scheduleAt: '', autoDownload: true,
            autoBorrow: false,                  // 审核未通过时自动借用已过审任务的图片继续出片

        }, bpDb.settings || {});
        // 一次性把旧默认 720p 抬到新默认 1080p（只跑一次；之后手动选 720p 不会再被改）
        if (!bpDb.settings._res1080) {
            if (bpDb.settings.resolution === '720p') bpDb.settings.resolution = '1080p';
            bpDb.settings._res1080 = true;
        }
        // 一次性把旧「分钟」间隔换算成「秒」；旧默认上限 10/小时 抬到新默认 25（手动改过的其他值不动）
        if (!bpDb.settings._intSec) {
            if (bpOldSettings.intervalMin != null) bpDb.settings.intervalMin = Math.round(bpOldSettings.intervalMin * 60);
            if (bpOldSettings.intervalMax != null) bpDb.settings.intervalMax = Math.round(bpOldSettings.intervalMax * 60);
            if (bpOldSettings.hourlyCap === 10) bpDb.settings.hourlyCap = 25;
            bpDb.settings._intSec = true;
        }
        bpDb.settings.voiceSpeed = bpNormSpeed(bpDb.settings.voiceSpeed);
        bpDb.tasks = bpDb.tasks || [];           // {id,title,script,voiceId,status,lookId,draftId,videoUrl,error,submittedAt}
        bpDb.groupId = bpDb.groupId || '';       // 旧版全局头像组 id（仅作 legacy 迁移来源，不再使用）
        bpDb.groups = bpDb.groups || {};         // batchId → 头像组 id（每批一个独立组，批次隔离）
        bpDb.batchNames = bpDb.batchNames || {}; // batchId → 建批时定格的批次名（组名/归档文件夹名，改设置不影响已建批次）
        bpDb.log = Array.isArray(bpDb.log) ? bpDb.log : [];  // 运行日志（{t,level,title,msg}，尾部封顶）
        bpDb.running = !!bpDb.running;
        // 旧数据迁移：无 batchId 的任务归入 legacy 批次，沿用原全局 groupId
        if (bpDb.tasks.some(t => !t.batchId)) {
            bpDb.tasks.forEach(t => { if (!t.batchId) t.batchId = 'legacy'; });
            if (bpDb.groupId && !bpDb.groups.legacy) bpDb.groups.legacy = bpDb.groupId;
        }
    }
    function bpSaveDb() { localStorage.setItem(BP_DB_KEY, JSON.stringify(bpDb)); }

    // ── 运行日志：面板实时展示 + 可下载排查 ──
    const BP_LOG_CAP = 800;
    function bpLog(level, msg, task) {
        const e = { t: Date.now(), level, title: task ? (task.title || task.id) : '', msg: String(msg) };
        bpDb.log.push(e);
        if (bpDb.log.length > BP_LOG_CAP) bpDb.log.splice(0, bpDb.log.length - BP_LOG_CAP);
        bpSaveDb();
        bpAppendLogLine(e);
        return e;
    }
    function bpLogLineText(e) {
        const ts = new Date(e.t).toLocaleTimeString('zh-CN', { hour12: false });
        return `${ts} [${e.level}]${e.title ? ' 〈' + e.title + '〉' : ''} ${e.msg}`;
    }
    function bpAppendLogLine(e) {
        const box = document.getElementById('hvt-bp-log');
        if (!box) return;
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        const div = document.createElement('div');
        div.className = 'hvt-bp-log-line hvt-bp-log-' + e.level;
        div.textContent = bpLogLineText(e);
        box.appendChild(div);
        while (box.childNodes.length > BP_LOG_CAP) box.removeChild(box.firstChild);
        if (atBottom) box.scrollTop = box.scrollHeight;
        bpSyncLogLast();
    }
    // 日志折叠条上常驻显示最新一条，出错时标红
    function bpSyncLogLast() {
        const el = document.getElementById('hvt-bp-log-last');
        if (!el) return;
        const last = bpDb.log[bpDb.log.length - 1];
        el.textContent = last ? bpLogLineText(last) : '（暂无日志）';
        el.classList.toggle('hvt-bp-log-last-err', !!last && last.level === 'error');
    }
    function bpRenderLog() {
        const box = document.getElementById('hvt-bp-log');
        if (!box) return;
        box.innerHTML = bpDb.log.map(e =>
            `<div class="hvt-bp-log-line hvt-bp-log-${e.level}">${esc(bpLogLineText(e))}</div>`
        ).join('');
        box.scrollTop = box.scrollHeight;
        bpSyncLogLast();
    }
    function bpDownloadLog() {
        if (!bpDb.log.length) { showToast('暂无日志', 'error'); return; }
        const text = bpDb.log.map(bpLogLineText).join('\n');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `批量流水线日志-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    function bpClearLog() { bpDb.log = []; bpSaveDb(); bpRenderLog(); }

    // ── IndexedDB：任务图片持久化（localStorage 放不下 base64） ──
    function bpIdbOpen() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(BP_IDB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore('imgs');
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }
    async function bpIdbPut(key, blob) {
        const db = await bpIdbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('imgs', 'readwrite');
            tx.objectStore('imgs').put(blob, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror    = () => { db.close(); reject(tx.error); };
        });
    }
    async function bpIdbGet(key) {
        const db = await bpIdbOpen();
        return new Promise((resolve, reject) => {
            const req = db.transaction('imgs').objectStore('imgs').get(key);
            req.onsuccess = () => { db.close(); resolve(req.result || null); };
            req.onerror   = () => { db.close(); reject(req.error); };
        });
    }
    async function bpIdbDel(key) {
        const db = await bpIdbOpen();
        return new Promise((resolve) => {
            const tx = db.transaction('imgs', 'readwrite');
            tx.objectStore('imgs').delete(key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror    = () => { db.close(); resolve(); };
        });
    }

    function bpSpaceHeaders() {
        const sid = bpDb.settings.spaceId;
        return sid ? { 'x-space-id': sid } : {};
    }

    // ── 上传一张图为 look：temp.create → PUT S3 → temp.convert ──
    // groupId 为空 = 新建组（返回的 group_id 即主 look 的 look_id）；
    // groupId 非空 = 追加 look 到该组（convert 只回 group_id，新 look_id 由调用方 diff look.list 认领）。
    async function bpUploadLook(blob, name, groupId) {
        const t = await heygenApi('/v1/avatar_group/photo/temp.create?num_photos=1', { headers: bpSpaceHeaders() });
        const putUrl = t.upload_urls && t.upload_urls[0];
        const s3Url  = t.s3_urls && t.s3_urls[0];
        if (!putUrl || !s3Url) throw new Error('获取图片上传地址失败');
        const up = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'x-amz-server-side-encryption': 'AES256', 'Content-Type': 'image/jpeg' },
            body: blob,
        });
        if (!up.ok) throw new Error(`图片上传失败 HTTP ${up.status}`);
        const idMatch = s3Url.match(/temporary_user_photar\/([0-9a-f]{32})/i);
        if (!idMatch) throw new Error('解析临时图片 ID 失败: ' + s3Url);
        const q = new URLSearchParams({
            parent_temporary_user_photar_id: idMatch[1],
            ethnicity: 'Unspecified', gender: 'Unspecified', age: 'Unspecified',
            name, skip_validation: 'true',
        });
        if (groupId) q.set('group_id', groupId);   // 带 group_id = 追加到已有组
        const conv = await heygenApi(`/v1/avatar_group/photo/temp.convert?${q}`, { headers: bpSpaceHeaders() });
        if (!conv.group_id) throw new Error('创建/追加头像未返回 group_id');
        return conv.group_id;
    }

    // 拉取整组全部 look 的状态（一次覆盖全组）
    async function bpFetchLooks(groupId) {
        const d = await heygenApi(
            `/v2/avatar_group/look.list?group_id=${groupId}&type=all&page=1&limit=100`,
            { headers: bpSpaceHeaders() },
        );
        return ((d && d.avatar_looks) || []).map(x => ({
            lookId: x.look.id, status: x.look.status,
            moderation_msg: x.look.moderation_msg, created_at: x.look.created_at || 0,
        }));
    }

    // 视频最终名：新任务的标题在导入时已烧入代号（titleHasPrefix），队列显示与下载命名完全一致；
    // 旧任务（无标记）沿用提交时拼前缀的老行为
    function bpFinalTitle(task) {
        return task.titleHasPrefix ? (task.title || '') : (bpDb.settings.titlePrefix || '') + (task.title || '');
    }

    // ── 提交渲染：Avatar Shots 通道，按 look_id 定位出片 ──
    async function bpShortcutSubmit(task) {
        const voiceId = task.voiceId || bpDb.settings.voiceId;
        if (!voiceId) throw new Error('未指定声音 ID');
        if (!task.lookId) throw new Error('缺 look id（未完成预审）');
        const iii = bpDb.settings.forceIII;
        const d = await heygenApi('/v2/avatar/shortcut/submit', {
            method: 'POST', headers: bpSpaceHeaders(),
            body: JSON.stringify({
                video_title: bpFinalTitle(task),
                video_orientation: task.orientation || bpDb.settings.orientation,
                resolution: task.resolution || bpDb.settings.resolution,
                avatar_id: task.lookId,   // ← 传 look_id，渲染指定那个 look
                source_type: 'avatar_video_shortcut_modal',
                fit: 'cover',
                // 引擎/语速：字段名按 HeyGen 编辑器 draft 的 voice_settings 形态推断（未在 shortcut/submit 实测确认，
                // 若不生效需 DevTools 抓真实字段）；auto/1.0 为平台默认值时不发，行为与旧版完全一致。
                // 参数取任务入队时的快照（task.engine/speed），改默认设置不影响在途任务。
                audio_data: (() => {
                    const eng = task.engine || bpDb.settings.voiceEngine;
                    const spd = parseFloat(task.speed || bpDb.settings.voiceSpeed);
                    return {
                        audio_type: 'tts_pending', text: task.script, voice_id: voiceId,
                        ...(eng && eng !== 'auto' ? { voice_engine: eng } : {}),
                        ...(spd && spd !== 1 ? { voice_settings: { speed: spd } } : {}),
                    };
                })(),
                avatar_settings: { use_avatar_iv_model: !iii, use_unlimited_mode: iii },
                enable_caption: false,
                create_new_avatar: false,
            }),
        });
        if (!d.video_id) throw new Error('提交未返回 video_id');
        return d.video_id;
    }

    // 瞬时失败自动重试：最多 tries 次，间隔线性退避；耗尽后抛最后一次错误
    async function bpWithRetry(fn, label, task, tries = 3, baseMs = 20_000) {
        let lastErr;
        for (let a = 1; a <= tries; a++) {
            try { return await fn(); }
            catch (e) {
                lastErr = e;
                if (a < tries) {
                    const wait = baseMs * a;
                    bpLog('error', `${label}失败(第 ${a}/${tries} 次)：${e.message}，${Math.round(wait / 1000)}s 后自动重试`, task);
                    await new Promise(r => setTimeout(r, wait));
                }
            }
        }
        throw lastErr;
    }

    // 整批完成桌面通知：本轮跑过任务（预审/提交置位）且活跃任务清零时发一次
    let bpHadActivity = false;
    function bpMaybeNotifyDone() {
        if (!bpHadActivity || !bpDb.tasks.length) return;
        if (bpDb.tasks.some(t => !BP_FINAL_STATES.includes(t.status))) return;
        bpHadActivity = false;
        const failed = bpDb.tasks.filter(t => t.status === '失败').length;
        const done = bpDb.tasks.length - failed;
        chrome.runtime.sendMessage({
            type: 'hvt_notify',
            title: failed ? '⚠ 批量流水线完成（有失败）' : '✅ 批量流水线完成',
            message: `成功 ${done} 条，失败 ${failed} 条`,
        });
    }

    // ── 预审阶段：整批建一个组 → 逐张追加 look → 一次性等全组审核出结果 ──
    // completed 置「待渲染」进入渲染队列；failed / 有 moderation_msg 置「失败」直接踢出，不进渲染。
    async function bpPreflight() {
        bpHadActivity = true;
        const needUpload = () => bpDb.tasks.filter(t => !t.lookId && ['待提交', '上传中', '审核中'].includes(t.status));
        if (!needUpload().length && !bpDb.tasks.some(t => t.status === '审核中')) return;

        // 批次隔离：每个批次建自己的头像组，逐批处理
        const batchIds = [...new Set(needUpload().map(t => t.batchId || 'legacy'))];
        for (const bid of batchIds) {
            const groupName = bpBatchLabel(bid);
            const mine = () => needUpload().filter(t => (t.batchId || 'legacy') === bid);

            // 1) 建组（用该批次第一张待上传图）
            if (!bpDb.groups[bid]) {
                const first = mine()[0];
                if (!first) continue;
                first.status = '上传中'; bpSaveDb(); bpRenderTasks();
                bpSetStatusLine(`预审：建组「${groupName}」…`);
                try {
                    const blob = await bpIdbGet(first.id);
                    if (!blob) throw new Error('任务图片丢失，请删除后重新添加');
                    const gid = await bpWithRetry(() => bpUploadLook(blob, groupName, ''), '建组', first, 3, 15_000);
                    bpDb.groups[bid] = gid; first.lookId = gid; first.status = '审核中';
                    bpLog('info', `建组成功 group=${gid.slice(0, 8)}…（主 look 已上传）`, first);
                } catch (e) {
                    first.status = '失败'; first.error = e.message;
                    bpLog('error', '建组失败：' + e.message, first);
                }
                bpSaveDb(); bpRenderTasks();
            }

            // 2) 逐张追加该批次其余 look
            const gid = bpDb.groups[bid];
            if (!gid) continue;
            const known = new Set(bpDb.tasks.filter(t => t.lookId).map(t => t.lookId));
            const rest = mine();
            let n = 0;
            for (const task of rest) {
                task.status = '上传中'; bpSaveDb(); bpRenderTasks();
                bpSetStatusLine(`预审：上传造型 ${++n}/${rest.length}…`);
                try {
                    const blob = await bpIdbGet(task.id);
                    if (!blob) throw new Error('任务图片丢失，请删除后重新添加');
                    await bpWithRetry(() => bpUploadLook(blob, task.title, gid), '上传造型', task, 3, 15_000);
                    const looks = await bpWithRetry(() => bpFetchLooks(gid), '查询造型列表', task, 3, 10_000);
                    const fresh = looks.filter(l => !known.has(l.lookId))
                                       .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
                    if (!fresh) throw new Error('追加造型后未能定位新 look id');
                    task.lookId = fresh.lookId; known.add(fresh.lookId); task.status = '审核中';
                    bpLog('info', `造型已上传 look=${fresh.lookId.slice(0, 8)}…`, task);
                } catch (e) {
                    task.status = '失败'; task.error = e.message;
                    bpLog('error', '上传造型失败：' + e.message, task);
                }
                bpSaveDb(); bpRenderTasks();
            }
        }

        // 3) 一次性等全部批次审核出结果
        await bpWaitLooksReady();
    }

    // 失败自动借图：审核未通过的任务随机借用一张已过审任务的图——直接复用其 lookId
    //（同组 look 可多次出片），免重新上传+审核；本地图库/缩略图同步为借用图，与实际出片一致。
    async function bpAutoBorrow() {
        const allDonors = bpDb.tasks.filter(t => t.lookId && ['待渲染', '生成中', '已完成', '已下载'].includes(t.status));
        if (!allDonors.length) return;
        const failed = bpDb.tasks.filter(t => t.status === '失败' && /^审核未通过/.test(t.error || ''));
        for (const t of failed) {
            // look 隶属于各批次自己的头像组 → 只借同批次的图
            const donors = allDonors.filter(d => (d.batchId || 'legacy') === (t.batchId || 'legacy'));
            if (!donors.length) { bpLog('error', '同批次内无可借用图片，保持失败', t); continue; }
            const donor = donors[Math.floor(Math.random() * donors.length)];
            t.lookId = donor.lookId; t.status = '待渲染'; t.error = '';
            const blob = await bpIdbGet(donor.id).catch(() => null);
            if (blob) {
                await bpIdbPut(t.id, blob).catch(() => {});
                const old = bpThumbCache.get(t.id);
                if (old) { URL.revokeObjectURL(old); bpThumbCache.delete(t.id); }
            }
            bpLog('info', `审核未通过 → 自动借用「${donor.title}」的图片继续出片`, t);
        }
        if (failed.length) { bpSaveDb(); bpRenderTasks(); }
    }

    // 轮询整组 look.list，把「审核中」任务按 lookId 落地为 待渲染 / 失败
    async function bpWaitLooksReady() {
        const pending = () => bpDb.tasks.filter(t => t.status === '审核中' && t.lookId);
        if (!pending().length) return;
        const TIMEOUT_MS = 180_000, INTERVAL_MS = 30_000;
        const deadline = Date.now() + TIMEOUT_MS;
        bpSetStatusLine('预审：等待审核结果…');
        while (pending().length) {
            const byId = new Map();
            let fetched = false;
            for (const bid of [...new Set(pending().map(t => t.batchId || 'legacy'))]) {
                const gid = bpDb.groups[bid];
                if (!gid) continue;
                try {
                    for (const l of await bpFetchLooks(gid)) byId.set(l.lookId, l);
                    fetched = true;
                } catch (e) { bpLog('error', '查询审核状态失败：' + e.message); }
            }
            if (!fetched) {
                if (Date.now() >= deadline) break;
                await new Promise(r => setTimeout(r, INTERVAL_MS)); continue;
            }
            for (const t of pending()) {
                const l = byId.get(t.lookId);
                if (!l) continue;
                if (l.status === 'completed') {
                    t.status = '待渲染'; bpLog('info', '审核通过 → 待渲染', t);
                } else if (l.status === 'failed' || l.moderation_msg) {
                    t.status = '失败'; t.error = '审核未通过：' + (l.moderation_msg || l.status);
                    bpLog('error', t.error, t);
                }
            }
            bpSaveDb(); bpRenderTasks();
            if (!pending().length) break;
            if (Date.now() >= deadline) {
                for (const t of pending()) { t.status = '失败'; t.error = '审核超时未完成'; bpLog('error', '审核超时', t); }
                bpSaveDb(); bpRenderTasks(); break;
            }
            await new Promise(r => setTimeout(r, INTERVAL_MS));
        }
        if (bpDb.settings.autoBorrow) await bpAutoBorrow();
        const ok = bpDb.tasks.filter(t => t.status === '待渲染').length;
        const bad = bpDb.tasks.filter(t => t.status === '失败').length;
        bpSetStatusLine(`预审完成：待渲染 ${ok} 条，失败 ${bad} 条`);
        bpLog('info', `预审完成：待渲染 ${ok}，失败 ${bad}`);
        bpMaybeNotifyDone();
    }

    // ── 渲染阶段：对「待渲染」任务按 look_id 提交出片 ──
    async function bpRunTask(task) {
        bpHadActivity = true;
        try {
            task.status = '提交渲染中'; bpSaveDb(); bpRenderTasks();
            task.draftId = await bpWithRetry(() => bpShortcutSubmit(task), '提交渲染', task, 3, 30_000);   // draftId 存渲染中的 video_id
            task.submittedAt = Date.now();
            task.status = '生成中';
            bpLog('info', `已提交渲染 video=${task.draftId.slice(0, 8)}…`, task);
        } catch (e) {
            task.status = '失败'; task.error = e.message;
            bpLog('error', '提交渲染失败：' + e.message, task);
        }
        bpSaveDb(); bpRenderTasks();
    }

    // ── 提交调度：串行 + 随机间隔 + 每小时限额 + 定时启动 ──
    function bpNextPending() {
        return bpDb.tasks.find(t => t.status === '待渲染');
    }
    function bpSubmittedInLastHour() {
        const cutoff = Date.now() - 3600_000;
        return bpDb.tasks.filter(t => t.submittedAt && t.submittedAt > cutoff).length;
    }
    function bpScheduleDelayMs() {
        const at = bpDb.settings.scheduleAt;
        if (!at) return 0;
        const ts = new Date(at).getTime();
        return Number.isFinite(ts) ? Math.max(0, ts - Date.now()) : 0;
    }
    function bpRandomIntervalMs() {
        let lo = Math.max(0, Number(bpDb.settings.intervalMin) || 0);
        let hi = Math.max(lo, Number(bpDb.settings.intervalMax) || lo);
        return Math.round((lo + Math.random() * (hi - lo)) * 1000);
    }

    function bpSetStatusLine(msg) {
        const el = document.getElementById('hvt-bp-status');
        if (el) el.textContent = msg || '';
    }

    async function bpWorkerTick() {
        bpWorkerTimer = null;
        if (!bpRunning || bpPreflighting) return;

        // 阶段①：有「待提交」（待上传）或「审核中」任务 → 先跑预审（建组+追加+等审核）
        if (bpDb.tasks.some(t => t.status === '待提交' || t.status === '审核中')) {
            bpPreflighting = true;
            try { await bpPreflight(); }
            catch (e) { bpLog('error', '预审异常：' + e.message); bpSetStatusLine('预审异常：' + e.message); }
            bpPreflighting = false;
            if (!bpRunning) return;
            bpWorkerTimer = setTimeout(bpWorkerTick, 50);   // 预审完 → 进渲染队列
            return;
        }

        // 阶段②：渲染队列（只提「待渲染」）
        const task = bpNextPending();
        if (!task) {
            bpSetStatusLine('队列已空（生成中的任务仍在轮询下载）');
            bpMaybeNotifyDone();
            return;
        }
        const capped = bpSubmittedInLastHour() >= (Number(bpDb.settings.hourlyCap) || Infinity);
        if (capped) {
            bpSetStatusLine(`已达每小时限额（${bpDb.settings.hourlyCap}），15 分钟后重试`);
            bpWorkerTimer = setTimeout(bpWorkerTick, 15 * 60_000);
            return;
        }
        bpCurrentTask = task.id;
        bpSetStatusLine(`正在提交渲染：${task.title}`);
        await bpRunTask(task);
        bpCurrentTask = null;

        if (!bpRunning) return;
        const wait = bpRandomIntervalMs();
        bpSetStatusLine(`下一条 ${Math.round(wait / 60_000)} 分钟后提交`);
        bpWorkerTimer = setTimeout(bpWorkerTick, wait);
    }

    function bpStart() {
        if (bpRunning) return;
        if (!bpHasLock) {
            bpSetStatusLine('另一个 HeyGen 标签页正在运行批量，请在该标签页操作，或关闭它后重试');
            showToast('已有 HeyGen 标签页在运行批量，请勿多开', 'error', 3500);
            return;
        }
        // 点「开始/继续提交」是明确的提交意图 → 「已暂停」任务全部恢复为待提交
        const paused = bpDb.tasks.filter(t => t.status === '已暂停');
        if (paused.length) {
            paused.forEach(t => { t.status = '待提交'; });
            showToast(`已恢复 ${paused.length} 个暂停任务`, 'success');
        }
        if (!bpDb.settings.voiceId && bpDb.tasks.some(t => t.status === '待提交' && !t.voiceId)) {
            showToast('存在未指定声音 ID 的任务，且未设默认声音', 'error', 3500); return;
        }
        bpRunning = true;
        bpDb.running = true;
        bpSaveDb();
        bpUpdateRunButtons();
        // 归档在两条导入路径里已各自生成过，这里不再重复触发（会额外产生一批下载条目）；
        // 需要重出归档用面板的「归档」按钮。
        const delay = bpScheduleDelayMs();
        if (delay > 0) {
            bpSetStatusLine(`定时启动：${new Date(Date.now() + delay).toLocaleString()}`);
            bpWorkerTimer = setTimeout(bpWorkerTick, delay);
        } else {
            bpWorkerTimer = setTimeout(bpWorkerTick, 50);
        }
        bpEnsurePoller();
    }
    function bpStop() {
        bpRunning = false;
        bpDb.running = false;
        bpSaveDb();
        if (bpWorkerTimer) { clearTimeout(bpWorkerTimer); bpWorkerTimer = null; }
        bpSetStatusLine('已暂停（生成中的任务仍会轮询下载）');
        bpUpdateRunButtons();
    }
    // 运行中但 worker 已因队列空而停摆时（新增任务/重试后）重新唤醒
    function bpKick() {
        if (bpRunning && !bpWorkerTimer && !bpCurrentTask) {
            bpWorkerTimer = setTimeout(bpWorkerTick, 100);
        }
    }
    // 批次是否已启动过（有在途任务）→ 停止后按钮显示「继续」而非「开始」
    function bpStartedBefore() {
        return bpDb.tasks.some(t => ['上传中', '审核中', '待渲染', '提交渲染中', '生成中'].includes(t.status));
    }
    function bpUpdateRunButtons() {
        const btn = document.getElementById('hvt-bp-toggle');
        if (!btn) return;
        btn.textContent = bpRunning ? '⏸ 停止提交' : (bpStartedBefore() ? '▶ 继续提交' : '▶ 开始提交');
        btn.classList.toggle('hvt-btn-danger', bpRunning);
        btn.classList.toggle('hvt-btn-primary', !bpRunning);
    }

    // ── 生成状态轮询 + 自动下载 ──
    // 渲染耗时长（分钟级，队列繁忙可能更久），故首轮等 30 分钟再查，之后每 10 分钟一次。
    // 重载续跑时：已提交超过 30 分钟的任务立即补查一次，避免旧视频白等一整个首轮。
    function bpEnsurePoller() {
        if (bpPollTimer) return;
        const FIRST_MS = 30 * 60_000, EVERY_MS = 10 * 60_000;
        const subs = bpDb.tasks.filter(t => t.status === '生成中' && t.submittedAt).map(t => t.submittedAt);
        const oldest = subs.length ? Math.min(...subs) : Date.now();
        const firstDelay = Math.max(0, Math.min(FIRST_MS, FIRST_MS - (Date.now() - oldest)));
        bpPollTimer = setTimeout(function start() {
            bpPollTick();
            bpPollTimer = setInterval(bpPollTick, EVERY_MS);
        }, firstDelay);
    }
    async function bpPollTick() {
        const watching = bpDb.tasks.filter(t => t.status === '生成中' && t.draftId);
        if (!watching.length) return;
        for (const task of watching) {
            try {
                const d = await heygenApi(`/v1/pacific/video.get?video_id=${task.draftId}`, { headers: bpSpaceHeaders() });
                if (d.status === 'completed' && d.video_url) {
                    task.videoUrl = d.video_url;
                    task.status = bpDb.settings.autoDownload ? '下载中' : '已完成';
                    bpLog('info', '渲染完成' + (bpDb.settings.autoDownload ? '，开始下载' : ''), task);
                    bpSaveDb(); bpRenderTasks();
                    if (bpDb.settings.autoDownload) bpDownload(task);
                } else if (d.status === 'failed') {
                    task.status = '失败';
                    task.error = d.error_message || '服务端渲染失败';
                    bpLog('error', '渲染失败：' + task.error, task);
                    bpSaveDb(); bpRenderTasks();
                }
            } catch (e) { /* 单次轮询失败忽略，下轮再试 */ }
            await new Promise(r => setTimeout(r, 1200));
        }
        bpMaybeNotifyDone();
    }
    // 整批统一名称：组名设置（空则「批量-日期」），用作头像组名 / 导出 zip 名 / 下载归档子文件夹名
    // 批次号 = 导入时刻（分钟粒度，同分钟追加 x 去重）；批次名当场定格进 batchNames
    function bpNewBatchId() {
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        let bid = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
        while (bpDb.batchNames[bid]) bid += 'x';
        const base = (bpDb.settings.groupName || '').trim() || '批量';
        bpDb.batchNames[bid] = `${base}-${bid}`;
        return bid;
    }
    const bpBatchLabel = (bid) => bpDb.batchNames[bid]
        || ((bpDb.settings.groupName || '').trim() || `批量-${new Date().toISOString().slice(0, 10)}`);
    // chrome.downloads 的单个路径分量：非法字符外，结尾的点/空格与超长（>255 字节，中文 1 字 3 字节）均报 Invalid filename
    const bpSafePart = (s, max = 60, fallback = '_') => {
        const t = String(s || '')
            .replace(/[\x00-\x1f\x7f]/g, '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .trim()
            .slice(0, max)
            .replace(/^[.\s]+|[.\s]+$/g, '');
        return t || fallback;
    };
    const bpBatchDir = (bid) => bpSafePart(bpBatchLabel(bid), 80, '批量');
    function bpDownload(task) {
        const safe = bpSafePart(bpFinalTitle(task) || task.draftId, 80, task.draftId || 'video');
        chrome.runtime.sendMessage(
            { type: 'hvt_download', url: task.videoUrl, filename: `${bpBatchDir(task.batchId)}/${safe}.mp4` },
            (res) => {
                task.status = (res && res.ok) ? '已下载' : '已完成';
                if (res && res.ok) { bpLog('info', '已下载', task); }
                else { task.error = '自动下载失败，可手动点击下载'; bpLog('error', task.error, task); }
                bpSaveDb(); bpRenderTasks();
                bpMaybeNotifyDone();
            }
        );
    }

    // 原图上传：JPEG 直接用原始字节；其他格式（PNG/WebP…）按原尺寸转 JPEG
    // （S3 上传头固定 Content-Type: image/jpeg，与 temp.create 返回的 image.jpg 键一致）
    function bpPrepareImage(file) {
        if (file.type === 'image/jpeg') return Promise.resolve(file);
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片转码失败')), 'image/jpeg', 0.95);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取图片')); };
            img.src = url;
        });
    }

    // ── 精简 ZIP 解包（存储/deflate 两种压缩方式；Chrome 原生 DecompressionStream） ──
    // 返回 File[]（带原文件名与推断的 MIME type），跳过目录项与 macOS 元数据
    async function bpUnzip(zipFile) {
        const buf = new Uint8Array(await zipFile.arrayBuffer());
        const dv = new DataView(buf.buffer);
        // 从尾部找 EOCD 签名 0x06054b50
        let eocd = -1;
        for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('无效的 ZIP 文件');
        const count = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);      // 中央目录偏移
        const utf8 = new TextDecoder('utf-8');
        const mime = (name) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[(name.split('.').pop() || '').toLowerCase()] || '';
        const out = [];
        for (let n = 0; n < count; n++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method  = dv.getUint16(p + 10, true);
            const csize   = dv.getUint32(p + 20, true);
            const nameLen = dv.getUint16(p + 28, true);
            const extraLen = dv.getUint16(p + 30, true);
            const cmtLen  = dv.getUint16(p + 32, true);
            const lho     = dv.getUint32(p + 42, true);   // 本地头偏移
            const path    = utf8.decode(buf.subarray(p + 46, p + 46 + nameLen));
            p += 46 + nameLen + extraLen + cmtLen;
            const base = path.split('/').pop();
            if (!base || path.endsWith('/') || path.includes('__MACOSX') || base.startsWith('.')) continue;
            // 数据紧跟本地头（其 name/extra 长度须从本地头自身读取）
            const dataOff = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
            const raw = buf.subarray(dataOff, dataOff + csize);
            let bytes;
            if (method === 0) bytes = raw;
            else if (method === 8) {
                const ds = new DecompressionStream('deflate-raw');
                bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
            } else throw new Error(`不支持的压缩方式(${method})：${base}`);
            out.push(new File([bytes], base, { type: mime(base) }));
        }
        return out;
    }

    // 生成归档文件夹：把当前队列按 ARH 解压后的目录结构直接写进 下载/组名/
    // （N_标题.jpg + copy.tsv；#N#\t标题\t文案，含 voice_id meta）。视频渲染完也下载到同一文件夹。
    // 经 chrome.downloads 用 data: URL 落盘（blob: URL 在 SW 侧无法跨源解析），同名覆盖，可重复生成。
    const bpBlobDataUrl = (blob) => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error('读取图片数据失败'));
        r.readAsDataURL(blob);
    });
    // 插件重载/更新后旧页面的 chrome.runtime 全部失效，报 Extension context invalidated → 换成可操作的提示
    const bpFriendlyErr = (m) => /context invalidated/i.test(m || '') ? '插件已更新，请刷新本页面后重试' : (m || '下载失败');
    const bpArchiveFile = (filename, dataUrl) => new Promise((res, rej) => {
        try {
            chrome.runtime.sendMessage(
                { type: 'hvt_download', url: dataUrl, filename, conflictAction: 'overwrite' },
                (r) => (r && r.ok) ? res() : rej(new Error(bpFriendlyErr(r?.error || chrome.runtime.lastError?.message)))
            );
        } catch (e) { rej(new Error(bpFriendlyErr(e.message))); }
    });
    async function bpGenerateArchive(onlyPending = false, onlyBatch = null) {
        if (!bpDb.tasks.length) { showToast('队列为空，无可归档', 'error'); return; }
        const clean = (s) => String(s || '').replace(/[\t\n\r]/g, ' ').trim();
        const byBatch = new Map();
        for (const t of bpDb.tasks) {
            const bid = t.batchId || 'legacy';
            if (!byBatch.has(bid)) byBatch.set(bid, []);
            byBatch.get(bid).push(t);
        }
        let dirs = 0, imgs = 0;
        for (const [bid, tasks] of byBatch) {
            if (onlyBatch && bid !== onlyBatch) continue;
            if (onlyPending && !tasks.some(t => ['待提交', '已暂停'].includes(t.status))) continue;
            const dir = bpBatchDir(bid);
            const t0 = tasks[0];
            // 与 ARH zip 完全同构：3 行 meta（恒写）+ 列名行 + #N# 数据行；图片进 images/ 子文件夹
            const lines = [
                `voice_id\t${(t0.voiceId || bpDb.settings.voiceId || '').trim()}`,
                `voice_engine\t${t0.engine || bpDb.settings.voiceEngine || 'auto'}`,
                `voice_speed\t${t0.speed || bpDb.settings.voiceSpeed || '1.0'}`,
                `#id#\tchinese\tenglish`,
            ];
            for (let i = 0; i < tasks.length; i++) {
                const t = tasks[i];
                const n = i + 1;
                const blob = await bpIdbGet(t.id).catch(() => null);
                if (!blob) { showToast(`批次 ${bid} 第 ${n} 行图片丢失，无法归档`, 'error', 4000); return; }
                const label = bpSafePart(clean(t.chinese) || clean(t.title).replace(/^\d+[_\-. ]*/, ''), 60, 'img');
                await bpArchiveFile(`${dir}/images/${n}_${label}.jpg`, await bpBlobDataUrl(blob));
                lines.push(`#${n}#\t${clean(t.chinese)}\t${clean(t.script)}`);
                imgs++;
            }
            const tsv = lines.join('\n') + '\n';
            await bpArchiveFile(`${dir}/copy.tsv`,
                'data:text/tab-separated-values;base64,' + btoa(String.fromCharCode(...new TextEncoder().encode(tsv))));
            bpLog('info', `已生成归档文件夹 下载/${dir}（images/${tasks.length} 张 + copy.tsv）`);
            dirs++;
        }
        if (dirs) showToast(`已生成 ${dirs} 个归档文件夹（共 ${imgs} 张图），视频完成后也会存入对应文件夹`, 'success', 5000);
    }

    // ── ARH（AvatarReelsHelper）copy.tsv 格式 ──
    // 头部若干元数据行「key<TAB>value」（voice_id / voice_engine / voice_speed…），
    // 正文行「#N#<TAB>中文<TAB>英文」。图片文件名以「N_」开头与 #N# 精确配对。
    // 返回 null 表示不是 ARH 格式；否则 { meta, items: [{id, chinese, english}] }
    // 文案清理规则移植自 AvatarReelsHelper copyAudit.ts：
    // 去首尾引号、折叠内部换行、剥与 #N# 重复的行首序号、修复无换行粘连行泄漏的 id 数字
    const bpHasChinese = (s) => /[一-龥]/.test(s || '');
    // emoji / 非语音符号（TTS 念不了）：清理时静默剥离，不拦截（真实文案里 🇨🇦🙏 等常见）
    const BP_EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0E}\u{FE0F}\u{200D}⭐⭕←-⇿★☆]/gu;
    const BP_CN_PUNCT = { '，': ', ', '。': '. ', '！': '! ', '？': '? ', '：': ': ', '；': '; ', '（': ' (', '）': ') ', '“': '"', '”': '"', '‘': "'", '’': "'", '、': ', ' };
    function bpCleanScript(s, id) {
        let t = String(s || '')
            .replace(BP_EMOJI_RE, '')                        // emoji/非语音符号剥离
            .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')     // 零宽字符/BOM
            .replace(/[\u00A0\u2028\u2029\u3000]/g, ' ')     // nbsp/行分隔符/全角空格
            .replace(/\s*\n\s*/g, ' ')                       // collapseWs
            .replace(/[，。！？：；（）“”‘’、]/g, (c) => BP_CN_PUNCT[c])  // 中文标点→英文
            .replace(/~~([^~]*)~~/g, '')                     // markdown 删除线（ARH 质检标记残留）
            .replace(/\*\*([^*]*)\*\*/g, '$1')               // markdown 加粗
            .replace(/^[#>\-•*]+\s*/, '')                    // 行首 markdown 记号
            .replace(/([!?])(\s*\1)+/g, '$1')                // 重复标点折叠（含全角转换产生的空格间隔）
            .replace(/ (")(?=\s|$|[,.!?])/g, '$1')           // 全角句读转换留下的引号前空格
            .replace(/ {2,}/g, ' ')
            .replace(/^[\s"]+|[\s"]+$/g, '')                 // stripQuotes
            .trim();
        const m = t.match(/^\[?(\d+)\]?[.\s]+/);             // stripLeadingId（仅与本行 id 一致时剥）
        if (m && parseInt(m[1], 10) === id) t = t.slice(m[0].length).trim();
        return t.replace(/([.!?])\d+$/, '$1');               // 粘连行泄漏的下一行 id
    }
    function bpParseArhTsv(raw) {
        const txt = String(raw || '').replace(/\r/g, '').trim();
        if (!/^#\d+#\t/m.test(txt)) return null;
        const meta = {};
        const items = [];
        for (const line of txt.split('\n')) {
            const m = line.match(/^#(\d+)#\t(.*)$/);
            if (m) {
                const cols = m[2].split('\t');               // 第 3 个 tab 之后的多余列丢弃（粘连行）
                const id = parseInt(m[1], 10);
                items.push({ id, chinese: (cols[0] || '').trim(), english: bpCleanScript(cols[1], id) });
            } else if (line.includes('\t')) {
                const [k, ...rest] = line.split('\t');
                const key = k.trim();
                if (key && !/^#id#$/i.test(key)) meta[key] = rest.join('\t').trim();
            }
        }
        return items.length ? { meta, items } : null;
    }
    // ARH 导入：按图片文件名前导编号与 #N# 配对，与选图顺序无关
    async function bpImportArhTasks(files, arh) {
        const byId = new Map(arh.items.map(it => [it.id, it]));
        const pairs = [];
        const skipped = [];
        for (const f of files) {
            const m = f.name.match(/^(\d+)[_\-.]/);
            if (!m) { skipped.push(f.name); continue; }       // 无前导编号 → 跳过，不阻断
            const it = byId.get(parseInt(m[1], 10));
            if (!it) { skipped.push(f.name); continue; }      // 编号无对应文案 → 跳过
            if (!it.english) { showToast(`#${it.id}# 缺英文文案`, 'error', 5000); return; }
            if (bpHasChinese(it.english)) { showToast(`#${it.id}# 英文文案混入中文，已拦截导入，请先修正 copy.tsv`, 'error', 6000); return; }
            pairs.push({ file: f, it });
        }
        if (!pairs.length) {
            showToast(`没有任何图片能与 #N# 配对（共 ${files.length} 张），请检查文件名前导编号`, 'error', 5000);
            return;
        }
        if (pairs.length < arh.items.length) {
            const missing = arh.items.filter(it => !pairs.some(p => p.it.id === it.id)).map(it => `#${it.id}#`);
            showToast(`以下文案缺图片：${missing.join(' ')}，请补齐后再导入`, 'error', 6000);
            return;
        }
        if (skipped.length) showToast(`已跳过 ${skipped.length} 张无法配对的图片：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? ' 等' : ''}`, 'info', 5000);
        {   // 同批文案完全重复 → 大概率错行，警告但不拦截
            const seen = new Map();
            for (const it of arh.items) {
                if (seen.has(it.english)) showToast(`⚠️ #${seen.get(it.english)}# 与 #${it.id}# 英文文案完全相同，请确认非错行`, 'error', 7000);
                else seen.set(it.english, it.id);
            }
        }
        pairs.sort((a, b) => a.it.id - b.it.id);
        const snapPrefix = document.getElementById('hvt-bp-prefix')?.value ?? bpDb.settings.titlePrefix ?? '';
        const batchId = bpNewBatchId();
        const voiceId = arh.meta.voice_id || '';
        if (voiceId) {                          // ARH 带 voice_id → 自动填入默认声音框（meta 无则不覆盖用户已填值）
            bpDb.settings.voiceId = voiceId;
            const vEl = document.getElementById('hvt-bp-voice');
            if (vEl) vEl.value = voiceId;
        }
        // ARH meta 的引擎/语速同样自动带入设置（无则不覆盖）
        if (arh.meta.voice_engine) {
            bpDb.settings.voiceEngine = arh.meta.voice_engine;
            const el = document.getElementById('hvt-bp-vengine');
            if (el) el.value = arh.meta.voice_engine;
        }
        if (arh.meta.voice_speed) {
            bpDb.settings.voiceSpeed = bpNormSpeed(arh.meta.voice_speed);
            const el = document.getElementById('hvt-bp-vspeed');
            if (el) el.value = bpDb.settings.voiceSpeed;
        }
        for (let i = 0; i < pairs.length; i++) {
            const { file, it } = pairs[i];
            const id = `bp_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
            const blob = await bpPrepareImage(file);
            await bpIdbPut(id, blob);
            bpDb.tasks.push({
                id, title: snapPrefix + file.name.replace(/\.[^.]+$/, ''), titleHasPrefix: true,
                chinese: it.chinese || '', script: it.english,
                voiceId, status: bpRunning ? '已暂停' : '待提交',
                batchId, engine: bpDb.settings.voiceEngine || 'auto', speed: bpDb.settings.voiceSpeed || '1.0',
                orientation: bpDb.settings.orientation, resolution: bpDb.settings.resolution,
                lookId: '', draftId: '', videoUrl: '', error: '', submittedAt: 0,
            });
        }
        bpSaveDb();
        bpRenderTasks();
        bpKick();
        bpGenerateArchive(false, batchId).catch(e => bpLog('error', '自动归档失败：' + e.message));
        bpAfterImport(batchId, pairs.length, `（ARH 按编号配对${voiceId ? '，声音 ' + voiceId.slice(0, 8) + '…' : ''}）`);
    }

    // ── 任务导入：多图 + 文案，按顺序配对 ──
    // 文案支持三种粘贴格式：
    //   1. 谷歌表格整行（含制表符）：每行一条，「标题<TAB>文案」或仅「文案」列
    //   2. 空行分段：一段一条
    //   3. 单行一条
    // 返回 [{title?, script}]
    function bpSplitScripts(raw) {
        const txt = String(raw || '').replace(/\r/g, '').trim();
        if (!txt) return [];
        if (txt.includes('\t')) {
            return txt.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
                const cols = line.split('\t').map(c => c.trim()).filter(Boolean);
                // 「序号⇥中文⇥英文」三列粘贴：配音只用英文列；标题 = 序号 + 中文前50字（最终视频名=代号+标题）
                if (cols.length >= 3 && /^\d+$/.test(cols[0]) && bpHasChinese(cols[1]) && !bpHasChinese(cols[cols.length - 1])) {
                    const cnFull = cols[1].replace(/\s+/g, ' ').trim();
                    return { title: `${cols[0]} ${cnFull.slice(0, 50)}`, chinese: cnFull,
                             script: bpCleanScript(cols.slice(2).join(' '), parseInt(cols[0], 10)) };
                }
                return cols.length >= 2
                    ? { title: cols[0], script: cols.slice(1).join(' ') }
                    : { script: cols[0] || '' };
            });
        }
        const blocks = txt.includes('\n\n')
            ? txt.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
            : txt.split('\n').map(s => s.trim()).filter(Boolean);
        return blocks.map(b => ({ script: b }));
    }
    // ── 文案表格编辑器（谷歌表格式网格；提交时序列化成 TSV 走 bpSplitScripts 既有解析） ──
    const BP_GRID_MIN_ROWS = 3;
    const bpGridBody = () => document.getElementById('hvt-bp-grid-body');
    function bpGridAddRow(cn = '', en = '') {
        const body = bpGridBody(); if (!body) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="hvt-bp-grid-num"></td>
            <td class="hvt-bp-grid-cell" contenteditable="true"></td>
            <td class="hvt-bp-grid-cell" contenteditable="true"></td>
            <td class="hvt-bp-grid-del" title="删除此行">✕</td>`;
        tr.children[1].textContent = cn;
        tr.children[2].textContent = en;
        body.appendChild(tr);
        bpGridRenumber();
        return tr;
    }
    function bpGridRenumber() {
        [...bpGridBody().children].forEach((tr, i) => { tr.firstElementChild.textContent = i + 1; });
    }
    function bpGridClearRows() {
        const body = bpGridBody(); body.innerHTML = '';
        for (let i = 0; i < BP_GRID_MIN_ROWS; i++) bpGridAddRow();
    }
    function bpGridRows() {
        return [...bpGridBody().children].map(tr => ({
            cn: tr.children[1].textContent.replace(/\s+/g, ' ').trim(),
            en: tr.children[2].textContent.replace(/\s+/g, ' ').trim(),
        })).filter(r => r.cn || r.en);
    }
    // 序列化：两列都填→「序号⇥中文⇥英文」或「标题⇥文案」（与谷歌表格粘贴同构）；只填一列→该列即文案
    function bpGridToTsv() {
        return bpGridRows().map((r, i) => {
            if (!r.cn || !r.en) return r.en || r.cn;
            return bpHasChinese(r.cn) && !bpHasChinese(r.en) ? `${i + 1}\t${r.cn}\t${r.en}` : `${r.cn}\t${r.en}`;
        }).join('\n');
    }
    // 剪贴板一行 → {cn, en}（列规则与 bpSplitScripts 一致）
    function bpGridParseLine(line) {
        const cols = line.split('\t').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 3 && /^\d+$/.test(cols[0])) return { cn: cols[1], en: cols.slice(2).join(' ') };
        if (cols.length === 2) return { cn: cols[0], en: cols[1] };
        return { cn: '', en: cols.join(' ') };
    }
    const bpImportTextMode = (on) => {
        document.getElementById('hvt-bp-scripts').style.display = on ? '' : 'none';
        document.getElementById('hvt-bp-grid').style.display = on ? 'none' : '';
        document.getElementById('hvt-bp-grid-addrow').style.display = on ? 'none' : '';
        document.getElementById('hvt-bp-grid-clear').style.display = on ? 'none' : '';
        document.getElementById('hvt-bp-grid-mode').textContent = on ? '⊞ 表格模式' : '✍ 文本模式';
    };
    const bpImportInTextMode = () => document.getElementById('hvt-bp-scripts').style.display !== 'none';
    function bpShuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
    async function bpImportTasks(files, scriptsRaw) {
        if (!files.length) { showToast('请选择图片', 'error'); return false; }
        const arh = bpParseArhTsv(scriptsRaw);
        if (arh) { await bpImportArhTasks(files, arh); return true; }
        const scripts = bpSplitScripts(scriptsRaw);
        if (scripts.length !== files.length) {
            showToast(`图片 ${files.length} 张 ≠ 文案 ${scripts.length} 条，请一一对应`, 'error', 4500);
            return false;
        }
        // 随机配对：文案洗牌后分配给图片（ARH 编号格式不走这里，始终精确配对）
        if (document.getElementById('hvt-bp-randpair')?.checked) bpShuffle(scripts);
        // 导入瞬间快照默认声音到每个任务：批次声音就此锁定，之后改默认框/导入新批次不会污染本批未提交任务
        const snapVoice = (document.getElementById('hvt-bp-voice')?.value || bpDb.settings.voiceId || '').trim();
        const snapPrefix = document.getElementById('hvt-bp-prefix')?.value ?? bpDb.settings.titlePrefix ?? '';
        const batchId = bpNewBatchId();
        for (let i = 0; i < files.length; i++) {
            const id = `bp_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
            const baseName = files[i].name.replace(/\.[^.]+$/, '');
            const blob = await bpPrepareImage(files[i]);   // 原图上传（非 JPEG 才原尺寸转码）
            await bpIdbPut(id, blob);
            bpDb.tasks.push({
                id, title: snapPrefix + (scripts[i].title || baseName), titleHasPrefix: true,
                chinese: scripts[i].chinese || '', script: scripts[i].script,
                voiceId: snapVoice, status: bpRunning ? '已暂停' : '待提交',
                batchId, engine: bpDb.settings.voiceEngine || 'auto', speed: bpDb.settings.voiceSpeed || '1.0',
                orientation: bpDb.settings.orientation, resolution: bpDb.settings.resolution,
                lookId: '', draftId: '', videoUrl: '', error: '', submittedAt: 0,
            });
        }
        bpSaveDb();
        bpRenderTasks();
        bpKick();
        bpGenerateArchive(false, batchId).catch(e => bpLog('error', '自动归档失败：' + e.message));
        bpAfterImport(batchId, files.length);   // 不 await：弹框不阻塞导入表单清空
        return true;
    }

    // ── UI ──
    const BP_FINAL_STATES = ['已下载', '已完成', '失败'];
    const bpSelected = new Set();   // 勾选的任务 id（仅限有 draftId 的行；不落盘）
    function bpUpdateTrashButton() {
        const btn = document.getElementById('hvt-bp-trash');
        if (!btn) return;
        const n = bpDb.tasks.filter(t => t.draftId && bpSelected.has(t.id)).length;
        btn.textContent = `🗑 删除所选视频${n ? `(${n})` : ''}`;
        btn.disabled = !n;
        const failed = bpDb.tasks.filter(t => t.status === '失败').length;
        const residual = bpDb.tasks.filter(t => t.status === '失败' && t.draftId).length;
        const retryBtn = document.getElementById('hvt-bp-retryall');
        if (retryBtn) { retryBtn.textContent = `↺ 重试全部失败${failed ? `(${failed})` : ''}`; retryBtn.disabled = !failed; }
        const cleanBtn = document.getElementById('hvt-bp-clean');
        if (cleanBtn) { cleanBtn.textContent = `🧹 清理失败残留${residual ? `(${residual})` : ''}`; cleanBtn.disabled = !residual; }
    }
    // 进度总览：完成/失败/出片中/待处理 计数 + 进度条（按已终态任务占比）
    function bpRenderProgress() {
        const el = document.getElementById('hvt-bp-progress');
        if (!el) return;
        const total = bpDb.tasks.length;
        if (!total) { el.style.display = 'none'; el.innerHTML = ''; return; }
        const c = (sts) => bpDb.tasks.filter(t => sts.includes(t.status)).length;
        const done = c(['已下载', '已完成']), failed = c(['失败']);
        const gen = c(['提交渲染中', '生成中', '下载中']);
        const wait = total - done - failed - gen;
        const pct = Math.round((done + failed) / total * 100);
        el.style.display = '';
        el.innerHTML = `
            <div class="hvt-bp-prog-bar"><div class="hvt-bp-prog-fill${failed ? ' hvt-bp-prog-haserr' : ''}" style="width:${pct}%"></div></div>
            <span class="hvt-bp-prog-text">完成 ${done} · 失败 ${failed} · 出片中 ${gen} · 待处理 ${wait} ／ 共 ${total}（${pct}%）</span>`;
    }
    // 一键把所有失败任务重置回「待提交」重新走完整流水线（同单行 ↺）
    function bpRetryAllFailed() {
        const failed = bpDb.tasks.filter(t => t.status === '失败');
        if (!failed.length) return;
        for (const t of failed) { t.status = '待提交'; t.lookId = ''; t.draftId = ''; t.error = ''; }
        bpSaveDb(); bpRenderTasks(); bpKick();
        showToast(`已重置 ${failed.length} 个失败任务，重新进入流水线`, 'success');
    }
    // 清理失败残留：失败但已提交过渲染的任务，其平台残留视频移入回收站；任务行保留可继续重试
    async function bpCleanFailedDrafts() {
        const targets = bpDb.tasks.filter(t => t.status === '失败' && t.draftId);
        if (!targets.length) return;
        if (!confirm(`把 ${targets.length} 个失败任务在平台上的残留视频移入回收站？\n（可在 HeyGen 回收站恢复；任务行保留，可继续重试）`)) return;
        try {
            await heygenApi('/v1/project/item.trash', {
                method: 'DELETE', headers: bpSpaceHeaders(),
                body: JSON.stringify({ items: targets.map(t => ({ id: t.draftId, item_type: 'heygen_video' })) }),
            });
            targets.forEach(t => { t.draftId = ''; bpSelected.delete(t.id); });
            bpSaveDb(); bpRenderTasks();
            bpLog('info', `已清理 ${targets.length} 个失败残留视频`);
            showToast(`✅ 已清理 ${targets.length} 个失败残留`, 'success');
        } catch (e) {
            bpLog('error', '清理失败残留出错：' + e.message);
            showToast('清理失败: ' + e.message, 'error', 4000);
        }
    }
    // 把勾选任务的平台视频移入回收站（HeyGen 端可恢复），成功后任务行连图片一并移出队列
    async function bpTrashSelectedVideos() {
        const targets = bpDb.tasks.filter(t => t.draftId && bpSelected.has(t.id));
        if (!targets.length) return;
        const preview = targets.slice(0, 8).map(t => `· ${bpFinalTitle(t) || t.draftId}`).join('\n');
        const more = targets.length > 8 ? `\n· … 等共 ${targets.length} 个` : '';
        if (!confirm(`把选中的 ${targets.length} 个平台视频移入回收站？\n（可在 HeyGen 回收站中恢复）\n\n${preview}${more}`)) return;
        const btn = document.getElementById('hvt-bp-trash');
        if (btn) { btn.disabled = true; btn.textContent = '删除中…'; }
        try {
            await heygenApi('/v1/project/item.trash', {
                method: 'DELETE',
                headers: bpSpaceHeaders(),
                body: JSON.stringify({ items: targets.map(t => ({ id: t.draftId, item_type: 'heygen_video' })) }),
            });
            const gone = new Set(targets.map(t => t.id));
            bpDb.tasks = bpDb.tasks.filter(t => !gone.has(t.id));
            for (const id of gone) {
                bpSelected.delete(id);
                await bpIdbDel(id).catch(() => {});
                const thumb = bpThumbCache.get(id);
                if (thumb) { URL.revokeObjectURL(thumb); bpThumbCache.delete(id); }
            }
            bpSaveDb(); bpRenderTasks();
            bpLog('info', `已把 ${targets.length} 个视频移入回收站并移出队列`);
            showToast(`✅ 已把 ${targets.length} 个视频移入回收站（HeyGen 端可恢复）`, 'success', 4000);
        } catch (e) {
            bpLog('error', '删除视频失败：' + e.message);
            showToast('删除视频失败: ' + e.message, 'error', 4000);
        }
        bpUpdateTrashButton();
    }
    const bpThumbCache = new Map();   // taskId → objectURL（避免每次渲染重建）
    async function bpThumbUrl(taskId) {
        if (bpThumbCache.has(taskId)) return bpThumbCache.get(taskId);
        const blob = await bpIdbGet(taskId).catch(() => null);
        const url = blob ? URL.createObjectURL(blob) : '';
        bpThumbCache.set(taskId, url);
        return url;
    }
    // 导入时若流水线在跑：新批次默认置「已暂停」，弹框问用户是立刻放行还是先核对
    function bpAskJoinNow(n) {
        return new Promise(resolve => {
            // 挂 body 而非 #hvt-root：后者 pointer-events:none 会让按钮点不动，且最小化面板时 display:none 会带走弹框
            const host = document.body;
            const box = document.createElement('div');
            box.className = 'hvt-bp-ask';
            box.innerHTML = `
              <div class="hvt-bp-ask-card">
                <div class="hvt-bp-ask-title">已添加 ${n} 个任务</div>
                <div class="hvt-bp-ask-body">流水线正在运行中。要立刻把这批任务加入提交队列，还是先核对图文配对再放行？</div>
                <div class="hvt-bp-ask-btns">
                  <button class="hvt-btn hvt-bp-ask-later">先检查，稍后加入</button>
                  <button class="hvt-btn hvt-btn-primary hvt-bp-ask-now">立即加入队列</button>
                </div>
              </div>`;
            host.appendChild(box);
            const done = v => { box.remove(); resolve(v); };
            box.querySelector('.hvt-bp-ask-now').onclick = () => done(true);
            box.querySelector('.hvt-bp-ask-later').onclick = () => done(false);
            box.onclick = e => { if (e.target === box) done(false); };   // 点遮罩 = 先检查（安全默认）
        });
    }
    // 导入收尾：非运行中直接是「待提交」无需询问；运行中按用户选择放行或留在暂停
    async function bpAfterImport(batchId, n, extra = '') {
        if (!bpRunning) { showToast(`已添加 ${n} 个任务${extra}`, 'success'); return; }
        showToast(`已添加 ${n} 个任务${extra}`, 'success');
        if (await bpAskJoinNow(n)) {
            bpDb.tasks.forEach(t => { if (t.batchId === batchId && t.status === '已暂停') t.status = '待提交'; });
            bpSaveDb(); bpRenderTasks(); bpKick();
            showToast(`${n} 个任务已加入提交队列`, 'success');
        } else {
            showToast(`${n} 个任务已暂停，核对后点队列顶部的「▶ 恢复全部」放行`, 'info', 8000);
        }
    }
    // 常驻提示条：只要有「已暂停」任务就显示，提供整批放行入口（运行中同样可点）
    function bpRenderPausedBar() {
        const bar = document.getElementById('hvt-bp-paused-bar');
        if (!bar) return;
        const n = bpDb.tasks.filter(t => t.status === '已暂停').length;
        if (!n) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
        bar.style.display = '';
        bar.innerHTML = `<span>⏸ 有 <b>${n}</b> 个任务已暂停，尚未进入提交队列；核对图文配对无误后点右侧放行</span>
          <button id="hvt-bp-resume-all" class="hvt-btn hvt-btn-primary">▶ 恢复全部 ${n} 条</button>`;
        bar.querySelector('#hvt-bp-resume-all').onclick = () => {
            bpDb.tasks.forEach(t => { if (t.status === '已暂停') t.status = '待提交'; });
            bpSaveDb(); bpRenderTasks(); bpKick();
            showToast(`已恢复 ${n} 个任务`, 'success');
        };
    }
    // 渲染时在每个批次首行前插入批次头（两种视图共用）
    function bpWithBatchHeaders(tasks, rowFn) {
        let out = '', lastBid = null;
        tasks.forEach((t, i) => {
            const bid = t.batchId || 'legacy';
            if (bid !== lastBid) {
                const n = tasks.filter(x => (x.batchId || 'legacy') === bid).length;
                out += `<div class="hvt-bp-batch-header">📦 ${esc(bid === 'legacy' ? '早期批次' : bpBatchLabel(bid))}（${n} 条）</div>`;
                lastBid = bid;
            }
            out += rowFn(t, i);
        });
        return out;
    }
    function bpRenderTasks() {
        const wrap = document.getElementById('hvt-bp-list');
        if (!wrap) return;
        if (!bpDb.tasks.length) {
            wrap.innerHTML = '<div class="hvt-bp-empty">暂无任务：选择图片并粘贴对应文案后点「添加任务」</div>';
            bpRenderProgress(); bpUpdateTrashButton(); bpRenderPausedBar();
            return;
        }
        const last = bpDb.tasks.length - 1;
        // 卡片模式：ARH 式图文对照排版。类名与列表模式一致（hvt-bp-row / hvt-bp-t-script…），
        // 点击/change/拖拽交换文案的事件委托两个视图共用，无需分支绑定。
        if (bpDb.settings.viewMode === 'card') {
            wrap.classList.add('hvt-bp-cards');
            wrap.innerHTML = bpWithBatchHeaders(bpDb.tasks, (t, i) => `
            <div class="hvt-bp-row hvt-bp-card" data-id="${esc(t.id)}">
              <img class="hvt-bp-thumb hvt-bp-card-thumb" alt="" title="点击换图（批内互换/上传）；已提交任务点击放大">
              <div class="hvt-bp-card-body">
                <div class="hvt-bp-card-top">
                  <span class="hvt-bp-idx">#${i + 1}</span>
                  <input class="hvt-bp-t-title hvt-input" value="${esc(t.title)}" title="视频标题">
                  <input class="hvt-bp-t-voice hvt-input" value="${esc(t.voiceId)}" placeholder="声音ID(空=默认)" title="该任务单独的声音 ID，留空用默认">
                  <span class="hvt-bp-t-status hvt-bp-st-${t.status === '失败' ? 'err' : (BP_FINAL_STATES.includes(t.status) ? 'ok' : (['待提交','已暂停'].includes(t.status) ? 'idle' : 'busy'))}"
                        title="${esc(t.error || '')}">${esc(t.status)}${t.error ? ' ⚠' : ''}</span>
                </div>
                <div class="hvt-bp-t-script hvt-bp-card-script${bpSwappable(t) ? ' hvt-bp-draggable' : ''}" draggable="${bpSwappable(t)}"
                     title="${bpSwappable(t) ? '拖到另一张卡片交换文案（图片不动）' : ''}">${esc(t.script)}</div>
                <div class="hvt-bp-card-foot">
                  ${t.draftId ? `<label class="hvt-bp-selall-label"><input type="checkbox" class="hvt-bp-t-sel" ${bpSelected.has(t.id) ? 'checked' : ''}>选中</label>` : ''}
                  <span class="hvt-bp-swap">
                    <button class="hvt-btn hvt-bp-txt-up" title="文案与上一张调换（图片不动）" ${i === 0 ? 'disabled' : ''}>⇅↑</button>
                    <button class="hvt-btn hvt-bp-txt-down" title="文案与下一张调换（图片不动）" ${i === last ? 'disabled' : ''}>⇅↓</button>
                  </span>
                  <span class="hvt-bp-t-ops">
                    ${t.videoUrl ? '<button class="hvt-btn hvt-bp-dl" title="下载视频">⬇</button>' : ''}
                    ${t.status === '已暂停' ? '<button class="hvt-btn hvt-bp-resume" title="恢复为待提交，加入提交队列">▶</button>' : ''}
                    ${t.status === '失败' ? '<button class="hvt-btn hvt-bp-retry" title="重置为待提交（同一张图重试）">↺</button>' : ''}
                    ${t.status === '失败' ? '<button class="hvt-btn hvt-bp-reimg" title="换一张图片重新生成">🖼</button>' : ''}
                    <button class="hvt-btn hvt-bp-del" title="删除任务">✕</button>
                  </span>
                </div>
              </div>
            </div>`);
        } else {
        wrap.classList.remove('hvt-bp-cards');
        wrap.innerHTML = bpWithBatchHeaders(bpDb.tasks, (t, i) => `
            <div class="hvt-bp-row" data-id="${esc(t.id)}">
              ${t.draftId ? `<input type="checkbox" class="hvt-bp-t-sel" title="选中该平台视频（供批量删除）" ${bpSelected.has(t.id) ? 'checked' : ''}>` : '<span></span>'}
              <span class="hvt-bp-idx">${i + 1}</span>
              <img class="hvt-bp-thumb" alt="" title="点击换图（批内互换/上传）；已提交任务点击放大">
              <input class="hvt-bp-t-title hvt-input" value="${esc(t.title)}" title="视频标题">
              <input class="hvt-bp-t-voice hvt-input" value="${esc(t.voiceId)}" placeholder="声音ID(空=默认)" title="该任务单独的声音 ID，留空用默认">
              <span class="hvt-bp-t-script${bpSwappable(t) ? ' hvt-bp-draggable' : ''}" draggable="${bpSwappable(t)}" title="${esc(t.script)}${bpSwappable(t) ? '\n（可拖到另一行交换文案，图片不动）' : ''}">${esc(t.script.slice(0, 40))}${t.script.length > 40 ? '…' : ''}</span>
              <span class="hvt-bp-swap">
                <button class="hvt-btn hvt-bp-txt-up" title="文案与上一行调换（图片不动）" ${i === 0 ? 'disabled' : ''}>⇅↑</button>
                <button class="hvt-btn hvt-bp-txt-down" title="文案与下一行调换（图片不动）" ${i === last ? 'disabled' : ''}>⇅↓</button>
              </span>
              <span class="hvt-bp-t-status hvt-bp-st-${t.status === '失败' ? 'err' : (BP_FINAL_STATES.includes(t.status) ? 'ok' : (['待提交','已暂停'].includes(t.status) ? 'idle' : 'busy'))}"
                    title="${esc(t.error || '')}">${esc(t.status)}${t.error ? ' ⚠' : ''}</span>
              <span class="hvt-bp-t-ops">
                ${t.videoUrl ? '<button class="hvt-btn hvt-bp-dl" title="下载视频">⬇</button>' : ''}
                ${t.status === '已暂停' ? '<button class="hvt-btn hvt-bp-resume" title="恢复为待提交，加入提交队列">▶</button>' : ''}
                ${t.status === '失败' ? '<button class="hvt-btn hvt-bp-retry" title="重置为待提交（同一张图重试）">↺</button>' : ''}
                ${t.status === '失败' ? '<button class="hvt-btn hvt-bp-reimg" title="换一张图片重新生成">🖼</button>' : ''}
                <button class="hvt-btn hvt-bp-del" title="删除任务">✕</button>
              </span>
            </div>`);
        }
        // 缩略图异步填充（IndexedDB → objectURL）
        wrap.querySelectorAll('.hvt-bp-row').forEach(row => {
            bpThumbUrl(row.dataset.id).then(url => {
                const img = row.querySelector('.hvt-bp-thumb');
                if (img && url) img.src = url;
            });
        });
        bpUpdateTrashButton();
        bpRenderProgress();
        bpRenderPausedBar();
    }
    // 文案（含标题/声音ID）在两行间调换，图片和已建头像保持原位
    const bpSwappable = (t) => ['待提交', '失败', '已暂停'].includes(t.status);
    function bpSwapPair(task, other) {
        if (!bpSwappable(task) || !bpSwappable(other)) { showToast('已提交的任务不能调换文案', 'error'); return false; }
        if ((task.batchId || 'legacy') !== (other.batchId || 'legacy')) { showToast('不同批次之间不能调换文案', 'error'); return false; }
        for (const k of ['title', 'script', 'voiceId']) {
            [task[k], other[k]] = [other[k], task[k]];
        }
        bpSaveDb(); bpRenderTasks();
        return true;
    }
    function bpSwapScript(task, dir) {
        const i = bpDb.tasks.indexOf(task);
        const j = i + dir;
        if (j < 0 || j >= bpDb.tasks.length) return;
        bpSwapPair(task, bpDb.tasks[j]);
    }
    // 重新随机：文案/标题/声音ID 留在原行，图片在批次内随机换位（IDB blob 互换）
    async function bpReshuffleImages() {
        // 洗牌限定在各批次内部，避免跨批次串图（look 隶属各批次自己的头像组）
        const pools = new Map();
        for (const t of bpDb.tasks.filter(t => ['待提交', '已暂停'].includes(t.status))) {
            const bid = t.batchId || 'legacy';
            if (!pools.has(bid)) pools.set(bid, []);
            pools.get(bid).push(t);
        }
        let total = 0;
        for (const pool of pools.values()) {
            if (pool.length < 2) continue;
            const blobs = await Promise.all(pool.map(t => bpIdbGet(t.id).catch(() => null)));
            const order = bpShuffle(pool.map((_, i) => i));
            await Promise.all(pool.map((t, i) => {
                const b = blobs[order[i]];
                return (b ? bpIdbPut(t.id, b) : bpIdbDel(t.id)).catch(() => {});
            }));
            pool.forEach(t => {
                t.lookId = '';   // 图变了，重走上传+审核
                const u = bpThumbCache.get(t.id);
                if (u) { URL.revokeObjectURL(u); bpThumbCache.delete(t.id); }
            });
            total += pool.length;
        }
        if (!total) { showToast('可洗牌的「待提交/已暂停」任务不足 2 个（洗牌只在批次内进行）', 'error'); return; }
        bpSaveDb(); bpRenderTasks();
        showToast(`已随机换位 ${total} 张图片（文案不动，批次内）`, 'success');
    }
    // 两个任务互换图片（blob 互换，文案不动）；图变则清 lookId，失败任务顺带重置回待提交
    async function bpSwapImages(a, b) {
        const [ba, bb] = await Promise.all([bpIdbGet(a.id).catch(() => null), bpIdbGet(b.id).catch(() => null)]);
        await Promise.all([
            (bb ? bpIdbPut(a.id, bb) : bpIdbDel(a.id)).catch(() => {}),
            (ba ? bpIdbPut(b.id, ba) : bpIdbDel(b.id)).catch(() => {}),
        ]);
        for (const t of [a, b]) {
            t.lookId = '';
            if (t.status === '失败') { t.status = '待提交'; t.draftId = ''; t.error = ''; }
            const u = bpThumbCache.get(t.id);
            if (u) { URL.revokeObjectURL(u); bpThumbCache.delete(t.id); }
        }
        bpSaveDb(); bpRenderTasks();
    }
    // 换图选择器：大图预览 + 同批次可换任务缩略图（点选互换）+ 本地上传
    async function bpOpenImagePicker(task) {
        const bid = task.batchId || 'legacy';
        const peers = bpDb.tasks.filter(t =>
            t.id !== task.id && (t.batchId || 'legacy') === bid && bpSwappable(t) && t.id !== bpCurrentTask);
        const box = document.createElement('div');
        box.className = 'hvt-bp-lightbox';
        const curUrl = await bpThumbUrl(task.id);
        box.innerHTML = `
          <div class="hvt-bp-imgpick" title="">
            <div class="hvt-bp-imgpick-cur">${curUrl ? `<img src="${curUrl}" alt="">` : '<span>（无图）</span>'}</div>
            <div class="hvt-bp-imgpick-tip">点下方任一图与「${esc(task.title)}」互换，或上传新图（文案不动）</div>
            <div class="hvt-bp-imgpick-grid"></div>
            <div class="hvt-bp-imgpick-foot">
              <button class="hvt-btn hvt-bp-imgpick-upload">⬆ 上传新图</button>
              <button class="hvt-btn hvt-bp-imgpick-close">关闭</button>
            </div>
          </div>`;
        const grid = box.querySelector('.hvt-bp-imgpick-grid');
        for (const p of peers) {
            const cell = document.createElement('div');
            cell.className = 'hvt-bp-imgpick-cell';
            cell.title = `与 #${bpDb.tasks.indexOf(p) + 1}「${p.title}」互换图片`;
            const img = document.createElement('img');
            bpThumbUrl(p.id).then(u => { if (u) img.src = u; });
            cell.appendChild(img);
            cell.addEventListener('click', async () => {
                box.remove();
                await bpSwapImages(task, p).catch(err => showToast('互换失败: ' + err.message, 'error', 4000));
                showToast(`已互换「${task.title}」与「${p.title}」的图片`, 'success');
            });
            grid.appendChild(cell);
        }
        if (!peers.length) grid.innerHTML = '<span class="hvt-bp-imgpick-empty">本批次内没有其他可换图的任务，可用「上传新图」</span>';
        box.querySelector('.hvt-bp-imgpick-upload').addEventListener('click', () => { box.remove(); bpReplaceImage(task); });
        box.querySelector('.hvt-bp-imgpick-close').addEventListener('click', () => box.remove());
        box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
        document.body.appendChild(box);
    }
    // 本地上传一张新图替换任务底图；失败任务重置回待提交重跑
    function bpReplaceImage(task) {
        if (task.id === bpCurrentTask) { showToast('该任务正在执行，无法换图', 'error'); return; }
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = async () => {
            const file = inp.files?.[0];
            if (!file) return;
            try {
                const blob = await bpPrepareImage(file);
                await bpIdbPut(task.id, blob);
                const old = bpThumbCache.get(task.id);
                if (old) { URL.revokeObjectURL(old); bpThumbCache.delete(task.id); }
                task.lookId = '';
                if (task.status === '失败') { task.status = '待提交'; task.draftId = ''; task.error = ''; bpKick(); }
                bpSaveDb(); bpRenderTasks();
                showToast('已换图', 'success');
            } catch (err) { showToast('换图失败: ' + err.message, 'error', 4000); }
        };
        inp.click();
    }
    function bpSyncSettingsFromUI() {
        const g = (id) => document.getElementById(id);
        bpDb.settings.spaceId     = g('hvt-bp-space').value;
        bpDb.settings.groupName   = g('hvt-bp-gname').value.trim();
        bpDb.settings.titlePrefix = g('hvt-bp-prefix').value;   // 不 trim：允许「A_」「A 」等带分隔符前缀
        bpDb.settings.voiceId     = g('hvt-bp-voice').value.trim();
        bpDb.settings.voiceEngine = g('hvt-bp-vengine').value;
        bpDb.settings.voiceSpeed  = bpNormSpeed(g('hvt-bp-vspeed').value);
        bpDb.settings.orientation = g('hvt-bp-orient').value;
        bpDb.settings.resolution  = g('hvt-bp-res').value;
        bpDb.settings.forceIII    = g('hvt-bp-force3').checked;
        bpDb.settings.intervalMin = Math.max(0, parseFloat(g('hvt-bp-int-min').value) || 0);
        bpDb.settings.intervalMax = Math.max(bpDb.settings.intervalMin, parseFloat(g('hvt-bp-int-max').value) || 0);
        bpDb.settings.hourlyCap   = Math.max(1, parseInt(g('hvt-bp-cap').value, 10) || 25);
        bpDb.settings.scheduleAt  = g('hvt-bp-schedule').value;
        bpDb.settings.autoDownload = g('hvt-bp-autodl').checked;
        bpDb.settings.autoBorrow  = g('hvt-bp-autoborrow').checked;
        bpSaveDb();
        bpSyncFoldSummaries();
    }
    function bpFillSettingsUI() {
        const s = bpDb.settings;
        const g = (id) => document.getElementById(id);
        g('hvt-bp-space').value   = s.spaceId;
        g('hvt-bp-gname').value   = s.groupName;
        g('hvt-bp-prefix').value  = s.titlePrefix || '';
        g('hvt-bp-voice').value   = s.voiceId;
        g('hvt-bp-vengine').value = s.voiceEngine || 'auto';
        g('hvt-bp-vspeed').value  = s.voiceSpeed || '1.0';
        g('hvt-bp-orient').value  = s.orientation;
        g('hvt-bp-res').value     = s.resolution;
        g('hvt-bp-force3').checked = s.forceIII;
        g('hvt-bp-int-min').value = s.intervalMin;
        g('hvt-bp-int-max').value = s.intervalMax;
        g('hvt-bp-cap').value     = s.hourlyCap;
        g('hvt-bp-schedule').value = s.scheduleAt;
        g('hvt-bp-autodl').checked = s.autoDownload;
        g('hvt-bp-autoborrow').checked = s.autoBorrow;
        bpSyncFoldSummaries();
    }
    // 折叠条摘要：折叠时也能一眼确认当前配置
    function bpSyncFoldSummaries() {
        const s = bpDb.settings;
        const p = document.getElementById('hvt-bp-params-sum');
        if (p) p.textContent = [
            s.orientation === 'landscape' ? '横屏' : '竖屏',
            s.resolution || '720p',
            s.forceIII ? 'Avatar III' : 'Avatar IV',
            s.voiceId ? '声音已设' : '⚠ 声音未设',
            s.autoBorrow ? '借图开' : '',
            s.autoDownload ? '自动下载' : '',
        ].filter(Boolean).join(' · ');
        const r = document.getElementById('hvt-bp-rhythm-sum');
        if (r) r.textContent = `间隔 ${s.intervalMin}~${s.intervalMax} 秒 · 每小时 ≤${s.hourlyCap}`
            + (s.scheduleAt ? ` · 定时 ${s.scheduleAt.replace('T', ' ')}` : '');
    }
    // Space 下拉：异步拉取团队空间列表填充；无已选值时默认第一个团队 Space
    async function bpPopulateSpaces() {
        const sel = document.getElementById('hvt-bp-space');
        if (!sel || sel.dataset.loaded) return;
        try {
            const spaces = await fetchSpaces();
            for (const sp of spaces) {
                const opt = document.createElement('option');
                opt.value = sp.id; opt.textContent = sp.name;
                sel.appendChild(opt);
            }
            sel.dataset.loaded = '1';
            if (!bpDb.settings.spaceId && spaces.length) {
                bpDb.settings.spaceId = spaces[0].id;
                bpSaveDb();
            }
            sel.value = bpDb.settings.spaceId;
        } catch { /* 拉取失败保持「个人」 */ }
    }

    function bpBuildUI() {
        const root = document.createElement('div');
        root.id = 'hvt-bp-overlay';
        root.style.display = 'none';
        root.innerHTML = `
            <div id="hvt-bp-panel">
              <div id="hvt-bp-header">
                <span>🎬 批量流水线（免 UI 提交视频）</span>
                <button id="hvt-bp-close" title="关闭">✕</button>
              </div>
              <div id="hvt-bp-topbar">
                <button id="hvt-bp-toggle" class="hvt-btn hvt-btn-primary">▶ 开始提交</button>
                <div id="hvt-bp-progress" style="display:none"></div>
                <div id="hvt-bp-status"></div>
              </div>
              <div id="hvt-bp-body">
                <details class="hvt-bp-fold" id="hvt-bp-params-sec">
                  <summary>⚙ 默认参数 <span class="hvt-bp-fold-sum" id="hvt-bp-params-sum"></span></summary>
                  <div class="hvt-bp-hint">整批共建 1 个头像组，逐造型审核；走 Avatar Shots 通道，Avatar III 不占额度。以下为新任务的默认值，导入时快照进任务。</div>
                  <div class="hvt-bp-grid">
                    <label>Space
                      <select id="hvt-bp-space" class="hvt-input"><option value="">个人</option></select>
                    </label>
                    <label title="批次文件夹名（同时用作头像组名），实际名称=此名+批次号；留空用「批量-批次号」">文件夹名 <input id="hvt-bp-gname" class="hvt-input" placeholder="批量"></label>
                    <label title="加在每条视频名最前面的代号/前缀，留空不加；导入时拼进任务标题（之后改代号不影响已导入任务）">代号 <input id="hvt-bp-prefix" class="hvt-input" placeholder="如 A_ / 项目名"></label>
                    <label>声音ID <input id="hvt-bp-voice" class="hvt-input" placeholder="默认 voice_id"></label>
                    <label>引擎
                      <select id="hvt-bp-vengine" class="hvt-input">
                        <option value="auto">auto</option>
                        <option value="elevenLabs">elevenLabs</option>
                        <option value="elevenLabsV3">elevenLabsV3</option>
                        <option value="panda">panda</option>
                        <option value="starfish">starfish</option>
                        <option value="fish">fish</option>
                      </select>
                    </label>
                    <label>语速 <input id="hvt-bp-vspeed" class="hvt-input hvt-bp-num" type="number" min="0.5" max="1.5" step="0.05"></label>
                    <label>画幅
                      <select id="hvt-bp-orient" class="hvt-input">
                        <option value="portrait">竖屏 9:16</option>
                        <option value="landscape">横屏 16:9</option>
                      </select>
                    </label>
                    <label>分辨率
                      <select id="hvt-bp-res" class="hvt-input">
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                      </select>
                    </label>
                  </div>
                  <div class="hvt-bp-line hvt-bp-checks">
                    <label title="Avatar III + 无限模式（不占额度）；取消则用 Avatar IV"><input type="checkbox" id="hvt-bp-force3"> Avatar III（不占额度）</label>
                    <label><input type="checkbox" id="hvt-bp-autodl"> 完成后自动下载</label>
                    <label title="人物图片审核未通过时，自动随机借用一张已过审任务的图片继续出片（免重新审核），无需人工干预"><input type="checkbox" id="hvt-bp-autoborrow"> 失败自动借图</label>
                  </div>
                </details>
                <details class="hvt-bp-fold" id="hvt-bp-rhythm-sec">
                  <summary>⏱ 提交节奏 <span class="hvt-bp-fold-sum" id="hvt-bp-rhythm-sum"></span></summary>
                  <div class="hvt-bp-line">
                    <label>间隔(秒) <input id="hvt-bp-int-min" class="hvt-input hvt-bp-num" type="number" min="0" step="5">
                      ~ <input id="hvt-bp-int-max" class="hvt-input hvt-bp-num" type="number" min="0" step="5"></label>
                    <label>每小时上限 <input id="hvt-bp-cap" class="hvt-input hvt-bp-num" type="number" min="1" step="1"></label>
                    <label>定时启动 <input id="hvt-bp-schedule" class="hvt-input" type="datetime-local"></label>
                  </div>
                  <div class="hvt-bp-note">⚠ 提交与轮询依赖本页面：请保持任意 HeyGen 标签页开启，关闭后重开会自动续跑。多开时仅一个标签页负责提交，其余只查看（避免重复出片）。</div>
                </details>
                <details class="hvt-bp-fold" id="hvt-bp-import-sec" open>
                  <summary>➕ 添加任务</summary>
                  <div class="hvt-bp-line">
                    <label id="hvt-bp-arh-drop" title="ARH 导出包含 copy.tsv 与图片；载入后按编号自动精确配对，并自动填入声音 ID">📦 ARH 导入：点击选 .zip，或把导出文件夹拖到这里<input type="file" id="hvt-bp-zip" accept=".zip" style="display:none"></label>
                  </div>
                  <div class="hvt-bp-line">
                    <label title="手动模式：图片按文件名排序，与下方文案按顺序一一配对">或手动选图 <input type="file" id="hvt-bp-imgs" accept="image/*,.zip" multiple></label>
                    <label title="勾选后文案随机洗牌分配给图片（ARH 编号格式仍精确配对）；导入后可拖动文案调整或点「🔀 重新随机」"><input type="checkbox" id="hvt-bp-randpair"> 随机配对</label>
                  </div>
                  <div id="hvt-bp-img-strip" style="display:none"></div>
                  <details class="hvt-bp-fold" id="hvt-bp-fmt-sec">
                    <summary>📋 不知道粘贴什么格式？看示例（谷歌表格整行复制即可）</summary>
                    <div class="hvt-bp-fmt">
                      <table class="hvt-bp-sheet">
                        <tr><th class="hvt-bp-sheet-corner"></th><th>A<span>序号</span></th><th>B<span>中文（作视频名）</span></th><th>C<span>英文（作配音文案）</span></th></tr>
                        <tr><td>1</td><td>1</td><td>产品开箱介绍</td><td>Hey guys, today I want to show you this amazing product...</td></tr>
                        <tr><td>2</td><td>2</td><td>一周使用体验</td><td>After using it for a week, here is my honest review...</td></tr>
                      </table>
                      <div class="hvt-bp-fmt-tip">在谷歌表格里选中整行（A/B/C 三列一起）复制，直接粘贴到下面输入框，一行 = 一条视频。也支持：两列（第 1 列标题 + 第 2 列文案）、每行一条纯文案、空行分段。</div>
                      <button id="hvt-bp-fmt-fill" class="hvt-btn">⬇ 把上面示例填入试试</button>
                    </div>
                  </details>
                  <table class="hvt-bp-sheet hvt-bp-grid" id="hvt-bp-grid">
                    <thead><tr>
                      <th class="hvt-bp-sheet-corner"></th>
                      <th>视频名<span>可留空 = 用图片文件名</span></th>
                      <th>配音文案<span>可从谷歌表格整块复制后在任意格粘贴，自动分行分列</span></th>
                      <th class="hvt-bp-sheet-corner"></th>
                    </tr></thead>
                    <tbody id="hvt-bp-grid-body"></tbody>
                  </table>
                  <div class="hvt-bp-line" id="hvt-bp-grid-ops">
                    <button id="hvt-bp-grid-addrow" class="hvt-btn">➕ 加一行</button>
                    <button id="hvt-bp-grid-clear" class="hvt-btn">🧹 清空</button>
                    <button id="hvt-bp-grid-mode" class="hvt-btn" title="表格 ⇄ 原始文本框（ARH copy.tsv 等特殊格式用文本框）">✍ 文本模式</button>
                  </div>
                  <textarea id="hvt-bp-scripts" style="display:none" placeholder="粘贴文案（或用「📦 ARH 导入」自动填入）。支持：&#10;· ARH copy.tsv（#N# 与图片文件名前导编号精确配对，自动带 voice_id）&#10;· 谷歌表格整行粘贴（每行一条；两列时第 1 列作标题、第 2 列作文案；「序号+中文+英文」三列时只取英文作配音文案）&#10;· 空行分段 / 每行一条"></textarea>
                  <div class="hvt-bp-line">
                    <button id="hvt-bp-add" class="hvt-btn hvt-btn-primary">添加任务</button>
                  </div>
                </details>
                <div class="hvt-bp-section" id="hvt-bp-queue-sec">
                  <div class="hvt-bp-toolbar">
                    <span class="hvt-bp-sec-title">任务队列</span>
                    <button id="hvt-bp-view" class="hvt-btn" title="切换 列表/卡片 视图；卡片视图显示大图与完整文案，便于核对图文配对"></button>
                    <button id="hvt-bp-shuffle" class="hvt-btn" title="文案/标题留在原行，图片在批次内随机换位（仅待提交/已暂停任务）">🔀 重新随机</button>
                    <button id="hvt-bp-export" class="hvt-btn" title="按 ARH zip 同构目录重写归档（文件夹名/images/N_中文.jpg + copy.tsv）；导入时已自动生成，此按钮用于配对调整后手动重刷">📁 生成归档</button>
                    <span class="hvt-bp-toolbar-spacer"></span>
                    <button id="hvt-bp-retryall" class="hvt-btn hvt-bp-btn-warn" title="把所有失败任务重置回「待提交」重新走完整流水线" disabled>↺ 重试全部失败</button>
                    <button id="hvt-bp-clean" class="hvt-btn hvt-bp-btn-warn" title="失败但已提交过渲染的任务，把其平台残留视频移入回收站；任务行保留可继续重试" disabled>🧹 清理失败残留</button>
                    <span class="hvt-bp-toolbar-sep"></span>
                    <label class="hvt-bp-selall-label" title="全选/取消全选已出片的行"><input type="checkbox" id="hvt-bp-selall"> 全选</label>
                    <button id="hvt-bp-trash" class="hvt-btn hvt-bp-btn-danger" title="把勾选的平台视频移入 HeyGen 回收站（可恢复），并从队列移除对应行" disabled>🗑 删除所选视频</button>
                  </div>
                  <div id="hvt-bp-paused-bar" class="hvt-bp-paused-bar" style="display:none"></div>
                  <div id="hvt-bp-list"></div>
                </div>
                <details class="hvt-bp-fold" id="hvt-bp-log-sec">
                  <summary>📋 运行日志 <span id="hvt-bp-log-last"></span>
                    <span class="hvt-bp-log-ops">
                      <button id="hvt-bp-log-dl" class="hvt-btn" title="导出全部日志为 txt">下载</button>
                      <button id="hvt-bp-log-clear" class="hvt-btn" title="清空日志">清空</button>
                    </span>
                  </summary>
                  <div id="hvt-bp-log" title="预审/上传/审核/渲染/下载的实时记录，出错时含具体报错"></div>
                </details>
              </div>
            </div>`;
        document.body.appendChild(root);

        const g = (id) => document.getElementById(id);
        g('hvt-bp-close').addEventListener('click', () => { root.style.display = 'none'; });
        root.addEventListener('click', (e) => { if (e.target === root) root.style.display = 'none'; });

        ['hvt-bp-space', 'hvt-bp-gname', 'hvt-bp-prefix', 'hvt-bp-voice', 'hvt-bp-vengine', 'hvt-bp-vspeed', 'hvt-bp-orient', 'hvt-bp-res', 'hvt-bp-force3', 'hvt-bp-autodl', 'hvt-bp-autoborrow',
         'hvt-bp-int-min', 'hvt-bp-int-max', 'hvt-bp-cap', 'hvt-bp-schedule']
            .forEach(id => g(id).addEventListener('change', bpSyncSettingsFromUI));

        g('hvt-bp-log-dl').addEventListener('click', bpDownloadLog);
        g('hvt-bp-log-clear').addEventListener('click', bpClearLog);
        // summary 里的操作按钮不触发日志区折叠开合
        root.querySelector('.hvt-bp-log-ops').addEventListener('click', (e) => e.preventDefault());

        // 选图后立即显示顺序预览条，便于与文案顺序核对
        g('hvt-bp-imgs').addEventListener('change', async () => {
            // 选中里含 zip → 就地解包取图片，与散图合并回选择框（后续「添加任务」直接复用 input.files）
            let picked = [...g('hvt-bp-imgs').files];
            if (picked.some(f => /\.zip$/i.test(f.name))) {
                const out = [];
                for (const f of picked) {
                    if (!/\.zip$/i.test(f.name)) { out.push(f); continue; }
                    try {
                        out.push(...(await bpUnzip(f)).filter(x => x.type.startsWith('image/') && !x.name.startsWith('.')));
                    } catch (e) { showToast(`解压「${f.name}」失败：${e.message}`, 'error', 5000); }
                }
                const dt = new DataTransfer();
                out.forEach(f => dt.items.add(f));
                g('hvt-bp-imgs').files = dt.files;
                picked = out;
            }
            const strip = g('hvt-bp-img-strip');
            strip.querySelectorAll('img').forEach(im => URL.revokeObjectURL(im.src));
            const files = picked.sort((a, b) => a.name.localeCompare(b.name));
            if (!files.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
            strip.style.display = '';
            strip.innerHTML = files.map((f, i) =>
                `<span class="hvt-bp-strip-item"><span class="hvt-bp-strip-idx">${i + 1}</span><img alt=""><span class="hvt-bp-strip-name">${esc(f.name)}</span></span>`
            ).join('');
            strip.querySelectorAll('img').forEach((im, i) => { im.src = URL.createObjectURL(files[i]); });
        });

        // ARH 整包载入（文件夹/zip 共用）：图片填入图片选择框（触发预览条）、copy.tsv 读入文案框
        const bpLoadArhBundle = async (all, srcLabel) => {
            const imgs = all.filter(f => f.type.startsWith('image/') && !f.name.startsWith('.'));
            const tsv = all.find(f => f.name.toLowerCase() === 'copy.tsv')
                     || all.find(f => /\.(tsv|txt|csv)$/i.test(f.name) && !f.name.startsWith('.'));
            if (!imgs.length || !tsv) {
                showToast(`${srcLabel}缺${!imgs.length ? '图片' : ''}${!imgs.length && !tsv ? '和' : ''}${!tsv ? '文案文件(copy.tsv)' : ''}`, 'error', 4500);
                return;
            }
            const dt = new DataTransfer();
            imgs.forEach(f => dt.items.add(f));
            g('hvt-bp-imgs').files = dt.files;
            g('hvt-bp-imgs').dispatchEvent(new Event('change'));
            g('hvt-bp-scripts').value = await tsv.text();
            bpImportTextMode(true);   // ARH copy.tsv 是 #N# 特殊格式，切到文本框展示
            showToast(`已载入 ${imgs.length} 张图片 + ${tsv.name}，请核对后点「添加任务」`, 'success');
        };
        g('hvt-bp-zip').addEventListener('change', async () => {
            const zf = g('hvt-bp-zip').files[0];
            g('hvt-bp-zip').value = '';
            if (!zf) return;
            try {
                await bpLoadArhBundle(await bpUnzip(zf), '压缩包');
            } catch (e) {
                showToast(`解压失败：${e.message}`, 'error', 5000);
            }
        });
        // 同一入口支持拖入导出文件夹或 zip（Finder 拖放）
        const bpEntryFiles = async (entry) => {
            if (entry.isFile) return [await new Promise((res, rej) => entry.file(res, rej))];
            const reader = entry.createReader();
            const children = [];
            // readEntries 每次最多返回 100 条，须循环读空
            for (;;) {
                const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
                if (!batch.length) break;
                children.push(...batch);
            }
            const out = [];
            for (const c of children) out.push(...await bpEntryFiles(c));
            return out;
        };
        const arhDrop = g('hvt-bp-arh-drop');
        arhDrop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); arhDrop.classList.add('hvt-bp-drop-over'); });
        arhDrop.addEventListener('dragleave', () => arhDrop.classList.remove('hvt-bp-drop-over'));
        arhDrop.addEventListener('drop', async (e) => {
            e.preventDefault(); e.stopPropagation();
            arhDrop.classList.remove('hvt-bp-drop-over');
            try {
                const entries = [...e.dataTransfer.items].map(it => it.webkitGetAsEntry()).filter(Boolean);
                let all = [];
                for (const en of entries) all.push(...await bpEntryFiles(en));
                if (all.length === 1 && /\.zip$/i.test(all[0].name)) all = await bpUnzip(all[0]);
                if (all.length) await bpLoadArhBundle(all, '拖入内容');
            } catch (err) {
                showToast(`载入失败：${err.message}`, 'error', 5000);
            }
        });

        // ── 文案表格编辑器 ──
        bpGridClearRows();   // 初始 3 空行
        const gridBody = g('hvt-bp-grid-body');
        // 粘贴：多行/带制表符 → 从当前行起逐行填格（谷歌表格整块粘贴）；普通文本 → 纯文本插入当前格
        gridBody.addEventListener('paste', (e) => {
            const txt = (e.clipboardData?.getData('text/plain') || '').replace(/\r/g, '');
            e.preventDefault();
            if (!txt.includes('\n') && !txt.includes('\t')) {
                document.execCommand('insertText', false, txt);
                return;
            }
            const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
            const startTr = e.target.closest('tr');
            let idx = startTr ? [...gridBody.children].indexOf(startTr) : gridBody.children.length;
            for (const line of lines) {
                const { cn, en } = bpGridParseLine(line);
                while (idx >= gridBody.children.length) bpGridAddRow();
                const tr = gridBody.children[idx];
                tr.children[1].textContent = cn;
                tr.children[2].textContent = en;
                idx++;
            }
            bpGridRenumber();
            showToast(`已粘贴 ${lines.length} 行`, 'success');
        });
        gridBody.addEventListener('click', (e) => {
            if (!e.target.classList.contains('hvt-bp-grid-del')) return;
            e.target.closest('tr').remove();
            if (!gridBody.children.length) bpGridAddRow();
            bpGridRenumber();
        });
        g('hvt-bp-grid-addrow').addEventListener('click', () => { bpGridAddRow().children[2].focus(); });
        g('hvt-bp-grid-clear').addEventListener('click', bpGridClearRows);
        g('hvt-bp-grid-mode').addEventListener('click', () => bpImportTextMode(!bpImportInTextMode()));
        // 示例填入：表格模式填进网格，文本模式填 TSV 原文
        g('hvt-bp-fmt-fill').addEventListener('click', () => {
            const sample = [
                ['产品开箱介绍', 'Hey guys, today I want to show you this amazing product...'],
                ['一周使用体验', 'After using it for a week, here is my honest review...'],
            ];
            if (bpImportInTextMode()) {
                g('hvt-bp-scripts').value = sample.map((r, i) => `${i + 1}\t${r[0]}\t${r[1]}`).join('\n');
            } else {
                gridBody.innerHTML = '';
                sample.forEach(r => bpGridAddRow(r[0], r[1]));
                while (gridBody.children.length < BP_GRID_MIN_ROWS) bpGridAddRow();
            }
            showToast('已填入示例（2 条）：再选 2 张图片点「添加任务」即可体验', 'success', 4000);
        });
        g('hvt-bp-add').addEventListener('click', async () => {
            const files = [...g('hvt-bp-imgs').files].sort((a, b) => a.name.localeCompare(b.name));
            const raw = bpImportInTextMode() ? g('hvt-bp-scripts').value : bpGridToTsv();
            const ok = await bpImportTasks(files, raw);
            if (!ok) return;   // 数量不匹配等失败时保留已填内容
            g('hvt-bp-imgs').value = '';
            if (bpImportInTextMode()) g('hvt-bp-scripts').value = '';
            else bpGridClearRows();
            const strip = g('hvt-bp-img-strip');
            strip.querySelectorAll('img').forEach(im => URL.revokeObjectURL(im.src));
            strip.style.display = 'none'; strip.innerHTML = '';
        });

        g('hvt-bp-toggle').addEventListener('click', () => {
            if (bpRunning) { bpStop(); }
            else { bpSyncSettingsFromUI(); bpStart(); }
        });

        g('hvt-bp-list').addEventListener('click', async (e) => {
            const row = e.target.closest('.hvt-bp-row');
            if (!row) return;
            const task = bpDb.tasks.find(t => t.id === row.dataset.id);
            if (!task) return;
            if (e.target.classList.contains('hvt-bp-del')) {
                if (task.id === bpCurrentTask) { showToast('该任务正在执行，无法删除', 'error'); return; }
                bpDb.tasks = bpDb.tasks.filter(t => t.id !== task.id);
                await bpIdbDel(task.id);
                const thumb = bpThumbCache.get(task.id);
                if (thumb) { URL.revokeObjectURL(thumb); bpThumbCache.delete(task.id); }
                bpSaveDb(); bpRenderTasks();
            } else if (e.target.classList.contains('hvt-bp-resume')) {
                task.status = '待提交';
                bpSaveDb(); bpRenderTasks(); bpKick();
            } else if (e.target.classList.contains('hvt-bp-retry')) {
                // 重试：清掉 lookId 走完整预审（重新上传+审核），保证审核失败/渲染失败都能干净重跑
                task.status = '待提交'; task.lookId = ''; task.draftId = ''; task.error = '';
                bpSaveDb(); bpRenderTasks(); bpKick();
            } else if (e.target.classList.contains('hvt-bp-reimg')) {
                // 换图重试：覆盖同 task.id 的底图，清 lookId 走完整预审重新上传+审核；标题/文案/声音ID/配对关系不变
                bpReplaceImage(task);
            } else if (e.target.classList.contains('hvt-bp-dl')) {
                bpDownload(task);
            } else if (e.target.classList.contains('hvt-bp-txt-up')) {
                bpSwapScript(task, -1);
            } else if (e.target.classList.contains('hvt-bp-txt-down')) {
                bpSwapScript(task, 1);
            }
        });
        g('hvt-bp-list').addEventListener('change', (e) => {
            const row = e.target.closest('.hvt-bp-row');
            if (!row) return;
            const task = bpDb.tasks.find(t => t.id === row.dataset.id);
            if (!task) return;
            if (e.target.classList.contains('hvt-bp-t-title')) task.title = e.target.value.trim();
            if (e.target.classList.contains('hvt-bp-t-voice')) task.voiceId = e.target.value.trim();
            if (e.target.classList.contains('hvt-bp-t-sel')) {
                e.target.checked ? bpSelected.add(task.id) : bpSelected.delete(task.id);
                bpUpdateTrashButton();
                return;   // 勾选不落盘
            }
            bpSaveDb();
        });

        g('hvt-bp-selall').addEventListener('change', (e) => {
            const eligible = bpDb.tasks.filter(t => t.draftId);
            if (e.target.checked) eligible.forEach(t => bpSelected.add(t.id));
            else eligible.forEach(t => bpSelected.delete(t.id));
            bpRenderTasks();
        });
        g('hvt-bp-trash').addEventListener('click', bpTrashSelectedVideos);
        g('hvt-bp-retryall').addEventListener('click', bpRetryAllFailed);
        g('hvt-bp-clean').addEventListener('click', bpCleanFailedDrafts);

        // 列表/卡片视图切换（偏好落盘）；按钮文字显示「切换后」的目标视图
        const bpViewBtn = g('hvt-bp-view');
        const bpSyncViewBtn = () => { bpViewBtn.textContent = bpDb.settings.viewMode === 'card' ? '☰ 列表视图' : '🖼 卡片视图'; };
        bpSyncViewBtn();
        bpViewBtn.addEventListener('click', () => {
            bpDb.settings.viewMode = bpDb.settings.viewMode === 'card' ? 'list' : 'card';
            bpSaveDb(); bpSyncViewBtn(); bpRenderTasks();
        });
        // 点击缩略图：可编辑任务（待提交/失败/已暂停）弹换图选择器（批内互换 / 本地上传），其余仅放大预览
        g('hvt-bp-list').addEventListener('click', async (e) => {
            if (!e.target.classList.contains('hvt-bp-thumb')) return;
            const row = e.target.closest('.hvt-bp-row');
            const task = row && bpDb.tasks.find(t => t.id === row.dataset.id);
            if (task && bpSwappable(task) && task.id !== bpCurrentTask) {
                await bpOpenImagePicker(task).catch(err => showToast('换图失败: ' + err.message, 'error', 4000));
                return;
            }
            if (!e.target.src) return;
            const box = document.createElement('div');
            box.className = 'hvt-bp-lightbox';
            box.innerHTML = `<img src="${e.target.src}" alt="">`;
            box.addEventListener('click', () => box.remove());
            document.body.appendChild(box);
        });

        g('hvt-bp-shuffle').addEventListener('click', () => bpReshuffleImages().catch(e => showToast('洗牌失败: ' + e.message, 'error', 4000)));
        g('hvt-bp-export').addEventListener('click', () => bpGenerateArchive().catch(e => showToast('归档失败: ' + e.message, 'error', 4000)));

        // 拖动文案到另一行 → 两行的 标题/文案/声音ID 互换（图片不动）；仅 待提交/失败 行可参与
        let bpDragSrcId = null;
        const list = g('hvt-bp-list');
        list.addEventListener('dragstart', (e) => {
            const cell = e.target.closest('.hvt-bp-t-script');
            const row = e.target.closest('.hvt-bp-row');
            if (!cell || !row) return;
            const task = bpDb.tasks.find(t => t.id === row.dataset.id);
            if (!task || !bpSwappable(task)) { e.preventDefault(); return; }
            bpDragSrcId = task.id;
            e.dataTransfer.effectAllowed = 'move';
        });
        list.addEventListener('dragover', (e) => {
            if (!bpDragSrcId) return;
            const row = e.target.closest('.hvt-bp-row');
            if (!row || row.dataset.id === bpDragSrcId) return;
            const task = bpDb.tasks.find(t => t.id === row.dataset.id);
            if (!task || !bpSwappable(task)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            list.querySelectorAll('.hvt-bp-drop-target').forEach(r => r.classList.remove('hvt-bp-drop-target'));
            row.classList.add('hvt-bp-drop-target');
        });
        list.addEventListener('dragleave', (e) => {
            const row = e.target.closest('.hvt-bp-row');
            if (row && !row.contains(e.relatedTarget)) row.classList.remove('hvt-bp-drop-target');
        });
        list.addEventListener('drop', (e) => {
            if (!bpDragSrcId) return;
            e.preventDefault();
            const row = e.target.closest('.hvt-bp-row');
            const src = bpDb.tasks.find(t => t.id === bpDragSrcId);
            const dst = row && bpDb.tasks.find(t => t.id === row.dataset.id);
            bpDragSrcId = null;
            if (!src || !dst || src === dst) return;
            bpSwapPair(src, dst);   // 内部含可换性校验；成功后重渲染自动清掉高亮
        });
        list.addEventListener('dragend', () => {
            bpDragSrcId = null;
            list.querySelectorAll('.hvt-bp-drop-target').forEach(r => r.classList.remove('hvt-bp-drop-target'));
        });
    }

    function bpOpenPanel() {
        const root = document.getElementById('hvt-bp-overlay');
        bpFillSettingsUI();
        bpPopulateSpaces();
        bpRenderTasks();
        bpRenderLog();
        // 已有任务时收起导入区，把版面让给队列；空队列时展开引导导入
        document.getElementById('hvt-bp-import-sec').open = !bpDb.tasks.length;
        bpUpdateRunButtons();
        root.style.display = 'flex';
    }

    function bpInit() {
        bpLoadDb();
        bpBuildUI();
        // 中断恢复：上次处于运行态 → 自动续跑；卡在中间态的任务按有无 lookId/draftId 归位
        // （'审核中' 有 lookId、'生成中' 有 draftId 的保持原状，续跑时分别由预审轮询/下载轮询接管）
        for (const t of bpDb.tasks) {
            if (t.status === '上传中')        t.status = t.lookId ? '审核中' : '待提交';
            else if (t.status === '提交渲染中') t.status = t.draftId ? '生成中' : (t.lookId ? '待渲染' : '待提交');
            else if (t.status === '下载中')    t.status = t.videoUrl ? '已完成' : (t.draftId ? '生成中' : '待渲染');
        }
        bpSaveDb();
        // 后台工作（自动续跑提交 + 生成中轮询）只在取得单实例锁的标签页进行；
        // 第二个 HeyGen 标签页取不到锁 → 只当查看器，不提交、不轮询，避免重复出片。
        const willResume = bpDb.running || bpDb.tasks.some(t => t.status === '生成中');
        if (willResume) bpSetStatusLine('等待取得提交权（避免多标签页重复提交）…');
        bpTryLock(() => {
            if (bpDb.tasks.some(t => t.status === '生成中')) bpEnsurePoller();
            if (bpDb.running) { bpDb.running = false; bpStart(); }
            else if (willResume) bpSetStatusLine('已取得提交权（本标签页负责轮询下载）');
        });
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
            <button id="hvt-fab-video" title="找我的视频：跨文件夹定位你创建的视频">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 6h5l2 2h9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>
                    <circle cx="11" cy="14" r="3"/>
                    <path d="m14 17 3 3"/>
                </svg>
            </button>
            <div class="hvt-fab-divider"></div>
            <button id="hvt-fab-vd" title="生音 — AI 声音设计">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                    <path d="M20 3v4m2-2h-4"/>
                </svg>
            </button>
            <div class="hvt-fab-divider"></div>
            <button id="hvt-fab-eng" title="强制 Avatar III 引擎：Avatar IV / V 自动切回 III">
                <span class="hvt-fab-eng-txt">III</span>
            </button>
            <div class="hvt-fab-divider"></div>
            <button id="hvt-fab-bp" title="批量流水线：免 UI 批量提交视频并自动下载">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <path d="m10 9 5 3-5 3z"/>
                </svg>
            </button>
        `;
        document.body.appendChild(fabStrip);

        // 浮动图标条可拖动 + 位置记忆（拖动超过 6px 才算拖，否则仍是点击）
        (function initFabDrag() {
            const FAB_POS_KEY = 'hvt_fab_pos';
            function applyPos(x, y) {
                const w = fabStrip.offsetWidth || 300, h = fabStrip.offsetHeight || 48;
                x = Math.min(Math.max(0, x), window.innerWidth - w);
                y = Math.min(Math.max(0, y), window.innerHeight - h);
                fabStrip.style.left = x + 'px';
                fabStrip.style.top = y + 'px';
                fabStrip.style.right = 'auto';
                fabStrip.style.bottom = 'auto';
            }
            try {
                const p = JSON.parse(localStorage.getItem(FAB_POS_KEY));
                if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) applyPos(p.x, p.y);
            } catch {}
            let drag = null;
            let suppressClick = false;
            fabStrip.addEventListener('pointerdown', (e) => {
                const r = fabStrip.getBoundingClientRect();
                drag = { startX: e.clientX, startY: e.clientY, origX: r.left, origY: r.top, moved: false };
                // 注意：此处不能立即 setPointerCapture——捕获会把 click 重定向到条本身，按钮就点不到了
            });
            fabStrip.addEventListener('pointermove', (e) => {
                if (!drag) return;
                const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
                if (!drag.moved && Math.hypot(dx, dy) < 6) return;
                if (!drag.moved) { try { fabStrip.setPointerCapture(e.pointerId); } catch {} }
                drag.moved = true;
                fabStrip.dataset.dragging = '1';
                applyPos(drag.origX + dx, drag.origY + dy);
            });
            fabStrip.addEventListener('pointerup', () => {
                if (drag && drag.moved) {
                    const r = fabStrip.getBoundingClientRect();
                    try { localStorage.setItem(FAB_POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch {}
                    suppressClick = true;
                    setTimeout(() => { suppressClick = false; }, 0);
                }
                delete fabStrip.dataset.dragging;
                drag = null;
            });
            fabStrip.addEventListener('click', (e) => {
                if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
            }, true);
            window.addEventListener('resize', () => {
                const r = fabStrip.getBoundingClientRect();
                if (fabStrip.style.left) applyPos(r.left, r.top);
            });
        })();

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

  <div id="hvt-update-banner" style="display:none"></div>

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
                  <div id="hvt-vd-engine-row">
                    <label class="hvt-vd-label">上传头像生成提示词（可选）</label>
                    <div id="hvt-vd-engine-tabs">
                      <button class="hvt-vd-engine-tab" data-engine="heygen">HeyGen 官方</button>
                      <button class="hvt-vd-engine-tab" data-engine="gemini">AI 分析</button>
                    </div>
                    <button id="hvt-gm-settings-toggle" class="hvt-btn" title="AI 分析设置（Gemini / OpenRouter）" style="display:none">⚙ 设置</button>
                  </div>
                  <div id="hvt-gm-settings" style="display:none">
                    <div class="hvt-gm-set-row">
                      <label>服务商</label>
                      <select id="hvt-gm-provider" class="hvt-input">
                        <option value="gemini">Gemini 官方</option>
                        <option value="openrouter">OpenRouter（免费模型池）</option>
                      </select>
                    </div>
                    <div class="hvt-gm-set-row" id="hvt-gm-key-row">
                      <label>API Key</label>
                      <input id="hvt-gm-key" class="hvt-input" type="password" placeholder="在 aistudio.google.com 免费获取">
                    </div>
                    <div class="hvt-gm-set-row" id="hvt-or-key-row" style="display:none">
                      <label>API Key</label>
                      <input id="hvt-or-key" class="hvt-input" type="password" placeholder="在 openrouter.ai 免费获取（sk-or-…）">
                    </div>
                    <div class="hvt-gm-set-row">
                      <label>模型</label>
                      <select id="hvt-gm-model" class="hvt-input"></select>
                      <button id="hvt-gm-models-refresh" class="hvt-btn" title="实时拉取当前服务商可用模型列表（OpenRouter 只列免费+支持图片的模型）">🔄</button>
                    </div>
                    <div class="hvt-gm-set-row hvt-gm-set-col">
                      <label>系统指令（可精调，输出格式须保留 \`\`\`prompt 代码块）</label>
                      <textarea id="hvt-gm-sys" class="hvt-vd-textarea"></textarea>
                    </div>
                    <div class="hvt-gm-set-actions">
                      <a id="hvt-gm-key-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">获取免费 API Key ↗</a>
                      <a id="hvt-or-key-link" href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener" style="display:none">获取 OpenRouter Key ↗</a>
                      <button id="hvt-gm-sys-reset" class="hvt-btn">恢复默认指令</button>
                      <button id="hvt-gm-save" class="hvt-btn hvt-btn-primary">保存设置</button>
                    </div>
                  </div>
                  <div id="hvt-vd-engine-heygen">
                    <div id="hvt-vd-photo-row">
                      <label id="hvt-vd-photo-drop" for="hvt-vd-photo-input">
                        <img id="hvt-vd-photo-thumb" alt="">
                        <span id="hvt-vd-photo-placeholder">📷 点击选择头像图片</span>
                      </label>
                      <input id="hvt-vd-photo-input" type="file" accept="image/*" hidden>
                      <span id="hvt-vd-photo-status"></span>
                    </div>
                    <div id="hvt-vd-refine-row">
                      <label id="hvt-vd-refine-label"><input id="hvt-vd-refine-on" type="checkbox"> 追加风格补充（拼接到 HeyGen 提示词后）</label>
                      <textarea id="hvt-vd-refine-text" class="hvt-vd-textarea" style="display:none" placeholder="例：Warm and steady delivery, slow-to-moderate pace, suited for devotional narration for an American Christian audience."></textarea>
                    </div>
                  </div>
                  <div id="hvt-vd-engine-gemini" style="display:none">
                    <div id="hvt-gm-photo-row">
                      <div id="hvt-gm-thumbs"></div>
                      <label id="hvt-gm-add" for="hvt-gm-input" title="可添加多张同一人物的图片（最多6张）">＋ 添加图片</label>
                      <input id="hvt-gm-input" type="file" accept="image/*" multiple hidden>
                    </div>
                    <input id="hvt-gm-note" class="hvt-input" placeholder="备注（可选）：如“主要用于圣经叙事”">
                    <div class="hvt-vd-form-actions">
                      <button id="hvt-gm-analyze" class="hvt-btn hvt-btn-primary">🔮 分析生成提示词</button>
                      <span id="hvt-gm-status"></span>
                    </div>
                    <div id="hvt-gm-result" style="display:none">
                      <details id="hvt-gm-analysis"><summary>查看 AI 完整分析</summary><pre id="hvt-gm-analysis-text"></pre></details>
                      <div id="hvt-gm-prompts"></div>
                      <div class="hvt-vd-form-actions">
                        <button id="hvt-gm-create" class="hvt-btn hvt-btn-primary">⚡ 生成所选声音</button>
                        <span id="hvt-gm-create-hint">每个方案出 3 个声音：勾 1/2/3 个方案 → 一次得 3/6/9 个声音</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="hvt-vd-form-row">
                  <label class="hvt-vd-label">提示词
                    <a id="hvt-vd-gpt-link" href="https://chatgpt.com/g/g-69dbc173671081918d1fc9fb3fcaff1d-ren-wu-pei-yin-ti-shi-ci-sheng-cheng-qi" target="_blank" rel="noopener" title="打开 ChatGPT「人物配音提示词生成器」，上传图片生成提示词后粘贴回下方输入框">🤖 ChatGPT 提示词生成器 ↗</a>
                  </label>
                  <textarea id="hvt-vd-prompt" class="hvt-vd-textarea" placeholder="描述声音特征：年龄、性别、风格、口音、情绪……&#10;例：A high-pitched, energetic voice of a 4-year-old American boy with a slight childish lisp."></textarea>
                </div>
                <div class="hvt-vd-form-actions">
                  <select id="hvt-vd-count" class="hvt-input" title="一次生成的试听数量（HeyGen 每组固定出 3 个，多组会依次请求）">
                    <option value="1">3 个（1组）</option>
                    <option value="2">6 个（2组）</option>
                    <option value="3">9 个（3组）</option>
                    <option value="4">12 个（4组）</option>
                  </select>
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
                  <button id="hvt-mv-space-toggle" class="hvt-btn hvt-btn-icon" title="切换显示：本号自带声音 / 社区（Space）声音">🌐</button>
                  <button id="hvt-mv-exp" class="hvt-btn hvt-btn-icon" title="分享到期清理：撤销超过设定天数的对外分享">⏰</button>
                  <button id="hvt-mv-refresh" class="hvt-btn hvt-btn-icon" title="刷新列表">↺</button>
                  <button id="hvt-mv-audio-clear" class="hvt-btn hvt-btn-icon" title="清空所有已缓存的试听音频（单个声音可 Shift+点击试听按钮单独刷新）">🧹</button>
                  <button id="hvt-mv-clear-sel" class="hvt-btn hvt-btn-icon" title="取消全选" style="display:none">✕选</button>
                  <button id="hvt-mv-dl-sel" class="hvt-btn hvt-btn-primary" title="下载已勾选的声音" style="display:none">⬇ 下载已选</button>
                  <button id="hvt-mv-share-sel" class="hvt-btn" title="把已勾选的声音一次性共享给一个或多个邮箱" style="display:none">🔗 共享选中</button>
                  <button id="hvt-mv-del-sel" class="hvt-btn hvt-btn-danger" title="删除已勾选、且是你自己创建的声音（不可逆）" style="display:none">🗑 删除选中</button>
                  <button id="hvt-mv-dl-all" class="hvt-btn hvt-btn-icon" title="下载全部声音 MP3">⬇</button>
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

        // Project Videos modal
        const pvRoot = document.createElement('div');
        pvRoot.id = 'hvt-pv-overlay';
        pvRoot.style.display = 'none';
        pvRoot.innerHTML = `
            <div id="hvt-pv-panel">
              <div id="hvt-pv-header">
                <span id="hvt-pv-title">找我的视频</span>
                <div id="hvt-pv-header-actions">
                  <span id="hvt-pv-count"></span>
                  <button id="hvt-pv-scan" class="hvt-btn">重新扫描</button>
                  <button id="hvt-pv-stop" class="hvt-btn" style="display:none">停止</button>
                  <button id="hvt-pv-close" title="关闭">✕</button>
                </div>
              </div>
              <div id="hvt-pv-toolbar">
                <input id="hvt-pv-search" class="hvt-input" placeholder="搜索视频名称 / 文件夹 / 状态 / ID…" autocomplete="off">
                <select id="hvt-pv-age" class="hvt-input" title="按创建时间筛选老视频">
                  <option value="0">全部时间</option>
                  <option value="3">3天前</option>
                  <option value="7">7天前</option>
                  <option value="15">15天前</option>
                  <option value="custom">自定义</option>
                </select>
                <input id="hvt-pv-age-custom" class="hvt-input" type="number" min="1" step="1" placeholder="天数" title="输入自定义天数" style="display:none">
                <label id="hvt-pv-moved-label">
                  <input type="checkbox" id="hvt-pv-moved-only">
                  只看位置变更
                </label>
                <label id="hvt-pv-selall-label" title="全选当前筛选出来的视频">
                  <input type="checkbox" id="hvt-pv-selall">
                  全选
                </label>
                <button id="hvt-pv-trash" class="hvt-btn hvt-btn-danger" disabled>移入回收站</button>
              </div>
              <div id="hvt-pv-status"></div>
              <div id="hvt-pv-list"></div>
            </div>
        `;
        document.body.appendChild(pvRoot);

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

        document.getElementById('hvt-fab-video').addEventListener('click', () => {
            openProjectVideos();
        });

        document.getElementById('hvt-fab-vd').addEventListener('click', () => {
            openVoiceDesign();
        });

        document.getElementById('hvt-fab-bp').addEventListener('click', bpOpenPanel);

        const engBtn = document.getElementById('hvt-fab-eng');
        engBtn.classList.toggle('hvt-fab-off', !forceIIIEnabled());
        engBtn.addEventListener('click', async () => {
            localStorage.setItem(FORCE_III_KEY, '1');
            engBtn.classList.remove('hvt-fab-off');
            showToast('正在切换到 Avatar III…', 'info', 1600);
            await enforceAvatarIII(true);
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

        // Voice Design: 引擎切换 + Gemini 设置 + 风格补充
        document.querySelectorAll('.hvt-vd-engine-tab').forEach(tab => {
            tab.addEventListener('click', () => vdSetEngine(tab.dataset.engine));
        });
        vdSetEngine(localStorage.getItem(VD_ENGINE_KEY) === 'gemini' ? 'gemini' : 'heygen');

        document.getElementById('hvt-gm-settings-toggle').addEventListener('click', () => {
            const el = document.getElementById('hvt-gm-settings');
            el.style.display = el.style.display === 'none' ? '' : 'none';
            if (el.style.display !== 'none') gmRefreshModels(false); // 缓存过期则静默同步
        });
        gmLoadSettingsUI();
        document.getElementById('hvt-gm-models-refresh').addEventListener('click', () => gmRefreshModels(true));
        document.getElementById('hvt-gm-provider').addEventListener('change', () => { gmProviderUI(); gmRefreshModels(false); });
        document.getElementById('hvt-gm-save').addEventListener('click', gmSaveSettings);
        document.getElementById('hvt-gm-sys-reset').addEventListener('click', () => {
            document.getElementById('hvt-gm-sys').value = GM_DEFAULT_SYS_PROMPT;
            showToast('已恢复默认指令，点「保存设置」生效', 'info');
        });

        document.getElementById('hvt-gm-input').addEventListener('change', (e) => {
            const files = [...(e.target.files || [])];
            e.target.value = '';
            if (files.length) gmAddFiles(files);
        });
        document.getElementById('hvt-gm-analyze').addEventListener('click', gmAnalyze);
        document.getElementById('hvt-gm-create').addEventListener('click', gmCreateSelected);

        const refineOn   = document.getElementById('hvt-vd-refine-on');
        const refineText = document.getElementById('hvt-vd-refine-text');
        refineOn.checked = localStorage.getItem(VD_REFINE_ON_KEY) === '1';
        refineText.value = localStorage.getItem(VD_REFINE_TEXT_KEY) || '';
        refineText.style.display = refineOn.checked ? '' : 'none';
        refineOn.addEventListener('change', () => {
            localStorage.setItem(VD_REFINE_ON_KEY, refineOn.checked ? '1' : '0');
            refineText.style.display = refineOn.checked ? '' : 'none';
        });
        refineText.addEventListener('input', () => {
            localStorage.setItem(VD_REFINE_TEXT_KEY, refineText.value);
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
        document.getElementById('hvt-mv-audio-clear').addEventListener('click', mvAudioClearAll);
        document.getElementById('hvt-mv-space-toggle').addEventListener('click', () => {
            mvSetViewMode(mvViewMode === 'space' ? 'self' : 'space');
        });
        document.getElementById('hvt-mv-search').addEventListener('input', mvRenderList);
        document.getElementById('hvt-mv-dl-all').addEventListener('click', mvDownloadSelected);
        document.getElementById('hvt-mv-dl-sel').addEventListener('click', mvDownloadSelected);
        document.getElementById('hvt-mv-clear-sel').addEventListener('click', mvClearSelection);
        document.getElementById('hvt-mv-share-sel').addEventListener('click', () => {
            const ids = [...mvActiveSel()];
            const voices = mvActiveVoices().filter(v => ids.includes(v.voice_id || ''));
            if (!voices.length) { showToast('未找到选中的声音', 'error'); return; }
            mvOpenShareBatch(voices);
        });
        document.getElementById('hvt-mv-del-sel').addEventListener('click', () => {
            if (mvDelRunning || spaceDelRunning) { mvDelAbort = true; spaceDelAbort = true; if (mvShareWaitCancel) mvShareWaitCancel(); }
            else mvDeleteSelected();
        });
        document.getElementById('hvt-mv-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('hvt-mv-overlay')) closeMyVoices();
        });

        // Project Videos modal
        document.getElementById('hvt-pv-close').addEventListener('click', closeProjectVideos);
        document.getElementById('hvt-pv-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('hvt-pv-overlay')) closeProjectVideos();
        });
        document.getElementById('hvt-pv-scan').addEventListener('click', pvScan);
        document.getElementById('hvt-pv-stop').addEventListener('click', () => {
            pvAbort = true;
            if (mvShareWaitCancel) mvShareWaitCancel();
        });
        document.getElementById('hvt-pv-search').addEventListener('input', debounce(pvRender, 180));
        document.getElementById('hvt-pv-search').addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeProjectVideos();
        });
        document.getElementById('hvt-pv-age').addEventListener('change', () => {
            pvUpdateAgeCustomVisibility();
            pvRender();
        });
        document.getElementById('hvt-pv-age-custom').addEventListener('input', debounce(pvRender, 180));
        document.getElementById('hvt-pv-moved-only').addEventListener('change', pvRender);
        document.getElementById('hvt-pv-selall').addEventListener('change', (e) => {
            const visible = pvVisibleRows();
            if (e.currentTarget.checked) visible.forEach(r => pvSelected.add(pvLedgerKey(r.spaceId, r.id)));
            else visible.forEach(r => pvSelected.delete(pvLedgerKey(r.spaceId, r.id)));
            pvRender();
        });
        document.getElementById('hvt-pv-trash').addEventListener('click', pvTrashSelected);

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
    // ─── 强制 Avatar III 引擎（Avatar IV / Avatar V → Avatar III）─────────────
    // 在 Avatar Shots (/avatar/) 与 AI Studio (/create-v4/) 页面，当"动作引擎"
    // 为 Avatar IV 或 Avatar V 时自动切回 Avatar III。引擎按钮结构（真实 DOM 确认）：
    // <button> 可见文本仅为 "Avatar <罗马数字>"（AI Studio 因 img[alt]+文本会
    // 重复成 "Avatar III Avatar III"），尾部带 chevron。点击后弹出下拉，III 选项
    // 文本含 "Avatar III"。下拉结构运行时自适应：广选择器 + 文本匹配定位选项。
    const FORCE_III_KEY   = 'hvt_force_avatar_iii';   // '1' 开启(默认) / '0' 关闭
    const ENGINE_EXACT_RE = /^(?:Avatar\s+(?:II|III|IV|V)\s*)+$/i; // 纯引擎名（排除"最近创作"等长文本）
    const AVATAR_IV_RE    = /\bAvatar\s+IV\b/i;
    const AVATAR_V_RE     = /\bAvatar\s+V\b/i;   // "Avatar IV" 不会误命中（IV 内 V 前无词边界）
    const AVATAR_III_RE   = /\bAvatar\s+III\b/i;

    let engineSwitching   = false;  // 再入保护：切换期间暂停 observer 触发
    let engineDebounce    = null;
    let engineAttempts    = 0;      // 连续失败计数（防死循环）
    let engineCooldownUntil = 0;    // 失败后的退避截止时间

    const forceIIIEnabled = () => localStorage.getItem(FORCE_III_KEY) !== '0';
    // 不再靠 URL 判断"是否引擎页";真正的信号是 findDowngradeButton()——
    // 找得到 Avatar IV/V 引擎按钮才有活可干,找不到就跳过。路由改了也不影响。

    // 引擎选择器是 Radix DropdownMenu：触发器在 pointerdown 打开，菜单项也按指针事件选中。
    // 真实页面验证：单纯 el.click() 不会打开菜单，必须补 pointerdown/pointerup。
    function pointerClick(el) {
        const fire = (type) => el.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerType: 'mouse', button: 0,
            buttons: type === 'pointerdown' ? 1 : 0,
        }));
        fire('pointerdown'); fire('pointerup'); el.click();
    }

    // 定位需要降级的引擎按钮：当前为 Avatar IV 或 Avatar V（AI Studio 多场景时逐个处理）
    function findDowngradeButton() {
        return [...document.querySelectorAll('button')].find(b => {
            if (isHvtUI(b)) return false;
            const t = (b.textContent || '').trim().replace(/\s+/g, ' ');
            return ENGINE_EXACT_RE.test(t) && (AVATAR_IV_RE.test(t) || AVATAR_V_RE.test(t));
        });
    }

    function findEnginePopup() {
        const sel = '[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],[role="dialog"][data-state="open"],[data-radix-menu-content],body > div';
        const candidates = [...document.querySelectorAll(sel)]
            .filter(el => !isHvtUI(el) && el.offsetParent !== null)
            .map(el => ({ el, text: (el.textContent || '').replace(/\s+/g, ' ').trim() }))
            .filter(x => AVATAR_III_RE.test(x.text) && (AVATAR_IV_RE.test(x.text) || AVATAR_V_RE.test(x.text)))
            .sort((a, b) => a.text.length - b.text.length);
        return candidates[0]?.el || null;
    }

    // 点击引擎按钮后，等待含 Avatar III/IV/V 文本的下拉弹层出现
    function waitForEnginePopup(timeout = 3500) {
        return new Promise(resolve => {
            const t0 = Date.now();
            (function poll() {
                const p = findEnginePopup();
                if (p) return resolve(p);
                if (Date.now() - t0 > timeout) return resolve(null);
                setTimeout(poll, 100);
            })();
        });
    }

    function findAvatarIIIOption(popup) {
        const clickableOption = (el) => {
            const clickable = el.closest('[role="menuitem"],[role="option"],[role="menuitemradio"],[data-radix-collection-item],button,li,[tabindex]');
            return clickable && popup.contains(clickable) ? clickable : el;
        };
        const candidates = [popup, ...popup.querySelectorAll('[role="menuitem"],[role="option"],[role="menuitemradio"],[data-radix-collection-item],button,li,a,div,span')]
            .filter(el => !isHvtUI(el) && el.offsetParent !== null)
            .map(el => ({ el, text: (el.textContent || '').replace(/\s+/g, ' ').trim() }))
            .filter(x => AVATAR_III_RE.test(x.text) && !AVATAR_IV_RE.test(x.text) && !AVATAR_V_RE.test(x.text))
            .sort((a, b) => a.text.length - b.text.length);
        return candidates[0] ? clickableOption(candidates[0].el) : null;
    }

    function engineBridgeForceIII() {
        return new Promise(resolve => {
            const handler = (e) => {
                document.removeEventListener('hvt-engine-result', handler);
                clearTimeout(timer);
                resolve(e.detail || { success: false });
            };
            const timer = setTimeout(() => {
                document.removeEventListener('hvt-engine-result', handler);
                resolve({ success: false, error: 'timeout' });
            }, 4000);
            document.addEventListener('hvt-engine-result', handler);
            document.dispatchEvent(new CustomEvent('hvt-engine-force-iii'));
        });
    }

    async function enforceAvatarIII(manual = false) {
        if (!forceIIIEnabled() || engineSwitching) return false;
        const btn = findDowngradeButton();
        if (!btn) {
            engineAttempts = 0;                                // 无需处理时重置失败计数
            if (manual) showToast('当前已是 Avatar III，或未找到可切换的引擎按钮', 'info', 2200);
            return false;
        }
        if (!manual && (Date.now() < engineCooldownUntil || engineAttempts >= 5)) return false;
        if (manual) { engineAttempts = 0; engineCooldownUntil = 0; }

        engineSwitching = true;
        try {
            const bridgeResult = await engineBridgeForceIII();
            if (bridgeResult.success || !findDowngradeButton()) {
                engineAttempts = 0;
                console.log('[hvt] 动作引擎已通过 MAIN world 切回 Avatar III');
                showToast('已自动将引擎切回 Avatar III', 'success', 2000);
                return true;
            }

            let popup = findEnginePopup();
            if (!popup) {
                pointerClick(btn);                             // Radix 菜单需 pointerdown 才会打开
                popup = await waitForEnginePopup();
            }
            if (!popup) {
                engineAttempts++; engineCooldownUntil = Date.now() + 3000;
                console.warn('[hvt] 引擎下拉未出现，跳过（第 ' + engineAttempts + ' 次）');
                if (manual) showToast('未能打开 Avatar 引擎下拉，请再试一次', 'error', 2500);
                return false;
            }
            const opt = findAvatarIIIOption(popup);
            if (!opt) {
                engineAttempts++; engineCooldownUntil = Date.now() + 3000;
                console.warn('[hvt] 下拉中未找到 Avatar III 选项（第 ' + engineAttempts + ' 次）');
                document.body.click();                          // 关闭下拉，避免卡住
                if (manual) showToast('下拉中未找到 Avatar III 选项', 'error', 2500);
                return false;
            }
            pointerClick(opt);
            await new Promise(r => setTimeout(r, 500));
            if (findDowngradeButton()) {                        // 校验：仍为 IV/V → 记失败并退避
                engineAttempts++; engineCooldownUntil = Date.now() + 3000;
                console.warn('[hvt] 点击后仍为 Avatar IV/V（第 ' + engineAttempts + ' 次），可能存在确认步骤');
                if (manual) showToast('点击后仍未切到 Avatar III，请检查是否有确认步骤', 'error', 2800);
                return false;
            } else {
                engineAttempts = 0;
                console.log('[hvt] 动作引擎已从 Avatar IV/V 自动切回 Avatar III');
                showToast('已自动将引擎切回 Avatar III', 'success', 2000);
                return true;
            }
        } finally {
            setTimeout(() => { engineSwitching = false; }, 300);
        }
    }

    function initEngineForce() {
        const tick = () => {
            clearTimeout(engineDebounce);
            engineDebounce = setTimeout(enforceAvatarIII, 300);
        };
        const obs = new MutationObserver(() => {
            if (engineSwitching) return;
            tick();
        });
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        tick();  // 初次：覆盖"页面加载即为 Avatar IV"的情况
    }

    function init() {
        loadDb();
        buildUI();
        initUpdateCheck();                 // 检查 GitHub 是否有新版本并提示升级
        spaceInit();                       // 加载社区声音缓存并后台慢速刷新
        scheduleStartupVoiceScan();        // 当前账号首次加载：静默扫描个人 + 全部 Space 声音
        initEngineForce();                 // Avatar IV 自动切回 Avatar III
        bpInit();                          // 批量流水线：恢复队列并按需续跑
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
