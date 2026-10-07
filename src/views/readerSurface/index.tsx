/**
 * 阅读区——连续滚动 ＋ 虚拟化只渲染可视页（首屏可视 ±2 页，WINDOW_BUFFER）。
 *
 * 渲染治理（100MB 级不卡、内存不涨穿的落点）：
 * - 页面卡片全量铺位（空 div 很便宜），canvas 只挂在可视窗口内的页上；滚出窗口即清位图拆除。
 * - 渲染串行逐页（避免与 pdf.js 单页渲染约束打架）；每轮渲染前重验页仍在窗口内。
 * - 缩放变化全窗重渲；换档瞬间按当前页锚定滚动位置（不跳页）。
 * - 视口尺寸经 store.reportViewport 回灌，适宽/适页模式据此重算（resize 跟随）。
 * - 换文档（doc 句柄更替）时渲染记录全清，防旧页残留。
 *
 * T5 文本层（划选复制＋搜索高亮）：
 * - 文本层**同吃虚拟化窗口**（`hasCanvas` 那一份判据）：窗外不建 div，滚动/内存口径与 canvas 一致。
 * - 文本层是 `position: absolute` 的浮层（卡片 `position: relative`），⛔ **不动卡片尺寸**——
 *   缩放锚点、虚拟化偏移、canvas 尺寸全都不受影响（T3 回归判据）。
 * - 跳转定位（把当前命中滚进视野中央）由本文件做：它是滚动容器的主人，别让各家自己动 scrollTop。
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PAGE_GAP, WINDOW_BUFFER } from "../../constants";
import type { PdfDocument } from "../../services/pdfDoc";
import {
  HIT_CURRENT_CLASS,
  applyHighlights,
  clearHighlights,
  planHighlights,
  renderTextLayer,
  type RenderedTextLayer,
} from "../../services/textLayer";
import { pageAt, pageOffsets, visibleRange, windowRange } from "../../utils/pagination";
import { useReaderState, type ReaderStore, type SearchHit } from "../readerStore";

/** 渲染被取消/中止的「预期收场」异常名——换文件、destroy、pdf.js 取消渲染时抛这些，不是故障 */
const CANCELLED_RENDER_ERRORS = new Set(["AbortException", "RenderingCancelledException"]);

