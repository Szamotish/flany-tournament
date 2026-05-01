import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { supabaseServer } from "@/lib/supabaseServer";

async function hasTournamentStarted(tournamentId: string): Promise<boolean> {
  const { count } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  return (count ?? 0) > 0;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const { data, error } = await supabaseServer
    .from("tournament_join_requests")
    .select("id,status,created_at,player_id")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (error.message.includes("tournament_join_requests")) {
      return NextResponse.json({ error: "missing_join_requests_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const playerIds = Array.from(new Set((data ?? []).map((row) => String(row.player_id ?? "")).filter(Boolean)));
  const playersRes =
    playerIds.length > 0
      ? await supabaseServer.from("players").select("id,name,avatar_url").in("id", playerIds)
      : { data: [], error: null };
  if (playersRes.error) return NextResponse.json({ error: playersRes.error.message }, { status: 500 });

  const playersMap = new Map(
    (playersRes.data ?? []).map((row) => [String(row.id), { id: row.id, name: row.name, avatar_url: row.avatar_url }])
  );
  const requests = (data ?? []).map((row) => ({
    ...row,
    players: playersMap.get(String(row.player_id ?? "")) ?? null,
  }));

  return NextResponse.json({ requests });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `admin-join-request:ip:${ip}`, limit: 160, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  const userLimit = rateLimit({ key: `admin-join-request:user:${auth.ctx.userId}`, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const body = await req.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const action = body?.action === "accept" ? "accept" : body?.action === "reject" ? "reject" : "";

  if (!requestId || !action) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { data: row, error: rowErr } = await supabaseServer
    .from("tournament_join_requests")
    .select("id,player_id,status")
    .eq("id", requestId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "request_not_found" }, { status: 404 });
  if (row.status !== "pending") return NextResponse.json({ error: "request_not_pending" }, { status: 400 });

  if (action === "accept") {
    if (await hasTournamentStarted(tournamentId)) {
      return NextResponse.json({ error: "tournament_already_started" }, { status: 400 });
    }

    const memberRes = await supabaseServer.from("tournament_players").upsert(
      {
        tournament_id: tournamentId,
        player_id: row.player_id,
      },
      { onConflict: "tournament_id,player_id", ignoreDuplicates: true }
    );

    if (memberRes.error) {
      return NextResponse.json({ error: memberRes.error.message }, { status: 500 });
    }
  }

  const status = action === "accept" ? "accepted" : "rejected";
  const updateRes = await supabaseServer
    .from("tournament_join_requests")
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by_player_id: auth.ctx.playerId ?? null,
    })
    .eq("id", requestId)
    .select("id,status")
    .single();

  if (updateRes.error) {
    return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
  }

  await writeAuditLog({
    actorUserId: auth.ctx.userId,
    actorPlayerId: auth.ctx.playerId,
    action: action === "accept" ? "tournament_join_request_accept" : "tournament_join_request_reject",
    targetType: "tournament",
    targetId: tournamentId,
    metadata: { requestId, playerId: row.player_id },
  });

  return NextResponse.json({ request: updateRes.data });
}
