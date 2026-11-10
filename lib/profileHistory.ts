export type MmrHistoryRow = { id: string; tournament_id: string | null; match_id?: string | null; mmr: number; prestige_points: number; created_at: string; reason?: string };
export type HistoryTournament = { id: string; name: string; event_at: string | null; started_at: string | null; created_at: string; name_day_number?: number | null; is_private?: boolean | null };
export type HistoryMatch = { id: string; round_no: number; match_no: number };
export type HistoryState = { mmr: number; prestigePoints: number };
export type MmrChartPoint = { id: string; mmr: number; prestigePoints: number; playedAt: string; tournamentName: string | null; tournamentHref?: string | null; eventLabel?: string | null; changeLabel?: string | null };
export function tournamentHistoryDate(t: { event_at?: string | null; started_at?: string | null; created_at?: string | null } | undefined, fallback?: string | null): string | null {
  return [t?.event_at, t?.started_at, t?.created_at, fallback]
    .find(date => date && Number.isFinite(Date.parse(date))) ?? null;
}
const HISTORY_LABELS: Record<string, string> = {
  performance_bonus: "Premia za performance",
  hit_bonus: "Premia za trafienia",
  admin_penalty: "Kara punktowa",
  admin_set_mmr: "Ręczna zmiana MMR",
  admin_reset_mmr: "Reset MMR",
};
const warsawDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });
export function profileHistoryDay(iso: string) {
  const parts = Object.fromEntries(warsawDay.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// Match and champion records share a timestamp. Their generated UUIDs do not
// describe the calculation order; mirror rankedReplay's event order instead.
const reasonPriority = (reason?: string) => reason === "tournament_win" ? 1 : reason === "hit_bonus" ? 2 : reason === "performance_bonus" ? 3
  : reason === "admin_penalty" ? 4 : reason === "admin_set_mmr" || reason === "admin_reset_mmr" ? 5 : 0;
const score = (state: HistoryState) => Math.round(state.mmr * 10) + state.prestigePoints;
const rowState = (row: MmrHistoryRow): HistoryState => ({ mmr: Number(row.mmr), prestigePoints: Number(row.prestige_points) });
const difference = (after: HistoryState, before: HistoryState) => ({ mmr: Math.round((after.mmr - before.mmr) * 10) / 10, prestigePoints: after.prestigePoints - before.prestigePoints });
const changeText = (change: HistoryState) => {
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}`;
  return [change.mmr ? `${signed(change.mmr)} MMR` : "", change.prestigePoints ? `${signed(change.prestigePoints)} PP` : ""].filter(Boolean).join(" / ") || "0";
};

export function buildProfileHistory(rows: MmrHistoryRow[], tournaments: HistoryTournament[], options: {
  baseline?: HistoryState | null; current?: HistoryState; matches?: HistoryMatch[];
} = {}): MmrChartPoint[] {
  if (!rows.length) return [];
  const byId = new Map(tournaments.map(t => [t.id, t]));
  const matches = new Map((options.matches ?? []).map(m => [m.id, m]));
  const matchOrder = (r: MmrHistoryRow) => {
    const m = r.match_id ? matches.get(r.match_id) : undefined;
    return m ? m.round_no * 10000 + m.match_no : 0;
  };
  const recorded = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    || reasonPriority(a.reason) - reasonPriority(b.reason)
    || matchOrder(a) - matchOrder(b)
    || ((a.reason === "tournament_win" && b.reason === "tournament_win" || a.reason === "hit_bonus" && b.reason === "hit_bonus")
      ? (a.tournament_id ?? "").localeCompare(b.tournament_id ?? "")
      : a.reason === "performance_bonus" && b.reason === "performance_bonus"
        ? score(rowState(a)) - score(rowState(b)) // same-time positive bonuses
        : a.reason === "admin_penalty" && b.reason === "admin_penalty"
          ? score(rowState(b)) - score(rowState(a)) // same-time deductions
        : (a.match_id ?? a.id).localeCompare(b.match_id ?? b.id)));
  const initial = options.baseline ?? rowState(recorded[0]);
  if (!Number.isFinite(initial.mmr) || !Number.isFinite(initial.prestigePoints)) throw new Error("invalid_profile_history_baseline");
  let previous = initial;
  type Group = { id: string; playedAt: string; tournamentName: string | null; tournamentHref: string | null; isPrivate: boolean; eventLabel: string | null;
    dayNumber: number; tournamentKey: string; phase: number; hasTournament: boolean; ledgerOrder: number; recordedAt: string; change: HistoryState; complete: boolean };
  const groups = new Map<string, Group>();
  for (const row of recorded) {
    const state = rowState(row);
    if (!Number.isFinite(state.mmr) || !Number.isFinite(state.prestigePoints) || !Number.isFinite(Date.parse(row.created_at))) throw new Error("invalid_profile_history");
    // Preserve what was actually awarded, including caps, prestige losses and
    // manual adjustments. Do not recalculate rewards or streaks in the chart.
    const change = difference(state, previous);
    previous = state;
    const t = row.tournament_id ? byId.get(row.tournament_id) : undefined;
    const hitBonus = row.reason === "hit_bonus";
    const key = row.tournament_id ? `${hitBonus ? "hits" : "tournament"}:${row.tournament_id}` : row.id;
    const group = groups.get(key) ?? { id: key, playedAt: tournamentHistoryDate(t, row.created_at)!,
      tournamentName: t?.is_private ? "Turniej prywatny" : t?.name ?? null,
      tournamentHref: t && !t.is_private ? `/tournaments/${encodeURIComponent(t.id)}` : null,
      isPrivate: t?.is_private === true,
      eventLabel: hitBonus ? HISTORY_LABELS.hit_bonus : t ? null : HISTORY_LABELS[row.reason ?? ""] ?? "Zmiana MMR",
      tournamentKey: row.tournament_id ?? row.id, phase: hitBonus ? 1 : 0,
      hasTournament: Boolean(row.tournament_id), ledgerOrder: groups.size,
      dayNumber: t?.name_day_number ?? 0, recordedAt: row.created_at, change: { mmr: 0, prestigePoints: 0 },
      complete: true };
    if (!options.baseline && row === recorded[0]) group.complete = false;
    const add = (target: HistoryState) => { target.mmr = Math.round((target.mmr + change.mmr) * 10) / 10; target.prestigePoints += change.prestigePoints; };
    add(group.change);
    groups.set(key, group);
  }
  if (options.current && score(previous) !== score(options.current)) throw new Error("profile_history_current_mismatch");
  let total = score(initial);
  const ordered = [...groups.values()].sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt)
    || Number(b.hasTournament) - Number(a.hasTournament)
    || (!a.hasTournament && !b.hasTournament ? a.ledgerOrder - b.ledgerOrder : 0)
    || a.dayNumber - b.dayNumber || a.tournamentKey.localeCompare(b.tournamentKey) || a.phase - b.phase
    || Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id));
  return ordered.map((group, i) => {
    total += score(group.change);
    // Impossible reordered histories must not silently invent or clamp points.
    if (total < 0) throw new Error("profile_history_negative_balance");
    const state = i === ordered.length - 1 ? options.current ?? previous
      : { mmr: Math.min(total, 100) / 10, prestigePoints: Math.max(0, total - 100) };
    return { id: group.isPrivate ? `private:${i}` : group.id, ...state, playedAt: group.playedAt,
      tournamentName: group.tournamentName, tournamentHref: group.tournamentHref, eventLabel: group.eventLabel,
      changeLabel: group.complete ? changeText(group.change) : null };
  });
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
