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
import { countOutline, loadPdf, PdfOpenError, type OutlineItem, type PdfDocument, type PageSize } from "../services/pdfDoc";
import { findMatches, pageTextOf } from "../services/textLayer";
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

/** 一处搜索命中——`index` 是**文档顺序**里的全局序号（上下导航与「当前命中」都认它，⛔ 不用页内号） */
export interface SearchHit {
  /** 命中所在页（1-based） */
  page: number;
  index: number;
  /** 在该页搜索文本里的起始偏移与长度（口径见 services/textLayer/search.ts 头注） */
  at: number;
  length: number;
}

/** 搜索态——一条链路的全部（搜索条、阅读区高亮、命令读数都从这一份出） */
export interface SearchState {
  open: boolean;
  query: string;
  /** 文档顺序的命中表；扫描中边扫边长（命中数直读靠它） */
  hits: readonly SearchHit[];
  /**
   * 当前命中在 `hits` 里的下标（-1 = 无命中/未定位）。
   * ⚠️ 名字**故意不叫 `current`**：JSX 里写 `s.search.current` 会被 `linkdesk/no-ref-current-in-jsx`
   * 判成「ref.current 参与渲染」（那条规则只认属性名，分不出 store 状态与 ref）——⛔ 别改回去。
   */
  currentMatch: number;
  scanning: boolean;
  /** 已扫完的页数——扫描中给「扫到哪了」的读数（全文档搜索没有真进度可言，这是唯一的实话） */
  scannedPages: number;
  /**
   * 「跳到某条命中」的序号——每次定位 +1。阅读区据此把该条滚进视野中央。
   * 🔴 别拿 `current` 当触发：同一页内换到另一条时 `current` 会变而页不变，
   * 但同页里**只有滚到该条**用户才看得见（长页尤其明显）。
   */
  jumpNonce: number;
}

function emptySearch(): SearchState {
  return { open: false, query: "", hits: [], currentMatch: -1, scanning: false, scannedPages: 0, jumpNonce: 0 };
}

