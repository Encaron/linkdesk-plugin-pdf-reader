/**
 * 错误态的**选键**——kind → 标题／说明／细节／图标（T7 从 `ErrorState.tsx` 的内联三元抽出）。
 *
 * 组件里原本是三段嵌套三元，实机只跑到过「加密」这一支，其余三支靠读代码。抽成纯查表后四种
 * kind 逐条可钉，且「哪一档说哪句话」这件事不再埋在 JSX 里。
 *
 * 只回**键与旗子**、⛔ 不回译文（这里不调 `t()`）：译文归 i18n 字典，本文件只管取舍。
 */
import type { PdfOpenErrorKind } from "../services/pdfDoc";

export interface ErrorCopy {
  /** 标题键——损坏态与读取失败共用「无法打开」，加密态另起一档 */
  titleKey: string;
  /** 说明句键 */
  descKey: string;
  /** 说明句要插文件名（文案里的 `{{name}}`）——「文件是坏的」得指名道姓 */
  descUsesName: boolean;
  /** 是否补一行底层错误原文（异常原文对排查有用，但只在真有异常的那两档才出现） */
  showDetail: boolean;
  /** 区中央图标：lock = 加密，document = 损坏／读不到 */
  icon: "lock" | "document";
}

/** 参数化说明句的文件名占位——与 i18n 字典里 `{{name}}` 拼写一致 */
export const ERROR_NAME_VAR = "name";

const COPIES: Record<PdfOpenErrorKind, ErrorCopy> = {
  encrypted: {
    titleKey: "此 PDF 已加密",
    descKey: "暂不支持打开受密码保护的文件。",
    descUsesName: false,
    // 加密是**判定的结论**（pdf.js 抛 PasswordException），没有可查的异常原文
    showDetail: false,
    icon: "lock",
  },
  // 损坏与读取失败共用标题，但说明句说实话——两者的下一个动作相反
  // （去别处找副本 vs 去查占用/路径），见下面 §errorCopy 的告警
  invalid: {
    titleKey: "此 PDF 无法打开",
    descKey: "「{{name}}」损坏或不是有效的 PDF 格式。",
    descUsesName: true,
    showDetail: false,
    icon: "document",
  },
  read: {
    titleKey: "此 PDF 无法打开",
    descKey: "读不到「{{name}}」——文件可能已被移走，或被别的程序占用。",
    descUsesName: true,
    showDetail: true,
    icon: "document",
  },
  unknown: {
    titleKey: "此 PDF 无法打开",
    descKey: "读不到「{{name}}」——文件可能已被移走，或被别的程序占用。",
    descUsesName: true,
    showDetail: true,
    icon: "document",
  },
};

/**
 * 取该 kind 的错误态文案取舍。
 *
 * 🔴 **`unknown` 走「读不到」那一档，⛔ 不并入「损坏」。** 渲染期异常也归到 `unknown`（见
 * `loadPdf.ts` 的 `PdfOpenError` 三分支之外那一支），把它说成「文件损坏」会把排查方向带偏
 * （实机踩过：报「损坏」，实际是路径/占用问题）。要改这条口径就动这张表，别在 JSX 里补特例。
 */
export function errorCopy(kind: PdfOpenErrorKind): ErrorCopy {
  return COPIES[kind];
}