export function ReaderSurface({ store }: { store: ReaderStore }) {
  const { t } = useTranslation();
  const s = useReaderState(store);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderedScale = useRef(new Map<number, number>());
  const rafRef = useRef(0);
  /** 滚动锚：当前页 ＋ 视口顶边在该页内的相对位置（缩放换档时按它回定位） */
  const anchorRef = useRef({ page: 1, rel: 0 });
  /** 当前页顶边偏移（每次渲染后记录；缩放换档瞬间它还是旧 scale 的值） */
  const anchorOffsetRef = useRef(0);

  const ready = s.phase.kind === "ready" && s.doc !== null && s.defaultSize !== null;

  // 每页 CSS 像素尺寸（未实测的页按首页尺寸铺位）
  const heights = useMemo(() => {
    const list: number[] = [];
    if (!ready) return list;
    for (let i = 1; i <= s.numPages; i++) {
      list.push((s.pageSizes.get(i) ?? s.defaultSize!).height * s.scale);
    }
    return list;
  }, [ready, s.numPages, s.defaultSize, s.pageSizes, s.scale]);
  const widths = useMemo(() => {
    const list: number[] = [];
    if (!ready) return list;
    for (let i = 1; i <= s.numPages; i++) {
      list.push((s.pageSizes.get(i) ?? s.defaultSize!).width * s.scale);
    }
    return list;
  }, [ready, s.numPages, s.defaultSize, s.pageSizes, s.scale]);
  const offsets = useMemo(() => pageOffsets(heights, PAGE_GAP), [heights]);

  // ── 滚动 → 当前页 ＋ 可视窗口（rAF 节流）──
  const [win, setWin] = useState({ first: 1, last: 1 });
  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el || heights.length === 0) return;
    const range = visibleRange(el.scrollTop, el.clientHeight, offsets, heights, PAGE_GAP);
    const current = pageAt(el.scrollTop + el.clientHeight / 2, offsets, heights, PAGE_GAP);
    store.setCurrentPage(current);
    anchorRef.current = { page: current, rel: el.scrollTop - (offsets[current - 1] ?? 0) };
    setWin((prev) => (prev.first === range.first && prev.last === range.last ? prev : range));
  }, [heights, offsets, store]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recompute);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    recompute();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [recompute]);

  // ── 视口上报（适宽/适页 resize 跟随）——依赖 ready：loading 期容器不存在，ready 后才挂得上 ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return;
    const report = () => store.reportViewport(el.clientWidth, el.clientHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [store, ready]);

  // ── 换文档：渲染记录全清 ──
  const docRef = useRef(s.doc);
  useEffect(() => {
    if (docRef.current !== s.doc) {
      docRef.current = s.doc;
      renderedScale.current.clear();
      setCanvasPages(new Set());
    }
  }, [s.doc]);

  // ── 虚拟化窗口：窗外拆 canvas（清位图释放内存），窗内补挂载 ──
  const [canvasPages, setCanvasPages] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    if (!ready) return;
    const { first, last } = windowRange(win, s.numPages, WINDOW_BUFFER);
    let removed: Set<number> | null = null;
    for (const p of canvasPages) {
      if (p < first || p > last) {
        const canvas = canvasRefs.current.get(p);
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        canvasRefs.current.delete(p);
        renderedScale.current.delete(p);
        (removed ??= new Set(canvasPages)).delete(p);
      }
    }
    if (removed) setCanvasPages(removed);
    const missing: number[] = [];
    for (let p = first; p <= last; p++) if (!canvasPages.has(p)) missing.push(p);
    if (missing.length > 0) {
      setCanvasPages((prev) => {
        const next = new Set(prev);
        for (const p of missing) next.add(p);
        return next;
      });
    }
  }, [ready, win, s.numPages, canvasPages]);

  // ── 渲染：单条 drain 循环逐页渲（同一 canvas 永不并发 render，⛔ 不丢请求）──
  // 两条实机教训（2026-10-07）：
  //   ① effect 内起 async + 清理标志挡不住**已在途**的 await ⇒ 滚动/换档连环重跑时，
  //      同一个 canvas 上两次并发 render()，pdf.js 直接抛错（滚到第 7 页当场翻错误态）。
  //   ② 「本轮无待渲页就不入队」的前置判断踩到 React state 滞后（canvasPages 比 DOM ref 晚一拍）
  //      ⇒ 缩放瞬间那一轮被整轮丢掉，后面没人再来补：第 2/3 页 canvas 挂着却永远是 300×150 空位图。
  // 现在的形状：effect 只**举手**（置请求位），干活的是唯一一条 drain 循环；每轮开头重取
  // 「当前」档位与窗口（ref 里读，不是闭包里那份），跑完再看请求位——新请求由同一轮循环接住。
  const renderReqRef = useRef(false);
  const drainingRef = useRef(false);
  const winRef = useRef(win);
  winRef.current = win;
  const numPagesRef = useRef(s.numPages);
  numPagesRef.current = s.numPages;

  useEffect(() => {
    if (!ready || !s.doc) return;
    renderReqRef.current = true;
    if (drainingRef.current) return; // 已有 drain 在跑：它会看到这次请求
    drainingRef.current = true;
    void (async () => {
      while (renderReqRef.current) {
        renderReqRef.current = false;
        const doc = store.getState().doc;
        if (!doc) break; // 已 dispose/换文件
        const scale = store.getState().scale;
        const { first, last } = windowRange(winRef.current, numPagesRef.current, WINDOW_BUFFER);
        for (let p = first; p <= last; p++) {
          if (renderReqRef.current) break; // 期间又滚动/换档：让位重算窗口与档位
          if (docRef.current !== doc || store.getState().scale !== scale) break;
          const canvas = canvasRefs.current.get(p);
          if (!canvas || renderedScale.current.get(p) === scale) continue;
          try {
            const size = await doc.renderPage(p, canvas, scale);
            // 渲完重认画布归属：期间滚出窗口的话这块 canvas 已被拆除/复位，
            // 记进 renderedScale 会让它滚回来时被当成「已渲染」而留白
            if (docRef.current !== doc || canvasRefs.current.get(p) !== canvas) continue;
            renderedScale.current.set(p, scale);
            store.measurePage(p, size);
          } catch (err) {
            if (docRef.current !== doc) break; // 旧文档的收场错误不报到新视图上
            if (CANCELLED_RENDER_ERRORS.has((err as Error)?.name ?? "")) continue;
            store.reportError(err instanceof Error ? err : new Error(String(err)));
            renderReqRef.current = false;
            drainingRef.current = false;
            return;
          }
        }
      }
      drainingRef.current = false;
    })();
  }, [ready, s.doc, s.scale, s.numPages, win, canvasPages, store]);

  // ── 缩放换档：按当前页锚定滚动（DOM 高度已按新 scale 提交后执行）──
  const prevScaleRef = useRef(s.scale);
  useLayoutEffect(() => {
    const el = containerRef.current;
    const prevScale = prevScaleRef.current;
    prevScaleRef.current = s.scale;
    if (!el || prevScale === s.scale || heights.length === 0) return;
    // 🔴 锚定页以 **store 的 currentPage**（真相源）为准，⛔ 不认 anchorRef 的页——那个 ref 只在
    // 滚动 rAF 里刷新：`gotoPage`/命令换页是**程序化改 scrollTop**，紧随其后的换档读到的还是旧页
    // （实测：jump 到 20 页后换档 ⇒ `scrollTop` 被锚回 0 ⇒ 回执/状态条变成「第 1 页」，而 DOM 已由
    // scrollTarget 摆回 20 页 —— 两处读数当场分叉）。`rel` 只在 ref 与真相源同页时才可信。
    const anchorPage = anchorRef.current.page;
    const page = s.currentPage || anchorPage;
    const rel = anchorPage === page ? anchorRef.current.rel : 0;
    const oldOff = anchorOffsetRef.current;
    const newOff = offsets[page - 1] ?? 0;
    const ratio = oldOff > 0 ? newOff / oldOff : 1;
    el.scrollTop = Math.max(0, newOff + rel * ratio);
  }, [s.scale, s.currentPage, offsets, heights]);
  useLayoutEffect(() => {
    const page = s.currentPage || anchorRef.current.page;
    anchorOffsetRef.current = offsets[page - 1] ?? 0;
  });

  // ── gotoPage 滚动请求 ──
  useEffect(() => {
    const el = containerRef.current;
    const target = s.scrollTarget;
    if (!el || !target || heights.length === 0) return;
    el.scrollTop = Math.max(0, (offsets[target.page - 1] ?? 0) - PAGE_GAP);
  }, [s.scrollTarget, offsets, heights.length]);

  // ── Ctrl+滚轮缩放（React 合成 wheel 是 passive 的，preventDefault 得用原生监听）──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) store.zoomIn();
      else store.zoomOut();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store]);

  const setCanvasRef = useCallback((page: number, el: HTMLCanvasElement | null) => {
    if (el) canvasRefs.current.set(page, el);
    else canvasRefs.current.delete(page);
  }, []);

  // ── 搜索命中：按页分组（只认 store 那一份命中表；`hits` 引用不变时分组结果不变 ⇒ 卡片 memo 有效）──
  const hitsByPage = useMemo(() => {
    const map = new Map<number, SearchHit[]>();
    for (const hit of s.search.hits) {
      const list = map.get(hit.page);
      if (list) list.push(hit);
      else map.set(hit.page, [hit]);
    }
    return map;
  }, [s.search.hits]);
  const noHits = useMemo<readonly SearchHit[]>(() => [], []);

  /**
   * 「当前命中已画进 DOM」的回执（文本层组件报上来）——把该条滚进视野中央。
   *
   * 为什么由阅读区统一做：它是滚动容器的主人。文本层自己调 scrollTop 会与
   * 「gotoPage 滚到页顶」那一条抢（两条 effect 分属父子，落地顺序不保证），且滚动容器不该有第二个主人。
   *
   * 🔴 用 `setTimeout(0)` 而不是 rAF：它要落在**同一批 effect 跑完之后**（父的页顶滚动先落地），
   * 而 rAF 在后台窗口会被冻结（T4 实机教训，见 scripts/dev 的 unthrottle）——定位读数就没了。
   * 每次跳转只认一次（`jumpNonce` 去重）：之后用户自己滚开再滚回来，⛔ 不再抢滚动条。
   */
  const jumpHandledRef = useRef(-1);
  const onCurrentHit = useCallback(
    (el: HTMLElement) => {
      const scroller = containerRef.current;
      const nonce = store.getState().search.jumpNonce;
      if (!scroller || jumpHandledRef.current === nonce) return;
      jumpHandledRef.current = nonce;
      setTimeout(() => {
        if (!el.isConnected) return; // 期间滚走了/换页了：这条已经不在了
        const box = el.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        scroller.scrollTop += box.top - view.top - (scroller.clientHeight - box.height) / 2;
      }, 0);
    },
    [store],
  );

  if (!ready) {
    if (s.phase.kind === "loading") return <LoadingSkeleton text={t("加载中…")} />;
    return null; // error 态由 ReaderView 换 ErrorState，不落这里
  }

  return (
    <div ref={containerRef} className="pdf-reader-surface" tabIndex={0}>
      <div className="pdf-reader-pages">
        {heights.map((h, i) => (
          <PageCard
            key={i + 1}
            page={i + 1}
            width={widths[i]}
            height={h}
            hasCanvas={canvasPages.has(i + 1)}
            doc={s.doc}
            scale={s.scale}
            hits={hitsByPage.get(i + 1) ?? noHits}
            currentHit={s.search.currentMatch}
            jumpNonce={s.search.jumpNonce}
            setCanvasRef={setCanvasRef}
            onCurrentHit={onCurrentHit}
          />
        ))}
      </div>
    </div>
  );
}

