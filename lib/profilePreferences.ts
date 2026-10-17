import type { DisplayRank } from "@/lib/playerRank";
import type { StatView } from "./matchStats";

export const PANEL_RANKS: DisplayRank[] = ["unranked", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"];
export type ProfilePreferences = { chart_from: string | null; chart_to: string | null; rank_panel: DisplayRank | null; stats_view?: StatView };
export const DEFAULT_PROFILE_PREFERENCES: ProfilePreferences = { chart_from: null, chart_to: null, rank_panel: null };
export function isPanelRank(value: unknown): value is DisplayRank {
  return typeof value === "string" && PANEL_RANKS.includes(value as DisplayRank);
}
export function availablePanels(rank: DisplayRank) { return PANEL_RANKS.slice(0, PANEL_RANKS.indexOf(rank) + 1); }
export function resolvePanelRank(saved: unknown, current: DisplayRank): DisplayRank {
  return isPanelRank(saved) && availablePanels(current).includes(saved) ? saved : current;
}
export function isProfileDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function validChartRange(from: unknown, to: unknown): boolean {
  return (from === null || isProfileDate(from)) && (to === null || isProfileDate(to))
    && (!from || !to || String(from) <= String(to));
}
