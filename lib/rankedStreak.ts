export type RankedStreak = { wins: number; duelWins: number };

export function lossStreakTier(losses: number): "none" | "frost" | "frozen" {
  return losses >= 6 ? "frozen" : losses >= 3 ? "frost" : "none";
}

export function streakBonus(wins: number): number {
  return wins >= 7 ? 0.2 : wins >= 4 ? 0.1 : 0;
}

// Called for tournament wins (a ranked duel is a whole one-match tournament).
export function advanceStreak(current: RankedStreak, won: boolean, oneVsOne: boolean) {
  if (!won) return { state: { wins: 0, duelWins: 0 }, bonus: 0 };
  if (oneVsOne && current.duelWins >= 2) return { state: current, bonus: 0 };
  const state = {
    wins: current.wins + 1,
    duelWins: current.duelWins + (oneVsOne ? 1 : 0),
  };
  return { state, bonus: streakBonus(state.wins) };
}
