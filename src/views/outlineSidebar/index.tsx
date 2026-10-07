/**
 * 缩略图侧栏＋目录树（T6 M3）——一夹两个面（03-工程目录规范：一域一夹一出口）。
 *
 * 位次照 [00.5 §一]：工具栏下方、状态条上方的**左缘 180px 列**（⛔ 不是浮层——侧栏是布局里的
 * 真列：开着它阅读区就窄了，适宽据此重算倍率是**有意的**；浮层那套是给搜索条用的，见
 * `components/SearchBar.tsx` 头注）。默认收起（AI 拍板：首屏给阅读让路），开合走命令
 * `pdf-reader.toggleSidebar`（T4 已立，本格只接功能，⛔ 不另立命令）。
 *
 * 两个面：
 * - **目录树**：文档自带的书签（`doc.outline()`，pdf.js `getOutline` 的窄化）。有目录才出这一段
 *   （⛔ 不给空目录画一个空标题栏）；条目点击 = `store.gotoPage`（00.5 §七 表的「点击 = gotoPage」）。
 * - **缩略图**：**页位整本都铺、canvas 只挂窗口内 ±2 条**（照 `readerSurface` 的
 *   `heights.map(h => <Card hasCanvas={…}/>)`：占位按每页长宽比定高，滚出窗口即清位图释放内存）。
 *   点击 = `store.gotoPage`；当前页带 `--pdf-accent` 描边（00.5 §七）。
 *
 * 两条自制纪律：
 * - 渲染**单条 drain 循环**逐页串行（同 `readerSurface/`）：pdf.js 同一个 canvas 上并发 render
 *   会直接抛错，宁可串行。
 * - 缩略图渲染失败**不判死阅读器**（单格留白），正文照常——缩略图是导航辅助，不是正文。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRightIcon } from "../../components/icons";
import { THUMB_GAP, THUMB_PAD, THUMB_WIDTH, WINDOW_BUFFER } from "../../constants";
import type { OutlineItem } from "../../services/pdfDoc";
import { pageOffsets, visibleRange, windowRange } from "../../utils/pagination";
import { thumbRenderScale, thumbSlotHeight } from "../../utils/thumbs";
import { useReaderState, type ReaderStore } from "../readerStore";

export function OutlineSidebar({ store }: { store: ReaderStore }) {
  const { t } = useTranslation();
  const s = useReaderState(store);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderedScale = useRef(new Map<number, number>());
  const rafRef = useRef(0);

  const ready = s.phase.kind === "ready" && s.doc !== null && s.defaultSize !== null;

  /**
   * 每条的槽位尺寸：按该页长宽比定高（未实测的页按首页尺寸铺位——同阅读区的铺位口径）。
   * 槽位**先占位、位图后到**：滚动位置与总高不随渲染先后跳动。
   */
  const sizes = useMemo(() => {
    const list: { width: number; height: number }[] = [];
    if (!ready) return list;
    for (let i = 1; i <= s.numPages; i++) list.push(s.pageSizes.get(i) ?? s.defaultSize!);
    return list;
  }, [ready, s.numPages, s.defaultSize, s.pageSizes]);
  const heights = useMemo(() => sizes.map(thumbSlotHeight), [sizes]);
  const offsets = useMemo(() => pageOffsets(heights, THUMB_GAP), [heights]);

  // ── 滚动 → 可视条目窗口（rAF 节流，同阅读区）──
  const [win, setWin] = useState({ first: 1, last: 1 });
  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el || heights.length === 0) return;
    const range = visibleRange(el.scrollTop, el.clientHeight, offsets, heights, THUMB_GAP);
    setWin((prev) => (prev.first === range.first && prev.last === range.last ? prev : range));
  }, [heights, offsets]);

  useEffect(() => {
    const el = scrollRef.current;
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

  /**
   * 开栏时把列表摆到当前页——**只此一次**（`jumpedRef`）：
   * 之后阅读区翻页不再抢这里的滚动条（用户正在自己翻缩略图时被拽走最恼人；口径同 T5
   * 「跳转只认一次」的 `jumpNonce`）。
   */
  const jumpedRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || jumpedRef.current || heights.length === 0) return;
    jumpedRef.current = true;
    el.scrollTop = Math.max(0, (offsets[s.currentPage - 1] ?? 0) - THUMB_GAP);
    recompute();
  }, [heights, offsets, s.currentPage, recompute]);

  /**
   * 挂 canvas 的条目 = 可视窗口 ±2（同阅读区的 `WINDOW_BUFFER` 口径）。**条目本身整本都铺**
   * （见下面 `heights.map`），这里只管「哪几条是真位图」。
   */
  const windowed = useMemo(() => {
    const { first, last } = windowRange(win, s.numPages, WINDOW_BUFFER);
    const list: number[] = [];
    for (let p = first; p <= last; p++) list.push(p);
    return list;
  }, [win, s.numPages]);
  /** 给渲染用的 O(1) 查表（页位整本铺，逐条 `includes` 在大文档上是 O(n·窗口)） */
  const windowedSet = useMemo(() => new Set(windowed), [windowed]);

  /**
   * 记账 canvas 元素——🔴 **只登记、⛔ 不在 ref 交还 null 时清位图**。
   *
   * 实机踩过（2026-10-07）：`ref={(el) => setThumbRef(page, el)}` 里的箭头函数**每次渲染都是新身份**
   * ⇒ React 每次重渲染都「旧 ref 交还 null → 新 ref 再给元素」一轮，于是**还挂在屏上的 canvas**
   * 也被当成「拆掉了」清掉位图，症状 = 缩略图格子尺寸样式都在（`style.width` 是 renderPage 留下的）、
   * `canvas.width` 却是 0，怎么看都像「没渲染」。把外层包进 `useCallback` 也挡不住——变的是箭头本身。
   * 所以位图的清理交给**窗口淘汰**（下面那个 effect），ref 只负责登记。
   */
  const setThumbRef = useCallback((page: number, el: HTMLCanvasElement | null) => {
    if (el) canvasRefs.current.set(page, el);
  }, []);

  /**
   * 滚出窗口的条目：位图立即置 0 释放（不等 GC 心情），渲染记录同时作废（滚回来要重画）。
   *
   * 淘汰的判据是**窗口**（`windowed`），不是「条目有没有铺」——页位整本都铺着（见 `heights.map`），
   * 拿「DOM 里在不在」当判据会把整本页的位图都当成「还在窗口里」而永不释放。
   */
  useEffect(() => {
    for (const [page, canvas] of [...canvasRefs.current]) {
      if (windowedSet.has(page)) continue;
      canvas.width = 0;
      canvas.height = 0;
      canvasRefs.current.delete(page);
      renderedScale.current.delete(page);
    }
  }, [windowedSet]);

  // 换文档：渲染记录全清（旧页的位图不许当成新文档的「已渲染」）
  const docRef = useRef(s.doc);
  useEffect(() => {
    if (docRef.current !== s.doc) {
      docRef.current = s.doc;
      renderedScale.current.clear();
    }
  }, [s.doc]);

  // ── 懒渲染：单条 drain 循环逐页串行（每轮重读「当前」窗口与档位，不是闭包里那份）──
  const renderReqRef = useRef(false);
  const drainingRef = useRef(false);
  const windowedRef = useRef(windowed);
  windowedRef.current = windowed;
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

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
        for (const p of windowedRef.current) {
          if (renderReqRef.current) break; // 期间又滚动：让位重算窗口
          if (docRef.current !== doc) break;
          const canvas = canvasRefs.current.get(p);
          const size = sizesRef.current[p - 1];
          if (!canvas || !size) continue;
          const scale = thumbRenderScale(size);
          if (renderedScale.current.get(p) === scale) continue;
          try {
            await doc.renderPage(p, canvas, scale);
            // 渲完重认归属：期间滚出窗口的话这块 canvas 已被拆（或换文档），记进 renderedScale
            // 会让它滚回来时被当成「已渲染」而留白
            if (docRef.current !== doc || canvasRefs.current.get(p) !== canvas) continue;
            renderedScale.current.set(p, scale);
          } catch {
            // 单页缩略图渲不出来（畸形页）：这一格留白，正文照常——⛔ 不把阅读器推进错误态
          }
        }
      }
      drainingRef.current = false;
    })();
  }, [ready, s.doc, windowed, sizes, store]);

  const outline = s.outline;

  return (
    <aside className="pdf-reader-side" aria-label={t("缩略图侧栏")}>
      {outline.length > 0 && (
        <div className="pdf-reader-outline">
          <div className="pdf-reader-outline-head">{t("目录")}</div>
          <div className="pdf-reader-outline-list">
            <OutlineLevel items={outline} store={store} depth={0} />
          </div>
        </div>
      )}
      {/*
        🔴 **页位整本都铺**（`heights` 一项 = 一页，高度按该页长宽比先占好），只有窗口内才挂 canvas。
        实机踩过（2026-10-07）：早先只渲染窗口那几条 ⇒ 滚动容器的高度 = 那几条之和，**滚动范围被自己
        锁死**——20 页文档滚到「第 3~10 页」就到底了（`scrollTop` 顶在 mounted 那几条的底上），后面
        十几页的缩略图永远够不到；开栏「摆到当前页」也随之失效（深页开栏时 `scrollTop` 被夹回 0）。
        照 `readerSurface` 的同一形状修：占位全铺、位图窗内（那边是 `hasCanvas={canvasPages.has(page)}`）。
      */}
      <div className="pdf-reader-thumbs" role="group" aria-label={t("缩略图")} ref={scrollRef}>
        {heights.map((height, i) => (
          <ThumbRow
            key={i + 1}
            page={i + 1}
            height={height}
            label={t("跳到第 {{page}} 页", { page: i + 1 })}
            current={i + 1 === s.currentPage}
            hasCanvas={windowedSet.has(i + 1)}
            store={store}
            setThumbRef={setThumbRef}
          />
        ))}
      </div>
    </aside>
  );
}

