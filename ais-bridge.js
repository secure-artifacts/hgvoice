// Runs in MAIN world — can access __reactFiber expando properties set by React.
// Communicates with the content script (isolated world) via document CustomEvents.
(function () {
    'use strict';
    const voiceMap = new Map();   // voice_id → {voice, onSelect}  (from current modal page)
    let capturedOnSelect = null;  // onSelect from any visible voice — same fn for all rows

    const cleanText = (el) => (el && el.textContent || '').trim().replace(/\s+/g, ' ');
    const isEngineText = (text) => /^Avatar\s+(?:III|IV|V)(?:\s+Avatar\s+(?:III|IV|V))*$/i.test(text);
    // 菜单项文本会把名称和英文描述无空格拼接（如 "Avatar IIILip syncs…"），尾部禁用 \b 词边界
    const isAvatarIIIItem = (text) => /\bAvatar\s+III/i.test(text) && !/\bAvatar\s+(?:IV|V)/i.test(text);

    function reactPropSources(el) {
        const out = [];
        for (const key of Object.keys(el)) {
            if (key.startsWith('__reactProps') && el[key]) out.push(el[key]);
            if (key.startsWith('__reactFiber') && el[key]) {
                let f = el[key];
                for (let i = 0; i < 20 && f; i++, f = f.return) {
                    if (f.memoizedProps) out.push(f.memoizedProps);
                }
            }
        }
        return out;
    }

    function mockReactEvent(el, type) {
        let defaultPrevented = false;
        let propagationStopped = false;
        return {
            type,
            target: el,
            currentTarget: el,
            button: 0,
            buttons: type === 'pointerdown' || type === 'mousedown' ? 1 : 0,
            pointerType: 'mouse',
            detail: 1,
            bubbles: true,
            cancelable: true,
            nativeEvent: { type, target: el, currentTarget: el, button: 0, pointerType: 'mouse', isTrusted: true },
            preventDefault() { defaultPrevented = true; },
            stopPropagation() { propagationStopped = true; },
            isDefaultPrevented() { return defaultPrevented; },
            isPropagationStopped() { return propagationStopped; },
            persist() {},
        };
    }

    function callReactHandlers(el) {
        const tried = [];
        const sources = reactPropSources(el);
        const orderedNames = [
            'onPointerDown', 'onMouseDown', 'onPointerUp', 'onMouseUp',
            'onClick', 'onSelect'
        ];
        for (const name of orderedNames) {
            for (const props of sources) {
                if (typeof props[name] !== 'function') continue;
                tried.push(name);
                try {
                    props[name](mockReactEvent(el, name.replace(/^on/, '').toLowerCase()));
                } catch (err) {
                    tried.push(name + ':error');
                }
            }
        }
        return tried;
    }

    // 派发一套会冒泡的原生指针+click 序列。React 用事件委托（在 document 根监听），
    // 故冒泡的原生 click 能触发组件 onClick——无需在元素上找到 React prop。
    // 用于 Avatar Shots 等菜单项不是 role=menuitem、也没有可枚举 React handler 的场景。
    // 仅用于“菜单项”（非 toggle 触发器），多次点击也只是选中+关闭，安全。
    function nativeActivate(el) {
        const fire = (type, Ctor = MouseEvent) => el.dispatchEvent(new Ctor(type, {
            bubbles: true, cancelable: true, composed: true, button: 0,
            buttons: type === 'pointerdown' || type === 'mousedown' ? 1 : 0,
            pointerType: 'mouse', view: window,
        }));
        try { el.focus && el.focus(); } catch {}
        fire('pointerover', PointerEvent); fire('pointerenter', PointerEvent);
        fire('pointermove', PointerEvent); fire('mousemove', MouseEvent);
        fire('pointerdown', PointerEvent); fire('mousedown', MouseEvent);
        fire('pointerup', PointerEvent); fire('mouseup', MouseEvent);
        fire('click', MouseEvent);
        try { el.click && el.click(); } catch {}
    }

    function findAvatarIIIItem() {
        const item = [...document.querySelectorAll('[role="menuitem"],[role="option"],[role="menuitemradio"],[data-radix-collection-item]')]
            .map(el => ({ el, text: cleanText(el) }))
            .filter(x => isAvatarIIIItem(x.text))
            .sort((a, b) => a.text.length - b.text.length)[0]?.el || null;
        if (!item) return null;
        const clickable = item.closest('[role="menuitem"],[role="option"],[role="menuitemradio"],[data-radix-collection-item],button,li,[tabindex]');
        return clickable || item;
    }

    function engineCurrentText() {
        const btn = [...document.querySelectorAll('button')]
            .find(b => !b.closest('#hvt-root') && !b.closest('#hvt-fab-strip') && isEngineText(cleanText(b)));
        return btn ? cleanText(btn) : '';
    }

    function scan() {
        voiceMap.clear();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
            const k = Object.keys(node).find(k => k.startsWith('__reactFiber'));
            if (!k) continue;
            let f = node[k];
            for (let i = 0; i < 20 && f; i++, f = f.return) {
                const p = f.memoizedProps;
                if (p && p.voice && p.voice.voice_id && p.onSelect && !voiceMap.has(p.voice.voice_id)) {
                    voiceMap.set(p.voice.voice_id, { voice: p.voice, onSelect: p.onSelect });
                    // Capture onSelect from first visible voice — reusable for any voice object
                    if (!capturedOnSelect) capturedOnSelect = p.onSelect;
                    break;
                }
            }
        }
    }

    // detail: { id, voiceObj, visibleOnly }
    // voiceObj — full voice object from content script's API cache (mvVoices / db.voices)
    // visibleOnly — require a real row from the open modal; used by Avatar Shots
    // where cached objects can be accepted without actually changing the voice.
    document.addEventListener('hvt-ais-switch', (e) => {
        const { id: targetId, voiceObj, visibleOnly } = e.detail || {};
        scan();

        // Case 1: voice is visible in the current modal tab — use its own fiber data (safest)
        const item = voiceMap.get(targetId);
        if (item) {
            item.onSelect(item.voice);
            document.dispatchEvent(new CustomEvent('hvt-ais-result', {
                detail: { success: true, source: 'visible', name: item.voice.display_name || targetId }
            }));
            return;
        }

        if (visibleOnly) {
            document.dispatchEvent(new CustomEvent('hvt-ais-result', {
                detail: { success: false, source: 'visible' }
            }));
            return;
        }

        // Case 2: voice not visible (paginated / different tab) — use captured onSelect + cached obj
        if (capturedOnSelect && voiceObj && voiceObj.voice_id) {
            try {
                capturedOnSelect(voiceObj);
                document.dispatchEvent(new CustomEvent('hvt-ais-result', {
                    detail: { success: true, source: 'cached', name: voiceObj.display_name || targetId }
                }));
            } catch (err) {
                document.dispatchEvent(new CustomEvent('hvt-ais-result', {
                    detail: { success: false, error: String(err) }
                }));
            }
            return;
        }

        // Case 3: no onSelect captured yet (modal empty or not open)
        document.dispatchEvent(new CustomEvent('hvt-ais-result', {
            detail: { success: false }
        }));
    });

    // 打开引擎下拉由 content.js 负责（合成 pointerClick 打开 Radix 触发器可靠）；
    // 这里只在“已打开的菜单”里选中 Avatar III 项。合成 PointerEvent 对 Radix 菜单项
    // 不触发选中，必须调用其 React onClick，故走 MAIN world。
    document.addEventListener('hvt-engine-select-iii', () => {
        const before = engineCurrentText();
        try {
            // 优先激活 content.js 已定位并打标记的确切菜单项（跨页面选择器差异都能覆盖）；
            // 无标记时才退回自身的 role 限定查找。
            let item = document.querySelector('[data-hvt-eng-iii]');
            if (item) {
                item = item.closest('[role="menuitem"],[role="option"],[role="menuitemradio"],[data-radix-collection-item],button,li,[tabindex]') || item;
            } else {
                item = findAvatarIIIItem();
            }
            if (!item) {
                document.dispatchEvent(new CustomEvent('hvt-engine-result', {
                    detail: { success: false, before, after: engineCurrentText(), error: 'no-avatar-iii-item' }
                }));
                return;
            }

            // 诊断：回传标记元素及祖先链结构，定位真正可点的行与处理器
            const short = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().slice(0, 45);
            const chain = [];
            for (let cur = item, d = 0; cur && d < 12 && !(cur.getAttribute && cur.getAttribute('role') === 'menu'); cur = cur.parentElement, d++) {
                const fkey = Object.keys(cur).find(k => k.startsWith('__reactFiber'));
                let handlers = [];
                if (fkey) { let f = cur[fkey], dd = 0; for (; f && dd < 3; f = f.return, dd++) { const p = f.memoizedProps; if (p) handlers = handlers.concat(Object.keys(p).filter(k => /^on[A-Z]/.test(k) && typeof p[k] === 'function')); } }
                chain.push({ d, tag: cur.tagName, role: cur.getAttribute && cur.getAttribute('role'), cls: short(cur.className), cursor: getComputedStyle(cur).cursor, fiber: !!fkey, on: [...new Set(handlers)] });
            }
            const menuOpen = !!document.querySelector('[role="menu"]');

            const tried = callReactHandlers(item);        // Radix 项：直接调 React prop
            nativeActivate(item);                         // 普通项：原生冒泡经 React 委托触发
            setTimeout(() => {
                const after = engineCurrentText();
                document.dispatchEvent(new CustomEvent('hvt-engine-result', {
                    detail: { success: /\bAvatar\s+III/i.test(after), before, after, tried, nativeAlso: true, menuOpen, chain }
                }));
            }, 500);
        } catch (err) {
            document.dispatchEvent(new CustomEvent('hvt-engine-result', {
                detail: { success: false, before, after: engineCurrentText(), error: String(err) }
            }));
        }
    });
})();
