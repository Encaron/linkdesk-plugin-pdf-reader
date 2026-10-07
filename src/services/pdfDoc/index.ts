/**
 * pdfDoc 域——pdf.js 引擎封装的唯一出口（03-工程目录规范：一域一夹一出口，视图不摸 pdf.js 原语）。
 *
 * `PageViewport` / `TextContent` 是 pdf.js 的**类型**，只在本仓服务域内流通（textLayer 域取数用），
 * 出口给视图的仍是窄化数据（`{ divs, itemsStr, starts }` / `Match`）——故它们只出到 services 边界。
 */
export {
  loadPdf,
  PdfOpenError,
  type PdfDocument,
  type PageSize,
  type PageViewport,
  type PdfOpenErrorKind,
  type TextContent,
} from "./loadPdf";