/**
 * 一条缩略图**页位**：整本页都铺（高度先按长宽比占好，滚动条长度才等于整个文档），
 * 只有窗口内那几条 `hasCanvas` 才真挂 `<canvas>`（位图由窗口淘汰 effect 释放）。
 *
 * memo 是必须的：页位整本都铺之后，滚动/翻页引起的每次重渲染都会走一遍全部页位，
 * 几百页的文档里没必要为「窗口挪了一格」重画几百个按钮（阅读区那边同形状，见 `readerSurface`）。
 */
const ThumbRow = memo(function ThumbRow({
  page,
  height,
  label,
  current,
  hasCanvas,
  store,
  setThumbRef,
}: {
  page: number;
  height: number;
  label: string;
  current: boolean;
  hasCanvas: boolean;
  /** 整机 store 原样传进来：`gotoPage` 是**用 `this` 的方法**，剥成 `onJump={store.gotoPage}` 传会当场炸 */
  store: ReaderStore;
  setThumbRef: (page: number, el: HTMLCanvasElement | null) => void;
}) {
  return (
    <button
      type="button"
      className={"pdf-reader-thumb" + (current ? " pdf-reader-thumb-current" : "")}
      style={{ width: THUMB_WIDTH, height }}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      onClick={() => store.gotoPage(page)}
    >
      {hasCanvas && <canvas ref={(el) => setThumbRef(page, el)} className="pdf-reader-thumb-canvas" />}
    </button>
  );
});

