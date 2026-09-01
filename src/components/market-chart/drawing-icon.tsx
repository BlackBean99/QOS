import type { DrawingKind } from "@/src/domain/stored-strategy";

interface Props {
  kind: DrawingKind;
}

export function DrawingIcon({ kind }: Props) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    "data-drawing-icon": kind,
  };

  if (["horizontal_line", "horizontal_ray", "horizontal_segment", "price_line"].includes(kind)) {
    return (
      <svg {...common}>
        <path d="M3 12h18" />
        {kind === "horizontal_segment" ? <path d="M5 9v6M19 9v6" /> : null}
        {kind === "horizontal_ray" ? <path d="m18 9 3 3-3 3" /> : null}
        {kind === "price_line" ? <circle cx="5" cy="12" r="2" /> : null}
      </svg>
    );
  }
  if (["vertical_line", "vertical_ray", "vertical_segment"].includes(kind)) {
    return (
      <svg {...common}>
        <path d="M12 3v18" />
        {kind === "vertical_segment" ? <path d="M9 5h6M9 19h6" /> : null}
        {kind === "vertical_ray" ? <path d="m9 18 3 3 3-3" /> : null}
      </svg>
    );
  }
  if (["trend_line", "straight_line", "ray"].includes(kind)) {
    return (
      <svg {...common}>
        <path d="M4 18 19 5" />
        {kind === "trend_line" ? <path d="M3 16v4h4M17 4h4v4" /> : null}
        {kind === "ray" ? <path d="m16 5 5-1-1 5" /> : null}
      </svg>
    );
  }
  if (["parallel_lines", "price_channel", "pitchfork"].includes(kind)) {
    return (
      <svg {...common}>
        <path d="M3 16 17 4M7 20 21 8" />
        {kind !== "parallel_lines" ? <path d="M5 18 19 6" strokeDasharray="2 2" /> : null}
      </svg>
    );
  }
  if (["fibonacci", "fan"].includes(kind)) {
    return (
      <svg {...common}>
        <path d="M4 19V5M4 19h16M4 15h13M4 11h10M4 7h7" />
        {kind === "fan" ? <path d="M4 19 20 5M4 19l16-7" /> : null}
      </svg>
    );
  }
  if (kind === "rectangle") {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="14" />
      </svg>
    );
  }
  if (kind === "brush") {
    return (
      <svg {...common}>
        <path d="M4 18c3-8 5 3 8-5s5 1 8-7" />
      </svg>
    );
  }
  if (kind === "annotation" || kind === "tag") {
    return (
      <svg {...common}>
        {kind === "annotation" ? (
          <path d="M5 5h14v11H9l-4 4V5Z" />
        ) : (
          <path d="M4 6v8l7 7 9-9-7-7H5a1 1 0 0 0-1 1Z" />
        )}
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 19 12 5l8 14M7 15h10" />
    </svg>
  );
}
