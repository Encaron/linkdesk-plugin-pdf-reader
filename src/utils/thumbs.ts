/**
 * 缩略图槽位换算——纯函数（T7 从 `views/outlineSidebar/` 的内联算式抽出）。
 *
 * 这两处换算原本内联在侧栏组件里，只有实机读数验过「20 页夹具槽位总高 4748」这一个点。
 * 抽出来是为了钉住**比例关系**（换成别的页宽/图宽仍然对），而不是只钉住那一份夹具的数值。
 */
import { THUMB_IMAGE_WIDTH } from "../constants";

/** 一页在 scale 1 下的尺寸——只吃长宽比，⛔ 不吃 pdf.js 类型（同 `pagination.ts` 的口径） */
export interface AspectSize {
  width: number;
  height: number;
}

/**
 * 缩略图**槽位高度**（px）：按该页长宽比折算到 `THUMB_IMAGE_WIDTH` 宽的位图高。
 *
 * 槽位先按比占好（`heights.map` 整本都铺）、位图后到——滚动条长度与滚动位置不随渲染先后跳动。
 * `Math.round` 与 CSS 像素取整同口径：不取整的话几十页累加起来会多出半像素的缝。
 */
export function thumbSlotHeight(size: AspectSize): number {
  return Math.round((THUMB_IMAGE_WIDTH * size.height) / size.width);
}

/**
 * 缩略图**渲染倍率** = 位图宽 / 页宽（即 `renderPage(page, canvas, scale)` 的 scale）。
 *
 * 用 `THUMB_IMAGE_WIDTH` 而不是槽位宽 `THUMB_WIDTH`——槽位含两侧各 1px 描边，位图要塞进描边之内。
 * 换算必须只有这一处：`renderedScale` 拿它判断「这一格是否已渲」，两处各算一遍的话，只要有一处
 * 换了口径，就会出现「每次滚动都重渲整窗」或「换了档位却不重画」（实机症状，见 T6 档案 §四）。
 */
export function thumbRenderScale(size: AspectSize): number {
  return THUMB_IMAGE_WIDTH / size.width;
}