const PageCard = memo(function PageCard({
  page,
  width,
  height,
  hasCanvas,
  doc,
  scale,
  hits,
  currentHit,
  jumpNonce,
  setCanvasRef,
  onCurrentHit,
}: {
  page: number;
  width: number;
  height: number;
  hasCanvas: boolean;
  doc: PdfDocument | null;
  scale: number;
  hits: readonly SearchHit[];
  currentHit: number;
  jumpNonce: number;
  setCanvasRef: (page: number, el: HTMLCanvasElement | null) => void;
  onCurrentHit: (el: HTMLElement) => void;
}) {
  return (
    <div className="pdf-reader-page-card" style={{ width, height }}>
      {hasCanvas && <canvas ref={(el) => setCanvasRef(page, el)} className="pdf-reader-page-canvas" />}
      {hasCanvas && doc && (
        <PageTextLayer
          doc={doc}
          page={page}
          scale={scale}
          hits={hits}
          currentHit={currentHit}
          jumpNonce={jumpNonce}
          onCurrentHit={onCurrentHit}
        />
      )}
    </div>
  );
});

/**
 * 一页的文本层——划选复制的载体，也是搜索命中的画布（T5）。
 *
 * 三条生命周期，各有它存在的理由：
 * ① **建层**只在换文档/换页时跑。文本项不随缩放变——换档就重建会在 Ctrl+滚轮连档时反复拆装
 *    上千个 span（T3 的缩放手感回归项就是这么坏的）。
 * ② **换档**只把新 viewport 交给 pdf.js `update()`（改 `--scale-factor` ＋ 重算 `--scale-x`）。
 * ③ **高亮**先复原全文再画（`clearHighlights` → `applyHighlights`）：改查询时新命中不一定覆盖旧命中
 *    碰过的每一项，不先复原就会留下上一轮的高亮残影。
 */
