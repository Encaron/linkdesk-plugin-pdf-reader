/**
 * pdf.js 文档加载与生命周期（页面对象 destroy() 纪律——mathematic-inc/vscode-pdf 借鉴点）。
 *
 * 引擎面只经本聚合器露面：视图拿 PdfDocument（numPages / pageSize / renderPage / destroy），
 * 不摸 getDocument 等原语；对壳只经 window.linkdesk.filesystem.readBinaryFile 一层。
 *
 * worker 生命周期：每份文档一个 worker（显式 port 的 PDFWorker——pdf.js 对外部 port 不代管
 * terminate，destroy() 里由本模块自己收），文档销毁 worker 即销毁，不留常驻线程。
 */
import { getDocument, PDFWorker } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import { PDFJS_CMAPS_URL, PDFJS_STANDARD_FONTS_URL, TEXT_CONTENT_OPTIONS, createPdfWorker } from "../../constants";
import { buildOutline, type OutlineItem } from "./outline";

/** pdf.js 的视口类型——只在本引擎域内流通（服务域出口给视图的是窄化数据） */
export type { PageViewport };
/**
 * 一页的文本项集合（`getTextContent` 的返回）——**从 pdf.js 自己的方法签名派生**，
 * ⛔ 不手抄形状：pdfjs-dist 的根类型入口（`types/src/pdf.d.ts`）**没有导出 `TextContent`**
 * （只有 `PDFDocumentProxy` / `PageViewport` 那几个），手抄一份就等于自己维护一份会漂的镜像；
 * 走 `ReturnType` 则它换形状时这里跟着走。
 */
export type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

/** scale 1 下的页面尺寸（pt）——布局与缩放换算统一用它 */
export interface PageSize {
  width: number;
  height: number;
}

/** 打开失败的分类——错误态两式（损坏/加密）按 kind 选，加载态照 00.5 §三 */
export type PdfOpenErrorKind = "encrypted" | "invalid" | "read" | "unknown";

export class PdfOpenError extends Error {
  constructor(
    readonly kind: PdfOpenErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "PdfOpenError";
  }
}

/** 一份已打开的 pdf 文档——调用方用完必须 destroy()（keep-alive 下随卸载/换文件释放）。 */
export interface PdfDocument {
  /** 总页数（本仓页码一律 1-based；pdf.js 亦 1-based，引擎边界零换算） */
  readonly numPages: number;
  /** 第 pageNumber 页（1-based）的 scale 1 尺寸——虚拟化布局用，pdf.js 内部有页缓存 */
  pageSize(pageNumber: number): Promise<PageSize>;
  /**
   * 把第 pageNumber 页渲进 canvas：scale 是 CSS 像素倍率（位图再乘 devicePixelRatio 保清晰），
   * 位图与 style 尺寸都由本方法设置；返回该页 scale 1 尺寸（供布局校准）。
   */
  renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale: number): Promise<PageSize>;
  /**
   * 该页的文本项（pdf.js `TextContent`）——搜索扫全文档与文本层渲染**共用这一份取数**
   * （T5：两处各取一份 = 命中框迟早偏，见 `services/textLayer/search.ts` 头注）。
   */
  textContent(pageNumber: number): Promise<TextContent>;
  /** 该页在 scale 下的视口——文本层按它排版（`--scale-factor` / UserUnit 都在这里面） */
  viewport(pageNumber: number, scale: number): Promise<PageViewport>;
  /**
   * 文档目录（书签树）——没有目录给**空数组**（⛔ 不当失败，没有目录的 PDF 多的是）；
   * 单个条目的目标解析不出（纯外链/坏 dest）给 `page: 0`，视图渲染成不可点的行。
   */
  outline(): Promise<OutlineItem[]>;
  /** 释放文档与 worker——幂等 */
  destroy(): Promise<void>;
}

