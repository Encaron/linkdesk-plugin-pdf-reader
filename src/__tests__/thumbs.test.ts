/**
 * 缩略图槽位换算单测（T7）——测**比例关系**，不是某一份夹具的数值。
 *
 * T6 的实机读数只留下一个点（20 页夹具槽位总高 4748、A4 一页 229），那是「夹具凑巧多少」；
 * 换个页宽（横向 A4、扫描件的小页）或换个图宽常量，那一组读数全都对不上，坏不坏没人知道。
 * 这里钉三件事：**长宽比守恒**（含四舍五入的容差）、**边界页不塌成 0**、**位图宽用的是
 * `THUMB_IMAGE_WIDTH` 而不是槽位宽**（差 2px 描边，用错了位图就会溢出描边）。
 */
import { describe, expect, it } from "vitest";
import { THUMB_IMAGE_WIDTH, THUMB_WIDTH } from "../constants";
import { thumbRenderScale, thumbSlotHeight } from "../utils/thumbs";

const A4 = { width: 595, height: 842 };
const A4_LANDSCAPE = { width: 842, height: 595 };

describe("thumbSlotHeight：槽位高度按长宽比折算", () => {
  it("A4 竖版 = 162 × 842/595 ≈ 229（与 T6 实机读数同一个数——口径没漂）", () => {
    expect(thumbSlotHeight(A4)).toBe(229);
  });

  it("正方形页 = 图宽本身", () => {
    expect(thumbSlotHeight({ width: 100, height: 100 })).toBe(THUMB_IMAGE_WIDTH);
  });

  it("横版页矮于竖版页（比例守恒——不是「所有页同高」）", () => {
    expect(thumbSlotHeight(A4_LANDSCAPE)).toBeLessThan(thumbSlotHeight(A4));
  });

  it("比例守恒：槽位高/图宽 ≈ 页高/页宽（取整容差 ≤1%）", () => {
    const slot = thumbSlotHeight(A4);
    expect(Math.abs(slot / THUMB_IMAGE_WIDTH - A4.height / A4.width) / (A4.height / A4.width)).toBeLessThan(0.01);
  });
});

describe("thumbRenderScale：位图倍率 = 图宽 / 页宽", () => {
  it("页宽恰等于图宽 ⇒ 倍率 1（等价于「不放大也不缩小」）", () => {
    expect(thumbRenderScale({ width: THUMB_IMAGE_WIDTH, height: 100 })).toBe(1);
  });

  it("A4 竖版 ≈ 0.2723（162/595）", () => {
    expect(thumbRenderScale(A4)).toBeCloseTo(0.27227, 5);
  });

  it("🔴 分母是 `THUMB_IMAGE_WIDTH`（位图宽），⛔ 不是槽位宽 `THUMB_WIDTH`", () => {
    // 槽位含两侧各 1px 描边；拿槽位宽当分母会让位图正好溢出描边 2px
    expect(THUMB_WIDTH).toBe(THUMB_IMAGE_WIDTH + 2);
    expect(thumbRenderScale({ width: THUMB_WIDTH, height: 1 })).not.toBe(1);
    expect(thumbRenderScale({ width: THUMB_WIDTH, height: 1 })).toBeLessThan(1);
  });

  it("横向 A4 的倍率小于竖版 A4（同样是 162px 宽的框，原页越宽倍率越小）", () => {
    expect(thumbRenderScale(A4_LANDSCAPE)).toBeLessThan(thumbRenderScale(A4));
  });
});
