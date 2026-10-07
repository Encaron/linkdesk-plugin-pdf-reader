/**
 * 文本层与命中定位单测（T5）——测的是**纯函数契约**：偏移表、匹配、命中→文本项映射。
 *
 * 🔴 这一组的价值全在「坐标系」上：搜索在**整页文本**坐标里出下标，文本层高亮要的是
 * **项内**下标（每项一个 span）。两者换算错一格，症状是「命中框整体偏移几个字」——肉眼像
 * 「差一点点」，实机却不报任何错。所以这里逐条钉住偏移，⛔ 不靠实机目测。
 * DOM 两半（applyHighlights / clearHighlights）用 jsdom 建真节点：拆 span 与复原必须是
 * 双向可逆的（复原靠 `itemsStr` 而不是 DOM 快照，见 highlight.ts 头注）。
 */
import { describe, expect, it } from "vitest";
import {
  HIT_CLASS,
  HIT_CURRENT_CLASS,
  applyHighlights,
  buildPageText,
  clearHighlights,
  findMatches,
  hitClassName,
  planHighlights,
} from "../services/textLayer";
import type { HighlightRange } from "../services/textLayer";

describe("buildPageText：整页文本与起始偏移表", () => {
  it("行尾（hasEOL）补 \\n，starts 逐项记下真实起点（⛔ 不是「项长累加」）", () => {
    const page = buildPageText([
      { str: "Hello world", hasEOL: true },
      { str: "second line", hasEOL: true },
    ]);
    expect(page.text).toBe("Hello world\nsecond line\n");
    expect(page.starts).toEqual([0, 12]);
  });

  it("🔴 补 \\n 的理由：不补的话行尾词与下一行首词会粘成一个词（假命中）", () => {
    const glued = buildPageText([{ str: "end" }, { str: "Start" }]);
    expect(glued.text).toBe("endStart");
    const split = buildPageText([{ str: "end", hasEOL: true }, { str: "Start" }]);
    expect(split.text).toBe("end\nStart");
    expect(findMatches(split.text, "endStart")).toHaveLength(0);
  });

  it("markedContent 标记项（str 不是字符串）跳过且不影响别人偏移——与 pdf.js textDivs 逐项对齐", () => {
    const page = buildPageText([{ str: undefined }, { str: "ab" }, {}, { str: "cd" }]);
    expect(page.text).toBe("abcd");
    expect(page.starts).toEqual([0, 2]); // 两个标记项没有占位，ab 仍在 0、cd 仍在 2
  });
});

describe("findMatches：原串坐标系里的子串匹配", () => {
  it("大小写不敏感，且下表取自**原串**（⛔ 不是小写化后的串）", () => {
    const out = findMatches("Hello hello HELLO", "hello");
    expect(out.map((m) => m.index)).toEqual([0, 6, 12]);
    expect(out.every((m) => m.length === 5)).toBe(true);
  });

  it("查询串里的正则元字符当字面量（用户随手敲的括号不该当语法）", () => {
    expect(findMatches("a.c abc", ".")).toEqual([{ index: 1, length: 1 }]);
    expect(findMatches("f(x)", "(x)")).toEqual([{ index: 1, length: 3 }]);
    expect(findMatches("a*b", "*")).toEqual([{ index: 1, length: 1 }]);
  });

  it("单页命中上限：病态文档截断而不铺满 DOM", () => {
    expect(findMatches("aaaa", "a", 2)).toHaveLength(2);
    expect(findMatches("aaaa", "a")).toHaveLength(4);
  });

  it("空查询/无命中都给空表（空串不是「搜空白串」）", () => {
    expect(findMatches("abc", "")).toEqual([]);
    expect(findMatches("", "abc")).toEqual([]);
    expect(findMatches("abc", "zzz")).toEqual([]);
  });

  it("相邻命中不吞字（lastIndex 由正则自管，⛔ 不手工跳一字）", () => {
    expect(findMatches("aaaa", "aa").map((m) => m.index)).toEqual([0, 2]); // 非重叠：0 与 2
  });
});

describe("planHighlights：命中 → 文本项覆盖区间（坐标系换算的唯一落点）", () => {
  const page = buildPageText([
    { str: "Hello world", hasEOL: true },
    { str: "second line", hasEOL: true },
  ]);

  it("单项内命中：区间落在该项，下标是项内下标", () => {
    const ranges = planHighlights(["Hello world", "second line"], page.starts, [
      { index: 6, length: 5, matchIdx: 0 },
    ]);
    expect(ranges).toEqual<HighlightRange[]>([{ divIdx: 0, from: 6, to: 11, matchIdx: 0 }]);
  });

  it("跨项命中拆成两段（各自落在自己的项里）——「world\\nsecond」这类选择跨行时必然发生", () => {
    const idx = page.text.indexOf("world\nsecond");
    expect(idx).toBe(6);
    const ranges = planHighlights(["Hello world", "second line"], page.starts, [
      { index: idx, length: "world\nsecond".length, matchIdx: 3 },
    ]);
    expect(ranges).toEqual<HighlightRange[]>([
      { divIdx: 0, from: 6, to: 11, matchIdx: 3 },
      { divIdx: 1, from: 0, to: 6, matchIdx: 3 },
    ]);
  });

  it("起点落在补齐的 \\n 之后：区间归到该项，⛔ 不从上一项的尾巴起算", () => {
    // 「second」在整页文本里的起点是 12（11 是补出来的 \n）
    const ranges = planHighlights(["Hello world", "second line"], page.starts, [
      { index: 12, length: 6, matchIdx: 0 },
    ]);
    expect(ranges).toEqual<HighlightRange[]>([{ divIdx: 1, from: 0, to: 6, matchIdx: 0 }]);
  });

  it("matchIdx 原样带下去（高亮层靠它认「当前那一处」）", () => {
    const ranges = planHighlights(["ab"], [0], [
      { index: 0, length: 1, matchIdx: 7 },
      { index: 1, length: 1, matchIdx: 8 },
    ]);
    expect(ranges.map((r) => r.matchIdx)).toEqual([7, 8]);
  });

  it("越界命中（下标落在表外）不抛也不算区间", () => {
    expect(planHighlights(["ab"], [0], [{ index: 99, length: 3, matchIdx: 0 }])).toEqual([]);
  });
});

