/**
 * 页文本与命中定位——**纯函数**（T5 单测主战场；⛔ 不碰 DOM、不碰 pdf.js）。
 *
 * ── 取数口径（搜索文本 ↔ 文本层 div 之间唯一的那份约定）──
 * 整页文本 = 逐项 `str` 直接拼接；某项 `hasEOL` 时**其后补一个 `"\n"`**。
 * 为什么不学 pdf.js 只拼 `""`：行尾不留边界，上一行末词与下一行首词会粘成一个词
 * （「…end」+「Start…」=「…endStart…」），搜索里就是假命中。补 `\n` 之后跨行不再粘连。
 *
 * 🔴 代价是**偏移不再等于「项长累加」**——所以 `starts[]` 必须显式记下每一项在整页文本里的起始
 * 位置，命中下标 → (项下标, 项内偏移) 的换算只认它。pdf.js 那边靠「原始串 ↔ 归一化串的 diff 回填」
 * 补偏移（它要做 diacritics 归一化），本仓不做归一化，用 `starts[]` 更直白也更难写错。
 *
 * 🔴 两边**必须用同一份取数与同一个 `buildPageText`**：搜索扫全文档用 `loadPageText`，
 * 文本层渲染后算 `starts` 也用它（见 `render.ts`）——两处各算一份 = 命中框迟早偏。
 */
import { MAX_PAGE_MATCHES } from "../../constants";
import type { TextContent } from "../pdfDoc";

/** 文本项——只要 pdf.js 给得出的那两位；`str === undefined` 的是 markedContent 标记项，不算文本 */
export interface SearchTextItem {
  str?: string;
  hasEOL?: boolean;
}

/** 整页文本 ＋ 每项起始偏移（`starts[i]` = 第 i 项 str 在 `text` 里的下标） */
export interface PageText {
  text: string;
  starts: number[];
}

/** 一处命中：`index` / `length` 都在**整页文本**的坐标系里（不是项内坐标） */
export interface Match {
  index: number;
  length: number;
}

/** 命中的一段落到某个文本项上的覆盖区间（`from` / `to` 是**项内**字符下标，左闭右开） */
export interface HighlightRange {
  divIdx: number;
  from: number;
  to: number;
  /** 命中在当页命中表里的序号——用于把「当前那一处」画成另一种样式 */
  matchIdx: number;
}

export { MAX_PAGE_MATCHES };

/**
 * 整页文本 ＋ 起始偏移表。markedContent 标记项（`str === undefined`）跳过——
 * pdf.js 的 `TextLayer` 也只给这类项以外的东西建 span，跳过才与 `textContentItemsStr` 逐项对齐。
 */
export function buildPageText(items: readonly SearchTextItem[]): PageText {
  const parts: string[] = [];
  const starts: number[] = [];
  let at = 0;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    parts.push(item.str);
    starts.push(at);
    at += item.str.length;
    if (item.hasEOL) {
      parts.push("\n");
      at += 1;
    }
  }
  return { text: parts.join(""), starts };
}

/** 正则元字符转义——查询串是用户随手敲的，`(` `[` `*` 这些不许当语法 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 在一页文本里找全部命中（大小写不敏感的子串匹配，⛔ 不做 diacritics/全角归一化——见文件头）。
 *
 * 🔴 用**正则**而不是「小写化后 indexOf」：小写化会改长度（`İ` 小写是两个码元），下标当场失真；
 * 正则的 `i` 旗标在**原串坐标系**里给下标，命中长度也取自原串，映射进文本层零换算。
 */
export function findMatches(text: string, query: string, limit = MAX_PAGE_MATCHES): Match[] {
  if (!query || !text) return [];
  const re = new RegExp(escapeRegExp(query), "gi");
  const out: Match[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, length: m[0].length });
    if (out.length >= limit) break;
    // 零长命中（查询串非空时不该出现）——手动推进，避免 exec 卡死在同一位置
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

/**
 * 命中 → 文本项上的覆盖区间（pdf.js `TextHighlighter._convertMatches` 的同一件事，只是换成
 * `starts[]` 查表而不用游标累加——跨项/跨行的命中天然落在同一套判据里）。
 *
 * `indexes` 要给**当页命中**的 `matchIdx`（全文档命中表里的序号），高亮层靠它认「当前那一处」。
 */
export function planHighlights(
  itemsStr: readonly string[],
  starts: readonly number[],
  matches: readonly (Match & { matchIdx: number })[],
): HighlightRange[] {
  const out: HighlightRange[] = [];
  for (const m of matches) {
    const end = m.index + m.length;
    // 命中起点可能落在「行尾补的 \n」上——它不属于任何项，往后挪一格找真正覆盖它的那项
    let i = 0;
    while (i < starts.length && starts[i] + itemsStr[i].length <= m.index) i++;
    while (i < starts.length && starts[i] < end) {
      const s = starts[i];
      const e = s + itemsStr[i].length;
      const from = Math.max(m.index, s) - s;
      const to = Math.min(end, e) - s;
      if (to > from) out.push({ divIdx: i, from, to, matchIdx: m.matchIdx });
      i++;
    }
  }
  return out;
}

/** `TextContent` → 整页文本（引擎面的窄化入口；视图层看不到 pdf.js 类型） */
export function pageTextOf(content: TextContent): PageText {
  return buildPageText(content.items as readonly SearchTextItem[]);
}
