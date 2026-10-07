/** 连续滚动布局纯函数单测（页码 1-based；gap 与 CSS 同源常量语义） */
import { describe, expect, it } from "vitest";
import { pageAt, pageOffsets, visibleRange } from "../utils/pagination";

const GAP = 16;
// 三页，高 100/200/300：offsets = [16, 132, 348]
const heights = [100, 200, 300];
const offsets = pageOffsets(heights, GAP);

describe("pageOffsets", () => {
  it("首页顶边 = gap，其后累加高度＋gap", () => {
    expect(offsets).toEqual([16, 132, 348]);
  });
});

describe("pageAt", () => {
  it("按容器坐标找页（1-based）", () => {
    expect(pageAt(0, offsets, heights, GAP)).toBe(1); // 首页之前的留白 → 第 1 页
    expect(pageAt(16, offsets, heights, GAP)).toBe(1);
    expect(pageAt(147, offsets, heights, GAP)).toBe(2); // 第 2 页中部
    expect(pageAt(400, offsets, heights, GAP)).toBe(3);
  });
  it("页间 gap 归前一页，末页之后夹回末页", () => {
    expect(pageAt(120, offsets, heights, GAP)).toBe(1); // 116–132 是第 1 页后的 gap
    expect(pageAt(9999, offsets, heights, GAP)).toBe(3);
  });
  it("空文档回 0", () => {
    expect(pageAt(0, [], [], GAP)).toBe(0);
  });
});

describe("visibleRange", () => {
  it("可视区覆盖的页（首尾可只露一角）", () => {
    expect(visibleRange(0, 200, offsets, heights, GAP)).toEqual({ first: 1, last: 2 });
    expect(visibleRange(140, 100, offsets, heights, GAP)).toEqual({ first: 2, last: 2 });
    expect(visibleRange(340, 500, offsets, heights, GAP)).toEqual({ first: 2, last: 3 }); // 340 在第 2 页后的 gap（归第 2 页）
  });
});
