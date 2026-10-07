/**
 * 文本层渲染——用 pdf.js 导出的 `TextLayer` 原语（T5 选型结论，⛔ 不引 `web/pdf_viewer.mjs`）。
 *
 * ── 为什么只借 `TextLayer`、不用整套 viewer 的 `TextLayerBuilder`/`PDFFindController` ──
 * 那两个在 **320 KB 的 viewer 模块**里，且与 stock `PDFViewer`/`PDFPageView` 的页模型强耦合：
 * `PDFFindController` 靠 `linkService.page/pagesCount` 驱动滚动、`TextLayerBuilder` 自持
 * container/viewport/scale 生命周期并走 EventBus 广播 `updatetextlayermatches`。本仓阅读区是
 * **自绘的虚拟化列表**（T3 判据：缩放锚点与虚拟化不许被破坏），套 stock 页模型要么重写阅读区、
 * 要么写一层适配——回归风险大于收益。而 `TextLayer` 本身是 `pdfjs-dist` 主入口已导出的**同一个
 * 渲染原语**（stock viewer 也是拿它建文本层），定位/字体度量/`--scale-x` 那些难活它全包了。
 * ⇒ 文本层借原语，**搜索与高亮自绘**（`search.ts` 纯函数 ＋ `highlight.ts` 拆 span），
 * 匹配与映射两段算法照 pdf.js 原语同一套做法搬。
 *
 * 🔴 CSS 契约（样式住 styles/reader.css 的 `.pdf-reader-text-layer`）：pdf.js 的文本层排版
 * 依赖 `--scale-factor`（本函数按页设）与 `--total-scale-factor` / `--font-height` / `--scale-x`
 * 那几个自定义属性，缺一个就是「文字层错位或字号坍缩」——样式表里那几条不是装饰，是接口。
 */
import { TextLayer } from "pdfjs-dist";
import type { PdfDocument, PageViewport } from "../pdfDoc";
import { pageTextOf } from "./search";

/** 一页已渲染的文本层——视图层拿到的全部（pdf.js 的 TextLayer 实例不越出本域） */
export interface RenderedTextLayer {
  /** 每项一个 span（pdf.js `textDivs`） */
  divs: HTMLElement[];
  /** 每项的原文（pdf.js `textContentItemsStr`）——高亮拆/复原都以它为准 */
  itemsStr: string[];
  /** 每项在整页搜索文本里的起始偏移（口径见 search.ts 文件头） */
  starts: number[];
  /**
   * 换档：更新 `--scale-factor` 并让 pdf.js 重算 `--scale-x`（字宽补偿）。
   * 🔴 **不重取文本、不重建 span**——`left`/`top` 是百分比、容器宽高吃 `--total-scale-factor`，
   * 所以换档只是改一个自定义属性 ＋ 一次度量；重建会丢掉已画上的高亮，也会在
   * Ctrl+滚轮连档时把文本项反复拆装（T3 缩放手感回归项）。
   */
  setScale(viewport: PageViewport): void;
  /** 拆页/换文档：在途排版就此收手，容器清空（下次渲染是干净的） */
  destroy(): void;
}

/**
 * 把第 page 页（1-based）的文本层渲进 `container`（该页卡片内的浮层，尺寸由卡片给）。
 * 调用方负责：换文档/拆页时 `destroy()`；换档走返回值的 `setScale`。
 */
export async function renderTextLayer(
  doc: PdfDocument,
  page: number,
  container: HTMLElement,
  scale: number,
): Promise<RenderedTextLayer> {
  const [content, viewport] = await Promise.all([doc.textContent(page), doc.viewport(page, scale)]);
  // pdf.js 排版口径：--scale-factor = 本页 viewport 的 scale；--user-unit 只在 PDF 声明了
  // UserUnit(≠1) 时才要覆盖（尺寸换算那一份在 rawDims 里，见 pdf.js setLayerDimensions）
  container.style.setProperty("--scale-factor", String(viewport.scale));
  if (viewport.userUnit !== 1) container.style.setProperty("--user-unit", String(viewport.userUnit));
  const layer = new TextLayer({ textContentSource: content, container, viewport });
  await layer.render();
  const { starts } = pageTextOf(content);
  return {
    divs: layer.textDivs,
    itemsStr: layer.textContentItemsStr,
    starts,
    setScale(next) {
      container.style.setProperty("--scale-factor", String(next.scale));
      if (next.userUnit !== 1) container.style.setProperty("--user-unit", String(next.userUnit));
      layer.update({ viewport: next });
    },
    destroy() {
      // 渲完之后 cancel 是空操作（capability 已 settle）；在途时它是唯一的收手方式
      try {
        layer.cancel();
      } catch {
        /* 已 settle：无需收手 */
      }
      container.replaceChildren();
    },
  };
}
