/**
 * 阅读器工具栏（40px，照 00.5 §一 ＋ 06-设计图 §B；图标钮 28×28、悬停 150ms、焦点环键盘可达）。
 *
 * 布局：侧栏开关 · 上一页 · 页码框（输入跳页）· 下一页 ｜ 缩小 · 百分比（点击回 100%）·
 * 放大 · 适宽 · 适页 ｜ 底色切换。搜索位 T5 到位（00.5 §七：搜索钮 T5 建钮——本格不建，无死代码）。
 * 全部动作走 store 的同一份动作函数——T4 命令化时命令 handler 调的就是它们。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useReaderState, type ReaderStore } from "../readerStore";
import { ContrastIcon, NextIcon, PrevIcon, SidebarIcon, ZoomInIcon, ZoomOutIcon } from "./icons";

export function ReaderToolbar({ store }: { store: ReaderStore }) {
  const { t } = useTranslation();
  const s = useReaderState(store);
  const atFirst = s.currentPage <= 1;
  const atLast = s.currentPage >= s.numPages;

  return (
    <div className="pdf-reader-toolbar" role="toolbar" aria-label={t("阅读器工具栏")}>
      <button
        type="button"
        className="pdf-reader-tbtn"
        data-hint={t("缩略图侧栏")}
        aria-label={t("缩略图侧栏")}
        aria-pressed={s.sidebarOpen}
        onClick={() => store.toggleSidebar()}
      >
        <SidebarIcon />
      </button>
      <button
        type="button"
        className="pdf-reader-tbtn"
        data-hint={t("上一页")}
        aria-label={t("上一页")}
        disabled={atFirst}
        onClick={() => store.pagePrev()}
      >
        <PrevIcon />
      </button>
      <PageBox store={store} page={s.currentPage} total={s.numPages} />
      <button
        type="button"
        className="pdf-reader-tbtn"
        data-hint={t("下一页")}
        aria-label={t("下一页")}
        disabled={atLast}
        onClick={() => store.pageNext()}
      >
        <NextIcon />
      </button>

      <span className="pdf-reader-toolbar-sep" aria-hidden="true" />

      <button type="button" className="pdf-reader-tbtn" data-hint={t("缩小")} aria-label={t("缩小")} onClick={() => store.zoomOut()}>
        <ZoomOutIcon />
      </button>
      <button
        type="button"
        className="pdf-reader-pct"
        data-hint={t("重置为 100%")}
        onClick={() => store.zoomTo(1)}
      >
        {Math.round(s.scale * 100)}%
      </button>
      <button type="button" className="pdf-reader-tbtn" data-hint={t("放大")} aria-label={t("放大")} onClick={() => store.zoomIn()}>
        <ZoomInIcon />
      </button>
      <button
        type="button"
        className={"pdf-reader-tbtn-wide" + (s.zoomMode === "fitWidth" ? " active" : "")}
        aria-pressed={s.zoomMode === "fitWidth"}
        onClick={() => store.setZoomMode("fitWidth")}
      >
        {t("适宽")}
      </button>
      <button
        type="button"
        className={"pdf-reader-tbtn-wide" + (s.zoomMode === "fitPage" ? " active" : "")}
        aria-pressed={s.zoomMode === "fitPage"}
        onClick={() => store.setZoomMode("fitPage")}
      >
        {t("适页")}
      </button>

      <span className="pdf-reader-toolbar-sep" aria-hidden="true" />

      <button
        type="button"
        className="pdf-reader-tbtn"
        data-hint={t("切换底色")}
        aria-label={t("切换底色")}
        onClick={() => store.setBackground(s.bg === "paper" ? "night" : "paper")}
      >
        <ContrastIcon />
      </button>
    </div>
  );
}

/** 页码框「7 / 132」——聚焦全选，Enter 跳页，Esc 还原（00.5 §七：页码框输入跳页） */
function PageBox({ store, page, total }: { store: ReaderStore; page: number; total: number }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const commit = () => {
    if (editing !== null) {
      const n = Number.parseInt(editing, 10);
      if (Number.isFinite(n)) store.gotoPage(n);
    }
    setEditing(null);
  };
  return (
    <input
      className="pdf-reader-pagebox"
      aria-label={t("跳转到指定页")}
      value={editing ?? `${page} / ${total}`}
      onChange={(e) => setEditing(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setEditing(null);
      }}
    />
  );
}
