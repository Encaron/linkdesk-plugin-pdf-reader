/**
 * 本插件的 16px 内联 SVG 图标集（照 06-设计图 §B；ui-ux-pro-max：SVG 图标、禁位图、禁 emoji 当图标）。
 *
 * 为什么住 `components/`（T5 归一）：T5 起图标有**两个消费方**——阅读器工具栏与搜索浮条
 * （00.5 §七 表：搜索钮住工具栏、搜索条住 `components/`）。一份图标表放在 `components/`
 * 让两边都按同一方向依赖（views → components），⛔ 不各存一份（两份 path 数据迟早画得不一样）。
 *
 * 口径：24 格视框、`stroke="currentColor"`、`stroke-width 2`——颜色一律由上下文给（跟主题），
 * 图标自身不认识任何色值（无硬编码判据）。
 */
interface IconProps {
  size?: number;
}

function base(size?: number) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function SidebarIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function PrevIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function NextIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ZoomOutIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="10" cy="10" r="6" />
      <path d="M20 20l-4.5-4.5M8 10h4" />
    </svg>
  );
}

export function ZoomInIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="10" cy="10" r="6" />
      <path d="M20 20l-4.5-4.5M10 8v4M8 10h4" />
    </svg>
  );
}

/** 底色切换（半填充圆——纸白/夜间对半） */
export function ContrastIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 搜索（放大镜——⛔ 不带 ± 号：那两位是缩小的语义，同屏出现会串味） */
export function SearchIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.9-3.9" />
    </svg>
  );
}

/** 关闭（搜索条的收条钮；Esc 与它同一动作） */
export function CloseIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** 上一处（查找的上一条——纵向箭头是查找族惯例，⛔ 别用翻页的横向箭头） */
export function ArrowUpIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

/** 下一处 */
export function ArrowDownIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

/** 目录树的展开箭头（收起时指右，展开时由 CSS 转 90°——⛔ 不为两个态各画一份 path） */
export function ChevronRightIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
