# CLAUDE.md — 人声筛选工具（HeyGen Chrome 扩展）

Manifest V3 内容脚本扩展，仅在 `app.heygen.com` 生效。**无构建步骤**——直接改源码，`chrome://extensions` 重载即生效。所有 API 调用复用页面 Session Cookie（`credentials: include`）。本地数据存 `localStorage`（主库 key `hvt_data_v1`）。

## 文件地图

| 文件 | 职责 |
|------|------|
| `manifest.json` | MV3 清单；**发版时在此改版本号** |
| `content.js` | 主体（~4900 行单 IIFE），所有面板 UI 与业务逻辑 |
| `background.js` | Service Worker：`chrome.downloads` 下载代理 + GitHub Releases 更新检查（6h alarm） |
| `ais-bridge.js` | MAIN world 脚本：读 React Fiber 调用页面 `onSelect`，经 document CustomEvent 与 content.js 通信 |
| `proc11ShareVoice.js` | Share Voice 弹框增强（批量添加/删除邮箱） |
| `content.css` | 全部样式 |
| `README.md` | 功能说明 + 版本记录（发版时更新） |

## content.js 模块索引（按函数名前缀 grep 定位，不要通读全文）

| 前缀 | 功能域 |
|------|--------|
| 无前缀：`loadDb`/`saveDb`/`heygenApi`/`fetchAllVoices`/`getFilteredVoices`/`populateFilters`/`renderTable`/`buildUI`/`bindEvents` | 公共声音库筛选主面板、本地库、通用 API 封装、UI 骨架与事件绑定 |
| `vd*` | Voice Design：提示词生成声音（含照片上传、引擎切换） |
| `gm*` | Gemini：头像图片分析生成声音提示词 |
| `mv*` | 我的声音：列表/试听/下载/批量删除/分享 |
| `space*` | 社区(Space)声音：需 `x-space-id`，与 `mvVoices` 分开缓存 |
| `exp*` | 分享到期清理：localStorage 台账 `hvt_share_ledger_v1`、白名单、自动清理 |
| `pv*` | 找我的视频：项目/文件夹扫描、按创建者过滤、下载、移回收站 |
| `ais*` | AI Studio / Avatar Shots 快速换声音（配合 ais-bridge.js） |
| `initUpdateCheck`/`renderUpdateBanner` | 更新提示横幅 |

## 修改后验证（最低要求）

1. `node --check` 改动过的每个 js 文件
2. 用 playwright MCP 打开 `app.heygen.com`，实际走一遍受影响的面板流程；页面定位经验先查项目 memory 的 `MEMORY.md` 索引
3. UI 定位必须**语言无关**（图标 sprite id / `role` / 主按钮样式），禁止英文文案全等匹配（memory: ais-switch-language-independent）
4. 删除/撤销类操作必须按精确 id 定位目标，禁止虚拟列表坐标定位（memory: playwright-destructive-op-targeting）

## 发版

改 `manifest.json` 版本号 + README 版本记录；zip 命名 `人声筛选工具-vX.Y.Z.zip`（zip 不入库）。
