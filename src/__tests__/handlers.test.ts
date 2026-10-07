/**
 * 命令 handler 单测（T4）——测的是**对外契约**（回执三态 ＋ 点名口径），⛔ 不是 store 实现。
 *
 * 替身口径：用**真** `createReaderStore()`——它一建出来就停在 loading 相位（没跑 `open()`），
 * 正好把「一份都没挂」「点名的找不到」「还在加载」三条回执，与「不需要文档就该能设」的那族
 * （缩放档/倍率/底色/侧栏）一并覆盖，全程不需要 pdf.js 出一份真文档。
 * 真文档那一半归实机验收（linkdeskctl exec 逐条打真回执）。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  fitPage,
  fitWidth,
  getStatus,
  gotoPage,
  pageNext,
  pagePrev,
  setBackground,
  toggleSidebar,
  zoomIn,
  zoomOut,
  zoomTo,
} from "../commands/handlers";
import { attachReaderStore, detachReaderStore } from "../services/readerBridge";
import { createReaderStore } from "../views/readerStore";

const SID = "C:/docs/a.pdf";

/** 挂一份阅读器（loading 相位）——用完 afterEach 销号（命令桥是模块级单例，测试之间必须干净） */
function withReader() {
  const store = createReaderStore();
  attachReaderStore(SID, store);
  return store;
}

afterEach(() => {
  detachReaderStore(SID);
});

describe("没有目标时（一份阅读器都没挂）", () => {
  it("🔴 同一份文件开两份视图（两个分组/窗口）：关掉后挂的那份，先挂的那份仍够得着（⛔ 不许答 no-document）", async () => {
    const first = createReaderStore();
    const second = createReaderStore();
    attachReaderStore(SID, first);
    attachReaderStore(SID, second);
    second.setBackground("night"); // 认人：寻址落在**后挂**的那份上（最近打开的视图）
    expect(await getStatus()).toMatchObject({ ok: true, sourceId: SID, bg: "night" });
    detachReaderStore(SID, second); // 按实例销号——先挂的那份不许被连坐
    expect(await getStatus()).toMatchObject({ ok: true, sourceId: SID, bg: "paper" });
    detachReaderStore(SID, first);
    expect(await getStatus()).toMatchObject({ ok: true, noop: true, reason: "no-document" });
  });
  it("getStatus 如实答「空」而不是失败——ok:true ＋ hasDocument:false（规范 §7.3 读命令：空 ≠ 失败）", async () => {
    const reply = await getStatus();
    expect(reply).toMatchObject({
      ok: true,
      noop: true,
      reason: "no-document",
      hasDocument: false,
      phase: "none",
    });
  });

  it("动作命令回「不是失败」那档（ok:true ＋ noop ＋ 指路），⛔ 不吞成成功", async () => {
    for (const reply of [await pageNext(), await pagePrev(), await toggleSidebar(), await fitPage()]) {
      expect(reply).toMatchObject({ ok: true, noop: true, reason: "no-document" });
      expect(String(reply.error)).toContain("单击一个 .pdf");
    }
  });
});

describe("点名（sourceId）——点名必须命中，⛔ 不静默回退", () => {
  it("点中了就用它（回执把 sourceId 交回，多标签下才知道是谁答的）", async () => {
    withReader();
    const reply = await pageNext({ sourceId: SID });
    expect(reply).toMatchObject({ ok: true, noop: true, reason: "loading", sourceId: SID });
  });

  it("点了名找不到 ⇒ ok:false ＋ bad-source，并把**现有的**列出来", async () => {
    withReader();
    const reply = await getStatus({ sourceId: "C:/docs/nope.pdf" });
    expect(reply).toMatchObject({ ok: false, noop: true, reason: "bad-source" });
    expect(String(reply.error)).toContain(SID);
  });

  it("sourceId 不是非空字符串也判 bad-source（坏载荷不抛）", async () => {
    withReader();
    for (const bad of [5, true, "   ", []]) {
      const reply = await pageNext({ sourceId: bad });
      expect(reply).toMatchObject({ ok: false, noop: true, reason: "bad-source" });
    }
  });

  it("逐位形态的数字载荷**不当点名**（gotoPage(3) 的 3 是页码，不是 sourceId）", async () => {
    withReader();
    const reply = await gotoPage(3);
    expect(reply.reason).toBe("loading"); // 若把 3 当点名读，这里会是 bad-source
  });
});

describe("翻页族的前提门（文档还没就绪）", () => {
  it("loading 相位：翻页回「不是失败」那档并说明为什么", async () => {
    withReader();
    const reply = await pageNext();
    expect(reply).toMatchObject({ ok: true, noop: true, reason: "loading", sourceId: SID });
    expect(String(reply.error)).toContain("还在加载");
  });

  it("gotoPage 先判**载荷类型**（坏载荷不该被相位门挡住）", async () => {
    withReader();
    expect(await gotoPage({ page: "3" })).toMatchObject({ ok: false, reason: "bad-page" });
    expect(await gotoPage({ page: 2.5 })).toMatchObject({ ok: false, reason: "bad-page" });
    expect(await gotoPage({})).toMatchObject({ ok: false, reason: "bad-page" });
  });
});

