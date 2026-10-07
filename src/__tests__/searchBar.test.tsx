/**
 * 搜索浮条组件单测（T5）——测的是**用户看得见的那几条**（ui-ux-pro-max 的查找族判据）：
 *   · 无命中要**给话**（⛔ 不是空白读数——空白在查找族里最容易被当成「还在扫」）；
 *   · 命中数直读「第几处/共几处」；扫描中如实说在扫；
 *   · Enter = 下一处 / Shift+Enter = 上一处（走位，⛔ 不是「提交」）；
 *   · Esc 收条；文档没就绪时输入框不可用（空转不假装能搜）。
 * 断言只用原生（⛔ 本仓没装 jest-dom 那套匹配器）。文案 key 就是中文原文，i18n 未初始化时
 * `t()` 原样返回 key ⇒ 这里断言中文即等于断言渲染面。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

vi.mock("../services/pdfDoc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/pdfDoc")>();
  const { makeFakeDoc } = await import("./helpers/fakePdf");
  return { ...actual, loadPdf: async () => makeFakeDoc() };
});

import SearchBar from "../components/SearchBar";
import { broken, hanging, resetFake } from "./helpers/fakePdf";
import { createReaderStore } from "../views/readerStore";

const SID = "C:/docs/fake.pdf";

beforeEach(() => {
  resetFake();
});

function bar(store: ReturnType<typeof createReaderStore>) {
  return render(<SearchBar store={store} />);
}

function input(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(".pdf-reader-search-input");
  if (!el) throw new Error("搜索输入框不在场");
  return el;
}

function count(container: HTMLElement): string {
  return container.querySelector(".pdf-reader-search-count")?.textContent ?? "";
}

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(".pdf-reader-search-btn")];
}

describe("搜索浮条（未就绪 / 关条）", () => {
  it("条没开就不渲染（⛔ 不占位、不留空壳）", async () => {
    const store = createReaderStore();
    const { container } = bar(store);
    expect(container.querySelector(".pdf-reader-search")).toBeNull();
    expect(container.hasChildNodes()).toBe(false);
  });

  it("文档还在加载：输入框与走位钮都不可用（不给「能搜的假象」），但收条钮留着", async () => {
    const store = createReaderStore();
    store.openSearch();
    const { container } = bar(store);
    expect(input(container).disabled).toBe(true);
    expect(buttons(container)[0].disabled).toBe(true);
    expect(buttons(container)[1].disabled).toBe(true);
    expect(buttons(container)[2].disabled).toBe(false);
    expect(count(container)).toBe(""); // 未就绪不给读数（不是「无命中」——那是搜过的结论）
  });

  it("Esc 收条（与 ✕ 同一个动作：关条连命中表一起清）", async () => {
    const store = createReaderStore();
    store.openSearch();
    const { container } = bar(store);
    fireEvent.keyDown(container.querySelector(".pdf-reader-search")!, { key: "Escape" });
    expect(store.getStatus().searchOpen).toBe(false);
    await waitFor(() => expect(container.querySelector(".pdf-reader-search")).toBeNull());
  });
});

describe("搜索浮条（就绪后）", () => {
  async function opened() {
    const store = createReaderStore();
    await store.open(SID);
    store.openSearch();
    return store;
  }

  it("命中数直读「第几处/共几处」，上下钮可用；走位即更新读数", async () => {
    const store = await opened();
    const { container } = bar(store);
    fireEvent.change(input(container), { target: { value: "hello" } });

    await waitFor(() => expect(count(container)).toBe("1/3"));
    expect(buttons(container).every((b) => !b.disabled)).toBe(true);
    expect(input(container).value).toBe("hello");

    fireEvent.keyDown(container.querySelector(".pdf-reader-search")!, { key: "Enter" });
    await waitFor(() => expect(count(container)).toBe("2/3"));

    fireEvent.keyDown(container.querySelector(".pdf-reader-search")!, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(count(container)).toBe("1/3"));
  });

  it("🔴 无命中给**文案**不给空白（并且走位钮禁用——没处可走）", async () => {
    const store = await opened();
    const { container } = bar(store);
    fireEvent.change(input(container), { target: { value: "zzz" } });

    await waitFor(() => expect(count(container)).toBe("无命中"));
    expect(buttons(container)[0].disabled).toBe(true);
    expect(buttons(container)[1].disabled).toBe(true);
    expect(buttons(container)[2].disabled).toBe(false); // 收条钮永远可用（否则用户出不去）
  });

  it("空查询不显示读数（⛔ 不写「0/0」）", async () => {
    const store = await opened();
    const { container } = bar(store);
    fireEvent.change(input(container), { target: { value: "hello" } });
    await waitFor(() => expect(count(container)).toBe("1/3"));

    fireEvent.change(input(container), { target: { value: "" } });
    await waitFor(() => expect(count(container)).toBe(""));
    expect(buttons(container)[0].disabled).toBe(true);
  });

  it("扫描中如实说「扫描中…」（长文档里这是唯一的进度实话）", async () => {
    hanging.add(2); // 第 2 页永不落地 ⇒ 停在中间态
    const store = await opened();
    const { container } = bar(store);
    fireEvent.change(input(container), { target: { value: "hello" } });

    await waitFor(() => expect(count(container)).toBe("扫描中…"));
    expect(store.getStatus().searchScannedPages).toBe(1);
  });

  it("单页取数失败不影响读数（跳过那页接着扫）", async () => {
    broken.add(2);
    const store = await opened();
    const { container } = bar(store);
    fireEvent.change(input(container), { target: { value: "hello" } });
    await waitFor(() => expect(count(container)).toBe("1/2"));
  });

  it("收条钮点击 = closeSearch（鼠标路径与 Esc 等效）", async () => {
    const store = await opened();
    const { container } = bar(store);
    const close = buttons(container)[2];
    expect(close.getAttribute("aria-label")).toBe("关闭搜索");
    fireEvent.click(close);
    expect(store.getStatus().searchOpen).toBe(false);
  });
});
