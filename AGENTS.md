# PDF 阅读器（pdf-reader）——LinkDesk 插件仓

> **本文件是给在这个仓里干活的 AI 看的**（Claude Code / Codex / Cursor / …）。人看 `README.md`。
> 插件身份的唯一来源 = `plugin.json` 顶层的 `pluginId`（本仓：`pdf-reader`）。当前版本 `0.1.0`。

## 1. 这是什么

PDF 阅读器——官方示例级的阅读器插件，认领 `.pdf`（声明式文件关联）。双击就在主区标签页里**真渲染**（pdf.js 逐页画到 canvas，不是缩略图预览）；左缘 180px 侧栏一夹两个面 ＝ 缩略图 ＋ 目录树；划选复制、页内与整篇搜索。**卸掉它，`.pdf` 立刻交还系统默认程序**——关联是声明式的，软件里不留痕迹。

**用户在哪看到它**：主区标签页（`appearsIn.tabBar`）；入口 = 文件树 / 资源管理器双击 `.pdf`，或命令面板。⚠️ 那个 180px 侧栏在**阅读器面内部**，不是壳的侧栏——`contributes` 里**没有 `viewsContainers`**。

**🔴 本仓就是这只插件的真源。** 插件源码后来从壳仓整体外移，现在**壳仓没有它的源码**了——
改这只插件，只能在这个仓里改；壳仓那边只有它**已发布的产物**（`bundled-plugins/` 里的 zip 或官方目录的条目）。

> 这只插件**不随软件出厂**（`seed: false`）：用户从插件市场装上它。发版照常走下面的两步。

## 2. 铁律（破了就坏插件，或者坏壳）

1. **颜色一律走 `var(--xxx)`** —— 禁止硬编码 hex，否则切主题时你的 UI 不跟。
2. **UI 文案一律走 `t()`**（key = 原文；英文译文放 `i18n/en.json`）—— 禁止硬编码显示字符串。
3. **系统能力只走 `window.linkdesk.*`** —— 不要 `import` 壳内部（`@src/core/...`）；SDK 的 lint 会判这条。
4. **插件身份只来自 `plugin.json` 的声明** —— 不要让任何人从目录名 / 文件位置去推断它是什么。
5. **右键菜单声明式**（`contributes.menus` ＋ `<ContextMenu>`）；**弹窗 portal 到 `document.body`**；**持久化走 `window.linkdesk.configuration`**（不要 `localStorage`）。
6. **keep-alive：每个标签页始终挂载** —— 不要用 `isActive` 把内容整块 blank 掉；它只用来 gate「聚焦才跑」的副作用。

## 3. 本仓的结构与关键路径

`src/index.tsx` 是入口；阅读面在 `src/views/readerSurface/`，左缘侧栏（缩略图 ＋ 目录树）在 `src/views/outlineSidebar/`，工具栏在 `src/views/readerToolbar/`；
引擎面在 `src/services/pdfDoc/`（pdf.js 引导与打开、书签目标 → 页码、目录树）与 `src/services/textLayer/`（文本层 ＋ 命中定位与高亮）；纯换算在 `src/utils/`；命令实现与视图态在 `src/commands/`。
🔴 pdf.js 的 cmaps 与标准字体**随包带走**：`scripts/sync-pdfjs-assets.mjs` 把它们同步进 `public/`，`build` 时一并在包里（`prebuild` 钩子跑的就是它）——中日韩文档不画成方块靠的就是这一步。



- 🔴 **阅读底色有意不跟壳主题**（纸白 / 夜间两档；工具栏与状态条照旧跟主题）——PDF 的观感基准是纸。这是拍板，不是缺陷，⛔ 别顺手「修」成跟主题。
- 🔴 **12 条命令全部写在 `plugin.json` 的 `contributes.commands` 里**（翻页 / 跳页 / 缩放 / 适宽适页 / 底色 / 侧栏开合 / 搜索 / 读状态）——命令面板与 `linkdeskctl` 读的是同一张注册表，⛔ 别在代码里另起一套。
- 🔴 **回执纪律**：到边界如实回 `noop`、参数不合法回 `ok:false` ＋ `reason`——⛔ 不把「没动」说成「动了」。`pdf-reader.getStatus` 就是给 AI 读数的那条命令。
- 🔴 阅读区是**自绘的虚拟化列表**，两条形状一起看：**页位整本都铺**（滚动条长度 ＝ 整本文档）、**位图只挂窗口内 ±2**。只铺窗口那几条会让滚动范围自锁（后面十几页永远够不到）。换倍率还要守住**锚点**：不许把当前页打回第 1 页。
- 🔴 `.pdf` 关联是**声明式**的（`contributes.fileAssociations`）——系统注册表那套由壳按声明去写，⛔ 插件侧不自己碰注册表；「卸载即退回」也是靠这个形态成立的。
- 本仓同时是**官方示例级参考实现**：只用公开的 `@linkdesk/plugin-sdk` 与 npmjs 上的包，不 import 壳内部——第三方作者可以照它的造法写自己的插件。

