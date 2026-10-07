/**
 * 目录目标（`dest`）→ 页码单测（T7）——**三条 dest 分支逐条钉住**。
 *
 * 为什么单独抽这一组：T6 的实机读数只能证明「那份夹具文档恰好走哪一支」（三份手工 PDF 各点一次，
 * 那是三次读数、不是判据），而一份夹具**不可能同时长成**「页对象引用 / 具名 / 0-based 整数」。
 * 真文档里三支都出现（老生成器爱用 0-based 整数），某支坏掉的症状只是「某几个目录条目点不动」，
 * 极易被当成「文档本来就没这本书签」而不报错——所以三支都得在这里红得起来。
 *
 * 替身照**契约不照实现**：`DestDocument` 只有两位（`getDestination` / `getPageIndex`），
 * ⛔ 不铺 pdf.js 的几十个成员（没起真引擎也不影响判据——判定逻辑全在本仓这一层）。
 */
import { describe, expect, it, vi } from "vitest";
import { destResolver, resolveDestPage, type DestDocument } from "../services/pdfDoc";

/** 造一个假页对象引用（pdf.js 的 `Ref`：`{num, gen}`——本模块只当黑盒透传给 getPageIndex） */
const ref = (num: number) => ({ num, gen: 0 });

/**
 * 假文档面。`pageIndex` 缺省时**抛**（模拟 pdf.js 对指向已删对象的 ref 的行为），
 * 这样「解析不出」的路径走的是真分支（catch），而不是替身偷偷返回 0 把风险藏起来。
 */
function makeDoc(opts: {
  named?: Record<string, unknown>;
  pageIndex?: (r: unknown) => number | Promise<number>;
} = {}): DestDocument {
  return {
    async getDestination(name) {
      return opts.named && name in opts.named ? opts.named[name] : null;
    },
    async getPageIndex(r) {
      if (opts.pageIndex) return opts.pageIndex(r);
      throw new Error(`no such ref: ${JSON.stringify(r)}`);
    },
  };
}

describe("resolveDestPage：三种 dest 形都认", () => {
  it("① 页对象引用（主流写法 `[3 0 R /Fit]`）——getPageIndex 的 0-based 页序 +1", async () => {
    // ⚠️ 引用是**黑盒透传**：替身按 `num` 认，⛔ 别拿对象身份比（每次 `ref()` 都是新对象）
    const doc = makeDoc({ pageIndex: (r) => ((r as { num?: number })?.num === 5 ? 2 : -1) });
    expect(await resolveDestPage(doc, [ref(5), { name: "Fit" }])).toBe(3);
  });

  it("② 具名目标（`/Dest /chap2`）——先 getDestination 换开，再按换出来的数组走", async () => {
    const doc = makeDoc({
      named: { chap2: [ref(9), { name: "XYZ", args: [0, 800, 0] }] },
      pageIndex: () => 2,
    });
    expect(await resolveDestPage(doc, "chap2")).toBe(3);
  });

  it("②′ 具名换出来的是 0-based 整数——换开之后仍要认整数式（两支护持才够）", async () => {
    const doc = makeDoc({ named: { chap3: [5, { name: "Fit" }] } });
    expect(await resolveDestPage(doc, "chap3")).toBe(6);
  });

  it("③ 0-based 页序数（老生成器写法 `[2 /Fit]`）——直接 +1，⛔ 不走 getPageIndex", async () => {
    const spy = vi.fn();
    const doc = makeDoc({ pageIndex: spy });
    expect(await resolveDestPage(doc, [2, { name: "Fit" }])).toBe(3);
    expect(spy).not.toHaveBeenCalled(); // 整数式去问文档要页序是错的调用（真引擎会抛）
  });

  it("首位是 0 的整数式给第 1 页（⛔ 别把 0 当成「解析不出」）", async () => {
    expect(await resolveDestPage(makeDoc(), [0, { name: "Fit" }])).toBe(1);
  });
});

describe("resolveDestPage：解析不出一律给 0（0 = 无目标，视图渲成不可点的行）", () => {
  it("非数组（pdf.js 归一后会出现的 null）", async () => {
    expect(await resolveDestPage(makeDoc(), null)).toBe(0);
  });

  it("空数组——没有首位可取", async () => {
    expect(await resolveDestPage(makeDoc(), [])).toBe(0);
  });

  it("首位是 null（`isValidExplicitDest` 滤剩下的残形）", async () => {
    expect(await resolveDestPage(makeDoc(), [null, { name: "Fit" }])).toBe(0);
  });

  it("首位是字符串——既不是整数式也不是页引用式，认不出来就给 0（⛔ 不瞎猜）", async () => {
    expect(await resolveDestPage(makeDoc(), ["Fit", 3])).toBe(0);
  });

  it("具名目标查不到（getDestination 给 null）", async () => {
    expect(await resolveDestPage(makeDoc(), "no-such-name")).toBe(0);
  });

  it("getDestination 抛（坏 dest 字典）", async () => {
    const doc: DestDocument = {
      async getDestination() {
        throw new Error("bad dest dictionary");
      },
      async getPageIndex() {
        throw new Error("unreachable");
      },
    };
    expect(await resolveDestPage(doc, "boom")).toBe(0);
  });

  it("getPageIndex 抛（指向已删对象）——⛔ 不让一条坏书签判死整棵树", async () => {
    const doc = makeDoc({
      pageIndex: () => {
        throw new Error("object 12 0 R does not exist");
      },
    });
    expect(await resolveDestPage(doc, [ref(12), { name: "Fit" }])).toBe(0);
  });
});

describe("destResolver：绑定文档的一次性解析器", () => {
  it("闭包里带着文档——逐条目录项调用时不必再传 doc", async () => {
    const doc = makeDoc({ pageIndex: () => 0 });
    const resolve = destResolver(doc);
    expect(await resolve([ref(1), { name: "Fit" }])).toBe(1);
    expect(await resolve(null)).toBe(0); // 同一个解析器两种形都要收
  });
});
