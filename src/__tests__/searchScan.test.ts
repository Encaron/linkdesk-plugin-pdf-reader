/**
 * 全文档搜索的 store 单测（T5）——测的是**扫页与定位**这段链路（视图与命令都靠它出读数）。
 *
 * 替身 = `helpers/fakePdf.ts` 的假文档（照 `PdfDocument` 契约造）。测这几条：
 *   · 逐页扫 + 命中表文档序（命中数边扫边长）；
 *   · 落点规则（从**当前页**起找第一条，往后没有就回文档头条）；
 *   · 上下导航环形回绕；
 *   · 单页取数失败跳过而不判死；
 *   · 换查询/关条/换文档清表；
 *   · 扫描中间态的读数（searchScanning / searchScannedPages）。
 * ⛔ 这里不测 pdf.js 真解析——归实机。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/pdfDoc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/pdfDoc")>();
  const { makeFakeDoc } = await import("./helpers/fakePdf");
  return { ...actual, loadPdf: async () => makeFakeDoc() };
});

import { broken, hanging, resetFake } from "./helpers/fakePdf";
import { createReaderStore } from "../views/readerStore";

const SID = "C:/docs/fake.pdf";

beforeEach(() => {
  resetFake();
});

async function openStore() {
  const store = createReaderStore();
  await store.open(SID);
  return store;
}

/** 等扫描落地（scanAll 是 void 出去的异步链，读数要等它跑完） */
async function settled(store: ReturnType<typeof createReaderStore>) {
  await vi.waitFor(() => expect(store.getStatus().searchScanning).toBe(false));
}

describe("全文档扫描", () => {
  it("逐页扫出文档序的命中表，落点取**当前页起的第一条**并跳过去", async () => {
    const store = await openStore();
    store.openSearch();
    store.setSearchQuery("hello");
    await settled(store);

    const st = store.getStatus();
    expect(st.searchQuery).toBe("hello");
    expect(st.searchHits).toBe(3); // 三页各一处
    expect(st.searchCurrent).toBe(1); // 当前页（第 1 页）就有 ⇒ 取它
    expect(st.searchScannedPages).toBe(3); // 总页数 = 假文档页数（⛔ 不是「扫了多少就有多少」）
    expect(store.getState().scrollTarget?.page).toBe(1);
  });

  it("🔴 当前页往后没有命中 ⇒ 回文档头一条（环形，⛔ 不停在「无当前」）", async () => {
    const store = await openStore();
    store.gotoPage(3); // 第 3 页（"hello nothing"）之后没有别的页了
    broken.add(3); // 第 3 页取不出来 ⇒ 命中只剩前两页，且都在当前页之前
    store.openSearch();
    store.setSearchQuery("hello");
    await settled(store);

    const st = store.getStatus();
    expect(st.searchHits).toBe(2);
    expect(st.searchCurrent).toBe(1); // 回绕到文档头一条
    expect(store.getState().scrollTarget?.page).toBe(1);
  });

  it("单页取数失败：跳过该页接着扫，⛔ 不判死整场（也⛔ 不进错误态）", async () => {
    broken.add(2);
    const store = await openStore();
    store.setSearchQuery("hello");
    await settled(store);

    const st = store.getStatus();
    expect(st.searchHits).toBe(2); // 第 2 页缺席，1/3 页照旧
    expect(store.getState().phase.kind).toBe("ready");
  });

  it("无命中：空表 ＋ current 归零（1-based 的 0 = 没有当前命中）", async () => {
    const store = await openStore();
    store.setSearchQuery("zzz");
    await settled(store);

    const st = store.getStatus();
    expect(st.searchHits).toBe(0);
    expect(st.searchCurrent).toBe(0);
    expect(store.searchStep(1)).toBe(false); // 没命中就是没动，⛔ 不假装跳过
  });

  it("大小写不敏感（查找族惯例：敲 hello 也要命中 Hello）", async () => {
    const store = await openStore();
    store.setSearchQuery("HELLO");
    await settled(store);
    expect(store.getStatus().searchHits).toBe(3);
  });
});

