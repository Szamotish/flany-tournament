export type DisplayRank =
  | "unranked"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "emerald"
  | "diamond"
  | "master"
  | "grandmaster"
  | "challenger";

export function canShowRankFromMmr(hasFinishedMatch: boolean, mmrManualOverride: boolean): boolean {
  return hasFinishedMatch || mmrManualOverride;
}

export function displayRankFromProgress(
  canShowRank: boolean,
  mmrValue: number,
  prestigePoints: number
): DisplayRank {
  if (!canShowRank) return "unranked";
  if (prestigePoints >= 301) return "challenger";
  if (prestigePoints >= 101) return "grandmaster";
  if (prestigePoints >= 1) return "master";
  if (mmrValue >= 10) return "master";
  if (mmrValue >= 9) return "diamond";
  if (mmrValue >= 7) return "emerald";
  if (mmrValue >= 5) return "platinum";
  if (mmrValue >= 4) return "gold";
  if (mmrValue >= 2) return "silver";
  return "bronze";
}

export function rankLabel(rank: DisplayRank): string {
  if (rank === "unranked") return "Unranked";
  if (rank === "bronze") return "Bronze";
  if (rank === "silver") return "Silver";
  if (rank === "gold") return "Gold";
  if (rank === "platinum") return "Platyna";
  if (rank === "emerald") return "Emerald";
  if (rank === "diamond") return "Diament";
  if (rank === "master") return "Master";
  if (rank === "grandmaster") return "Grandmaster";
  return "Challenger";
}

export const FRAME_BY_RANK: Partial<Record<DisplayRank, string>> = {
  bronze: "/ramki/bronze.png",
  silver: "/ramki/silver.png",
  gold: "/ramki/gold.png",
  platinum: "/ramki/platyna.png",
  emerald: "/ramki/emerald.png",
  diamond: "/ramki/diament.png",
  master: "/ramki/master.png",
  grandmaster: "/ramki/grandmaster.png",
  challenger: "/ramki/challanger.png",
};
