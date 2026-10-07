/**
 * PDF 阅读器——LinkDesk 插件主视图。
 *
 * 视图插件契约：壳以 { isActive, tabId?, sourceId? } 渲染 default 导出的组件。
 * sourceId = 打开的 pdf 文件路径（fileAssociations 路由进来，tabBehavior.identityField = "filePath"）。
 * T1 只立标签页骨架；阅读器主体（工具栏 / canvas / 虚拟化）由 T3 照 00.5-UI布局规格 施工。
 *
 * 样式：壳主题色一律 var(--xxx)，类名一律 pdf-reader- 前缀（一张样式表全局共享，禁裸类名）。
 * 文案：t()——key 就是中文原文，英译住 i18n/en.json。
 */

import { useTranslation } from "react-i18next";
import "./index.css";

export default function PdfReaderView(props: { isActive?: boolean; tabId?: string; sourceId?: string }) {
  const { t } = useTranslation();
  const filePath = props.sourceId;

  return (
    <div className="pdf-reader-shell">
      <p className="pdf-reader-shell__title">{t("PDF 阅读器")}</p>
      {filePath ? (
        <p className="pdf-reader-shell__path">{filePath}</p>
      ) : (
        <p className="pdf-reader-shell__hint">{t("从文件树打开一个 pdf 文件。")}</p>
      )}
    </div>
  );
}
