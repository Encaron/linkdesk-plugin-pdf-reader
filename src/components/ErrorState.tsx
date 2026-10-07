/**
 * 错误态两式一骨架（损坏态／加密态——照 editor 仓 BinaryNotice 同款，00.5 §三 2026-10-07 拍板）。
 *
 * 两颗**探测接线**钮，动作面不在就隐藏（⛔ 不留死钮）：
 * - 「打开方式…」——宿主命令 `SHELL_COMMANDS.openWith`（SDK 子路径）在册才出现；
 * - 「在市场搜索阅读器」——市场插件在册才出现，动作 = 揭示其侧栏（icon:selected 同路径）。
 * 🔴 无「仍旧以本插件强开」钮/命令——pdf 无文本兜底角色（2026-10-07 用户拍板）。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@linkdesk/ui";
import { SHELL_COMMANDS, openWith } from "@linkdesk/plugin-sdk/shell-commands";
import type { PdfOpenError } from "../services/pdfDoc";
import { ERROR_NAME_VAR, errorCopy } from "./errorCopy";

const lk = () => window.linkdesk;

/** 市场插件 id——揭示其侧栏容器（与点图标栏同一路径，BinaryNotice 同款先例） */
const MARKETPLACE_PLUGIN_ID = "marketplace";

export default function ErrorState({ filePath, error }: { filePath: string; error: PdfOpenError }) {
  const { t } = useTranslation();
  const [canSearchMarket, setCanSearchMarket] = useState(false);
  const [canOpenWith, setCanOpenWith] = useState(false);

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() || filePath, [filePath]);
  /**
   * 选键（标题／说明／是否补原文／图标）归 `errorCopy.ts` 一张表——⛔ 不在 JSX 里判 kind。
   * 🔴 「读不到文件」与「文件是坏的」给用户的下一个动作相反（去查占用·路径 vs 去别处找副本），
   * 表里刻意分成两档说明句，别为了少一句文案把它们合并（实机把渲染期异常也说成「损坏」会带偏排查）。
   */
  const copy = errorCopy(error.kind);
  const desc = copy.descUsesName ? t(copy.descKey, { [ERROR_NAME_VAR]: fileName }) : t(copy.descKey);

  // 探面：市场插件在不在（旧壳或插件缺席 ⇒ 按钮隐藏）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await lk().pluginManager?.list?.();
        if (!cancelled) setCanSearchMarket(!!list?.some((p) => p.pluginId === MARKETPLACE_PLUGIN_ID));
      } catch {
        /* 探测失败 = 面不在 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 探面：宿主「打开方式」命令在不在册
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await lk().commands?.getCommands?.();
        if (!cancelled) setCanOpenWith(!!list?.some((c) => c?.id === SHELL_COMMANDS.openWith));
      } catch {
        /* 探测失败 = 面不在 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenWith = () => {
    openWith({ uri: filePath, name: fileName, ext: "pdf" });
  };

  const handleSearchMarket = () => {
    // 市场侧栏的搜索词是市场插件内部 state ⇒ v1 只揭示市场侧栏；已在市场容器上则不再发。
    type LayoutProbe = { getLayout?: () => { sidebar?: { containerId?: string | null } } | null };
    const probe = (lk().pool as unknown as LayoutProbe | undefined)?.getLayout;
    const current = typeof probe === "function" ? probe.call(lk().pool)?.sidebar?.containerId : undefined;
    if (current === MARKETPLACE_PLUGIN_ID) return;
    lk().events?.emit("icon:selected", MARKETPLACE_PLUGIN_ID);
  };

  return (
    <div className="pdf-reader-error">
      {copy.icon === "lock" ? (
        <svg className="pdf-reader-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      ) : (
        <svg className="pdf-reader-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M12 11v4M12 18.5v.5" />
        </svg>
      )}
      <div className="pdf-reader-error-title">{t(copy.titleKey)}</div>
      <div className="pdf-reader-error-desc">{desc}</div>
      {copy.showDetail && error.message && <div className="pdf-reader-error-detail">{error.message}</div>}
      <div className="pdf-reader-error-actions">
        {canOpenWith && (
          <Button variant="ghost" onClick={handleOpenWith}>
            {t("打开方式…")}
          </Button>
        )}
        {canSearchMarket && (
          <Button variant="ghost" onClick={handleSearchMarket}>
            {t("在市场搜索阅读器")}
          </Button>
        )}
      </div>
    </div>
  );
}
