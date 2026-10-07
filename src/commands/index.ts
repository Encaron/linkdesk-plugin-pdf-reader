/**
 * pdf-reader 命令注册——**登记表**就是下面那 11 行（id ↔ handler ↔ 标题一处摆齐，00.5 §七 的钮序）。
 *
 * ── 什么时候注册：入口顶层（=`src/index.tsx` 求值那一刻），常驻、幂等 ──
 * 21-插件命令化规范 §7 之三第 1 条点名过这个坑：**能在外层注册就别拖到视图 mount**
 * （视图没开过时外部 AI 的 `getCommands()` 里根本没有这些 id，只能先撞一次 EUNKNOWN 再猜）。
 * 本仓 handler **注册时不需要 store**（目标在调用时才寻址，见 `services/readerBridge.ts`）⇒
 * 「能在外层注册」成立，照做。池侧对「打到未注册命令」还有一条 on-command 激活链：
 * 缺命令 → `import()` 属主插件入口 → 入口顶层副作用把 handler 装上 → 重试即命中
 * （先例 = serial-monitor `services/serialCommands.ts` 头注的同一条作者契约）。
 *
 * ⚠️ 于是本仓**不调 `unregisterCommands`**：那位的口径是「视图没了、**视图态**命令就该没」，
 *    而本仓每条命令在「一份阅读器都没挂」时都能如实答 `no-document` / `hasDocument:false`
 *    （⛔ 不是空转：读数面恰是「现在开着没有」的答案）。关标签只销 store 的号，命令面留着。
 *
 * ── meta 只带显示面三项 ──
 * `title` / `category` / `when`。`description` / `params` **只写在 `plugin.json`**（家规：
 * 两处都写 = 两份文案迟早分叉；壳的池侧重注册「有值才覆盖」不会抹掉声明面那份）。
 * 🔴 id 一律**字面量**写在调用点上（`check-command-ownership` 扫的就是这些字面量——
 * 拼成变量或遍历表它就瞎了，改名时也没人在另一半拦你）。
 */
import i18n from "i18next";
import { WHEN_PDF_ACTIVE } from "../constants";
import {
  fitPage,
  fitWidth,
  getStatus,
  gotoPage,
  pageNext,
  pagePrev,
  setBackground,
  toggleSidebar,
  zoomIn,
  zoomOut,
  zoomTo,
} from "./handlers";

/** 命令面板里的分组名 = 插件名（壳按 category 归组；值走本仓字典） */
const CATEGORY_KEY = "PDF 阅读器";

/** 已注册标记——本函数幂等（入口顶层 + 视图若再调也只装一次） */
let registered = false;

/** 显示面 meta（title 走本仓字典，中文原文即 key） */
function meta(title: string): { title: string; category: string; when: string } {
  return { title: i18n.t(title), category: i18n.t(CATEGORY_KEY), when: WHEN_PDF_ACTIVE };
}

/**
 * 注册本仓全部命令（11 条，与 `plugin.json` 的 `contributes.commands[]` 逐条同形）。
 * 幂等；无壳环境（单测 / 直开页面）静默跳过——命令面是壳给的能力，没有壳不是本插件的错，⛔ 不抛。
 */
export function registerReaderCommands(): void {
  if (registered) return;
  const reg = window.linkdesk?.commands?.registerCommand;
  if (typeof reg !== "function") return;

  // 翻页族
  reg("pdf-reader.pageNext", pageNext, meta("下一页"));
  reg("pdf-reader.pagePrev", pagePrev, meta("上一页"));
  reg("pdf-reader.gotoPage", gotoPage, meta("跳转到指定页"));
  // 缩放族（百分比钮「点击回 100%」= zoomTo 1——一颗钮一条命令，⛔ 不另立 resetZoom）
  reg("pdf-reader.zoomIn", zoomIn, meta("放大"));
  reg("pdf-reader.zoomOut", zoomOut, meta("缩小"));
  reg("pdf-reader.zoomTo", zoomTo, meta("设置缩放倍率"));
  reg("pdf-reader.fitWidth", fitWidth, meta("适宽"));
  reg("pdf-reader.fitPage", fitPage, meta("适页"));
  // 底色与侧栏
  reg("pdf-reader.setBackground", setBackground, meta("设置阅读底色"));
  reg("pdf-reader.toggleSidebar", toggleSidebar, meta("切换缩略图侧栏"));
  // 读数（与状态条同源一份数据）
  reg("pdf-reader.getStatus", getStatus, meta("读取阅读器状态"));

  registered = true;
}