/** 状态条与 getStatus 同源共用的结构化读数（00.5 §七；T4 命令化时就是命令返回值） */
export interface ReaderStatus {
  hasDocument: boolean;
  currentPage: number;
  numPages: number;
  scale: number;
  zoomMode: ZoomMode;
  bg: ReaderBg;
  sidebarOpen: boolean;
  /** 目录条目总数（含各级子项）——0 = 这份文档没有目录（或目录读不出来，两种都不当失败） */
  outlineCount: number;
  /** 搜索条是否展开 */
  searchOpen: boolean;
  searchQuery: string;
  /** 全文档命中数（扫描中会继续长） */
  searchHits: number;
  /** 当前命中的**序号（1-based）**；0 = 没有（无命中／还没定位到） */
  searchCurrent: number;
  searchScanning: boolean;
  /** 已扫完的页数（全文档搜索没有真进度，这是唯一的实话——扫描中给 AI 一个「在动」的凭据） */
  searchScannedPages: number;
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
  /** 文档目录（书签树）——随文档走，空数组 = 没有目录（T6） */
  outline: readonly OutlineItem[];
  search: SearchState;
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
    outline: [],
    search: emptySearch(),
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
    outlineCount: countOutline(this.state.outline),
    searchOpen: this.state.search.open,
    searchQuery: this.state.search.query,
    searchHits: this.state.search.hits.length,
    searchCurrent: this.state.search.currentMatch + 1, // 0 = 没有当前命中（1-based 与「第 3 处」同号）
    searchScanning: this.state.search.scanning,
    searchScannedPages: this.state.search.scannedPages,
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
      search: { ...emptySearch(), open: this.state.search.open }, // 命中表随文档走：换文件即清（搜索条开合留着）
      outline: [], // 目录随文档走：换文件即清（旧文档的书签留着会指到新文档的页上）
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
      void this.loadOutline(seq, doc);
    } catch (err) {
      if (seq !== this.openSeq) return;
      const error = err instanceof PdfOpenError ? err : new PdfOpenError("unknown", String(err));
      this.set({ phase: { kind: "error", error } });
    }
  }

  /**
   * 读目录（T6）——**在 ready 之后异步补**，⛔ 不挡阅读：目录读不出（畸形/无目录）就当没有，
   * 阅读器照常（书签是附加物，不是打开文档的必要条件）。落地前查 openSeq：换文件后旧目录作废。
   */
  private async loadOutline(seq: number, doc: PdfDocument): Promise<void> {
    let items: OutlineItem[] = [];
    try {
      items = await doc.outline();
    } catch {
      items = []; // 读不出来 ≠ 打开失败：如实给「没有目录」
    }
    if (seq !== this.openSeq) return;
    this.set({ outline: items });
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

  // ── 搜索（T5）──
  // 一条链路：SearchBar（查询串/上下导航）→ 本类扫全文档出命中表 → readerSurface 把命中画进文本层。
  // ⛔ 命中表只有这一份：⛔ 别让视图自己再扫一遍（两套偏移 = 命中框与字形分叉，见 services/textLayer/search.ts）。

  /** 扫描序号——改查询/关条/换文档都 +1，在途的旧扫描落地即弃（同 openSeq 的做法） */
  private searchSeq = 0;

  /** 打开搜索条（幂等；关条在搜索条自己的 ✕/Esc 上）——工具栏搜索钮与命令 openSearch 共用这一份 */
  openSearch(): void {
    if (this.state.search.open) return;
    this.set({ search: { ...this.state.search, open: true } });
  }

  /** 关闭搜索条 = 连命中表一起清（⛔ 别把半份命中留在背后：下次开条还是旧高亮，看着像新结果） */
  closeSearch(): void {
    this.searchSeq++;
    this.set({ search: { ...emptySearch(), jumpNonce: this.state.search.jumpNonce } });
  }

  /**
   * 改查询串 → 起一次全文档扫描。
   * 🔴 空串/纯空白 = 清命中表（不是「搜空白串」）；文档未就绪同理（如实给空表，不假装扫过）。
   * 旧扫描一律靠 `searchSeq` 自行收手——⛔ 不 abort pdf.js 取数：页文本在 pdf.js 侧有缓存，
   * 重扫同一页几乎零成本，而 abort 会把正在读的页一起连坐。
   */
  setSearchQuery(query: string): void {
    const seq = ++this.searchSeq;
    const doc = this.state.doc;
    const needle = query.trim();
    const idle = { ...this.state.search, query, hits: [], currentMatch: -1, scanning: false, scannedPages: 0 };
    if (!doc || this.state.phase.kind !== "ready" || needle === "") {
      this.set({ search: idle });
      return;
    }
    this.set({ search: { ...idle, scanning: true } });
    void this.scanAll(seq, doc, needle);
  }

  /** 逐页扫文本（页序 = 文档序，命中数边扫边长）；扫完定位并跳到该条所在页 */
  private async scanAll(seq: number, doc: PdfDocument, needle: string): Promise<void> {
    const hits: SearchHit[] = [];
    const numPages = this.state.numPages;
    for (let page = 1; page <= numPages; page++) {
      if (seq !== this.searchSeq) return; // 被新查询/关条/换文档顶掉：当场收手
      let text: string;
      try {
        text = pageTextOf(await doc.textContent(page)).text;
      } catch {
        continue; // 单页文本取不出来（畸形页）不该判死整场搜索——跳过它接着扫
      }
      if (seq !== this.searchSeq) return;
      for (const m of findMatches(text, needle)) hits.push({ page, index: hits.length, at: m.index, length: m.length });
      this.set({ search: { ...this.state.search, hits: hits.slice(), scannedPages: page } });
    }
    if (seq !== this.searchSeq) return;
    // 落点从**当前页**起找第一条（读到这里的人多半在找眼前这一段）；当前页往后没有就回文档头一条
    // （与上下导航同样是环形回绕，⛔ 不因为「眼前没命中」就停在无当前态）
    let currentMatch = -1;
    if (hits.length > 0) {
      const from = hits.findIndex((h) => h.page >= this.state.currentPage);
      currentMatch = from < 0 ? 0 : from;
    }
    this.set({
      search: {
        ...this.state.search,
        hits,
        currentMatch,
        scanning: false,
        scannedPages: numPages,
        jumpNonce: currentMatch >= 0 ? this.state.search.jumpNonce + 1 : this.state.search.jumpNonce,
      },
    });
    if (currentMatch >= 0) this.gotoPage(hits[currentMatch].page);
  }

  /**
   * 上下走一处（Enter / Shift+Enter）——**环形回绕**（末尾的下一条是第一处，pdf.js 查找同款）。
   * 返回是否真的动了（没命中时 false，调用方据此如实回话，⛔ 不假装跳了）。
   */
  searchStep(delta: 1 | -1): boolean {
    const { hits, currentMatch } = this.state.search;
    if (hits.length === 0) return false;
    const next = currentMatch < 0 ? (delta > 0 ? 0 : hits.length - 1) : (currentMatch + delta + hits.length) % hits.length;
    this.set({ search: { ...this.state.search, currentMatch: next, jumpNonce: this.state.search.jumpNonce + 1 } });
    this.gotoPage(hits[next].page);
    return true;
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
