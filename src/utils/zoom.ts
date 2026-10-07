/**
 * 缩放档位纯函数（单测主战场——03-工程目录规范 utils/）。
 * 缩放一律倍率数字（1.0 = 100%），适宽/适页是模式不是特殊倍率（归一化口径）。
 */
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../constants";

/**
 * 缩放档：百分比（自由倍率）｜适宽｜适页。
 * 🔴 定义住本模块（域类型的唯一出处）——store 与工具栏经它取，⛔ 别在别处再写一遍这个联合类型。
 */
export type ZoomMode = "percent" | "fitWidth" | "fitPage";

/** 出厂默认档（用户 2026-10-07 拍板：fitWidth）——配置读不到/值非法时都回落到它 */
export const DEFAULT_ZOOM_MODE: ZoomMode = "fitWidth";

/**
 * 配置项 `pdf-reader.defaultZoom` 的取值 → 缩放档（T4）。
 * 只认三个合法值，其余（undefined／拼错／旧值）一律回出厂 fitWidth——⛔ 不抛（配置是用户手写的，坏值不该炸阅读器）。
 */
export function parseDefaultZoom(value: unknown): ZoomMode {
  return value === "fitPage" ? "fitPage" : value === "percent" ? "percent" : DEFAULT_ZOOM_MODE;
}

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
