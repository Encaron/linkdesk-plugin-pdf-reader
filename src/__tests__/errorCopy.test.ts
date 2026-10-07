/**
 * 错误态选键单测（T7）——四种 kind 逐条钉住，**并且钉住它们的译文真的在自有字典里**。
 *
 * 两件事各值一条：
 * ① 「哪一档说哪句话」原本是三段嵌套三元埋在 JSX 里，实机只跑到过「加密」一支；
 * ② 🔴 键抽成数据之后，`t()` 的中文字面量从源码里消失了——`ci-verify` ⑧ 段的
 *    「源码 t() key 覆盖度」是**黄灯腿**（看不见就算了），于是「键写错一个字、屏幕上直接
 *    显示 key」这件事没有了机械兜底。所以这里**读一遍 `i18n/en.json` 逐键核对**，把这一族
 *    从黄灯改成硬红（测试红了就是红了）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_NAME_VAR, errorCopy } from "../components/errorCopy";
import type { PdfOpenErrorKind } from "../services/pdfDoc";

const ALL_KINDS: PdfOpenErrorKind[] = ["encrypted", "invalid", "read", "unknown"];

/**
 * 自有字典（plugin.json 的 `i18n.en` 指向它）——键必须在这里有非空译名。
 * 路径按仓库根解析（vitest 的 cwd 就是插件仓根）：⛔ 不用 `import.meta.url`（jsdom 环境下
 * 拿到的不是 `file:` URL，`fileURLToPath` 直接抛「URL must be of scheme file」——实测）。
 */
const dict = JSON.parse(readFileSync(resolve(process.cwd(), "i18n/en.json"), "utf8")) as Record<string, string>;

describe("errorCopy：kind → 文案取舍", () => {
  it("四档都有条目（union 加了新 kind 而表里没跟上 ⇒ 这里先红）", () => {
    for (const kind of ALL_KINDS) {
      expect(errorCopy(kind), `kind=${kind} 没在表里`).toBeTruthy();
    }
  });

  it("加密态：标题另起一档、不提文件名、不给底层原文、图标是锁", () => {
    const c = errorCopy("encrypted");
    expect(c.titleKey).toBe("此 PDF 已加密");
    expect(c.descUsesName).toBe(false);
    expect(c.showDetail).toBe(false);
    expect(c.icon).toBe("lock");
  });

  it("损坏态：标题回「无法打开」、说明指名道姓、⛔ 不补底层原文（损坏是判定的结论）", () => {
    const c = errorCopy("invalid");
    expect(c.titleKey).toBe("此 PDF 无法打开");
    expect(c.descUsesName).toBe(true);
    expect(c.showDetail).toBe(false);
    expect(c.icon).toBe("document");
  });

  it("读取失败与未知：补底层原文（那是可查的异常，不是结论）", () => {
    for (const kind of ["read", "unknown"] as const) {
      expect(errorCopy(kind).showDetail).toBe(true);
      expect(errorCopy(kind).icon).toBe("document");
    }
  });

  it("🔴 「读不到」与「文件是坏的」说两句话——下一个动作相反，⛔ 不许合并", () => {
    // 合并了的话：路径/占用问题会被报成「文件损坏」，用户去别处找副本——方向就错了
    expect(errorCopy("unknown").descKey).not.toBe(errorCopy("invalid").descKey);
    expect(errorCopy("read").descKey).toBe(errorCopy("unknown").descKey);
  });

  it("标题按「损坏 / 加密」两式归并（除加密外都用同一个标题键）", () => {
    const titles = ALL_KINDS.map((k) => errorCopy(k).titleKey);
    expect(new Set(titles).size).toBe(2);
  });

  it("只说要用 `{{name}}` 的那两档才带插值变量（加密态不带）", () => {
    expect(errorCopy("invalid").descKey).toContain(`{{${ERROR_NAME_VAR}}}`);
    expect(errorCopy("encrypted").descKey).not.toContain("{{");
  });
});

describe("错误态文案的字典覆盖（把黄灯腿在错误态这一族上变成硬红）", () => {
  it("四档的标题键与说明键都在 i18n/en.json 里，且译名非空", () => {
    for (const kind of ALL_KINDS) {
      const c = errorCopy(kind);
      for (const key of [c.titleKey, c.descKey]) {
        expect(dict[key], `kind=${kind} 的键 ${JSON.stringify(key)} 不在自有字典里`).toBeTypeOf("string");
        expect(dict[key].trim()).not.toBe("");
      }
    }
  });
});
