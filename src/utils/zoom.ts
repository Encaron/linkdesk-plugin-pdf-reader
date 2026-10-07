/**
 * 缩放档位纯函数（单测主战场——03-工程目录规范 utils/）。
 * 缩放一律倍率数字（1.0 = 100%），适宽/适页是模式不是特殊倍率（归一化口径）。
 */
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../constants";

export function clampScale(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

export function zoomInScale(scale: number): number {
  return clampScale(scale * ZOOM_STEP);
}

export function zoomOutScale(scale: number): number {
  return clampScale(scale / ZOOM_STEP);
}

/** 适宽：可用宽 / 页宽（scale 1），夹进缩放范围 */
export function fitWidthScale(availableWidth: number, pageWidth: number): number {
  if (pageWidth <= 0 || availableWidth <= 0) return 1;
  return clampScale(availableWidth / pageWidth);
}

/** 适页：宽高两个方向都装得下的最大倍率 */
export function fitPageScale(
  availableWidth: number,
  availableHeight: number,
  pageWidth: number,
  pageHeight: number,
): number {
  if (pageWidth <= 0 || pageHeight <= 0 || availableWidth <= 0 || availableHeight <= 0) return 1;
  return clampScale(Math.min(availableWidth / pageWidth, availableHeight / pageHeight));
}
