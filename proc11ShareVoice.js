// proc11ShareVoice.js — Share Voice 弹框增强：批量添加邮箱 + 批量删除
const proc11ShareVoice = (() => {

    let _currentDialog = null;
    let _listObserver  = null;

    // ── 工具 ──────────────────────────────────────────────────────────────────

    function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // 2~5 秒随机延迟，避免操作太快被服务器拒绝
    function _randomDelay() { return _sleep(2000 + Math.random() * 3000); }

    // 从任意文本中提取所有合法邮箱地址（忽略多余内容、空格、密码等）
    function _extractEmails(text) {
        const matches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
        return [...new Set(matches)]; // 去重
    }

    // 绕过 React 的受控 input 写入值
    function _setReactInput(input, value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ── Dialog 内元素定位 ─────────────────────────────────────────────────────

    function _getInput(dialog) {
        return dialog.querySelector('input[placeholder="Enter email address or select a subspace"]');
    }

    function _getAddBtn(dialog) {
        return Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.trim() === 'Add');
    }

    // 删除按钮（垃圾桶图标按钮）列表
    function _getDeleteBtns(dialog) {
        return Array.from(dialog.querySelectorAll('button')).filter(b =>
            b.className.includes('tw-text-gray-500') && b.className.includes('hover:tw-text-red-500')
        );
    }

    // 邮箱列表父容器（所有 row 的直接父节点）
    function _getListContainer(dialog) {
        const deleteBtns = _getDeleteBtns(dialog);
        if (!deleteBtns.length) return null;
        return deleteBtns[0].parentElement.parentElement; // delBtn → row → listContainer
    }

    // ── 注入逻辑 ──────────────────────────────────────────────────────────────

    // 向每个还没有复选框的邮箱行注入复选框
    function _injectCheckboxes(dialog) {
        _getDeleteBtns(dialog).forEach(btn => {
            const row = btn.parentElement;
            if (!row.querySelector('.hg11-cb')) {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'hg11-cb';
                cb.style.cssText = 'width:14px;height:14px;cursor:pointer;flex-shrink:0;margin-right:4px;accent-color:#1a1a2e;';
                row.insertBefore(cb, row.firstChild);
            }
        });
    }

    // 批量添加面板（注入在"输入框+Add按钮"那行的上方）
    function _injectBatchAddPanel(dialog) {
        if (dialog.querySelector('#hg11-batch-add')) return;

        const addBtn = _getAddBtn(dialog);
        if (!addBtn) return;

        const inputRow = addBtn.parentElement;
        const panel = document.createElement('div');
        panel.id = 'hg11-batch-add';
        panel.style.cssText = 'margin-bottom:8px;';
        panel.innerHTML = `
          <textarea id="hg11-emails-ta"
            placeholder="批量添加：每行一个邮箱（或用逗号 / 空格分隔）"
            style="width:100%;height:72px;border:1px solid #d9d9d9;border-radius:6px;
                   padding:6px 8px;font-size:12px;resize:none;box-sizing:border-box;
                   font-family:inherit;outline:none;"></textarea>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <button id="hg11-batch-add-btn"
              style="background:#1a1a2e;color:#fff;border:none;border-radius:100px;
                     padding:4px 14px;font-size:12px;cursor:pointer;white-space:nowrap;">
              批量添加
            </button>
            <span id="hg11-add-status" style="font-size:11px;color:#666;"></span>
          </div>
        `;
        inputRow.parentElement.insertBefore(panel, inputRow);

        document.getElementById('hg11-batch-add-btn').addEventListener('click', async () => {
            const ta     = document.getElementById('hg11-emails-ta');
            const status = document.getElementById('hg11-add-status');
            const btn    = document.getElementById('hg11-batch-add-btn');

            const emails = _extractEmails(ta.value);

            if (!emails.length) {
                status.textContent = '⚠️ 未检测到有效邮箱';
                return;
            }

            btn.disabled = true;
            let added = 0;

            for (let i = 0; i < emails.length; i++) {
                const inp  = _getInput(dialog);
                const addB = _getAddBtn(dialog);
                if (!inp || !addB) break;

                status.textContent = `添加中 ${i + 1}/${emails.length}…`;
                _setReactInput(inp, emails[i]);
                await _sleep(300);
                addB.click();
                await _randomDelay(); // 2~5 秒随机，避免过快失效
                added++;
            }

            status.textContent = `✅ 已添加 ${added} 个`;
            btn.disabled = false;
            ta.value = '';
        });
    }

    // 批量删除控制栏（注入在邮箱列表上方；无已分享邮箱时跳过）
    function _injectBatchDeleteBar(dialog) {
        if (dialog.querySelector('#hg11-del-bar')) return;

        const listContainer = _getListContainer(dialog);
        if (!listContainer) return; // 还没有分享过邮箱，列表为空

        const bar = document.createElement('div');
        bar.id = 'hg11-del-bar';
        bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 0 6px;'
            + 'border-bottom:1px solid #f0f0f0;margin-bottom:4px;';
        bar.innerHTML = `
          <input type="checkbox" id="hg11-sel-all"
            style="width:14px;height:14px;cursor:pointer;accent-color:#1a1a2e;">
          <label for="hg11-sel-all"
            style="font-size:12px;color:#888;cursor:pointer;user-select:none;">全选</label>
          <button id="hg11-del-sel-btn"
            style="margin-left:auto;background:#ff4d4f;color:#fff;border:none;border-radius:100px;
                   padding:3px 12px;font-size:12px;cursor:pointer;white-space:nowrap;">
            删除选中
          </button>
          <span id="hg11-del-status" style="font-size:11px;color:#666;"></span>
        `;
        listContainer.parentElement.insertBefore(bar, listContainer);

        document.getElementById('hg11-sel-all').addEventListener('change', e => {
            dialog.querySelectorAll('.hg11-cb').forEach(cb => { cb.checked = e.target.checked; });
        });

        document.getElementById('hg11-del-sel-btn').addEventListener('click', async () => {
            const checked = Array.from(dialog.querySelectorAll('.hg11-cb:checked'));
            if (!checked.length) return;

            const btn    = document.getElementById('hg11-del-sel-btn');
            const status = document.getElementById('hg11-del-status');
            btn.disabled = true;

            let deleted = 0;
            for (let i = 0; i < checked.length; i++) {
                status.textContent = `删除中 ${i + 1}/${checked.length}…`;
                const row    = checked[i].parentElement;
                const delBtn = row.querySelector('button.tw-cursor-pointer');
                if (delBtn) {
                    delBtn.click();
                    await _randomDelay(); // 2~5 秒随机，避免过快失效
                    deleted++;
                }
            }

            const selAll = document.getElementById('hg11-sel-all');
            if (selAll) selAll.checked = false;
            status.textContent = `✅ 已删除 ${deleted} 个`;
            btn.disabled = false;
        });
    }

    // 完整注入入口
    function _enhance(dialog) {
        _injectBatchAddPanel(dialog);
        _injectBatchDeleteBar(dialog);
        _injectCheckboxes(dialog);

        // 监听列表变化（添加 / 删除后 React 更新行）→ 补注复选框
        if (!_listObserver) {
            const listContainer = _getListContainer(dialog);
            if (listContainer) {
                _listObserver = new MutationObserver(() => _injectCheckboxes(dialog));
                _listObserver.observe(listContainer, { childList: true });
            }
        }
    }

    // 找 Share Voice 弹框（页面可能有多个 role=dialog，需用文字定位）
    function _findShareDialog() {
        return [...document.querySelectorAll('[role="dialog"]')]
            .find(d => d.textContent.includes('Share Voice with team members'));
    }

    // ── 初始化：监听 Share Voice 弹框出现 ────────────────────────────────────

    function init() {
        const observer = new MutationObserver(() => {
            const dialog = _findShareDialog();

            if (!dialog) {
                _currentDialog = null;
                if (_listObserver) { _listObserver.disconnect(); _listObserver = null; }
                return;
            }

            // 仅处理 Share Voice 弹框（用输入框 placeholder 判断，语言无关）
            if (!_getInput(dialog)) return;

            if (_currentDialog === dialog) {
                // 已增强过，但列表可能刚从空变为非空（如批量添加后）：
                // _enhance 幂等，补注删除栏 / 复选框 / 列表 observer
                _enhance(dialog);
                return;
            }
            _currentDialog = dialog;

            // 稍等 React 完成渲染再注入
            setTimeout(() => _enhance(dialog), 350);
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    return { init };
})();
