/**
 * pdf-reader 常量收口（03-工程目录规范：常量的唯一落点——命令 id、缩放档、布局尺寸等全在这里）。
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

// ── 阅读器布局与缩放（00.5-UI布局规格 §一/§三）──
/** 缩放范围 0.25–4.0 连续（倍率数字，1.0 = 100%） */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4.0;
/** 缩放按钮 / Ctrl+滚轮的单步倍率 */
export const ZOOM_STEP = 1.2;
/** 页间距（px，页面卡片之间与阅读区上下留白共用） */
export const PAGE_GAP = 16;
/** 阅读区左右留白（px，适宽/适页按它扣掉可用宽度） */
export const READING_PAD = 24;
/** 虚拟化缓冲：可视页 ±2 页（02-执行清单 T3 判据） */
export const WINDOW_BUFFER = 2;

// ── 命令化与配置（T4，21-插件命令化规范）──
/** 本仓身份——命令 id 第一段（`check-command-ownership`：id 第一段必须 == pluginId）＋ 配置键第一段 */
export const PLUGIN_ID = "pdf-reader";
/** 命令面板/菜单里本插件命令的出现条件（读壳的宿主旗子；插件禁设宿主 contextKey——只读不写） */
export const WHEN_PDF_ACTIVE = `activeEditor == '${PLUGIN_ID}'`;
/** 配置键（`<pluginId>.<property>` 命名规则）——出厂缩放档，本插件唯一一条配置 */
export const CONFIG_DEFAULT_ZOOM = `${PLUGIN_ID}.defaultZoom`;