describe("高亮落 DOM：applyHighlights / clearHighlights（双向可逆）", () => {
  function divsOf(texts: readonly string[]): HTMLElement[] {
    return texts.map((t) => {
      const div = document.createElement("span");
      div.textContent = t;
      return div;
    });
  }

  it("命中子串包进 span，父项 textContent 一字不变（划选/复制与 pdf.js 的字宽度量都不受影响）", () => {
    const texts = ["Hello world", "second line"];
    const divs = divsOf(texts);
    applyHighlights(divs, texts, [{ divIdx: 0, from: 6, to: 11, matchIdx: 0 }], 0);
    expect(divs[0].textContent).toBe("Hello world");
    const mark = divs[0].querySelector(`.${HIT_CLASS}`);
    expect(mark?.textContent).toBe("world");
    expect(divs[1].querySelectorAll("span")).toHaveLength(0); // 没命中的项一个字都不动
  });

  it("当前命中另加复合状态类（`current` 那处换底色）", () => {
    const texts = ["ab cd"];
    const divs = divsOf(texts);
    applyHighlights(
      divs,
      texts,
      [
        { divIdx: 0, from: 0, to: 2, matchIdx: 0 },
        { divIdx: 0, from: 3, to: 5, matchIdx: 1 },
      ],
      1,
    );
    expect(divs[0].querySelectorAll(`.${HIT_CLASS}`)).toHaveLength(2);
    expect(divs[0].querySelectorAll(`.${HIT_CURRENT_CLASS}`)).toHaveLength(1);
    expect(divs[0].querySelector(`.${HIT_CURRENT_CLASS}`)?.textContent).toBe("cd");
    expect(divs[0].textContent).toBe("ab cd");
  });

  it("🔴 连标两次不套两层（读时先 clear、⛔ 不叠着画）", () => {
    const texts = ["Hello world"];
    const divs = divsOf(texts);
    applyHighlights(divs, texts, [{ divIdx: 0, from: 0, to: 5, matchIdx: 0 }], 0);
    clearHighlights(divs, texts);
    applyHighlights(divs, texts, [{ divIdx: 0, from: 6, to: 11, matchIdx: 1 }], 1);
    expect(divs[0].querySelectorAll("span")).toHaveLength(1);
    expect(divs[0].querySelector("span")?.textContent).toBe("world");
    expect(divs[0].textContent).toBe("Hello world");
  });

  it("clearHighlights 复原成**单个文本节点**（不是一堆碎片）", () => {
    const texts = ["Hello world"];
    const divs = divsOf(texts);
    applyHighlights(divs, texts, [{ divIdx: 0, from: 0, to: 5, matchIdx: 0 }], 0);
    clearHighlights(divs, texts);
    expect(divs[0].childNodes).toHaveLength(1);
    expect(divs[0].firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(divs[0].textContent).toBe("Hello world");
  });

  it("改查询后残影不留：旧命中项上清得干净（clear 先于 apply 的理由）", () => {
    const texts = ["alpha beta"];
    const divs = divsOf(texts);
    applyHighlights(divs, texts, [{ divIdx: 0, from: 0, to: 5, matchIdx: 0 }], 0);
    clearHighlights(divs, texts);
    applyHighlights(divs, texts, [], -1); // 新查询在这一页零命中
    expect(divs[0].querySelectorAll("span")).toHaveLength(0);
    expect(divs[0].textContent).toBe("alpha beta");
  });

  it("空区间表/坏下标不抛（越界不判死，也不清空那一项）", () => {
    const texts = ["ab"];
    const divs = divsOf(texts);
    expect(() => applyHighlights(divs, texts, [], -1)).not.toThrow();
    expect(() => applyHighlights(divs, texts, [{ divIdx: 5, from: 0, to: 1, matchIdx: 0 }], -1)).not.toThrow();
    expect(() => applyHighlights(divs, texts, [{ divIdx: 0, from: 9, to: 12, matchIdx: 0 }], -1)).not.toThrow();
    expect(divs[0].textContent).toBe("ab");
  });

  it("hitClassName：当前命中是复合状态类（与本类同名叠加，⛔ 不单飞）", () => {
    expect(hitClassName(false)).toBe(HIT_CLASS);
    expect(hitClassName(true)).toBe(`${HIT_CLASS} ${HIT_CURRENT_CLASS}`);
  });
});
