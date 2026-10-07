/**
 * 目录树（T6 M3）——pdf.js `getOutline()` 原语的窄化。
 *
 * 分工：**异步的 dest → 页码解析住 `loadPdf.ts`**（要问文档），本文件只做**纯树形转换**
 * （解析函数由调用方注入）——「空标题条目怎么办 / 目标解析不出怎么办」这类判据因此能在
 * jsdom 里逐条钉住，不必起真引擎（同 `services/textLayer/search.ts` 的分工口径）。
 *
 * 形状口径：
 * - `title` 是**文档自带的文字**（不是 UI 文案）⇒ ⛔ 不进 i18n 字典、⛔ 不做省略之外的加工；
 * - `page` 为 0 = 该条目**没有可跳的页**（纯外链条目、坏目标、解析失败）——视图据此把它渲染成
 *   不可点的行，⛔ 不假装能跳、⛔ 也不静默吞掉（书签是文档里真有的东西，藏起来才是骗人）。
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * pdf.js `getOutline()` 的条目——**从其方法签名派生**（⛔ 不手抄形状：pdfjs-dist 的根类型入口
 * 不导出它，手抄一份就是自己维护一份会漂的镜像，同 `TextContent` 那条规矩）。
 */
export type RawOutlineNode = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];

/** 目录条目（本仓自有形状——pdf.js 的类型不越出 services 边界） */
export interface OutlineItem {
  /** 文档自带的标题（⛔ 不是 UI 文案） */
  title: string;
  /** 目标页（1-based）；**0 = 无目标**（外链/坏 dest/解析失败） */
  page: number;
  children: OutlineItem[];
}

/** dest → 页码（1-based；解析不出给 0）。由引擎层注入——本文件不认识 pdf.js 的 dest 形状。 */
export type DestResolver = (dest: unknown) => Promise<number>;

/**
 * pdf.js 原语 → 自有目录树。返回空数组 = 这份文档没有目录（⛔ 不当失败：没有目录的 PDF 多的是）。
 *
 * 丢掉的只有**三无条目**（无标题 ＋ 无子项 ＋ 无目标）：它在屏幕上留不下一个字、也点不动，
 * 留着只是一行空白（pdf.js 自家查看器会画一行空的）。**只缺其一的都留着**——没目标的带标题条目
 * 照样是一句真书签（渲染成不可点的行），有子项的带标题条目是分组头，都该看得见。
 */
export async function buildOutline(
  raw: readonly RawOutlineNode[] | null | undefined,
  resolveDest: DestResolver,
): Promise<OutlineItem[]> {
  if (!raw || raw.length === 0) return [];
  const items = await Promise.all(
    raw.map(async (node): Promise<OutlineItem | null> => {
      if (!node) return null;
      const title = typeof node.title === "string" ? node.title.trim() : "";
      const children = await buildOutline(node.items, resolveDest);
      const page = node.dest == null ? 0 : await resolveDest(node.dest);
      if (title === "" && children.length === 0 && page <= 0) return null;
      return { title, page, children };
    }),
  );
  return items.filter((it): it is OutlineItem => it !== null);
}

/** 目录条目总数（含各级子项）——`getStatus().outlineCount` 用它 */
export function countOutline(items: readonly OutlineItem[]): number {
  let n = 0;
  for (const it of items) n += 1 + countOutline(it.children);
  return n;
}
