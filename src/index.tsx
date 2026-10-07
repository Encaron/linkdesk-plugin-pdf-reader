/**
 * PDF 阅读器——LinkDesk 插件入口。
 *
 * 视图插件契约：壳以 { isActive, tabId?, sourceId? } 渲染 default 导出的组件。
 * sourceId = 打开的 pdf 文件路径（fileAssociations 路由进来，tabBehavior.identityField = "filePath"）。
 * 本文件只做装配（03-工程目录规范：入口不放业务）——阅读器主体在 views/ReaderView。
 */

import { useTranslation } from "react-i18next";
import ReaderView from "./views/ReaderView";
import "./styles/tokens.css";
import "./styles/reader.css";

export default function PdfReaderView({ sourceId }: { sourceId?: string }) {
  const { t } = useTranslation();
  if (!sourceId) {
    return <div className="pdf-reader-hint">{t("从文件树打开一个 pdf 文件。")}</div>;
  }
  return <ReaderView filePath={sourceId} />;
}
