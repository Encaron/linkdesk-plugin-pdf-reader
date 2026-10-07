/**
 * pdf-reader 命令 handlers——**一条命令一个 handler**（T4 落点 `src/commands/`；21-插件命令化规范）。
 *
 * ── 四条纪律（本文件的存在理由）──
 *   ① **不绕状态链路**：每个 handler 都走 `ReaderStore` 的动作函数——与工具栏钮点的是**同一份**
 *      （规范 §4.1/§4.2）⇒ 「命令跑了但界面不知道」在构造上不可能（store.set 会通知视图重渲）。
 *   ② **回执三态**（规范 §7.1）：`{ok:true}` 真做了 ／ `{ok:true,noop:true,reason}` 没改但**不是失败**
 *      （目标不存在／已在边界／文档还在加载）／ `{ok:false,noop:true,reason,error}` 这次**调用**有问题
 *      （实参坏、点名找不到）。⛔ 绝不把「没做」吞成 `ok:true`——那正是 AI 要猜的坑。
 *   ③ **点名必须命中**：带 `sourceId` 的调用查不到就如实报错并**列出有哪些**，
 *      ⛔ 不静默回退到活跃的那一份（寻址口径住 `services/readerBridge.ts`，本文件不另写一套）。
 *   ④ **实参坏不抛异常**：全部经 `badArg` 回载荷——抛异常会经壳变成用户面前的红 toast，
 *      而「调用方写错参数」用户当场什么也做不了（规范 §7.1）。
 *
 * ⚠️ 命名与说明**只写在 `plugin.json` 的 `contributes.commands[]`**（`description` / `params`），
 *    `registerCommand` 的 meta 只带 title/category/when——两处都写 = 两份文案迟早分叉
 *    （serial-monitor `services/serialCommands.ts` 头部那条家规同款）。
 */
import { ZOOM_MAX, ZOOM_MIN } from "../constants";
import { resolveReaderTarget, type ReaderTarget } from "../services/readerBridge";
import type { ReaderBg, ReaderStore } from "../views/readerStore";

/** 回执的形状（三态共用；各命令自己再挂读数字段） */
export interface CmdReply {
  ok: boolean;
  noop?: true;
  reason?: string;
  /** 人话一句——`reason` 给代码分支，`error` 给人/AI 读（规范 §7.1） */
  error?: string;
  [reading: string]: unknown;
}

/** 底色合法取值——校验与自测共用同一批字面量（⛔ 别在 handler 里另写一遍） */
export const BG_VALUES: readonly ReaderBg[] = ["paper", "night"];

/** 没有挂着的阅读器时的那句话——六条命令共用一句（⛔ 别各写一版，两份措辞迟早分叉） */
const NO_DOCUMENT_HINT =
  "当前没有打开的 PDF——先从文件树单击一个 .pdf 打开阅读器（命令只操作已经开着的那一份；" +
  "开文档归 fileAssociations 那条路，本仓不提供「建空阅读器」）";

/** 调用本身有问题（实参坏／点名找不到） */
function badArg(reason: string, error: string): CmdReply {
  return { ok: false, noop: true, reason, error };
}

/** 没做但不是失败（目标不存在／已在边界／文档还在加载） */
function notDone(reason: string, error: string, readings: Record<string, unknown> = {}): CmdReply {
  return { ...readings, ok: true, noop: true, reason, error };
}

/** 值 → 可读串（坏载荷也要能写进消息里，⛔ 不许在这里抛） */
function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "undefined") return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * 取具名实参的一个字段——两形等价：单具名对象 `{ page: 3 }` 与逐位 `(3)`。
 * 为什么必须支持逐位：壳侧具名展开有**窄门**（恰好一个对象实参 ＋ 命令声明 ≥2 个 params 才展开），
 * 本仓单参数命令一律只声明一个 `args` 对象 ⇒ 具名形态照原样到手，而逐位是 CLI 的顺手指法
 * （先例 = serial-monitor `readSessionId`）。
 */
function readField(args: unknown[], key: string): unknown {
  const first = args[0];
  if (first !== null && typeof first === "object" && !Array.isArray(first)) {
    return (first as Record<string, unknown>)[key];
  }
  return first;
}

