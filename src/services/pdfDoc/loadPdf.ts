/**
 * pdf.js 文档加载与生命周期（页面对象 destroy() 纪律——mathematic-inc/vscode-pdf 借鉴点）。
 *
 * 引擎面只经本聚合器露面：视图拿 PdfDocument（numPages / renderPage / destroy），
 * 不摸 getDocument 等原语；对壳只经 window.linkdesk.filesystem.readBinaryFile 一层。
 *
 * worker 生命周期：每份文档一个 worker（显式 port 的 PDFWorker——pdf.js 对外部 port 不代管
 * terminate，destroy() 里由本模块自己收），文档销毁 worker 即销毁，不留常驻线程。
 */
import { getDocument, PDFWorker } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PDFJS_CMAPS_URL, PDFJS_STANDARD_FONTS_URL, createPdfWorker } from "../../constants";

/** 一份已打开的 pdf 文档——调用方用完必须 destroy()（keep-alive 下随卸载/换文件释放）。 */
export interface PdfDocument {
  /** 总页数（本仓页码一律 1-based；pdf.js 亦 1-based，引擎边界零换算） */
  readonly numPages: number;
  /** 把第 pageNumber 页（1-based）按 scale 1 渲染进 canvas（缩放档位归一属 T3） */
  renderPage(pageNumber: number, canvas: HTMLCanvasElement): Promise<void>;
  /** 释放文档与 worker——幂等 */
  destroy(): Promise<void>;
}

/** 读文件字节 → pdf.js 解析。worker 打不开即抛（不塞主线程凑合，01-任务书 §六）。 */
export async function loadPdf(filePath: string): Promise<PdfDocument> {
  const data = await window.linkdesk.filesystem.readBinaryFile(filePath);
  const rawWorker = createPdfWorker();
  const worker = new PDFWorker({ port: rawWorker });
  const loadingTask = getDocument({
    data,
    worker,
    cMapUrl: PDFJS_CMAPS_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
    // cmap/标准字体在池域（主线程）取——linkdesk:// 资产 fetch 不进 worker 沙箱
    useWorkerFetch: false,
  });
  const doc: PDFDocumentProxy = await loadingTask.promise;
  let destroyed = false;
  return {
    numPages: doc.numPages,
    async renderPage(pageNumber, canvas) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d context unavailable");
      await page.render({ canvasContext: ctx, viewport }).promise;
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      await loadingTask.destroy();
      rawWorker.terminate();
    },
  };
}
