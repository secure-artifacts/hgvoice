// Runs in MAIN world — can access __reactFiber expando properties set by React.
// Communicates with the content script (isolated world) via document CustomEvents.
(function () {
    'use strict';
    const voiceMap = new Map();   // voice_id → {voice, onSelect}  (from current modal page)
    let capturedOnSelect = null;  // onSelect from any visible voice — same fn for all rows

    const cleanText = (el) => (el && el.textContent || '').trim().replace(/\s+/g, ' ');
    const isEngineText = (text) => /^Avatar\s+(?:III|IV|V)(?:\s+Avatar\s+(?:III|IV|V))*$/i.test(text);
    const isDowngradeEngine = (text) => isEngineText(text) && /\bAvatar\s+(?:IV|V)\b/i.test(text);
    const isAvatarIIIItem = (text) => /\bAvatar\s+III\b/i.test(text) && !/\bAvatar\s+(?:IV|V)\b/i.test(text);

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

    function nativeActivate(el) {
        const fire = (type, Ctor = MouseEvent) => el.dispatchEvent(new Ctor(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: type === 'pointerdown' || type === 'mousedown' ? 1 : 0,
            pointerType: 'mouse',
            view: window,
        }));
        try { el.focus && el.focus(); } catch {}
        fire('pointermove', PointerEvent);
        fire('mousemove', MouseEvent);
        fire('pointerdown', PointerEvent);
        fire('mousedown', MouseEvent);
        fire('pointerup', PointerEvent);
        fire('mouseup', MouseEvent);
        fire('click', MouseEvent);
        try { el.click && el.click(); } catch {}
    }

    function findEngineButton() {
        return [...document.querySelectorAll('button')]
            .find(b => !b.closest('#hvt-root') && !b.closest('#hvt-fab-strip') && isDowngradeEngine(cleanText(b))) || null;
    }

    function findAvatarIIIItem() {
        const item = [...document.querySelectorAll('[role="menuitem"],[role="option"],[role="menuitemradio"],[data-radix-collection-item],button,li,a,div,span')]
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

    document.addEventListener('hvt-engine-force-iii', () => {
        const before = engineCurrentText();
        try {
            let item = findAvatarIIIItem();
            if (!item) {
                const btn = findEngineButton();
                if (btn) {
                    try { callReactHandlers(btn); } catch {}
                    nativeActivate(btn);
                }
                item = findAvatarIIIItem();
            }

            if (!item) {
                document.dispatchEvent(new CustomEvent('hvt-engine-result', {
                    detail: { success: false, before, after: engineCurrentText(), error: 'no-avatar-iii-item' }
                }));
                return;
            }

            const tried = callReactHandlers(item);
            nativeActivate(item);
            setTimeout(() => {
                const after = engineCurrentText();
                document.dispatchEvent(new CustomEvent('hvt-engine-result', {
                    detail: { success: /\bAvatar\s+III\b/i.test(after), before, after, tried }
                }));
            }, 500);
        } catch (err) {
            document.dispatchEvent(new CustomEvent('hvt-engine-result', {
                detail: { success: false, before, after: engineCurrentText(), error: String(err) }
            }));
        }
    });
})();
