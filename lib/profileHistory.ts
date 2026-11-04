export type MmrHistoryRow = { id: string; tournament_id: string | null; mmr: number; prestige_points: number; created_at: string; reason?: string };
export type HistoryTournament = { id: string; name: string; event_at: string | null; started_at: string | null; created_at: string };
export type MmrChartPoint = { id: string; mmr: number; prestigePoints: number; playedAt: string; tournamentName: string | null; eventLabel?: string | null };
export function tournamentHistoryDate(t: { event_at?: string | null; started_at?: string | null; created_at?: string | null } | undefined, fallback?: string | null): string | null {
  return [t?.event_at, t?.started_at, t?.created_at, fallback]
    .find(date => date && Number.isFinite(Date.parse(date))) ?? null;
}
const HISTORY_LABELS: Record<string, string> = {
  performance_bonus: "Premia za performance",
  admin_set_mmr: "Ręczna zmiana MMR",
  admin_reset_mmr: "Reset MMR",
};
const warsawDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });
export function profileHistoryDay(iso: string) {
  const parts = Object.fromEntries(warsawDay.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function buildProfileHistory(rows: MmrHistoryRow[], tournaments: HistoryTournament[]): MmrChartPoint[] {
  const byId = new Map(tournaments.map(t => [t.id, t]));
  return rows.map(row => {
    const t = row.tournament_id ? byId.get(row.tournament_id) : undefined;
    const playedAt = tournamentHistoryDate(t, row.created_at) ?? "";
    return { id: row.id, mmr: Number(row.mmr), prestigePoints: Math.max(0, Number(row.prestige_points) || 0),
      playedAt, tournamentName: t?.name ?? null, eventLabel: t ? null : HISTORY_LABELS[row.reason ?? ""] ?? "Zmiana MMR", recordedAt: row.created_at };
  }).filter(p => p.playedAt && Number.isFinite(p.mmr))
    .sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt) || Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id))
    .map(p => ({ id: p.id, mmr: p.mmr, prestigePoints: p.prestigePoints, playedAt: p.playedAt, tournamentName: p.tournamentName, eventLabel: p.eventLabel }));
}
export function filterProfileHistory(points: MmrChartPoint[], from: string | null, to: string | null) {
  return points.filter(p => { const day = profileHistoryDay(p.playedAt); return (!from || day >= from) && (!to || day <= to); });
}
export type ChartWindow = { start: number; span: number };
export function clampChartWindow(view: ChartWindow, count: number): ChartWindow {
  const max = Math.max(1, count - 1);
  const span = Math.max(Math.min(2, max), Math.min(max, view.span));
  return { start: Math.max(0, Math.min(max - span, view.start)), span };
}
export function zoomChartWindow(view: ChartWindow, count: number, factor: number, anchor = 0.5): ChartWindow {
  const span = clampChartWindow({ start: 0, span: view.span * factor }, count).span;
  return clampChartWindow({ start: view.start + (view.span - span) * anchor, span }, count);
}
