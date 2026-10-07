/**
 * pdfDoc 域——pdf.js 引擎封装的唯一出口（03-工程目录规范：一域一夹一出口，视图不摸 pdf.js 原语）。
 */
export { loadPdf, PdfOpenError, type PdfDocument, type PageSize, type PdfOpenErrorKind } from "./loadPdf";
