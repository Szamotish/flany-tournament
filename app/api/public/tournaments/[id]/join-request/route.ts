import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { notifyTournamentJoinRequest } from "@/lib/emailNotifications";
import { supabaseServer } from "@/lib/supabaseServer";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";

async function hasTournamentStarted(tournamentId: string): Promise<boolean> {
  const { count } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  return (count ?? 0) > 0;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `join-request:ip:${ip}`, limit: 50, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId || !auth.ctx.playerActive) {
    return NextResponse.json({ error: "missing_active_player_profile" }, { status: 403 });
  }
  const userLimit = rateLimit({ key: `join-request:user:${auth.ctx.userId}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const { id: tournamentId } = await params;

  const primaryTournament = await supabaseServer
    .from("tournaments")
    .select("id,name,join_deadline_at")
    .eq("id", tournamentId)
    .maybeSingle();

  let t = primaryTournament.data;
  let tErr = primaryTournament.error;

  if (primaryTournament.error && primaryTournament.error.message.includes("join_deadline_at")) {
    const fallbackTournament = await supabaseServer
      .from("tournaments")
      .select("id,name")
      .eq("id", tournamentId)
      .maybeSingle();
    t = fallbackTournament.data ? { ...fallbackTournament.data, join_deadline_at: null } : null;
    tErr = fallbackTournament.error;
  }

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!t?.id) return NextResponse.json({ error: "tournament_not_found" }, { status: 404 });

  if (await hasTournamentStarted(tournamentId)) {
    return NextResponse.json({ error: "tournament_already_started" }, { status: 400 });
  }

  if (t.join_deadline_at) {
    const deadlineMs = new Date(String(t.join_deadline_at)).getTime();
    if (Number.isFinite(deadlineMs) && Date.now() > deadlineMs) {
      return NextResponse.json({ error: "join_deadline_passed" }, { status: 400 });
    }
  }

  const membership = await supabaseServer
    .from("tournament_players")
    .select("player_id")
    .eq("tournament_id", tournamentId)
    .eq("player_id", auth.ctx.playerId)
    .maybeSingle();

  if (membership.error) return NextResponse.json({ error: membership.error.message }, { status: 500 });
  if (membership.data) return NextResponse.json({ error: "already_in_tournament" }, { status: 400 });

  const insertRes = await supabaseServer
    .from("tournament_join_requests")
    .insert({
      tournament_id: tournamentId,
      player_id: auth.ctx.playerId,
      status: "pending",
    })
    .select("id,status,created_at")
    .single();

  if (insertRes.error) {
    if (insertRes.error.message.includes("tournament_join_requests")) {
      return NextResponse.json({ error: "missing_join_requests_schema" }, { status: 500 });
    }
    if (insertRes.error.code === "23505") {
      return NextResponse.json({ error: "request_already_pending" }, { status: 400 });
    }
    return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
  }

  await notifyTournamentJoinRequest({
    requesterName: auth.ctx.playerName,
    tournamentId,
    tournamentName: String(t.name ?? "Turniej"),
  });

  return NextResponse.json({ request: insertRes.data });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `join-request-cancel:ip:${ip}`, limit: 80, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) {
    return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });
  }

  const { id: tournamentId } = await params;

  const updateRes = await supabaseServer
    .from("tournament_join_requests")
    .update({
      status: "cancelled",
      resolved_at: new Date().toISOString(),
      resolved_by_player_id: auth.ctx.playerId,
    })
    .eq("tournament_id", tournamentId)
    .eq("player_id", auth.ctx.playerId)
    .eq("status", "pending")
    .select("id,status")
    .maybeSingle();

  if (updateRes.error) {
    if (updateRes.error.message.includes("tournament_join_requests")) {
      return NextResponse.json({ error: "missing_join_requests_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
  }

  if (!updateRes.data) {
    return NextResponse.json({ error: "no_pending_request" }, { status: 404 });
  }

  return NextResponse.json({ request: updateRes.data });
}
