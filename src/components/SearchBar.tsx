/**
 * 搜索浮条（00.5 §一 工具栏位次「… ｜ 搜索 ｜ 底色切换」＋ §四「工具栏下方浮条，Enter 下一处 /
 * Shift+Enter 上一处，命中数 `3/17` 直读」）。
 *
 * 🔴 为什么是**绝对定位浮层**不是一行布局：搜索条若参与 flex 布局，开条那一刻阅读区高度变小，
 * ResizeObserver 立刻上报 → 适宽/适页重算 → **一开搜索就跳缩放**。浮在阅读区之上则阅读盒子
 * 尺寸纹丝不动（验收句：开关搜索条，百分比读数不变）。
 *
 * 本文件只消费 store 的搜索态（命中表/当前序号/扫描态与命令面同源一份），不认识 pdf.js——
 * 扫描与偏移算法住 `services/textLayer/`，高亮落笔住 `views/readerSurface/`。
 */
import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useReaderState, type ReaderStore } from "../views/readerStore";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, SearchIcon } from "./icons";

export default function SearchBar({ store }: { store: ReaderStore }) {
  const { t } = useTranslation();
  const s = useReaderState(store);
  const { open, query, hits, currentMatch, scanning } = s.search;
  const ready = s.phase.kind === "ready";
  const count = currentMatch + 1; // 0 = 还没定位到（与 getStatus 的 searchCurrent 同一口径）
  const inputRef = useRef<HTMLInputElement>(null);

  // 开条即聚焦（进条就能打字——浮条的唯一存在意义就是接键盘）
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      store.closeSearch();
      return;
    }
    if (e.key !== "Enter") return;
    // Enter = 下一处 / Shift+Enter = 上一处（pdf.js 与各家查找条同款；⛔ 不偷换成「提交查询」——
    // 查询是**边打边扫**的，Enter 只负责走位）
    e.preventDefault();
    store.searchStep(e.shiftKey ? -1 : 1);
  };

  return (
    <div className="pdf-reader-search" role="search" onKeyDown={onKeyDown}>
      <span className="pdf-reader-search-glass" aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        ref={inputRef}
        className="pdf-reader-search-input"
        type="text"
        aria-label={t("在文档中查找…")}
        placeholder={t("在文档中查找…")}
        value={query}
        disabled={!ready}
        onChange={(e) => store.setSearchQuery(e.target.value)}
      />
      {/* 命中数直读（00.5 §四）——aria-live 让读屏也听得到「第几处/共几处」；
          无命中给**文案**不给空白（空读数在查找族里最容易被当成还在扫） */}
      <span className="pdf-reader-search-count" aria-live="polite">
        {!ready ? "" : scanning ? t("扫描中…") : query.trim() === "" ? "" : hits.length === 0 ? t("无命中") : `${count}/${hits.length}`}
      </span>
      <button
        type="button"
        className="pdf-reader-search-btn"
        data-hint={t("上一处")}
        aria-label={t("上一处")}
        disabled={hits.length === 0}
        onClick={() => store.searchStep(-1)}
      >
        <ArrowUpIcon />
      </button>
      <button
        type="button"
        className="pdf-reader-search-btn"
        data-hint={t("下一处")}
        aria-label={t("下一处")}
        disabled={hits.length === 0}
        onClick={() => store.searchStep(1)}
      >
        <ArrowDownIcon />
      </button>
      <button
        type="button"
        className="pdf-reader-search-btn"
        data-hint={t("关闭搜索")}
        aria-label={t("关闭搜索")}
        onClick={() => store.closeSearch()}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
