/**
 * textLayer 域——文本层与搜索的**唯一出口**（03-工程目录规范：一域一夹一出口）。
 *
 * 视图层只经这里拿能力，拿到的全是**窄化数据**（`{ divs, itemsStr, starts }` / `Match`），
 * pdf.js 的类型不越出 `services/`（引擎面只从 `services/pdfDoc/` 露出，见其 index.ts）。
 */
import type { PdfDocument } from "../pdfDoc";
import { pageTextOf, type PageText } from "./search";

export { buildPageText, findMatches, planHighlights, pageTextOf, MAX_PAGE_MATCHES } from "./search";
export type { HighlightRange, Match, PageText, SearchTextItem } from "./search";
export { HIT_CLASS, HIT_CURRENT_CLASS, applyHighlights, clearHighlights, hitClassName } from "./highlight";
export { renderTextLayer, type RenderedTextLayer } from "./render";

/** 取一页的整页文本 ＋ 起始偏移表——搜索扫全文档走这里（⛔ 别在别处再取一份） */
export async function loadPageText(doc: PdfDocument, page: number): Promise<PageText> {
  return pageTextOf(await doc.textContent(page));
}
