/** 连续滚动布局纯函数单测（页码 1-based；gap 与 CSS 同源常量语义） */
import { describe, expect, it } from "vitest";
import { pageAt, pageOffsets, visibleRange, windowRange } from "../utils/pagination";

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
  it("边界逐像素：页底那一像素仍归本页，下一页的顶边那一像素才换页", () => {
    expect(pageAt(115, offsets, heights, GAP)).toBe(1); // 第 1 页占 [16,116)
    expect(pageAt(116, offsets, heights, GAP)).toBe(1); // 底边之后是 gap，仍归第 1 页
    expect(pageAt(131, offsets, heights, GAP)).toBe(1);
    expect(pageAt(132, offsets, heights, GAP)).toBe(2); // 第 2 页顶边
    expect(pageAt(347, offsets, heights, GAP)).toBe(2);
    expect(pageAt(348, offsets, heights, GAP)).toBe(3);
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

  it("可视高为 0（折叠/未测量）时首尾同页，⛔ 不给「last < first」这种倒区间", () => {
    expect(visibleRange(16, 0, offsets, heights, GAP)).toEqual({ first: 1, last: 1 });
    expect(visibleRange(348, 0, offsets, heights, GAP)).toEqual({ first: 3, last: 3 });
  });

  it("last 恒 ≥ first（渲染窗口拿它往两边放宽，倒区间会把窗口算空）", () => {
    for (const [top, h] of [[0, 0], [120, 1], [200, 9000], [9999, 10]] as const) {
      const r = visibleRange(top, h, offsets, heights, GAP);
      expect(r.last).toBeGreaterThanOrEqual(r.first);
    }
  });

  it("空文档回 {1,1}（调用方不必先判空）", () => {
    expect(visibleRange(0, 500, [], [], GAP)).toEqual({ first: 1, last: 1 });
  });
});

describe("windowRange：渲染窗口（可视区 ± buffer，夹在 [1, numPages]）", () => {
  it("中段：两侧各放宽 buffer 页", () => {
    expect(windowRange({ first: 5, last: 7 }, 20, 2)).toEqual({ first: 3, last: 9 });
  });

  it("首端：夹在 1（⛔ 不出现第 0 页/负页）", () => {
    expect(windowRange({ first: 1, last: 3 }, 20, 2)).toEqual({ first: 1, last: 5 });
    expect(windowRange({ first: 2, last: 2 }, 20, 2)).toEqual({ first: 1, last: 4 });
  });

  it("末端：夹在 numPages（⛔ 不越过文档末尾）", () => {
    expect(windowRange({ first: 18, last: 20 }, 20, 2)).toEqual({ first: 16, last: 20 });
    expect(windowRange({ first: 20, last: 20 }, 20, 2)).toEqual({ first: 18, last: 20 });
  });

  it("buffer = 0 ⇒ 原样返回（可视区本身就是要渲染的那批）", () => {
    expect(windowRange({ first: 4, last: 6 }, 20, 0)).toEqual({ first: 4, last: 6 });
  });

  it("buffer 大于整本文档 ⇒ 整本都进窗口（不越界、不重复）", () => {
    expect(windowRange({ first: 1, last: 3 }, 3, 50)).toEqual({ first: 1, last: 3 });
  });

  it("单页文档：任何窗口都落在第 1 页", () => {
    expect(windowRange({ first: 1, last: 1 }, 1, 2)).toEqual({ first: 1, last: 1 });
  });

  it("首屏（可视区=第 1 页）在 30 页文档上要前 3 页——侧栏「位图只画窗口内 ±2」的计数口径", () => {
    const { first, last } = windowRange({ first: 1, last: 1 }, 30, 2);
    expect([first, last]).toEqual([1, 3]);
    expect(last - first + 1).toBe(3);
  });
});
