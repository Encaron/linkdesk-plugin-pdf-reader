/**
 * PDF 阅读器——LinkDesk 插件主视图。
 *
 * 视图插件契约：壳以 { isActive, tabId?, sourceId? } 渲染 default 导出的组件。
 * sourceId = 打开的 pdf 文件路径（fileAssociations 路由进来，tabBehavior.identityField = "filePath"）。
 * T2：装配 loadPdf 引擎渲染第一页（UI 糙是本格预期——工具栏/底色/虚拟化属 T3）。
 *
 * 样式：壳主题色一律 var(--xxx)，类名一律 pdf-reader- 前缀（一张样式表全局共享，禁裸类名）。
 * 文案：t()——key 就是中文原文，英译住 i18n/en.json。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadPdf, type PdfDocument } from "./services/pdfDoc";
import "./index.css";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; numPages: number }
  | { kind: "error"; message: string };

export default function PdfReaderView({ sourceId }: { sourceId?: string }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    if (!sourceId) return;
    // 活跃守卫（keep-alive／换文件／StrictMode 双跑）：过期回调用 cancelled 丢弃，引擎句柄必 destroy。
    let cancelled = false;
    let handle: PdfDocument | null = null;
    let rendering: Promise<void> | null = null;
    setPhase({ kind: "loading" });
    (async () => {
      try {
        handle = await loadPdf(sourceId);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("canvas mount missing");
        rendering = handle.renderPage(1, canvas);
        await rendering;
        rendering = null;
        if (cancelled) return;
        setPhase({ kind: "ready", numPages: handle.numPages });
      } catch (err) {
        if (!cancelled) {
          setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
      // 渲染进行中先等它落地再销毁（渲染中途 destroy 会以 abort 报错收场，属预期）
      (rendering ?? Promise.resolve()).catch(() => {}).then(() => void handle?.destroy());
    };
  }, [sourceId]);

  if (!sourceId) {
    return (
      <div className="pdf-reader-shell">
        <p className="pdf-reader-shell__hint">{t("从文件树打开一个 pdf 文件。")}</p>
      </div>
    );
  }

  return (
    <div className="pdf-reader-shell">
      <canvas ref={canvasRef} className="pdf-reader-canvas" />
      {phase.kind === "loading" && <p className="pdf-reader-meta">{t("加载中…")}</p>}
      {phase.kind === "ready" && (
        <p className="pdf-reader-meta">{t("第 1 页 · 共 {{total}} 页", { total: phase.numPages })}</p>
      )}
      {phase.kind === "error" && (
        <p className="pdf-reader-meta" role="alert">
          {t("加载失败：{{message}}", { message: phase.message })}
        </p>
      )}
    </div>
  );
}
