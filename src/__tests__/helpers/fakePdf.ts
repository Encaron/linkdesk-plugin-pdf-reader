/**
 * 假文档——T5 搜索测试的地基（⛔ 不是 pdf.js 替身，是 `PdfDocument` **契约**的替身）；
 * T6 补 `outline()` 与 `renderPage` 呼叫记账（缩略图懒渲染的证词）。
 *
 * 覆盖的是**扫页逻辑**那几条分支：跨行/跨页命中、落到当前页之后、单页取数失败不判死、
 * 扫描中间态。真解析（pdf.js 起 worker 读字节）归实机验收——在 jsdom 里起真引擎是另一个量级的
 * 成本，而且上面这几条分支它一条也测不出来。
 *
 * ⛔ 不放真文件名/真文案（夹具不许长得像真文档，免得后来人以为它是回归基线）。
 */
import type { OutlineItem, PageViewport, PdfDocument, TextContent } from "../../services/pdfDoc";

export interface FakeItem {
  str: string;
  hasEOL?: boolean;
}

/** 三页文本：第 1 页两行（跨行命中用）、第 2 页一行、第 3 页一行 */
export const PAGES: Record<number, FakeItem[]> = {
  1: [
    { str: "Hello world", hasEOL: true },
    { str: "second line", hasEOL: true },
  ],
  2: [{ str: "hello there" }],
  3: [{ str: "hello nothing" }],
};

/** 取数会**抛**的页——单页畸形不该判死整场搜索 */
export const broken = new Set<number>();
/** 取数**永不落地**的页——「扫描中…」与扫描中读数的中间态靠它复现 */
export const hanging = new Set<number>();

/** `renderPage` 被叫到的页（按调用序）——缩略图「只画可视条目、不整本铺开」在这上面断言 */
export const renderedPages: number[] = [];
/** 这份文档的目录（`buildOutline` 的产物直接喂进来，⛔ 不在替身里再走一遍 dest 解析） */
let outlineItems: OutlineItem[] = [];
export function setFakeOutline(items: OutlineItem[]): void {
  outlineItems = items;
}

/** 每例之间复位（模块级可变状态，⛔ 别让上一例的破页漏到下一例） */
export function resetFake(): void {
  broken.clear();
  hanging.clear();
  renderedPages.length = 0;
  outlineItems = [];
}

export function makeFakeDoc(numPages = 3): PdfDocument {
  return {
    numPages,
    async pageSize() {
      return { width: 595, height: 842 };
    },
    async renderPage(page: number, canvas: HTMLCanvasElement) {
      renderedPages.push(page);
      // 位图与 style 都要落（照真引擎面 `loadPdf.renderPage` 的合同）——否则「位图被谁清掉了」
      // 这类回归在 jsdom 里根本看不见（T6 实机踩过一次：重渲染把还挂着的 canvas 清了位图）
      canvas.width = 20;
      canvas.height = 28;
      canvas.style.width = "20px";
      return { width: 595, height: 842 };
    },
    async textContent(page: number) {
      if (hanging.has(page)) return new Promise<TextContent>(() => {});
      if (broken.has(page)) throw new Error("page text unavailable");
      return { items: PAGES[page] ?? [], styles: {}, lang: "en" } as unknown as TextContent;
    },
    async viewport(scale: number) {
      return { scale, userUnit: 1 } as unknown as PageViewport;
    },
    async outline() {
      return outlineItems;
    },
    async destroy() {},
  };
}
