import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOneVsOneFormat, ONE_V_ONE_PLAYER_LIMIT } from "@/lib/tournamentFormat";

async function hasTournamentStarted(tournamentId: string): Promise<boolean> {
  const { count } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  return (count ?? 0) > 0;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `invite-action:ip:${ip}`, limit: 80, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });
  const userLimit = rateLimit({ key: `invite-action:user:${auth.ctx.userId}`, limit: 50, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const { id: inviteId } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action === "accept" ? "accept" : body?.action === "reject" ? "reject" : "";
  if (!action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const inviteRes = await supabaseServer
    .from("tournament_invites")
    .select("id,tournament_id,player_id,status")
    .eq("id", inviteId)
    .maybeSingle();

  if (inviteRes.error) {
    if (inviteRes.error.message.includes("tournament_invites")) {
      return NextResponse.json({ error: "missing_invites_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: inviteRes.error.message }, { status: 500 });
  }
  if (!inviteRes.data?.id) return NextResponse.json({ error: "invite_not_found" }, { status: 404 });
  if (inviteRes.data.player_id !== auth.ctx.playerId) {
    return NextResponse.json({ error: "forbidden_invite_owner_only" }, { status: 403 });
  }
  if (inviteRes.data.status !== "pending") {
    return NextResponse.json({ error: "invite_not_pending" }, { status: 400 });
  }

  if (action === "accept") {
    if (await hasTournamentStarted(inviteRes.data.tournament_id)) {
      return NextResponse.json({ error: "tournament_already_started" }, { status: 400 });
    }

    const [tournamentRes, countRes] = await Promise.all([
      supabaseServer
        .from("tournaments")
        .select("format")
        .eq("id", inviteRes.data.tournament_id)
        .maybeSingle(),
      supabaseServer
        .from("tournament_players")
        .select("*", { count: "exact", head: true })
        .eq("tournament_id", inviteRes.data.tournament_id),
    ]);

    if (tournamentRes.error) return NextResponse.json({ error: tournamentRes.error.message }, { status: 500 });
    if (countRes.error) return NextResponse.json({ error: countRes.error.message }, { status: 500 });

    if (
      isOneVsOneFormat(tournamentRes.data?.format) &&
      (countRes.count ?? 0) >= ONE_V_ONE_PLAYER_LIMIT
    ) {
      return NextResponse.json({ error: "tournament_1v1_player_limit_reached" }, { status: 400 });
    }

    const memberRes = await supabaseServer.from("tournament_players").upsert(
      { tournament_id: inviteRes.data.tournament_id, player_id: auth.ctx.playerId },
      { onConflict: "tournament_id,player_id", ignoreDuplicates: true }
    );
    if (memberRes.error) {
      return NextResponse.json({ error: memberRes.error.message }, { status: 500 });
    }
  }

  const status = action === "accept" ? "accepted" : "rejected";
  const updateRes = await supabaseServer
    .from("tournament_invites")
    .update({
      status,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", inviteId)
    .select("id,status")
    .single();

  if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
  return NextResponse.json({ invite: updateRes.data });
}
