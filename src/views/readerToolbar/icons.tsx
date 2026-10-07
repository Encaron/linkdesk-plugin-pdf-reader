/**
 * 工具栏图标（内联 SVG，16px 线稿——照 06-设计图 §B；ui-ux-pro-max：SVG 图标、禁位图）。
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