/**
 * 读文件字节 → pdf.js 解析。worker 打不开即抛（不塞主线程凑合，01-任务书 §六）。
 *
 * ⛔ 不挂「加载进度」回调：pdf.js 在整段字节直接交给它的形态下**一次 onProgress 都不发**
 * （2026-10-07 实测 95MB 文件事件数 = 0——进度只在其网络流形态下才有），壳侧 readBinaryFile
 * 又是一次性 IPC（无 size / 无分块读）⇒ 本项目**没有任何真进度可报**。留个永不触发的回调
 * 只会喂出一条永远停在 0% 的进度条（死代码 ＋ 骗人），故整条进度面不设。
 */
/**
 * 把一条目录 `dest` 解析成本仓的 1-based 页码；**解析不出给 0**（0 = 无目标，视图渲成不可点的行）。
 *
 * 走到这里时 `dest` 已经过 pdf.js 两道归一（`Catalog.parseDestDictionary` ＋ `fetchDest`）：
 * 具名目标（`/Dest /name`）已换成字符串、`<< /D … >>` 包裹形已拆开、非法显式目标已滤成 `null`
 * ⇒ 本函数只需认两支（⛔ 不再自查字典形，那是到不了这儿的死分支）：
 *   · **字符串**——具名目标，经 `getDestination` 换开（换出来是数组，或 `null`）；
 *   · **数组**——显式目标，首位两种写法都要认：**页对象引用**（`[3 0 R /Fit]`，主流，走
 *     `getPageIndex`）或 **0-based 页序数**（`[2 /Fit]`，老生成器写法，pdf.js 的 `isValidExplicitDest`
 *     同样认它，直接加一）——⛔ 只认引用式 = 真文档里会静默少一批能跳的条目。
 * 坏目标、指向已删对象、外链条目（只有 url 没有 dest）一律落到 0，⛔ 不判死整棵树。
 */
async function pageOfDest(doc: PDFDocumentProxy, dest: unknown): Promise<number> {
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

export async function loadPdf(filePath: string): Promise<PdfDocument> {
  let data: unknown;
  try {
    data = await window.linkdesk.filesystem.readBinaryFile(filePath);
  } catch (err) {
    throw new PdfOpenError("read", err instanceof Error ? err.message : String(err));
  }

  const rawWorker = createPdfWorker();
  const worker = new PDFWorker({ port: rawWorker });
  let doc: PDFDocumentProxy;
  const loadingTask = getDocument({
    data,
    worker,
    cMapUrl: PDFJS_CMAPS_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_URL,
    // cmap/标准字体在池域（主线程）取——linkdesk:// 资产 fetch 不进 worker 沙箱
    useWorkerFetch: false,
  });
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    // 失败路径也要收掉 worker（一文档一线程，不泄漏）
    void loadingTask.destroy().catch(() => {});
    rawWorker.terminate();
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : String(err);
    if (name === "PasswordException") throw new PdfOpenError("encrypted", message);
    if (name === "InvalidPDFException") throw new PdfOpenError("invalid", message);
    throw new PdfOpenError("unknown", message);
  }

  let destroyed = false;
  return {
    numPages: doc.numPages,
    async pageSize(pageNumber) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    },
    async renderPage(pageNumber, canvas, scale) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(base.width * scale)}px`;
      canvas.style.height = `${Math.floor(base.height * scale)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d context unavailable");
      await page.render({ canvasContext: ctx, viewport }).promise;
      return { width: base.width, height: base.height };
    },
    async textContent(pageNumber) {
      const page = await doc.getPage(pageNumber);
      return page.getTextContent(TEXT_CONTENT_OPTIONS);
    },
    async viewport(pageNumber, scale) {
      const page = await doc.getPage(pageNumber);
      return page.getViewport({ scale });
    },
    async outline() {
      const raw = await doc.getOutline();
      return buildOutline(raw, (dest) => pageOfDest(doc, dest));
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      await loadingTask.destroy();
      rawWorker.terminate();
    },
  };
}
