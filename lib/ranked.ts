export type TournamentMode = "normal" | "ranked";

export const BASE_MMR_CAP = 10;
export const PRESTIGE_POINTS_PER_MMR = 100;
export const PRESTIGE_LOSS_MULTIPLIER = 3;

export const RANKED_MATCH_WIN_DELTA = 0.1;
export const RANKED_MATCH_LOSS_DELTA = -0.3;
export const RANKED_TOURNAMENT_WIN_BONUS = 0.3;

export type RankedState = {
  mmr: number;
  prestigePoints: number;
};

function roundToOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function clampMmr(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > BASE_MMR_CAP) return BASE_MMR_CAP;
  return roundToOne(value);
}

function normalizePrestigePoints(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeMode(value: unknown): TournamentMode {
  return value === "ranked" ? "ranked" : "normal";
}

export function parseRankedState(value: unknown): RankedState {
  const row = (value ?? {}) as { mmr?: unknown; prestige_points?: unknown; prestigePoints?: unknown };
  const mmrRaw = Number(row.mmr ?? 0);
  const prestigeRaw = Number(row.prestige_points ?? row.prestigePoints ?? 0);
  return {
    mmr: clampMmr(mmrRaw),
    prestigePoints: normalizePrestigePoints(prestigeRaw),
  };
}

export function applyRankedDelta(state: RankedState, delta: number): RankedState {
  if (!Number.isFinite(delta) || delta === 0) return state;

  let mmr = clampMmr(state.mmr);
  let prestigePoints = normalizePrestigePoints(state.prestigePoints);

  if (delta > 0) {
    const roomBeforeCap = Math.max(0, BASE_MMR_CAP - mmr);
    const mmrGain = Math.min(delta, roomBeforeCap);
    const overflow = Math.max(0, delta - mmrGain);

    mmr = clampMmr(mmr + mmrGain);
    prestigePoints += Math.round(overflow * PRESTIGE_POINTS_PER_MMR);
    return { mmr, prestigePoints };
  }

  const lossAbs = Math.abs(delta);

  if (prestigePoints > 0) {
    const prestigeLoss = Math.ceil(lossAbs * PRESTIGE_POINTS_PER_MMR * PRESTIGE_LOSS_MULTIPLIER);
    prestigePoints = Math.max(0, prestigePoints - prestigeLoss);
    return { mmr, prestigePoints };
  }

  mmr = clampMmr(mmr - lossAbs);
  return { mmr, prestigePoints };
}
