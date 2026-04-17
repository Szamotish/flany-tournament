import type { CSSProperties } from "react";

type TeamTone = {
  bg: string;
  border: string;
  glow: string;
  ink: string;
};

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getTeamTone(teamId: string): TeamTone {
  const seed = hashToken(teamId);
  const hue = seed % 360;
  const sat = 52 + (seed % 14);
  const light = 40 + ((seed >> 5) % 9);

  return {
    bg: `hsla(${hue}, ${sat}%, 78%, 0.34)`,
    border: `hsla(${hue}, ${Math.max(44, sat - 8)}%, ${light}%, 0.52)`,
    glow: `hsla(${hue}, ${sat}%, 46%, 0.24)`,
    ink: `hsl(${hue}, ${Math.max(36, sat - 16)}%, 24%)`,
  };
}

export function teamToneVars(teamId: string | null | undefined): CSSProperties {
  if (!teamId) return {};
  const tone = getTeamTone(teamId);
  return {
    "--team-bg": tone.bg,
    "--team-border": tone.border,
    "--team-glow": tone.glow,
    "--team-ink": tone.ink,
  } as CSSProperties;
}
