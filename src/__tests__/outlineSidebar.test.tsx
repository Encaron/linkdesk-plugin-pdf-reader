/**
 * 侧栏组件单测（T6）——测的是用户看得见、且**判据能在这里钉住**的那几条：
 *   · 缩略图**页位整本都铺、canvas 只画可视窗口**（30 页文档起步时只该向引擎要前几页，但
 *     30 个页位都得在 DOM 里——否则滚动条长度不等于整个文档，后面的页永远滚不到）；
 *   · 点击缩略图 = `gotoPage`（00.5 §七 表的「点击 = gotoPage」）；
 *   · 当前页带 `aria-current="page"` ＋ 当前态类（描边靠它，实机看）；
 *   · 目录树：层级渲染、点击跳页、收展、**跳不了的条目不立钮**（⛔ 不画点不动的按钮）；
 *   · 目录为空时整段不出现（⛔ 不留空标题栏）。
 * 断言只用原生（⛔ 本仓没装 jest-dom 那套匹配器）。文案 key 就是中文原文，i18n 未初始化时
 * `t()` 原样返回 key ⇒ 这里断言中文即等于断言渲染面。
 *
 * ⚠️ 两条 jsdom 限制，别把这里的断言当成实机读数：
 *   ① 没有布局：`scrollTop`/`clientHeight` 恒为 0 ⇒「可视窗口」永远是第 1 页那一屏——
 *      这里断言的是**窗口化的机制**（只要了前几页），「滚动后换一批」归实机；
 *   ② i18n 未初始化时**带插值的 key 原样返回**（`{{page}}` 不会被换掉）⇒ 三条缩略图的
 *      可访问名此刻同串，选具体某一条只能按**页序**（`.pdf-reader-thumb` 的第 n 个 = 第 n 页）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

vi.mock("../services/pdfDoc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/pdfDoc")>();
  const { makeFakeDoc } = await import("./helpers/fakePdf");
  return { ...actual, loadPdf: async () => makeFakeDoc(30) };
});

import { OutlineSidebar } from "../views/outlineSidebar";
import { createReaderStore, type ReaderStore } from "../views/readerStore";
import { renderedPages, resetFake, setFakeOutline } from "./helpers/fakePdf";

const SID = "C:/docs/fake.pdf";

async function readyStore(): Promise<ReaderStore> {
  const store = createReaderStore();
  await store.open(SID);
  expect(store.getState().phase.kind).toBe("ready");
  return store;
}

/** 缩略图按钮，按**页序**（第 n 个 = 第 n 页——见头注 ②） */
function thumbs(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".pdf-reader-thumb"));
}

const OUTLINE = [
  { title: "第一章", page: 1, children: [{ title: "1.1 小节", page: 2, children: [] }] },
  { title: "第二章", page: 5, children: [] },
  { title: "外部链接", page: 0, children: [] },
];

beforeEach(() => {
  resetFake();
});

