/**
 * 阅读器状态链路——视图与（T4 的）命令共用的唯一状态源（21-插件命令化规范 §四.1：
 * 命令 handler 必须落在这条链路上，不许绕开）。
 *
 * 一份打开的文档一个 store 实例（视图 mount 时创建）；动作函数是按钮 onClick 与命令
 * handler 共用的同一份（规范 §四.2：禁复制两份实现）。
 * 缩放一律倍率数字（1.0 = 100%）；适宽/适页是模式，倍率随视口重算；页码一律 1-based。
 */
import { useSyncExternalStore } from "react";
import { PAGE_GAP, READING_PAD } from "../constants";
import { loadPdf, PdfOpenError, type PdfDocument, type PageSize } from "../services/pdfDoc";
import { clampScale, fitPageScale, fitWidthScale, zoomInScale, zoomOutScale } from "../utils/zoom";
import type { ZoomMode } from "../utils/zoom";

/** ZoomMode 的唯一定义在 utils/zoom（配置解析也用同一个联合类型）——此处转出，既有导入路径不破 */
export type { ZoomMode };
/** 底色档：纸白｜夜间（用户 2026-10-07 拍板两档；sepia 留档不建枚举值——无死代码） */
export type ReaderBg = "paper" | "night";

export type ReaderPhase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; error: PdfOpenError };

/** 状态条与 getStatus 同源共用的结构化读数（00.5 §七；T4 命令化时就是命令返回值） */
export interface ReaderStatus {
  hasDocument: boolean;
  currentPage: number;
  numPages: number;
  scale: number;
  zoomMode: ZoomMode;
  bg: ReaderBg;
  sidebarOpen: boolean;
}

export interface ReaderState {
  phase: ReaderPhase;
  numPages: number;
  /** scale 1 尺寸；未实测的页按 defaultSize（首页）铺位 */
  defaultSize: PageSize | null;
  pageSizes: ReadonlyMap<number, PageSize>;
  /** pageSizes 变更时 +1，布局层据此重算偏移 */
  sizesVersion: number;
  currentPage: number;
  scale: number;
  zoomMode: ZoomMode;
  bg: ReaderBg;
  sidebarOpen: boolean;
  doc: PdfDocument | null;
  /** gotoPage 的滚动请求——readerSurface 消费后按 nonce 去重 */
  scrollTarget: { page: number; nonce: number } | null;
}

const DEFAULT_PAGE_SIZE: PageSize = { width: 595, height: 842 }; // A4 pt——defaultSize 测出前的兜底