/**
 * 一级目录（递归）。
 *
 * 🔴 只用**语义化的 ul/li ＋ 真 button**，⛔ 不挂 `role="tree"`：ARIA 树要求方向键在树内走位
 * （← → 收展、↑ ↓ 移动），本格没做那套键盘面——挂了 role 却不给完整键盘路径，比不挂更坏
 * （读屏用户按 tree 的规矩操作会卡住）。button 本身 Tab 可达、Enter/Space 可激活，够用且不撒谎。
 */
function OutlineLevel({ items, store, depth }: { items: readonly OutlineItem[]; store: ReaderStore; depth: number }) {
  return (
    <ul className="pdf-reader-outline-group">
      {items.map((item, i) => (
        <OutlineRow key={`${depth}.${i}`} item={item} store={store} depth={depth} />
      ))}
    </ul>
  );
}

const OutlineRow = memo(function OutlineRow({
  item,
  store,
  depth,
}: {
  item: OutlineItem;
  store: ReaderStore;
  depth: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hasChildren = item.children.length > 0;

  return (
    <li className="pdf-reader-outline-item">
      <div className="pdf-reader-outline-row" style={{ paddingLeft: depth * 10 }}>
        {hasChildren ? (
          <button
            type="button"
            className="pdf-reader-outline-toggle"
            data-pdf-open={open ? "true" : "false"}
            aria-expanded={open}
            aria-label={open ? t("收起") : t("展开")}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRightIcon size={12} />
          </button>
        ) : (
          // 叶子行的占位：与展开钮同宽，标题才能各级对齐（纯留白，不参与语义）
          <span className="pdf-reader-outline-dot" aria-hidden="true" />
        )}
        {item.page > 0 ? (
          <button
            type="button"
            className="pdf-reader-outline-label pdf-reader-outline-jump"
            // 揭示类提示（看全被省略号截断的标题）用宿主的提示渲染器（`data-hint`），
            // ⛔ 不写原生 title=（那套不跟主题/字号/翻面，见 check-native-title 腿）
            data-hint={item.title}
            data-hint-delay="0"
            onClick={() => store.gotoPage(item.page)}
          >
            {item.title}
          </button>
        ) : (
          // 没有可跳页的条目（外链/坏目标）：照原样显示，但**不给按钮**——⛔ 不立点不动的钮
          <span
            className="pdf-reader-outline-label pdf-reader-outline-static"
            data-hint={item.title}
            data-hint-delay="0"
          >
            {item.title}
          </span>
        )}
      </div>
      {hasChildren && open && <OutlineLevel items={item.children} store={store} depth={depth + 1} />}
    </li>
  );
});
