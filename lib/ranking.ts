import type { DisplayRank } from "@/lib/playerRank";

export type RankingComparable = {
  name: string;
  rating: number | null;
  effectiveMmr: number;
  prestigePoints: number;
  rank: DisplayRank;
  isRanked: boolean;
};

export const RANK_WEIGHT: Record<DisplayRank, number> = {
  challenger: 9,
  grandmaster: 8,
  master: 7,
  diamond: 6,
  emerald: 5,
  platinum: 4,
  gold: 3,
  silver: 2,
  bronze: 1,
  unranked: 0,
};

export function rankingCompare(a: RankingComparable, b: RankingComparable): number {
  if (a.isRanked !== b.isRanked) return a.isRanked ? -1 : 1;
  if (!a.isRanked && !b.isRanked) return a.name.localeCompare(b.name, "pl");

  const rankDiff = RANK_WEIGHT[b.rank] - RANK_WEIGHT[a.rank];
  if (rankDiff !== 0) return rankDiff;

  const ppDiff = b.prestigePoints - a.prestigePoints;
  if (ppDiff !== 0) return ppDiff;

  const mmrDiff = b.effectiveMmr - a.effectiveMmr;
  if (mmrDiff !== 0) return mmrDiff;

  const ratingDiff = Number(b.rating ?? -1) - Number(a.rating ?? -1);
  if (ratingDiff !== 0) return ratingDiff;

  return a.name.localeCompare(b.name, "pl");
}