export class ReaderStore {
  private listeners = new Set<() => void>();
  private openSeq = 0;
  private scrollNonce = 0;
  /** 用户是否自己缩放过（任一缩放动作置真）——配置默认档只在它还是 false 时生效 */
  private userZoomed = false;
  private state: ReaderState = {
    phase: { kind: "loading" },
    numPages: 0,
    defaultSize: null,
    pageSizes: new Map(),
    sizesVersion: 0,
    currentPage: 1,
    // 出厂默认适宽（用户拍板）；视图挂载时若有配置 pdf-reader.defaultZoom 则经 applyDefaultZoom 覆盖
    scale: 1,
    zoomMode: "fitWidth",
    bg: "paper",
    sidebarOpen: false,
    doc: null,
    scrollTarget: null,
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ReaderState => this.state;

  /** 状态条与 T4 getStatus 的同源读数——禁止另算第二份 */
  getStatus = (): ReaderStatus => ({
    hasDocument: this.state.doc !== null,
    currentPage: this.state.currentPage,
    numPages: this.state.numPages,
    scale: this.state.scale,
    zoomMode: this.state.zoomMode,
    bg: this.state.bg,
    sidebarOpen: this.state.sidebarOpen,
  });

  private set(patch: Partial<ReaderState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** 打开文档（幂等：新 open 递增序号，在途的旧加载落地即弃）。 */
  async open(filePath: string): Promise<void> {
    const seq = ++this.openSeq;
    await this.destroyDoc();
    this.set({
      phase: { kind: "loading" },
      numPages: 0,
      defaultSize: null,
      pageSizes: new Map(),
      sizesVersion: this.state.sizesVersion + 1,
      currentPage: 1,
      scrollTarget: null,
      doc: null,
    });
    try {
      const doc = await loadPdf(filePath);
      if (seq !== this.openSeq) {
        void doc.destroy();
        return;
      }
      let size: PageSize | null = null;
      try {
        size = await doc.pageSize(1);
      } catch {
        /* 首页尺寸测不出就用 A4 兜底，文档照开 */
      }
      if (seq !== this.openSeq) {
        void doc.destroy();
        return;
      }
      this.set({
        doc,
        phase: { kind: "ready" },
        numPages: doc.numPages,
        defaultSize: size ?? DEFAULT_PAGE_SIZE,
        pageSizes: size ? new Map([[1, size]]) : new Map(),
        sizesVersion: this.state.sizesVersion + 1,
      });
      this.recomputeFit();
    } catch (err) {
      if (seq !== this.openSeq) return;
      const error = err instanceof PdfOpenError ? err : new PdfOpenError("unknown", String(err));
      this.set({ phase: { kind: "error", error } });
    }
  }

  /** 视图卸载（关标签）时释放文档与 worker。 */
  async dispose(): Promise<void> {
    this.openSeq++;
    await this.destroyDoc();
  }

  private async destroyDoc(): Promise<void> {
    const doc = this.state.doc;
    if (doc) {
      this.set({ doc: null });
      await doc.destroy().catch(() => {});
    }
  }

  // ── 翻页 ──
  gotoPage(page: number): void {
    if (this.state.numPages <= 0 || this.state.phase.kind !== "ready") return;
    const target = Math.min(this.state.numPages, Math.max(1, Math.floor(page)));
    if (target === this.state.currentPage && this.state.scrollTarget?.page === target) return;
    this.set({
      currentPage: target,
      scrollTarget: { page: target, nonce: ++this.scrollNonce },
    });
  }

  pageNext(): void {
    this.gotoPage(this.state.currentPage + 1);
  }

  pagePrev(): void {
    this.gotoPage(this.state.currentPage - 1);
  }

  /** 滚动驱动：readerSurface 按可视页回写当前页（不算用户动作，不发滚动请求） */
  setCurrentPage(page: number): void {
    if (page >= 1 && page <= this.state.numPages && page !== this.state.currentPage) {
      this.set({ currentPage: page });
    }
  }

  // ── 缩放 ──
  zoomIn(): void {
    this.userZoomed = true;
    this.set({ scale: zoomInScale(this.state.scale), zoomMode: "percent" });
  }

  zoomOut(): void {
    this.userZoomed = true;
    this.set({ scale: zoomOutScale(this.state.scale), zoomMode: "percent" });
  }

  /** 百分比钮点击回 100%；带参即任意倍率（T4 pdf-reader.zoomTo） */
  zoomTo(scale: number): void {
    this.userZoomed = true;
    this.set({ scale: clampScale(scale), zoomMode: "percent" });
  }

  /** 适宽/适页是模式（窗口 resize 跟随）；percent = 自由倍率，保持当前 scale */
  setZoomMode(mode: ZoomMode): void {
    this.userZoomed = true;
    if (mode === this.state.zoomMode) return;
    this.set({ zoomMode: mode });
    this.recomputeFit();
  }

  /**
   * 应用配置项 `pdf-reader.defaultZoom`（T4）——只在用户还没自己缩放过时生效。
   * 用户一动缩放（钮／命令）就地锁定，之后的配置读数不再回头覆盖（配置是异步读来的，
   * 晚到的那一拍不能踩掉用户刚做的操作）。percent 档的「默认」即 100%（倍率 1）。
   */
  applyDefaultZoom(mode: ZoomMode): void {
    if (this.userZoomed || mode === this.state.zoomMode) return;
    this.set(mode === "percent" ? { zoomMode: mode, scale: 1 } : { zoomMode: mode });
    this.recomputeFit();
  }

  /** readerSurface 上报视口尺寸——适宽/适页据此重算（resize 跟随的落点） */
  reportViewport(width: number, height: number): void {
    // 隐藏标签页（keep-alive 后台）与首帧前布局会报 0——那不是「窗口变窄了」，
    // 照 0 算适宽会得到无意义的倍率（0.25 或回退 1）并触发空转重渲。丢掉这次读数，
    // 切回前台时 ResizeObserver 会带真实尺寸再来一次。
    if (width <= 0 || height <= 0) return;
    this.viewport = { width, height };
    this.recomputeFit();
  }

  // 视口尺寸不进 React 状态（只在适宽/适页重算时消费，避免每次 resize 全树重渲）
  private viewport: { width: number; height: number } | null = null;

  private recomputeFit(): void {
    const { zoomMode, defaultSize, scale } = this.state;
    const viewport = this.viewport;
    if (zoomMode === "percent" || !viewport || !defaultSize) return;
    const availableWidth = viewport.width - READING_PAD * 2;
    const availableHeight = viewport.height - PAGE_GAP * 2;
    const next =
      zoomMode === "fitWidth"
        ? fitWidthScale(availableWidth, defaultSize.width)
        : fitPageScale(availableWidth, availableHeight, defaultSize.width, defaultSize.height);
    if (next !== scale) this.set({ scale: next });
  }

  /** readerSurface 实测某页尺寸后回填（与铺位估计差半像素以上才算变了） */
  measurePage(page: number, size: PageSize): void {
    const known = this.state.pageSizes.get(page) ?? this.state.defaultSize;
    if (known && Math.abs(known.width - size.width) < 0.5 && Math.abs(known.height - size.height) < 0.5) return;
    const pageSizes = new Map(this.state.pageSizes);
    pageSizes.set(page, size);
    this.set({ pageSizes, sizesVersion: this.state.sizesVersion + 1 });
    this.recomputeFit();
  }

  // ── 底色与侧栏 ──
  setBackground(bg: ReaderBg): void {
    if (bg !== this.state.bg) this.set({ bg });
  }

  toggleSidebar(): void {
    this.set({ sidebarOpen: !this.state.sidebarOpen });
  }

  /** 渲染期非 abort 错误——文档会话视为失败，错误态接管 */
  reportError(err: Error): void {
    const error = err instanceof PdfOpenError ? err : new PdfOpenError("unknown", err.message);
    this.set({ phase: { kind: "error", error } });
  }
}

export function createReaderStore(): ReaderStore {
  return new ReaderStore();
}

/** React 绑定：视图组件经它订阅 store（useSyncExternalStore 要求快照引用稳定，set 已保证） */
export function useReaderState(store: ReaderStore): ReaderState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