describe("上下导航（Enter / Shift+Enter）", () => {
  it("顺序下走、末尾回绕到第一处；上走对称", async () => {
    const store = await openStore();
    store.setSearchQuery("hello");
    await settled(store);

    expect(store.searchStep(1)).toBe(true);
    expect(store.getStatus().searchCurrent).toBe(2);
    expect(store.getState().scrollTarget?.page).toBe(2);

    expect(store.searchStep(1)).toBe(true);
    expect(store.getStatus().searchCurrent).toBe(3);

    expect(store.searchStep(1)).toBe(true);
    expect(store.getStatus().searchCurrent).toBe(1); // 末尾 → 第一处
    expect(store.getState().scrollTarget?.page).toBe(1);

    expect(store.searchStep(-1)).toBe(true);
    expect(store.getStatus().searchCurrent).toBe(3); // 第一处 → 末尾
  });

  it("每次走位都递增 jumpNonce（阅读区据此居中；⛔ 别的读数都不适合当触发）", async () => {
    const store = await openStore();
    store.setSearchQuery("hello");
    await settled(store);
    const before = store.getState().search.jumpNonce;
    store.searchStep(1);
    expect(store.getState().search.jumpNonce).toBe(before + 1);
  });
});

describe("清表（换查询 / 关条 / 换文档）", () => {
  it("查询改成空串：清命中表但留着条的开关（空串不是「搜空白串」）", async () => {
    const store = await openStore();
    store.openSearch();
    store.setSearchQuery("hello");
    await settled(store);
    store.setSearchQuery("   ");
    expect(store.getStatus()).toMatchObject({ searchOpen: true, searchHits: 0, searchCurrent: 0, searchScanning: false });
  });

  it("关条 = 连命中表一起清（⛔ 不留半份命中在背后）", async () => {
    const store = await openStore();
    store.openSearch();
    store.setSearchQuery("hello");
    await settled(store);
    store.closeSearch();
    expect(store.getStatus()).toMatchObject({ searchOpen: false, searchQuery: "", searchHits: 0 });
    expect(store.getState().search.hits).toEqual([]);
  });

  it("openSearch 幂等；关条后能再开（工具栏钮连点不翻）", async () => {
    const store = await openStore();
    const nonce = store.getState();
    store.openSearch();
    const after = store.getState();
    store.openSearch();
    expect(store.getState()).toBe(after); // 第二次没改动状态（⛔ 没白通知一次重渲）
    expect(nonce.search.open).toBe(false);
    store.closeSearch();
    store.openSearch();
    expect(store.getStatus().searchOpen).toBe(true);
  });

  it("换文档：命中表随文档走（⛔ 旧文档的命中不许落到新文档上），条的开关留着", async () => {
    const store = await openStore();
    store.openSearch();
    store.setSearchQuery("hello");
    await settled(store);
    await store.open(SID);
    expect(store.getStatus()).toMatchObject({ searchOpen: true, searchQuery: "", searchHits: 0, searchCurrent: 0 });
  });

  it("文档没就绪（未 open）时改查询：如实给空表，不假装扫过", async () => {
    const store = createReaderStore();
    store.setSearchQuery("hello");
    expect(store.getStatus()).toMatchObject({ searchQuery: "hello", searchHits: 0, searchScanning: false });
    expect(store.getState().phase.kind).toBe("loading");
  });
});

describe("扫描中间态（长文档的诚实读数）", () => {
  it("扫到一半：searchScanning 为真、已扫页数在长、命中数边扫边长", async () => {
    hanging.add(2); // 第 2 页永不落地 ⇒ 卡在中间态
    const store = await openStore();
    store.setSearchQuery("hello");
    await vi.waitFor(() => expect(store.getStatus().searchScannedPages).toBe(1));

    const st = store.getStatus();
    expect(st.searchScanning).toBe(true);
    expect(st.searchScannedPages).toBe(1);
    expect(st.searchHits).toBe(1); // 第 1 页的命中已经可用（不等整场扫完）
    expect(st.searchCurrent).toBe(0); // 定位要等扫完才做 ⇒ 此刻「还没有当前命中」
  });
});
