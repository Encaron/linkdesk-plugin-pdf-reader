/** zoom 纯函数单测（替身零依赖，纯算术） */
import { describe, expect, it } from "vitest";
import { ZOOM_MAX, ZOOM_MIN } from "../constants";
import { clampScale, fitPageScale, fitWidthScale, zoomInScale, zoomOutScale } from "../utils/zoom";

describe("clampScale", () => {
  it("夹进 0.25–4.0", () => {
    expect(clampScale(0.1)).toBe(ZOOM_MIN);
    expect(clampScale(9)).toBe(ZOOM_MAX);
    expect(clampScale(1.5)).toBe(1.5);
  });
});

describe("zoomInScale / zoomOutScale", () => {
  it("按步进倍乘/除并在边界夹住", () => {
    expect(zoomInScale(1)).toBeCloseTo(1.2);
    expect(zoomOutScale(1.2)).toBeCloseTo(1);
    expect(zoomInScale(4)).toBe(ZOOM_MAX); // 到顶不涨
    expect(zoomOutScale(0.25)).toBe(ZOOM_MIN); // 到底不缩
  });
});

describe("fitWidthScale / fitPageScale", () => {
  it("适宽 = 可用宽/页宽", () => {
    expect(fitWidthScale(595, 595)).toBe(1);
    expect(fitWidthScale(1190, 595)).toBe(2);
  });
  it("适页取宽高两个方向的最小者", () => {
    // 可用 595×400，页 595×841 → 宽向 1.0、高向 ~0.4755 → 取高向
    expect(fitPageScale(595, 400, 595, 841)).toBeCloseTo(400 / 841);
  });
  it("非法输入回 1（不产 NaN）", () => {
    expect(fitWidthScale(0, 595)).toBe(1);
    expect(fitPageScale(100, 100, 0, 841)).toBe(1);
  });
});
