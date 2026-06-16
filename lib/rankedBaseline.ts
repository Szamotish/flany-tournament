import { supabaseServer } from "@/lib/supabaseServer";
import { BASE_MMR_CAP } from "@/lib/ranked";

export type RankedBaseline = {
  playerId: string;
  mmr: number;
  prestigePoints: number;
  source: string;
};

type BaselineRow = {
  player_id: string;
  baseline_mmr: number | null;
  baseline_prestige_points: number | null;
  source?: string | null;
};

type HistoryRow = {
  player_id: string;
  mmr: number | null;
  delta: number | null;
  prestige_points: number | null;
  created_at: string | null;
};

function isMissingBaselineTable(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("player_ranked_baselines") &&
    (normalized.includes("does not exist") ||
      normalized.includes("schema cache") ||
      normalized.includes("could not find"))
  );
}

function roundToOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function clampMmr(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > BASE_MMR_CAP) return BASE_MMR_CAP;
  return roundToOne(value);
}

function clampPrestigePoints(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function toBaseline(row: BaselineRow): RankedBaseline | null {
  const playerId = String(row.player_id ?? "");
  if (!playerId) return null;
  return {
    playerId,
    mmr: clampMmr(Number(row.baseline_mmr ?? 0)),
    prestigePoints: clampPrestigePoints(Number(row.baseline_prestige_points ?? 0)),
    source: row.source ?? "saved",
  };
}

export async function loadRankedBaselines(playerIds: string[]): Promise<Map<string, RankedBaseline>> {
  const ids = Array.from(new Set(playerIds.filter(Boolean)));
  const result = new Map<string, RankedBaseline>();
  if (ids.length === 0) return result;

  const { data, error } = await supabaseServer
    .from("player_ranked_baselines")
    .select("player_id,baseline_mmr,baseline_prestige_points,source")
    .in("player_id", ids);

  if (error) {
    if (isMissingBaselineTable(error.message)) return result;
    throw new Error(`ranked_baselines_load_failed: ${error.message}`);
  }

  for (const row of (data ?? []) as BaselineRow[]) {
    const baseline = toBaseline(row);
    if (baseline) result.set(baseline.playerId, baseline);
  }

  return result;
}

export async function inferRankedBaselinesFromHistory(playerIds: string[]): Promise<Map<string, RankedBaseline>> {
  const ids = Array.from(new Set(playerIds.filter(Boolean)));
  const result = new Map<string, RankedBaseline>();
  if (ids.length === 0) return result;

  const { data, error } = await supabaseServer
    .from("player_mmr_history")
    .select("player_id,mmr,delta,prestige_points,created_at")
    .in("player_id", ids)
    .in("reason", ["match_win", "match_loss", "tournament_win"])
    .order("created_at", { ascending: true });

  if (error) {
    if (error.message.includes("player_mmr_history")) return result;
    throw new Error(`ranked_baselines_history_failed: ${error.message}`);
  }

  for (const row of (data ?? []) as HistoryRow[]) {
    const playerId = String(row.player_id ?? "");
    if (!playerId || result.has(playerId)) continue;

    const postMmr = Number(row.mmr ?? NaN);
    const delta = Number(row.delta ?? NaN);
    if (!Number.isFinite(postMmr) || !Number.isFinite(delta)) continue;

    result.set(playerId, {
      playerId,
      mmr: clampMmr(postMmr - delta),
      prestigePoints: 0,
      source: "inferred_from_history",
    });
  }

  return result;
}

export async function ensureRankedBaselines(
  baselines: RankedBaseline[]
): Promise<Map<string, RankedBaseline>> {
  const clean = baselines
    .map((baseline) => ({
      playerId: String(baseline.playerId ?? ""),
      mmr: clampMmr(Number(baseline.mmr ?? 0)),
      prestigePoints: clampPrestigePoints(Number(baseline.prestigePoints ?? 0)),
      source: baseline.source || "first_ranked_match",
    }))
    .filter((baseline) => baseline.playerId);

  const playerIds = clean.map((baseline) => baseline.playerId);
  const existing = await loadRankedBaselines(playerIds);
  const missing = clean.filter((baseline) => !existing.has(baseline.playerId));
  if (missing.length === 0) return existing;

  const rows = missing.map((baseline) => ({
    player_id: baseline.playerId,
    baseline_mmr: baseline.mmr,
    baseline_prestige_points: baseline.prestigePoints,
    source: baseline.source,
  }));

  const { error } = await supabaseServer
    .from("player_ranked_baselines")
    .upsert(rows, { onConflict: "player_id", ignoreDuplicates: true });

  if (error) {
    if (isMissingBaselineTable(error.message)) return existing;
    throw new Error(`ranked_baselines_insert_failed: ${error.message}`);
  }

  return loadRankedBaselines(playerIds);
}