/**
 * 取点名的目标（`sourceId`）——具名对象里的 `sourceId`，或逐位形态下**当且仅当该命令没有别的载荷**时
 * 第一位的字符串。
 *
 * 🔴 `payloadKey` 这一维是必需的不是讲究：本仓三条命令自带字符串/数字载荷（`gotoPage.page` /
 * `zoomTo.scale` / `setBackground.bg`），逐位调用 `setBackground("night")` 的那位是**底色档**——
 * 一律当点名读就会把合法调用判成 `bad-source`（T4 单测当场逮住过这一形态）。反过来，没有载荷的
 * 命令（`pageNext` / `getStatus` …）逐位那一串字符串**只可能**是点名，认下来对调用方更顺手。
 * ⛔ 载荷命令的逐位形态一律不认点名——宁可让他用 `{ sourceId }` 具名形态，也不猜。
 */
function readTarget(args: unknown[], payloadKey: string | null): unknown {
  const first = args[0];
  if (first !== null && typeof first === "object" && !Array.isArray(first)) {
    const named = first as Record<string, unknown>;
    return "sourceId" in named ? named.sourceId : undefined;
  }
  return payloadKey === null && typeof first === "string" ? first : undefined;
}

/**
 * 寻址失败 → 回执。两态的措辞只写在这里（⛔ 别每条命令各写一遍）：
 *   · 点了名找不到 ⇒ `ok:false`（这次**调用**有问题，并**列出有哪些**——规范 §7.2.2）；
 *   · 一份都没挂 ⇒ `ok:true` ＋ noop（目标不存在**不是失败**，规范 §7.1）。
 */
function targetMiss(target: Exclude<ReaderTarget, { kind: "ok" }>, extra: Record<string, unknown> = {}): CmdReply {
  if (target.kind === "bad-source") {
    const available = target.available.length
      ? `现有：${target.available.join(" | ")}`
      : "当前一份阅读器都没挂着（先从文件树单击一个 .pdf）";
    return badArg(
      "bad-source",
      `找不到 sourceId ${show(target.received)} 对应的阅读器——${available}。` +
        "（sourceId = 该 pdf 的完整路径；清单也可读 pdf-reader.getStatus）",
    );
  }
  return notDone("no-document", NO_DOCUMENT_HINT, extra);
}

/**
 * 寻址一次（挂着的实例，或回执）——八条命令共用（`ok` 是真判别式，调用方 `if (!hit.ok) return hit.reply`）。
 *
 * @param payloadKey 该命令自带的载荷字段名（`page` / `scale` / `bg`）；**没有载荷传 `null`**——
 *   它决定逐位形态第一位算不算点名，判据与理由见 `readTarget`。
 */
async function address(
  args: unknown[],
  payloadKey: string | null = null,
  extra: Record<string, unknown> = {},
): Promise<{ ok: true; store: ReaderStore; sourceId: string } | { ok: false; reply: CmdReply }> {
  const target = await resolveReaderTarget(readTarget(args, payloadKey));
  if (target.kind !== "ok") return { ok: false, reply: targetMiss(target, extra) };
  return { ok: true, store: target.store, sourceId: target.sourceId };
}

/** 翻页类的前提：页数已定（loading／error 相位读不出页数）——不满足如实报，⛔ 不静默当成功 */
function pagesReady(store: ReaderStore, sourceId: string): CmdReply | null {
  const kind = store.getState().phase.kind;
  if (kind === "ready") return null;
  if (kind === "loading") {
    return notDone(
      "loading",
      `「${sourceId}」的 PDF 还在加载——页数未定，等就绪后再翻（相位读 pdf-reader.getStatus 的 phase）`,
      { sourceId },
    );
  }
  return badArg(
    "load-failed",
    `「${sourceId}」的 PDF 打开失败——先读 pdf-reader.getStatus 的 error，或重新单击该文件再打开`,
  );
}

// ── 翻页族 ──

/** `pdf-reader.pageNext` */
export async function pageNext(...args: unknown[]): Promise<CmdReply> {
  return stepPage(args, 1);
}

/** `pdf-reader.pagePrev` */
export async function pagePrev(...args: unknown[]): Promise<CmdReply> {
  return stepPage(args, -1);
}

