/**
 * 命中高亮落 DOM（T5）——把 `planHighlights` 算出的覆盖区间画进 pdf.js 已渲染的文本层 span 里。
 *
 * ── 为什么是「拆 span 内文」而不是「上面盖一层方块」──
 * 文本层是**叠在 canvas 之上**的透明文字（`color: transparent`）：命中底画在文字身后才透出底下的渲染结果。
 * 若另起一层绝对定位方块去盖，滚动/缩放都得自己重算坐标（每个方块一次 getBoundingClientRect ×
 * 滚动帧），且方块会挡住文字本身的划选。拆 span 内文这套是 pdf.js `TextHighlighter._renderMatches`
 * 的做法：命中子串用一个 `<span class="pdf-reader-hit">` 包住，父 span 的 `textContent` 一字不变
 * ⇒ 划选/复制、pdf.js 自己的 `--scale-x` 度量（它读 `div.textContent`）全都不受影响。
 *
 * 🔴 复原靠 `itemsStr`（渲染文本层时 pdf.js 给的原样字符串）——**不是**记改前的 DOM 快照：
 * 同一份 `itemsStr` 既能重建原文，也让「清了再标」幂等（连标两次不会套两层 span）。
 */
import type { HighlightRange } from "./search";

/** 命中底类名（样式住 styles/reader.css，色值只取 tokens.css 的 --pdf-hit / --pdf-accent） */
export const HIT_CLASS = "pdf-reader-hit";
/** 「当前命中」的修饰类（复合状态类：与本类同名叠加用，不单独出现） */
export const HIT_CURRENT_CLASS = `${HIT_CLASS}-current`;

/** 命中 span 的类名——`current` 那处是「当前命中」（上下导航落点），换另一种底色 */
export function hitClassName(current: boolean): string {
  return current ? `${HIT_CLASS} ${HIT_CURRENT_CLASS}` : HIT_CLASS;
}

/**
 * 把命中区间写进各文本项。`ranges` 来自 `planHighlights`（同页全部命中），`currentMatchIdx` 是
 * 全文档命中表里「当前那一处」的序号（-1 = 没有当前）。
 *
 * 只重写**有命中的那些项**——没命中的项一个字都不动（省掉整页重建，也少一次 DOM 抖动）。
 */
export function applyHighlights(
  divs: readonly HTMLElement[],
  itemsStr: readonly string[],
  ranges: readonly HighlightRange[],
  currentMatchIdx: number,
): void {
  if (ranges.length === 0) return;
  const byDiv = new Map<number, HighlightRange[]>();
  for (const r of ranges) {
    const list = byDiv.get(r.divIdx);
    if (list) list.push(r);
    else byDiv.set(r.divIdx, [r]);
  }
  for (const [divIdx, list] of byDiv) {
    const div = divs[divIdx];
    const text = itemsStr[divIdx];
    if (!div || typeof text !== "string") continue;
    list.sort((a, b) => a.from - b.from);
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const r of list) {
      const from = Math.max(cursor, Math.min(r.from, text.length));
      const to = Math.max(from, Math.min(r.to, text.length));
      if (from > cursor) frag.append(document.createTextNode(text.slice(cursor, from)));
      const mark = document.createElement("span");
      mark.className = hitClassName(r.matchIdx === currentMatchIdx);
      mark.textContent = text.slice(from, to);
      frag.append(mark);
      cursor = to;
    }
    if (cursor < text.length) frag.append(document.createTextNode(text.slice(cursor)));
    div.replaceChildren(frag);
  }
}

/**
 * 抹掉高亮，文本层回到原文（关搜索条/改查询时用）。
 * 拿不到原串的项（不该发生）跳过——宁可不还原，也不把那一项的文本清空。
 */
export function clearHighlights(divs: readonly HTMLElement[], itemsStr: readonly string[]): void {
  for (let i = 0; i < divs.length; i++) {
    const div = divs[i];
    const text = itemsStr[i];
    if (!div || typeof text !== "string") continue;
    if (div.childNodes.length === 1 && div.firstChild?.nodeType === Node.TEXT_NODE) continue; // 本来就是纯文本
    div.textContent = text;
  }
}
