import {
  applyRankedDelta, PRESTIGE_POINTS_PER_MMR, RANKED_MATCH_LOSS_DELTA,
  RANKED_MATCH_WIN_DELTA, RANKED_TOURNAMENT_WIN_BONUS, type RankedState,
} from "./ranked";
import { advanceStreak, streakBonus, type RankedStreak } from "./rankedStreak";

export type RankedEvent =
  | { kind: "match"; id: string; at: string; tournamentId: string; winners: string[]; losers: string[]; oneVsOne: boolean; order: number }
  | { kind: "champion"; id: string; at: string; tournamentId: string; players: string[] }
  | { kind: "performance"; id: string; at: string; playerId: string; delta: number }
  | { kind: "manual"; id: string; at: string; playerId: string; state: RankedState };

export type RankedHistoryRow = {
  player_id: string; tournament_id: string | null; match_id: string | null;
  created_at: string; reason: "match_win" | "match_loss" | "tournament_win" | "performance_bonus";
  delta: number; mmr: number; prestige_points: number;
};

export function replayRanked(baselines: Map<string, RankedState>, input: RankedEvent[]) {
  const states = new Map(Array.from(baselines, ([id, state]) => [id, { ...state }]));
  const streaks = new Map<string, RankedStreak>();
  const lossStreaks = new Map<string, number>();
  const history: RankedHistoryRow[] = [];
  const priority = { match: 0, champion: 1, performance: 2, manual: 3 };
  const events = [...input].sort((a, b) =>
    Date.parse(a.at) - Date.parse(b.at) || priority[a.kind] - priority[b.kind] ||
    (a.kind === "match" && b.kind === "match" ? a.order - b.order : 0) || a.id.localeCompare(b.id)
  );
  const streak = (id: string) => streaks.get(id) ?? { wins: 0, duelWins: 0 };
  const apply = (id: string, delta: number, event: RankedEvent, reason: RankedHistoryRow["reason"]) => {
    const current = states.get(id);
    if (!current) return;
    const next = applyRankedDelta(current, delta);
    states.set(id, next);
    history.push({
      player_id: id, tournament_id: event.kind === "performance" || event.kind === "manual" ? null : event.tournamentId,
      match_id: event.kind === "match" ? event.id : null, created_at: event.at, reason,
      delta: Math.round(delta * 10) / 10, mmr: next.mmr, prestige_points: next.prestigePoints,
    });
  };
  const score = (ids: string[]) => ids.reduce((sum, id) => {
    const state = states.get(id);
    return sum + (state ? state.mmr + state.prestigePoints / PRESTIGE_POINTS_PER_MMR : 5);
  }, 0) / Math.max(1, ids.length);

  for (const event of events) {
    if (event.kind === "manual") {
      if (states.has(event.playerId)) states.set(event.playerId, { ...event.state });
    } else if (event.kind === "performance") {
      apply(event.playerId, event.delta, event, "performance_bonus");
    } else if (event.kind === "champion") {
      for (const id of new Set(event.players)) {
        const result = advanceStreak(streak(id), true, false);
        apply(id, RANKED_TOURNAMENT_WIN_BONUS + result.bonus, event, "tournament_win");
        // Only winning the entire multiplayer tournament unlocks two more duels.
        streaks.set(id, { ...result.state, duelWins: 0 });
      }
    } else {
      let winnerDelta = RANKED_MATCH_WIN_DELTA;
      let loserDelta = RANKED_MATCH_LOSS_DELTA;
      if (event.oneVsOne) {
        const difference = score(event.winners) - score(event.losers);
        winnerDelta = Math.abs(difference) <= 2.5 ? 0.1 : difference > 0 ? 0 : 0.2;
        loserDelta = difference < -2.5 ? -0.2 : -0.1;
      }
      for (const id of new Set(event.winners)) {
        // Any ranked match win breaks the cold streak, even a zero-point duel win.
        lossStreaks.set(id, 0);
        const result = event.oneVsOne
          ? advanceStreak(streak(id), true, true)
          : { state: streak(id), bonus: streakBonus(streak(id).wins + 1) };
        streaks.set(id, result.state);
        // A favored duel win worth zero has no positive gain to boost.
        apply(id, winnerDelta + (winnerDelta > 0 ? result.bonus : 0), event, "match_win");
      }
      for (const id of new Set(event.losers)) {
        lossStreaks.set(id, (lossStreaks.get(id) ?? 0) + 1);
        streaks.set(id, advanceStreak(streak(id), false, event.oneVsOne).state);
        apply(id, loserDelta, event, "match_loss");
      }
    }
  }
  return { states, streaks, lossStreaks, history };
}
