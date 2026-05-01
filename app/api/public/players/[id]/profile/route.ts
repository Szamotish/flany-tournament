import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { trimmedMean } from "@/lib/rating";
import { readAuthContext } from "@/app/api/admin/_auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: playerId } = await params;

  const primaryPlayer = await supabaseServer
    .from("players")
    .select("id,name,active,avatar_url,mmr,prestige_points,rating_override,rank_frame_enabled")
    .eq("id", playerId)
    .maybeSingle();

  let player = primaryPlayer.data;
  let pErr = primaryPlayer.error;

  if (
    primaryPlayer.error &&
    (primaryPlayer.error.message.includes("rank_frame_enabled") ||
      primaryPlayer.error.message.includes("rating_override"))
  ) {
    const fallback = await supabaseServer
      .from("players")
      .select("id,name,active,avatar_url,mmr,prestige_points")
      .eq("id", playerId)
      .maybeSingle();

    player = fallback.data ? { ...fallback.data, rating_override: null, rank_frame_enabled: true } : null;
    pErr = fallback.error;
  }

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const { data: ratings, error: rErr } = await supabaseServer
    .from("ratings")
    .select("value")
    .eq("rated_player_id", playerId);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const values = (ratings ?? []).map((x) => x.value);
  const ratingOverrideRaw = (player as { rating_override?: number | null }).rating_override;
  const ratingOverride = Number(ratingOverrideRaw);
  const rating =
    ratingOverrideRaw !== null && ratingOverrideRaw !== undefined && Number.isFinite(ratingOverride)
      ? ratingOverride
      : trimmedMean(values, 0.1);

  const { data: memberships, error: mErr } = await supabaseServer
    .from("team_members")
    .select("team_id")
    .eq("player_id", playerId);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const teamIds = (memberships ?? []).map((x) => x.team_id);
  if (teamIds.length === 0) {
    return NextResponse.json({
      player,
      rating,
      ratingsCount: values.length,
      beers: 0,
      trophies: [],
      tournaments: [],
    });
  }

  const { data: beerMatches, error: beersErr } = await supabaseServer
    .from("tournament_matches")
    .select("team_a_id,team_b_id,status")
    .eq("status", "finished")
    .or(`team_a_id.in.(${teamIds.join(",")}),team_b_id.in.(${teamIds.join(",")})`);

  if (beersErr) return NextResponse.json({ error: beersErr.message }, { status: 500 });

  const beers = (beerMatches ?? []).reduce((sum, m) => {
    const hasA = typeof m.team_a_id === "string" && m.team_a_id.length > 0;
    const hasB = typeof m.team_b_id === "string" && m.team_b_id.length > 0;
    return sum + (hasA && hasB ? 1 : 0);
  }, 0);

  const { data: results, error: trErr } = await supabaseServer
    .from("tournament_results")
    .select("tournament_id,team_id,placement")
    .in("team_id", teamIds)
    .order("placement", { ascending: true });

  if (trErr) return NextResponse.json({ error: trErr.message }, { status: 500 });

  const tournamentIds = Array.from(new Set((results ?? []).map((x) => x.tournament_id)));
  const tournamentsMap = new Map<string, { id: string; name: string; created_at: string }>();

  if (tournamentIds.length > 0) {
    const { data: ts, error: tErr } = await supabaseServer
      .from("tournaments")
      .select("id,name,created_at")
      .in("id", tournamentIds);

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

    for (const t of ts ?? []) {
      tournamentsMap.set(t.id, t);
    }
  }

  const tournaments = (results ?? []).map((x) => {
    const t = tournamentsMap.get(x.tournament_id);
    return {
      tournamentId: x.tournament_id,
      tournamentName: t?.name ?? "(unknown)",
      tournamentCreatedAt: t?.created_at ?? null,
      teamId: x.team_id,
      placement: x.placement,
    };
  });

  const trophies = tournaments
    .filter((x) => x.placement === 1)
    .map((x) => ({
      tournamentId: x.tournamentId,
      tournamentName: x.tournamentName,
      createdAt: x.tournamentCreatedAt,
    }));

  return NextResponse.json({
    player,
    rating,
    ratingsCount: values.length,
    beers,
    trophies,
    tournaments,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: playerId } = await params;
  const canEdit = auth.ctx.isMainAdmin || auth.ctx.playerId === playerId;
  if (!canEdit) {
    return NextResponse.json({ error: "forbidden_player_owner_only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.rankFrameEnabled !== "boolean") {
    return NextResponse.json({ error: "invalid_rankFrameEnabled" }, { status: 400 });
  }

  const { data: player, error: pErr } = await supabaseServer
    .from("players")
    .select("id")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const { data: updated, error: uErr } = await supabaseServer
    .from("players")
    .update({ rank_frame_enabled: body.rankFrameEnabled })
    .eq("id", playerId)
    .select("id,rank_frame_enabled")
    .single();

  if (uErr) {
    if (uErr.message.includes("rank_frame_enabled")) {
      return NextResponse.json({ error: "missing_rank_frame_enabled_column" }, { status: 500 });
    }
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({
    player: {
      id: updated.id,
      rankFrameEnabled: updated.rank_frame_enabled === true,
    },
  });
}