## 4. 规矩去哪找

- **在线（作者文档，按「我想做什么」组织）**：<https://github.com/Encaron/linkdesk/tree/electron/docs/03-plugin-authoring>，从 `00-readme.md` 进。
- **离线（永远可用，不用联网）**：`node_modules/@linkdesk/plugin-sdk/schemas/plugin.schema.json` —— **字段级权威**；同目录的 `theme.schema.json` 管主题配方。
- **编辑器补全**：`plugin.json` 的 `$schema` 指向它，打字就有补全与诊断。
- **改完自查**：`npm run validate`（清单 / 格式 / 声明的文件在不在）＋ `npm run lint`（SDK 规则腿）。
- 中文版作者文档（维护者面原文）：<https://github.com/Encaron/linkdesk/tree/electron/docs/03-插件制造>

## 5. 本仓的命令

```bash
npm run dev        # 浏览器预览宿主（改码热重载）
npm run dev:real   # 真机环——写进 {userData}/plugins/<id> 并 CDP 重载（要真 IPC / 串口 / 文件时用）
npm run prebuild   # （见 package.json）
npm run build      # 产出 `<pluginId>.linkdesk-plugin`（装进 LinkDesk / 发布都用它）
npm run publish    # 发版到本仓自己的 GitHub Release（**上架两步里的第一步**）
npm run validate   # 校验 plugin.json / 主题配方 / 声明的字典文件真的在
npm run lint       # SDK 规则腿（硬编码颜色 / 字号 / 4px 网格 / 自定义 eslint 规则）——**只报告、不拦**
npm run verify     # 🔴 **交付前严格腿** = 本仓 CI 跑的那条（lint 判红 + 跨插件 import + 字典完整性 + 声明自洽）
npm run test       # 单元测试（vitest）
```

## 6. 发布与版本纪律

**🔴 上架是两步，别只做第一步**：`npm run publish` 只写**本仓自己的** GitHub Release
（只有手动加过本仓地址的人看得见）；**第二步是收录进官方目录**——只有收录之后，
默认设置的全体用户才找得到它。两步都做完，才算「上架」。

**版本号**：`plugin.json` 的 `version` 与 `package.json` 的 `version` **必须同值**；
且每次 bump 都要在 `CHANGELOG.md` 里配一段 `## v<新版本>（YYYY-MM-DD）`——
缺了这段，市场详情页的「更改日志」页签会是空的。

## 7. 本仓自带的门禁

- `.github/workflows/ci.yml` —— push / PR 时跑 `validate` → `verify` → `build` → `test`。
- `scripts/ci-verify.mjs`（`npm run verify`）—— **严格腿**：SDK lint 全腿**判红** ＋ 跨插件 import ＋
  字典完整性 ＋ 声明自洽。⚠️ SDK 自带的 `npm run lint` 是**只报告不拦**的（那是有意给作者本地留的），
  **别把 `verify` 里的这段删了换成 `npm run lint`**。
- 🔴 **壳仓的 `npm run check` 够不着本仓**（源码搬出去之后就不在它的扫描域里了）——
  本仓的绿灯只由本仓的这两条腿给出。

## 8. 测试

- **工具已预装**（`vitest` / `jsdom` / `@testing-library/react` 都在本仓 `devDependencies` 里）——写 `*.test.ts` 文件，跑 `npm run test`。
- **共享测试地基在 SDK**：`window.linkdesk` 的最小 mock 由 `@linkdesk/plugin-sdk/vitest-setup` 提供，本仓 `vitest.setup.ts` 是**一行指针**。⛔ **不要在本仓再抄一份完整 mock**——副本会漂，而没有任何门禁看着它。
- **纯逻辑单元应配测试**：`src/**/*.ts` 里既不碰 React、也不碰 `window.linkdesk` 的单元，应配 `src/__tests__/<同名>.test.ts`；视图 / hook 层**按需**（今天没有判据量它）。
- **本仓专属的桩住本仓测试文件**：共享 mock 没覆盖的能力（例如 `window.linkdesk.serial`）在自己的测试里用 `vi.fn()` 补上，⛔ 不要要求共享 mock 为某一只插件长分支。
- **声明式仓**（纯 JSON / 主题 / 语言包）**无可测单元**——它们的门禁是 `npm run verify` 的结构与声明判据；「没有测试」在那里**不是缺陷**。
- 若本仓 `vitest.setup.ts` 还是完整 mock 体（老仓形态）：换成一行指针 ＋ 跑一次 `npm install` 即可，**迁移不是强制**（好处是 mock 升级跟着 SDK 走）。
