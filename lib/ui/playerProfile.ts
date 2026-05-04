import type { CSSProperties } from "react";

export const PLAYER_PROFILE_COLORS = [
  { name: "Domyslny", value: "" },
  { name: "Lodowy blekit", value: "#bdefff" },
  { name: "Mieta", value: "#b9f5cf" },
  { name: "Pistacja", value: "#d6f5a8" },
  { name: "Sloneczny", value: "#ffe29a" },
  { name: "Brzoskwinia", value: "#ffc7a8" },
  { name: "Roz", value: "#ffc2df" },
  { name: "Lawenda", value: "#d8c8ff" },
  { name: "Stalowy", value: "#d7e1ef" },
] as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function normalizeProfileColor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const color = String(value).trim();
  if (!color) return null;
  if (!HEX_COLOR.test(color)) return null;
  return color.toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeProfileColor(hex);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

export function playerToneStyle(color: string | null | undefined): CSSProperties | undefined {
  const rgb = hexToRgb(color ?? "");
  if (!rgb) return undefined;
  return {
    "--player-panel-bg": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.36)`,
    "--player-panel-border": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.72)`,
    "--player-panel-glow": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`,
  } as CSSProperties;
}