async function stepPage(args: unknown[], delta: 1 | -1): Promise<CmdReply> {
  const hit = await address(args);
  if (!hit.ok) return hit.reply;
  const { store, sourceId } = hit;
  const blocked = pagesReady(store, sourceId);
  if (blocked) return blocked;

  const before = store.getStatus();
  if (delta > 0) store.pageNext();
  else store.pagePrev();
  const after = store.getStatus();
  if (after.currentPage === before.currentPage) {
    const last = delta > 0;
    return notDone(
      last ? "at-last-page" : "at-first-page",
      last
        ? `已经是最后一页（第 ${after.currentPage} 页 / 共 ${after.numPages} 页）`
        : `已经是第一页（第 1 页 / 共 ${after.numPages} 页）`,
      { sourceId, field: "currentPage", value: after.currentPage, numPages: after.numPages },
    );
  }
  return {
    ok: true,
    sourceId,
    field: "currentPage",
    previous: before.currentPage,
    value: after.currentPage,
    numPages: after.numPages,
  };
}

/** `pdf-reader.gotoPage` */
export async function gotoPage(...args: unknown[]): Promise<CmdReply> {
  const raw = readField(args, "page");
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return badArg(
      "bad-page",
      `page 要是整数页码（1-based）——收到 ${show(raw)}；例 { "page": 3 }（页码从 1 起，不是下标）`,
    );
  }
  const hit = await address(args, "page");
  if (!hit.ok) return hit.reply;
  const { store, sourceId } = hit;
  const blocked = pagesReady(store, sourceId);
  if (blocked) return blocked;

  const before = store.getStatus();
  if (raw < 1 || raw > before.numPages) {
    return badArg("out-of-range", `页码 ${raw} 超出 1..${before.numPages}（本文件共 ${before.numPages} 页）`);
  }
  store.gotoPage(raw);
  const after = store.getStatus();
  return {
    ok: true,
    sourceId,
    field: "currentPage",
    previous: before.currentPage,
    value: after.currentPage,
    numPages: after.numPages,
  };
}

// ── 缩放族 ──

/**
 * 缩放族**不做相位门**：缩放档与倍率是视图态，文档还在加载时设了也算数（就绪后按已设的档重算；
 * 适宽/适页继续随窗口 resize 跟随）。唯一前提 = 有一份挂着的阅读器。
 */

/** `pdf-reader.zoomIn` */
export async function zoomIn(...args: unknown[]): Promise<CmdReply> {
  return stepZoom(args, "in");
}

/** `pdf-reader.zoomOut` */
export async function zoomOut(...args: unknown[]): Promise<CmdReply> {
  return stepZoom(args, "out");
}

async function stepZoom(args: unknown[], dir: "in" | "out"): Promise<CmdReply> {
  const hit = await address(args);
  if (!hit.ok) return hit.reply;
  const { store, sourceId } = hit;

  const before = store.getStatus();
  if (dir === "in") store.zoomIn();
  else store.zoomOut();
  const after = store.getStatus();
  if (after.scale === before.scale) {
    const top = dir === "in";
    return notDone(
      top ? "at-max-zoom" : "at-min-zoom",
      top
        ? `已在缩放上限 ${Math.round(ZOOM_MAX * 100)}%（pdf-reader.zoomTo 也只能到 ${ZOOM_MAX}）`
        : `已在缩放下限 ${Math.round(ZOOM_MIN * 100)}%`,
      { sourceId, field: "scale", value: after.scale, zoomMode: after.zoomMode },
    );
  }
  return {
    ok: true,
    sourceId,
    field: "scale",
    previous: before.scale,
    value: after.scale,
    zoomMode: after.zoomMode,
  };
}

/** `pdf-reader.zoomTo` */
export async function zoomTo(...args: unknown[]): Promise<CmdReply> {
  const raw = readField(args, "scale");
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return badArg(
      "bad-scale",
      `scale 要是正数倍率（1 = 100%）——收到 ${show(raw)}；例 { "scale": 1.5 }（1.5 = 150%）`,
    );
  }
  if (raw < ZOOM_MIN || raw > ZOOM_MAX) {
    return badArg(
      "out-of-range",
      `scale ${raw} 超出本仓缩放范围 ${ZOOM_MIN}..${ZOOM_MAX}` +
        `（${Math.round(ZOOM_MIN * 100)}%–${Math.round(ZOOM_MAX * 100)}%）`,
    );
  }
  const hit = await address(args, "scale");
  if (!hit.ok) return hit.reply;
  const { store, sourceId } = hit;

  const before = store.getStatus();
  store.zoomTo(raw);
  const after = store.getStatus();
  if (before.scale === after.scale && before.zoomMode === after.zoomMode) {
    return notDone("already-at-scale", `倍率本来就是 ${after.scale}（${Math.round(after.scale * 100)}%）`, {
      sourceId,
      field: "scale",
      value: after.scale,
      zoomMode: after.zoomMode,
    });
  }
  return {
    ok: true,
    sourceId,
    field: "scale",
    previous: before.scale,
    value: after.scale,
    zoomMode: after.zoomMode,
  };
}