describe("缩放族（文档未就绪也能设——视图态，就绪后按已设的档重算）", () => {
  it("zoomIn/zoomOut 走同一份动作并读回倍率", async () => {
    withReader();
    const up = await zoomIn();
    expect(up).toMatchObject({ ok: true, field: "scale", previous: 1, zoomMode: "percent" });
    expect(up.value).toBeCloseTo(1.2);
    const down = await zoomOut();
    expect(down).toMatchObject({ ok: true, field: "scale", previous: up.value });
    expect(down.value).toBeCloseTo(1);
  });

  it("zoomTo：bad-scale / out-of-range / 命中 / 本来就那个倍率", async () => {
    withReader();
    for (const bad of ["1.5", 0, -1, Number.NaN, undefined]) {
      expect(await zoomTo({ scale: bad })).toMatchObject({ ok: false, noop: true, reason: "bad-scale" });
    }
    expect(await zoomTo({ scale: 9 })).toMatchObject({ ok: false, noop: true, reason: "out-of-range" });
    expect(await zoomTo({ scale: 1.5 })).toMatchObject({ ok: true, field: "scale", previous: 1, value: 1.5 });
    expect(await zoomTo(1.5)).toMatchObject({ ok: true, noop: true, reason: "already-at-scale" }); // 逐位形态等价
  });

  it("适宽/适页：出厂就是适宽 ⇒ 如实回 noop；切到适页回 {previous, value}", async () => {
    withReader();
    expect(await fitWidth()).toMatchObject({ ok: true, noop: true, reason: "already-fit-width", value: "fitWidth" });
    expect(await fitPage()).toMatchObject({ ok: true, field: "zoomMode", previous: "fitWidth", value: "fitPage" });
    expect(await fitPage()).toMatchObject({ ok: true, noop: true, reason: "already-fit-page" });
  });
});

describe("底色与侧栏（翻转类回执带翻转后读回的值）", () => {
  it("setBackground：命中 / 本来就是这个档 / 档位非法", async () => {
    withReader();
    expect(await setBackground({ bg: "night" })).toMatchObject({ ok: true, field: "bg", previous: "paper", value: "night" });
    expect(await setBackground("night")).toMatchObject({ ok: true, noop: true, reason: "already-night" });
    for (const bad of ["sepia", "", 1, undefined]) {
      expect(await setBackground({ bg: bad })).toMatchObject({ ok: false, noop: true, reason: "bad-bg" });
    }
  });

  it("🔴 自带载荷的命令：逐位那一位是**载荷**，⛔ 不当点名（否则 setBackground(\"night\") 会被判 bad-source）", async () => {
    withReader();
    // 三条载荷命令的逐位形态全部照常命中——点名只走 { sourceId } 具名形态
    expect(await setBackground("night")).toMatchObject({ ok: true, field: "bg", value: "night" });
    expect(await zoomTo(2)).toMatchObject({ ok: true, field: "scale", value: 2 });
    expect(await gotoPage(1)).toMatchObject({ ok: true, noop: true, reason: "loading" });
    // 载荷命令的逐位字符串**不会**被读成 sourceId：真传个路径进去也一样落「载荷非法」而不是「找不到阅读器」
    expect(await setBackground("C:/docs/a.pdf")).toMatchObject({ ok: false, noop: true, reason: "bad-bg" });
    // 对照：无载荷命令的逐位字符串**就是**点名（这一维由上面的「非字符串 sourceId」用例守着）
    expect(await getStatus("C:/docs/a.pdf")).toMatchObject({ ok: true, sourceId: SID });
  });

  it("toggleSidebar：previous ← value，一来一回", async () => {
    withReader();
    expect(await toggleSidebar()).toMatchObject({ ok: true, field: "sidebarOpen", previous: false, value: true });
    expect(await toggleSidebar()).toMatchObject({ ok: true, field: "sidebarOpen", previous: true, value: false });
  });

  it("getStatus 读的就是状态条那份数据（同一 getStatus 源）", async () => {
    withReader();
    const store = createReaderStore();
    attachReaderStore(SID, store);
    store.setBackground("night");
    store.toggleSidebar();
    const reply = await getStatus();
    expect(reply).toMatchObject({
      ok: true,
      sourceId: SID,
      hasDocument: false,
      phase: "loading",
      currentPage: 1,
      numPages: 0,
      scale: 1,
      zoomMode: "fitWidth",
      bg: "night",
      sidebarOpen: true,
    });
  });
});
