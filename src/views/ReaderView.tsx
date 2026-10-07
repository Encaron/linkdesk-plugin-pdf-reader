/**
 * 阅读器装配根（00.5 §一：工具栏 40px ＋ 阅读区 ＋ 状态条 24px）。
 *
 * 根类 `pdf-reader` ＋ `data-pdf-bg="paper|night"` 换底色档（token 唯一定义在 styles/tokens.css，
 * 阅读区不跟壳主题——用户拍板的有意例外）；工具栏/状态条消费壳主题 token（跟主题）。
 * 键盘路径：方向键 PgUp/PgDn 翻页（非鼠标路径；命令面 T4 命令化补齐）。
 */
import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import ErrorState from "../components/ErrorState";
import { useReaderState, createReaderStore } from "./readerStore";
import { ReaderToolbar } from "./readerToolbar";
import { ReaderSurface } from "./readerSurface";

export default function ReaderView({ filePath }: { filePath: string }) {
  const { t } = useTranslation();
  const [store] = useState(createReaderStore);
  const s = useReaderState(store);

  // 活跃守卫（StrictMode 双跑／换文件）：store.open 幂等（新 open 弃在途旧加载），卸载即 destroy
  useEffect(() => {
    void store.open(filePath);
    return () => {
      void store.dispose();
    };
  }, [filePath, store]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return; // 页码框里别劫持方向键
    if (e.key === "PageDown" || e.key === "ArrowRight") {
      e.preventDefault();
      store.pageNext();
    } else if (e.key === "PageUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      store.pagePrev();
    }
  };

  const status = store.getStatus();

  return (
    <div className="pdf-reader-root" data-pdf-bg={s.bg} onKeyDown={onKeyDown}>
      {s.phase.kind === "error" ? (
        <ErrorState filePath={filePath} error={s.phase.error} />
      ) : (
        <>
          <ReaderToolbar store={store} />
          <ReaderSurface store={store} />
          <div className="pdf-reader-status" role="status">
            <span>{t("第 {{page}} 页 / 共 {{total}} 页", { page: status.currentPage, total: status.numPages })}</span>
            <span>
              {t("缩放")} {Math.round(status.scale * 100)}%
              {status.zoomMode === "fitWidth" ? ` · ${t("适宽")}` : status.zoomMode === "fitPage" ? ` · ${t("适页")}` : ""}
            </span>
            <span>{t("底色：{{name}}", { name: status.bg === "paper" ? t("纸白") : t("夜间") })}</span>
          </div>
        </>
      )}
    </div>
  );
}
