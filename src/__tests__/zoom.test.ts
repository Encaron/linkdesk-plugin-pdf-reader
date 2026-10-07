/** zoom 纯函数单测（替身零依赖，纯算术） */
import { describe, expect, it } from "vitest";
import { ZOOM_MAX, ZOOM_MIN } from "../constants";
import {
  clampScale,
  DEFAULT_ZOOM_MODE,
  fitPageScale,
  fitWidthScale,
  parseDefaultZoom,
  zoomInScale,
  zoomOutScale,
} from "../utils/zoom";

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

describe("parseDefaultZoom（配置项 pdf-reader.defaultZoom → 缩放档）", () => {
  it("三个合法值原样认", () => {
    expect(parseDefaultZoom("fitWidth")).toBe("fitWidth");
    expect(parseDefaultZoom("fitPage")).toBe("fitPage");
    expect(parseDefaultZoom("percent")).toBe("percent");
  });
  it("其余一切回出厂适宽（配置是用户手写的，坏值不该炸阅读器）", () => {
    expect(parseDefaultZoom(undefined)).toBe(DEFAULT_ZOOM_MODE);
    expect(parseDefaultZoom(null)).toBe(DEFAULT_ZOOM_MODE);
    expect(parseDefaultZoom("")).toBe(DEFAULT_ZOOM_MODE);
    expect(parseDefaultZoom("FitWidth")).toBe(DEFAULT_ZOOM_MODE); // 大小写不宽容（值面是契约）
    expect(parseDefaultZoom("fit-width")).toBe(DEFAULT_ZOOM_MODE); // 连字符写法不是合法值
    expect(parseDefaultZoom(1)).toBe(DEFAULT_ZOOM_MODE);
    expect(parseDefaultZoom({ mode: "fitPage" })).toBe(DEFAULT_ZOOM_MODE);
  });
  it("出厂档就是用户拍板的 fitWidth", () => {
    expect(DEFAULT_ZOOM_MODE).toBe("fitWidth");
  });
});
