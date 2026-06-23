// Runs in MAIN world — can access __reactFiber expando properties set by React.
// Communicates with the content script (isolated world) via document CustomEvents.
(function () {
    'use strict';
    const voiceMap = new Map();   // voice_id → {voice, onSelect}  (from current modal page)
    let capturedOnSelect = null;  // onSelect from any visible voice — same fn for all rows

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

    // detail: { id, voiceObj }
    // voiceObj — full voice object from content script's API cache (mvVoices / db.voices)
    document.addEventListener('hvt-ais-switch', (e) => {
        const { id: targetId, voiceObj } = e.detail || {};
        scan();

        // Case 1: voice is visible in the current modal tab — use its own fiber data (safest)
        const item = voiceMap.get(targetId);
        if (item) {
            item.onSelect(item.voice);
            document.dispatchEvent(new CustomEvent('hvt-ais-result', {
                detail: { success: true, name: item.voice.display_name || targetId }
            }));
            return;
        }

        // Case 2: voice not visible (paginated / different tab) — use captured onSelect + cached obj
        if (capturedOnSelect && voiceObj && voiceObj.voice_id) {
            try {
                capturedOnSelect(voiceObj);
                document.dispatchEvent(new CustomEvent('hvt-ais-result', {
                    detail: { success: true, name: voiceObj.display_name || targetId }
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
})();
