/**
 * 目录目标（`dest`）→ 1-based 页码——**纯换算**（T7 从 `loadPdf.ts` 抽出：这是唯一一处
 * 认 pdf.js dest 形状的逻辑，而它的三条分支（页对象引用／具名／0-based 页序数）此前只有实机
 * 读数、没有单测——实机验的是「那份夹具文档恰好走哪一支」，钉不住「三支都认」这件事）。
 *
 * 分工照 `outline.ts` 的同一口径：**异步取数（问文档）由注入的窄接口给**，本文件只做判定与换算，
 * 于是三种 dest 形能在 jsdom 里逐条钉住，不必起真引擎。
 *
 * 走到这里时 `dest` 已经过 pdf.js 两道归一（`Catalog.parseDestDictionary` ＋ `fetchDest`）：
 * 具名目标（`/Dest /name`）已换成字符串、`<< /D … >>` 包裹形已拆开、非法显式目标已滤成 `null`
 * ⇒ 本函数只需认两支（⛔ 不再自查字典形，那是到不了这儿的死分支）。
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * 解析 dest 需要的**文档面**——只这两位（`PDFDocumentProxy` 结构性满足它）。
 * 收窄成接口而不是吃整个 `PDFDocumentProxy`：替身不必复刻 pdf.js 的几十个成员（同
 * `outline.ts` 的 `DestResolver` 口径——替身照契约不照实现）。
 */
export interface DestDocument {
  /** 具名目标（`/Dest /name`）换开——pdf.js 换出来是数组（或 `null`） */
  getDestination(name: string): Promise<unknown>;
  /** 页对象引用（`[3 0 R /Fit]`）→ 0-based 页序数 */
  getPageIndex(ref: unknown): Promise<number>;
}

/**
 * 把一条目录 `dest` 解析成本仓的 1-based 页码；**解析不出给 0**（0 = 无目标，视图渲成不可点的行）。
 *
 * 两支写法都要认（⛔ 只认引用式 = 真文档里会静默少一批能跳的条目）：
 *   · **字符串**——具名目标，经 `getDestination` 换开（换出来是数组，或 `null`）；
 *   · **数组**——显式目标，首位两种写法都要认：**页对象引用**（`[3 0 R /Fit]`，主流，走
 *     `getPageIndex`）或 **0-based 页序数**（`[2 /Fit]`，老生成器写法，pdf.js 的
 *     `isValidExplicitDest` 同样认它，直接加一）。
 *
 * 坏目标、指向已删对象、外链条目（只有 url 没有 dest）一律落到 0，⛔ 不判死整棵树。
 */
export async function resolveDestPage(doc: DestDocument, dest: unknown): Promise<number> {
  try {
    const explicit: unknown = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return 0;
    const first = explicit[0];
    if (typeof first === "number") return Math.floor(first) + 1;
    if (first === null || typeof first !== "object") return 0;
    return (await doc.getPageIndex(first)) + 1;
  } catch {
    return 0;
  }
}

/** 绑定文档的一次性解析器（`outline()` 逐条调它）——形状同 `outline.ts` 的 `DestResolver` */
export function destResolver(doc: PDFDocumentProxy): (dest: unknown) => Promise<number> {
  return (dest) => resolveDestPage(doc, dest);
}
