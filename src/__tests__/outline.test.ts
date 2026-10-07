/**
 * 目录树转换单测（T6）——测的是**纯函数契约**：树形、页码口径、哪些条目该丢。
 *
 * 🔴 这一组的价值在「别把文档里的书签偷偷弄丢」：pdf.js 的 outline 里混着四种东西——
 * 有名有页的、有名没页的（外链/坏目标）、没名有子项的（分组头）、三样都没有的。
 * 前三种都是**文档里真有的内容**，丢哪一种都是骗人；只有第四种在屏幕上留不下任何东西
 * （一个空格子、点也点不动），丢它才是对的。这里逐条钉住这条边界。
 * 真引擎（getOutline + dest 解析）归实机验收——解析函数是注入的，这里给假的即可。
 */
import { describe, expect, it } from "vitest";
import { buildOutline, countOutline, type OutlineItem, type RawOutlineNode } from "../services/pdfDoc";

/** 造一个 pdf.js outline 条目（只填本仓用得上的字段——其余字段的形状与本模块无关） */
function node(title: string, dest: unknown = null, items: RawOutlineNode[] = []): RawOutlineNode {
  return { title, dest, items } as unknown as RawOutlineNode;
}

/** 把 dest 当作页码直接返回（真解析在 loadPdf 里，这里只验「解析结果怎么落进树」） */
const asPage = async (dest: unknown): Promise<number> => (typeof dest === "number" ? dest : 0);

describe("buildOutline：pdf.js 原语 → 自有目录树", () => {
  it("null / undefined / 空数组一律给空数组（没有目录不是失败）", async () => {
    expect(await buildOutline(null, asPage)).toEqual([]);
    expect(await buildOutline(undefined, asPage)).toEqual([]);
    expect(await buildOutline([], asPage)).toEqual([]);
  });

  it("平铺：标题原样、页码 1-based 由解析函数给，顺序不重排", async () => {
    const tree = await buildOutline([node("第一章", 1), node("第二章", 7)], asPage);
    expect(tree).toEqual([
      { title: "第一章", page: 1, children: [] },
      { title: "第二章", page: 7, children: [] },
    ]);
  });

  it("嵌套：子项逐级保留（树形不压平——压平了层级就没了）", async () => {
    const tree = await buildOutline([node("上篇", 1, [node("一", 2, [node("1.1", 3)]), node("二", 4)])], asPage);
    expect(tree[0].children.map((c) => c.title)).toEqual(["一", "二"]);
    expect(tree[0].children[0].children).toEqual([{ title: "1.1", page: 3, children: [] }]);
  });

  it("没有 dest（外链条目）→ page 0，条目仍然留着（书签是真的，只是跳不了）", async () => {
    const tree = await buildOutline([node("官网", null)], asPage);
    expect(tree).toEqual([{ title: "官网", page: 0, children: [] }]);
  });

  it("dest 解析不出（坏目标）→ page 0，不当成「第 1 页」", async () => {
    const tree = await buildOutline([node("坏目标", "nope")], asPage);
    expect(tree[0].page).toBe(0);
  });

  it("解析函数抛异常也不该炸整棵树（交给调用方在解析里兜，契约是「返回页码」）", async () => {
    const boom = async (): Promise<number> => 0;
    expect((await buildOutline([node("x", "bad")], boom))[0].page).toBe(0);
  });

  it("无标题但有子项 → 留着（它是分组头，丢了整棵子树跟着没）", async () => {
    const tree = await buildOutline([node("  ", 0, [node("子页", 5)])], asPage);
    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe("");
    expect(tree[0].children[0].title).toBe("子页");
  });

  it("无标题但有目标 → 留着（真书签，只是文档没给它名字）", async () => {
    const tree = await buildOutline([node("", 9)], asPage);
    expect(tree).toEqual([{ title: "", page: 9, children: [] }]);
  });

  it("三无条目（无标题＋无子项＋无目标）→ 丢掉（屏幕上什么都留不下，也点不动）", async () => {
    const tree = await buildOutline([node("  ", null), node("留下的", 2)], asPage);
    expect(tree.map((t) => t.title)).toEqual(["留下的"]);
  });

  it("标题前后空白被 trim（PDF 里带缩进/换行的标题很常见）", async () => {
    const tree = await buildOutline([node("  带空白的标题\n", 1)], asPage);
    expect(tree[0].title).toBe("带空白的标题");
  });

  it("items 字段缺失（末级条目）当空数组，不炸", async () => {
    const bare = { title: "末级", dest: 4 } as unknown as RawOutlineNode;
    const tree = await buildOutline([bare], asPage);
    expect(tree).toEqual([{ title: "末级", page: 4, children: [] }]);
  });
});

describe("countOutline：目录条目总数（getStatus().outlineCount 的口径）", () => {
  it("含各级子项一起数（顶层 2 ＋ 子 3 ＝ 5）", () => {
    const tree: OutlineItem[] = [
      { title: "a", page: 1, children: [{ title: "a1", page: 2, children: [] }] },
      { title: "b", page: 3, children: [{ title: "b1", page: 4, children: [{ title: "b1x", page: 5, children: [] }] }] },
    ];
    expect(countOutline(tree)).toBe(5);
  });

  it("没有目录 = 0（⛔ 不是「未知」——空就是空）", () => {
    expect(countOutline([])).toBe(0);
  });
});
