export type TournamentFormat = "single_elim" | "double_elim" | "one_vs_one";

export const ONE_V_ONE_PLAYER_LIMIT = 2;

export function normalizeTournamentFormat(value: unknown): TournamentFormat {
  if (value === "double_elim") return "double_elim";
  if (value === "one_vs_one") return "one_vs_one";
  return "single_elim";
}

export function isDoubleElimFormat(value: unknown): value is "double_elim" {
  return value === "double_elim";
}

export function isOneVsOneFormat(value: unknown): value is "one_vs_one" {
  return value === "one_vs_one";
}

export function usesSingleBracket(value: unknown): boolean {
  return value !== "double_elim";
}

