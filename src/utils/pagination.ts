/**
 * 连续滚动布局纯函数（单测主战场）。
 * 布局口径：第 i 页顶边 = offsets[i]；页卡片之间与首尾留白都是 gap（CSS 与这里共用同一常量）。
 * 页码一律 1-based，这里数组下标 0-based 只在函数内部换算。
 */
export function pageOffsets(heights: number[], gap: number): number[] {
  const offsets: number[] = new Array(heights.length);
  let acc = gap;
  for (let i = 0; i < heights.length; i++) {
    offsets[i] = acc;
    acc += heights[i] + gap;
  }
  return offsets;
}

/** y 落在哪一页（页 i 占 [offsets[i], offsets[i]+heights[i]+gap)）；越界夹回首/末页。y、offsets 同为容器坐标。 */
export function pageAt(y: number, offsets: number[], heights: number[], gap: number): number {
  if (offsets.length === 0) return 0;
  // 二分：最大的 i 使 offsets[i] <= y
  let lo = 0;
  let hi = offsets.length - 1;
  if (y < offsets[0]) return 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  // 落在末页之后的空档 → 末页
  const lastBottom = offsets[lo] + heights[lo] + gap;
  return y >= lastBottom ? offsets.length : lo + 1;
}

/** 可视区间覆盖的页（首尾都可能只露一角） */
export function visibleRange(
  scrollTop: number,
  viewHeight: number,
  offsets: number[],
  heights: number[],
  gap: number,
): { first: number; last: number } {
  if (offsets.length === 0) return { first: 1, last: 1 };
  const first = pageAt(scrollTop, offsets, heights, gap);
  const last = pageAt(scrollTop + Math.max(0, viewHeight - 1), offsets, heights, gap);
  return { first, last: Math.max(first, last) };
}

/**
 * 把可视区间朝两侧各放宽 `buffer` 页，并夹在 [1, numPages] 内——**渲染窗口**的唯一定义处。
 *
 * 阅读区（位图挂载）与缩略图条（位图挂载）此前各自内联了三份同样的 `Math.max/Math.min`，
 * 而 `buffer` 的语义是「滚向哪边就先把哪边预渲染好」：**放宽方向必须是可视区间之外**，
 * 误写成从窗口自身放宽会白渲染、且边界页（1 / numPages）容易越界——这里收成一处，
 * 内联副本一律改调本函数（⛔ 不再各写一份）。
 */
export function windowRange(
  win: { first: number; last: number },
  numPages: number,
  buffer: number,
): { first: number; last: number } {
  return {
    first: Math.max(1, win.first - buffer),
    last: Math.min(numPages, win.last + buffer),
  };
}
