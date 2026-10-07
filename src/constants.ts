/**
 * pdf-reader 常量收口（03-工程目录规范：产物路径等常量的唯一落点）。
 */
// pdf.js worker——?worker 构造器随 vite 打包成独立 chunk（editor 的 monaco worker 同款路线）。
// ⛔ 不用 ?url／data: URL（池沙箱 CSP 不给非同源 worker）；打不开即抛，禁塞主线程凑合（01-任务书 §六）。
import PdfWorkerCtor from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

export function createPdfWorker(): Worker {
  return new PdfWorkerCtor();
}

// cmaps／标准字体目录——public/ 随包（scripts/sync-pdfjs-assets.mjs 保鲜），URL 相对包内根自锚定。
export const PDFJS_CMAPS_URL = new URL("pdfjs/cmaps/", import.meta.url).href;
export const PDFJS_STANDARD_FONTS_URL = new URL("pdfjs/standard_fonts/", import.meta.url).href;