const PageTextLayer = memo(function PageTextLayer({
  doc,
  page,
  scale,
  hits,
  currentHit,
  jumpNonce,
  onCurrentHit,
}: {
  doc: PdfDocument;
  page: number;
  scale: number;
  hits: readonly SearchHit[];
  currentHit: number;
  jumpNonce: number;
  onCurrentHit: (el: HTMLElement) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<RenderedTextLayer | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  /** 建层计数——层换了一份（换文档）就 +1，高亮 effect 据此重跑 */
  const [built, setBuilt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let made: RenderedTextLayer | null = null;
    void (async () => {
      try {
        const layer = await renderTextLayer(doc, page, host, scaleRef.current);
        if (cancelled) {
          layer.destroy();
          return;
        }
        made = layer;
        layerRef.current = layer;
        setBuilt((v) => v + 1);
      } catch {
        // 文本层建不起来（畸形文本项等）不该拖垮阅读：页面照常渲染，只是这页没有划选与高亮
      }
    })();
    return () => {
      cancelled = true;
      layerRef.current = null;
      made?.destroy();
    };
  }, [doc, page]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    let cancelled = false;
    void (async () => {
      const viewport = await doc.viewport(page, scale);
      if (!cancelled && layerRef.current === layer) layer.setScale(viewport);
    })();
    return () => {
      cancelled = true;
    };
    // 🔴 `built` 必须在依赖里：建层是异步的，本 effect 首次跑时层还没到手（早退）。
    // 若期间档位变过一次（新文档就绪 → 适宽/适页重算，两拍常挨着），不再补这一下，
    // 这页就会一直停在**建层那一刻的旧倍率**上（症状：文本层与 canvas 肉眼可辨的错位），
    // 直到用户下次手动缩放才自愈。带 `built` 重跑一次即可（倍率没变时 pdf.js 的 update 是空操作）。
  }, [doc, page, scale, built]);

  useEffect(() => {
    const layer = layerRef.current;
    const host = hostRef.current;
    if (!layer || !host || built === 0) return;
    clearHighlights(layer.divs, layer.itemsStr);
    if (hits.length === 0) return;
    const ranges = planHighlights(
      layer.itemsStr,
      layer.starts,
      hits.map((h) => ({ index: h.at, length: h.length, matchIdx: h.index })),
    );
    applyHighlights(layer.divs, layer.itemsStr, ranges, currentHit);
    // 本页画出了「当前命中」⇒ 报给阅读区去居中（由它统一动 scrollTop，见 ReaderSurface 里那段）
    const currentEl = host.querySelector<HTMLElement>(`.${HIT_CURRENT_CLASS}`);
    if (currentEl) onCurrentHit(currentEl);
  }, [built, hits, currentHit, jumpNonce, onCurrentHit]);

  return <div ref={hostRef} className="pdf-reader-text-layer" />;
});

/**
 * 加载骨架（00.5 §三：灰页面卡＋加载条，大文件不白屏）。
 * ⚠️ 加载条**只能是不确定式**：pdf.js 在「整段字节交给它」的形态下**一次 onProgress 都不发**
 * （2026-10-07 实测：95MB 文件 onProgress 事件数 = 0），而壳的 readBinaryFile 是一次性 IPC、
 * 无分块/无 size——本项目拿不到任何真进度。⛔ 既不能画一条假的百分比（骗人），
 * 也不留「永远不亮」的确定式分支（死代码）⇒ 只留不确定式滑动条。
 */
function LoadingSkeleton({ text }: { text: string }) {
  return (
    <div className="pdf-reader-loading">
      <div className="pdf-reader-loading-card" />
      <div className="pdf-reader-loading-bar indeterminate" />
      <div className="pdf-reader-loading-text">{text}</div>
    </div>
  );
}