/** `pdf-reader.fitWidth` */
export async function fitWidth(...args: unknown[]): Promise<CmdReply> {
  return stepFitMode(args, "fitWidth");
}

/** `pdf-reader.fitPage` */
export async function fitPage(...args: unknown[]): Promise<CmdReply> {
  return stepFitMode(args, "fitPage");
}

async function stepFitMode(args: unknown[], mode: "fitWidth" | "fitPage"): Promise<CmdReply> {
  const hit = await address(args);
  if (!hit.ok) return hit.reply;
  const { store, sourceId } = hit;

  const before = store.getStatus();
  // ⚠️ 即便「本来就是这个档」也要调一次：store 的动作里带「用户已自己缩放过」的锁定
  // （配置默认档只在用户没动过时生效）——不调就留下了「配置晚到把这一下盖掉」的缝。
  store.setZoomMode(mode);
  const after = store.getStatus();
  if (before.zoomMode === after.zoomMode) {
    return notDone(
      mode === "fitWidth" ? "already-fit-width" : "already-fit-page",
      `缩放档本来就是「${mode === "fitWidth" ? "适宽" : "适页"}」（当前倍率 ${after.scale}）`,
      { sourceId, field: "zoomMode", value: after.zoomMode, scale: after.scale },
    );
  }
  return {
    ok: true,
    sourceId,
    field: "zoomMode",
    previous: before.zoomMode,
    value: after.zoomMode,
    scale: after.scale,
  };
}

// ── 底色与侧栏 ──

/** `pdf-reader.setBackground` */
export async function setBackground(...args: unknown[]): Promise<CmdReply> {
  const raw = readField(args, "bg");
  if (typeof raw !== "string" || !BG_VALUES.includes(raw as ReaderBg)) {
    return badArg(
      "bad-bg",
      `bg 只接受 ${BG_VALUES.map((v) => JSON.stringify(v)).join(" | ")}——收到 ${show(raw)}`,
    );
  }
  const bg = raw as ReaderBg;
  const hit = await address(args, "bg");
  if (!hit.ok) return hit.reply;
  const { store, sourceId } = hit;

  const before = store.getStatus();
  store.setBackground(bg);
  const after = store.getStatus();
  if (before.bg === after.bg) {
    return notDone(`already-${bg}`, `阅读底色本来就是「${bg === "paper" ? "纸白" : "夜间"}」`, {
      sourceId,
      field: "bg",
      value: after.bg,
    });
  }
  return { ok: true, sourceId, field: "bg", previous: before.bg, value: after.bg };
}

/** `pdf-reader.toggleSidebar`——翻转类，回执带翻转**之后读回**的值（规范 §7.4） */
export async function toggleSidebar(...args: unknown[]): Promise<CmdReply> {
  const hit = await address(args);
  if (!hit.ok) return hit.reply;
  const { store, sourceId } = hit;

  const before = store.getStatus();
  store.toggleSidebar();
  const after = store.getStatus();
  return {
    ok: true,
    sourceId,
    field: "sidebarOpen",
    previous: before.sidebarOpen,
    value: after.sidebarOpen,
  };
}

// ── 读数 ──

/**
 * `pdf-reader.getStatus`——结构化读数，与状态条**同源一份数据**（`store.getStatus()`，00.5 §七）。
 * 读命令口径（规范 §7.3）：空 ≠ 失败（没开文档 = `ok:true` ＋ `hasDocument:false`），
 * 「读不到」（点名找不到）才 `ok:false`——两者混为一谈就是「答了个空，看着却像答案」。
 */
export async function getStatus(...args: unknown[]): Promise<CmdReply> {
  const hit = await address(args, null, { hasDocument: false, phase: "none" });
  if (!hit.ok) return hit.reply;
  const { store, sourceId } = hit;

  const state = store.getState();
  const reply: CmdReply = {
    ok: true,
    sourceId,
    ...store.getStatus(),
    phase: state.phase.kind,
  };
  if (state.phase.kind === "error") {
    reply.error = `${state.phase.error.kind}：${state.phase.error.message}`;
  }
  return reply;
}
