/**
 * 错误态组件单测（T7）——钉住**两件在 jsdom 里钉得住、且真会伤人**的事：
 *
 * ① **动作面不在就⛔ 不留死钮**（硬约束 ③）：错误态那两颗钮是**探测接线**钮——宿主没有
 *    `openWith` 命令、池子里没有 market 插件时，点了什么都不会发生。给人一颗点不动的钮
 *    比不给钮坏；T3 只做过实机读数（当时两个面都在），**「面不在」这一支从来没有被跑过**。
 * ② kind → 文案的接线（选键本体在 `errorCopy.ts` 单测里逐档钉过，这里验的是**组件真照它渲染**）。
 *
 * 文案 key 就是中文原文，i18n 未初始化时 `t()` 原样返回 key ⇒ 断言中文即等于断言渲染面。
 * 探面是 async（useEffect）⇒ 出钮的断言一律 waitFor。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

// 把 shell-commands 的 openWith 换成探针（SHELL_COMMANDS 常量保留原样——探面用的是真值）
vi.mock("@linkdesk/plugin-sdk/shell-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@linkdesk/plugin-sdk/shell-commands")>();
  return { ...actual, openWith: vi.fn() };
});

import { SHELL_COMMANDS, openWith } from "@linkdesk/plugin-sdk/shell-commands";
import ErrorState from "../components/ErrorState";
import { PdfOpenError } from "../services/pdfDoc";

const FILE = "C:/x/fake.pdf";
const lk = () =>
  window.linkdesk as unknown as {
    pluginManager?: { list?: () => Promise<unknown> };
    commands?: { getCommands?: () => Promise<unknown> };
    pool?: unknown;
    events?: { emit?: (...args: unknown[]) => void };
  };

let emit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(openWith).mockClear();
  emit = vi.fn();
  // 每个用例从「动作面全不在」起跑——探到的面由用例自己给
  delete lk().pluginManager;
  delete lk().commands;
  delete lk().pool;
  lk().events = { emit };
});

/** 给出动作面：市场插件在册 ＋ 宿主 openWith 命令在册 */
function provideActionSurfaces(): void {
  lk().pluginManager = { list: async () => [{ pluginId: "marketplace" }, { pluginId: "pdf-reader" }] };
  lk().commands = { getCommands: async () => [{ id: SHELL_COMMANDS.openWith }, { id: "pdf-reader.pageNext" }] };
}

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(".pdf-reader-error-actions button")];
}

describe("错误态：动作面不在则不留死钮（硬约束 ③）", () => {
  it("宿主命令与市场插件都不在册 ⇒ 两颗探测钮一颗都不出（⛔ 不是灰钮、不是空钮）", async () => {
    const { container } = render(<ErrorState filePath={FILE} error={new PdfOpenError("invalid", "boom")} />);
    await waitFor(() => expect(container.querySelector(".pdf-reader-error-title")).toBeTruthy());
    expect(buttons(container)).toHaveLength(0);
  });

  it("只探到一半：有市场插件、没有 openWith ⇒ 只出「在市场搜索阅读器」那一颗", async () => {
    lk().pluginManager = { list: async () => [{ pluginId: "marketplace" }] };
    const { container } = render(<ErrorState filePath={FILE} error={new PdfOpenError("read", "EACCES")} />);
    await waitFor(() => expect(buttons(container)).toHaveLength(1));
    expect(buttons(container)[0].textContent).toBe("在市场搜索阅读器");
  });

  it("探面抛异常也当「面不在」（坏探测⛔ 不许把错误态再炸一次）", async () => {
    lk().pluginManager = {
      list: async () => {
        throw new Error("ipc down");
      },
    };
    lk().commands = {
      getCommands: async () => {
        throw new Error("ipc down");
      },
    };
    const { container } = render(<ErrorState filePath={FILE} error={new PdfOpenError("read", "EACCES")} />);
    await waitFor(() => expect(container.querySelector(".pdf-reader-error-title")).toBeTruthy());
    expect(buttons(container)).toHaveLength(0);
  });

  it("两个面都在册 ⇒ 两颗钮都出，且动作各走各的线（openWith 带对参数 / 揭示市场侧栏）", async () => {
    provideActionSurfaces();
    const { container } = render(<ErrorState filePath={FILE} error={new PdfOpenError("invalid", "boom")} />);
    await waitFor(() => expect(buttons(container)).toHaveLength(2));

    fireEvent.click(buttons(container)[0]); // 「打开方式…」
    expect(openWith).toHaveBeenCalledWith({ uri: FILE, name: "fake.pdf", ext: "pdf" });

    fireEvent.click(buttons(container)[1]); // 「在市场搜索阅读器」
    expect(emit).toHaveBeenCalledWith("icon:selected", "marketplace");
  });

  it("市场侧栏已经揭着 ⇒ 不再重复 emit（⛔ 不发无效事件）", async () => {
    provideActionSurfaces();
    lk().pool = { getLayout: () => ({ sidebar: { containerId: "marketplace" } }) };
    const { container } = render(<ErrorState filePath={FILE} error={new PdfOpenError("invalid", "boom")} />);
    await waitFor(() => expect(buttons(container)).toHaveLength(2));
    fireEvent.click(buttons(container)[1]);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("错误态：kind → 文案接线", () => {
  it("加密态：标题「此 PDF 已加密」＋锁图标，⛔ 不显示底层原文", () => {
    const { container, queryByText } = render(
      <ErrorState filePath={FILE} error={new PdfOpenError("encrypted", "PasswordException")} />,
    );
    expect(container.querySelector(".pdf-reader-error-title")?.textContent).toBe("此 PDF 已加密");
    expect(container.querySelector(".pdf-reader-error-desc")?.textContent).toBe("暂不支持打开受密码保护的文件。");
    expect(queryByText("PasswordException")).toBeNull();
    expect(container.querySelector(".pdf-reader-error-icon rect")).toBeTruthy(); // 锁 = rect ＋ 环
  });

  it("损坏态：标题「此 PDF 无法打开」＋文档图标，说明句点名文件", () => {
    const { container, queryByText } = render(<ErrorState filePath={FILE} error={new PdfOpenError("invalid", "boom")} />);
    expect(container.querySelector(".pdf-reader-error-title")?.textContent).toBe("此 PDF 无法打开");
    expect(container.querySelector(".pdf-reader-error-desc")?.textContent).toBe(
      "「{{name}}」损坏或不是有效的 PDF 格式。", // i18n 未初始化：`{{name}}` 原样留着
    );
    expect(queryByText("boom")).toBeNull(); // 损坏是结论，不补原文
    expect(container.querySelector(".pdf-reader-error-icon rect")).toBeNull();
  });

  it("读取失败：补一行底层原文（那是可查的异常），说明句⛔ 不说「损坏」", () => {
    const { container, getByText } = render(<ErrorState filePath={FILE} error={new PdfOpenError("read", "EACCES")} />);
    const desc = container.querySelector(".pdf-reader-error-desc")?.textContent ?? "";
    expect(desc).toBe("读不到「{{name}}」——文件可能已被移走，或被别的程序占用。");
    expect(desc).not.toContain("损坏");
    expect(getByText("EACCES")).toBeTruthy();
  });
});