describe("缩略图：懒渲染与跳页", () => {
  it("30 页文档只向引擎要「可视窗口 ±2」那几条（位图不整本铺开）", async () => {
    const store = await readyStore();
    render(<OutlineSidebar store={store} />);
    await waitFor(() => expect(renderedPages.length).toBe(3));
    expect([...renderedPages].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("页位整本都铺（滚动条长度 = 整个文档），但只有窗口内挂 canvas（滚不到最后一页就是这里坏的——踩过）", async () => {
    const store = await readyStore();
    const { container } = render(<OutlineSidebar store={store} />);
    await waitFor(() => expect(renderedPages.length).toBe(3));
    const list = thumbs(container);
    // 🔴 页位：整本 30 条都在（实机教训：只渲染窗口那几条 ⇒ 容器高度 = 那几条之和 ⇒ scrollTop 顶死，
    // 20 页文档滚到第 3~10 页就到底，后面十几页的缩略图永远够不到）
    expect(list).toHaveLength(30);
    const withCanvas = list.map((b, i) => (b.querySelector("canvas") ? i + 1 : 0)).filter(Boolean);
    expect(withCanvas).toEqual([1, 2, 3]); // 位图只给窗口内 ±2
  });

  it("每条缩略图都带页号可访问名，且当前页有 aria-current（描边之外还给一条可读判据）", async () => {
    const store = await readyStore();
    store.gotoPage(2);
    const { container } = render(<OutlineSidebar store={store} />);
    const list = thumbs(container);
    expect(list).toHaveLength(30); // 页位整本铺（见上一条）；下标即页序
    expect(list[0].getAttribute("aria-label")).toBe("跳到第 {{page}} 页"); // i18n 未初始化：原样 key
    expect(list[1].getAttribute("aria-current")).toBe("page");
    expect(list[0].getAttribute("aria-current")).toBeNull();
  });

  it("点缩略图 = gotoPage：当前页与滚动请求都落到那一页", async () => {
    const store = await readyStore();
    const { container } = render(<OutlineSidebar store={store} />);
    fireEvent.click(thumbs(container)[1]);
    expect(store.getState().currentPage).toBe(2);
    expect(store.getState().scrollTarget?.page).toBe(2);
  });

  it("重渲染⛔ 不清已画好的位图（canvas 的 ref 是内联箭头，每次渲染都换身份——踩过）", async () => {
    const store = await readyStore();
    const { container } = render(<OutlineSidebar store={store} />);
    await waitFor(() => expect(renderedPages.length).toBe(3));
    const canvas = thumbs(container)[0].querySelector("canvas")!;
    expect(canvas.width).toBeGreaterThan(0);
    const draws = renderedPages.length;
    // 一次只动 store 的重渲染（当前页变了 ⇒ 组件重渲 ⇒ 内联 ref 会被 React 交还 null 再给回元素）
    fireEvent.click(thumbs(container)[1]);
    expect(store.getState().currentPage).toBe(2);
    expect(canvas.width).toBeGreaterThan(0); // 🔴 还挂在屏上的格子，位图不许被清
    expect(canvas.style.width).toBe("20px");
    expect(renderedPages.length).toBe(draws); // 也不该因为「记录被清」而重画一遍
  });
});

describe("目录树：层级、跳转、收展、跳不了的条目", () => {
  it("没有目录 ⇒ 目录段整段不出现（⛔ 不留空标题栏），缩略图照常在", async () => {
    const store = await readyStore();
    expect(store.getState().outline).toEqual([]);
    const { queryByText, container } = render(<OutlineSidebar store={store} />);
    expect(queryByText("目录")).toBeNull();
    expect(thumbs(container)).toHaveLength(30); // 侧栏不是「有目录才存在」
  });

  it("有目录 ⇒ 出「目录」段，且各级子项都渲染出来", async () => {
    setFakeOutline(OUTLINE);
    const store = await readyStore();
    await waitFor(() => expect(store.getState().outline).toHaveLength(3));
    const { getByText } = render(<OutlineSidebar store={store} />);
    expect(getByText("目录")).toBeTruthy();
    expect(getByText("第一章")).toBeTruthy();
    expect(getByText("1.1 小节")).toBeTruthy();
    expect(getByText("第二章")).toBeTruthy();
  });

  it("点目录条目 = gotoPage（含子项）", async () => {
    setFakeOutline(OUTLINE);
    const store = await readyStore();
    await waitFor(() => expect(store.getState().outline).toHaveLength(3));
    const { getByText } = render(<OutlineSidebar store={store} />);
    fireEvent.click(getByText("1.1 小节"));
    expect(store.getState().scrollTarget?.page).toBe(2);
  });

  it("跳不了的条目（page 0）不是按钮——⛔ 不立点不动的钮", async () => {
    setFakeOutline(OUTLINE);
    const store = await readyStore();
    await waitFor(() => expect(store.getState().outline).toHaveLength(3));
    const { getByText } = render(<OutlineSidebar store={store} />);
    expect(getByText("外部链接").tagName).toBe("SPAN");
    expect(getByText("第二章").tagName).toBe("BUTTON");
  });

  it("有子项的条目带展开钮，收起后子项不再渲染（aria-expanded 如实表态）", async () => {
    setFakeOutline(OUTLINE);
    const store = await readyStore();
    await waitFor(() => expect(store.getState().outline).toHaveLength(3));
    const { getByRole, queryByText } = render(<OutlineSidebar store={store} />);
    const toggle = getByRole("button", { name: "收起" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(queryByText("1.1 小节")).toBeNull();
    expect(getByRole("button", { name: "展开" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("叶子条目不给展开钮（⛔ 不画点不动的箭头）", async () => {
    setFakeOutline([{ title: "独条", page: 3, children: [] }]);
    const store = await readyStore();
    await waitFor(() => expect(store.getState().outline).toHaveLength(1));
    const { queryByRole, getByText } = render(<OutlineSidebar store={store} />);
    expect(queryByRole("button", { name: "收起" })).toBeNull();
    expect(getByText("独条").tagName).toBe("BUTTON");
  });
});

describe("getStatus：目录读数与状态条同源", () => {
  it("outlineCount 含各级子项；没有目录如实给 0", async () => {
    const store = await readyStore();
    expect(store.getStatus().outlineCount).toBe(0);
    setFakeOutline(OUTLINE);
    await store.open(SID); // 换文档（同路径重开也算换一份）——目录随文档走
    // 目录是 ready 之后异步补的（⛔ 不挡阅读），故这里等它落地
    await waitFor(() => expect(store.getStatus().outlineCount).toBe(4)); // 第一章 ＋ 1.1 ＋ 第二章 ＋ 外部链接
  });
});
