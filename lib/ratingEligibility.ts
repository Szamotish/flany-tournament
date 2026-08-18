import { supabaseServer } from "@/lib/supabaseServer";
import {
  RATING_COOLDOWN_MS,
  type RatingCooldownInfo,
  ratingCooldownFromUpdatedAt,
} from "@/lib/ratingCooldown";

export const RATING_REQUALIFY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export type RatingEligibilityReason =
  | "first_rating"
  | "cooldown"
  | "shared_match_window"
  | "needs_shared_match"
  | "shared_match_window_expired";

export type RatingEligibilityInfo = RatingCooldownInfo & {
  reason: RatingEligibilityReason;
  lastSharedMatchAt: string | null;
  windowExpiresAt: string | null;
};

type TeamMembershipRow = {
  team_id: string | null;
};

type MatchRow = {
  team_a_id: string | null;
  team_b_id: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

function isoOrNull(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function formatHoursLeft(milliseconds: number): number {
  return Math.max(0, Math.ceil(milliseconds / (1000 * 60 * 60)));
}

function matchTime(row: MatchRow): number {
  const raw = row.updated_at ?? row.created_at ?? null;
  if (!raw) return 0;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : 0;
}

async function playerTeamIds(playerIds: string[]): Promise<Map<string, Set<string>>> {
  const result = new Map(playerIds.map((playerId) => [playerId, new Set<string>()]));
  const ids = Array.from(new Set(playerIds.filter(Boolean)));
  if (ids.length === 0) return result;

  const { data, error } = await supabaseServer
    .from("team_members")
    .select("player_id,team_id")
    .in("player_id", ids);

  if (error) throw new Error(`rating_eligibility_team_members_failed: ${error.message}`);

  for (const row of data ?? []) {
    const playerId = String((row as TeamMembershipRow & { player_id?: string | null }).player_id ?? "");
    const teamId = String(row.team_id ?? "");
    if (!playerId || !teamId) continue;
    const current = result.get(playerId) ?? new Set<string>();
    current.add(teamId);
    result.set(playerId, current);
  }

  return result;
}

async function latestSharedFinishedMatchAt(
  raterPlayerId: string,
  ratedPlayerId: string,
  earliestMatchAtMs: number
): Promise<string | null> {
  const teamsByPlayer = await playerTeamIds([raterPlayerId, ratedPlayerId]);
  const raterTeamIds = teamsByPlayer.get(raterPlayerId) ?? new Set<string>();
  const ratedTeamIds = teamsByPlayer.get(ratedPlayerId) ?? new Set<string>();
  const allTeamIds = Array.from(new Set([...raterTeamIds, ...ratedTeamIds]));

  if (allTeamIds.length === 0 || raterTeamIds.size === 0 || ratedTeamIds.size === 0) return null;

  const { data, error } = await supabaseServer
    .from("tournament_matches")
    .select("team_a_id,team_b_id,updated_at,created_at")
    .eq("status", "finished")
    .or(`team_a_id.in.(${allTeamIds.join(",")}),team_b_id.in.(${allTeamIds.join(",")})`);

  if (error) throw new Error(`rating_eligibility_matches_failed: ${error.message}`);

  let latest = 0;
  for (const row of (data ?? []) as MatchRow[]) {
    const teamA = String(row.team_a_id ?? "");
    const teamB = String(row.team_b_id ?? "");
    const raterPlayed = raterTeamIds.has(teamA) || raterTeamIds.has(teamB);
    const ratedPlayed = ratedTeamIds.has(teamA) || ratedTeamIds.has(teamB);
    if (!raterPlayed || !ratedPlayed) continue;

    const playedAt = matchTime(row);
    if (playedAt < earliestMatchAtMs) continue;
    if (playedAt > latest) latest = playedAt;
  }

  return latest > 0 ? new Date(latest).toISOString() : null;
}

export async function ratingEligibilityForPair(
  raterPlayerId: string,
  ratedPlayerId: string,
  lastRatedAt: string | null | undefined
): Promise<RatingEligibilityInfo> {
  const cooldown = ratingCooldownFromUpdatedAt(lastRatedAt);
  if (!lastRatedAt) {
    return {
      ...cooldown,
      reason: "first_rating",
      lastSharedMatchAt: null,
      windowExpiresAt: null,
    };
  }

  if (!cooldown.canRate) {
    return {
      ...cooldown,
      reason: "cooldown",
      lastSharedMatchAt: null,
      windowExpiresAt: null,
    };
  }

  const lastRatedAtMs = new Date(lastRatedAt).getTime();
  if (!Number.isFinite(lastRatedAtMs)) {
    return {
      canRate: true,
      state: "ready",
      hoursLeft: 0,
      message: "Mozesz teraz wystawic ocene.",
      reason: "first_rating",
      lastSharedMatchAt: null,
      windowExpiresAt: null,
    };
  }

  const earliestMatchAtMs = lastRatedAtMs + RATING_COOLDOWN_MS;
  const lastSharedMatchAt = await latestSharedFinishedMatchAt(raterPlayerId, ratedPlayerId, earliestMatchAtMs);

  if (!lastSharedMatchAt) {
    return {
      canRate: false,
      state: "cooldown",
      hoursLeft: 0,
      message:
        "Aby ponownie ocenic tego gracza, zagrajcie razem lub przeciwko sobie mecz po zakonczeniu cooldownu.",
      reason: "needs_shared_match",
      lastSharedMatchAt: null,
      windowExpiresAt: null,
    };
  }

  const sharedMatchAtMs = new Date(lastSharedMatchAt).getTime();
  const windowExpiresAtMs = sharedMatchAtMs + RATING_REQUALIFY_WINDOW_MS;
  const windowExpiresAt = isoOrNull(windowExpiresAtMs);
  const timeLeftMs = windowExpiresAtMs - Date.now();

  if (timeLeftMs <= 0) {
    return {
      canRate: false,
      state: "cooldown",
      hoursLeft: 0,
      message: "Okno oceny po ostatnim wspolnym meczu wygaslo. Zagrajcie wspolny mecz ponownie.",
      reason: "shared_match_window_expired",
      lastSharedMatchAt,
      windowExpiresAt,
    };
  }

  const hoursLeft = formatHoursLeft(timeLeftMs);
  return {
    canRate: true,
    state: hoursLeft <= 24 ? "soon" : "ready",
    hoursLeft,
    message: `Mozesz zmienic ocene po wspolnym meczu. Okno oceny wygasa za ~${hoursLeft}h.`,
    reason: "shared_match_window",
    lastSharedMatchAt,
    windowExpiresAt,
  };
}
