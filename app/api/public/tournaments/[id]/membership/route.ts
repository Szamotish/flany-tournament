import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
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
  const auth = await readAuthContext(req);
  if (!auth.ok) {
    return NextResponse.json({
      authenticated: false,
      inTournament: false,
      pendingRequest: false,
      pendingInvite: false,
      isTournamentAdmin: false,
      tournamentStarted: await hasTournamentStarted(tournamentId),
    });
  }

  const playerId = auth.ctx.playerId;
  if (!playerId) {
    return NextResponse.json({
      authenticated: true,
      inTournament: false,
      pendingRequest: false,
      pendingInvite: false,
      isTournamentAdmin: false,
      tournamentStarted: await hasTournamentStarted(tournamentId),
    });
  }

  const [memberRes, requestRes, inviteRes, adminRes, started] = await Promise.all([
    supabaseServer
      .from("tournament_players")
      .select("player_id")
      .eq("tournament_id", tournamentId)
      .eq("player_id", playerId)
      .maybeSingle(),
    supabaseServer
      .from("tournament_join_requests")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("player_id", playerId)
      .eq("status", "pending")
      .maybeSingle(),
    supabaseServer
      .from("tournament_invites")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("player_id", playerId)
      .eq("status", "pending")
      .maybeSingle(),
    supabaseServer
      .from("tournament_admins")
      .select("player_id")
      .eq("tournament_id", tournamentId)
      .eq("player_id", playerId)
      .maybeSingle(),
    hasTournamentStarted(tournamentId),
  ]);

  if (requestRes.error && !requestRes.error.message.includes("tournament_join_requests")) {
    return NextResponse.json({ error: requestRes.error.message }, { status: 500 });
  }
  if (inviteRes.error && !inviteRes.error.message.includes("tournament_invites")) {
    return NextResponse.json({ error: inviteRes.error.message }, { status: 500 });
  }
  if (adminRes.error && !adminRes.error.message.includes("tournament_admins")) {
    return NextResponse.json({ error: adminRes.error.message }, { status: 500 });
  }
  if (memberRes.error) {
    return NextResponse.json({ error: memberRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    authenticated: true,
    playerId,
    inTournament: Boolean(memberRes.data),
    pendingRequest: Boolean(requestRes.data),
    pendingInvite: Boolean(inviteRes.data),
    isTournamentAdmin: auth.ctx.isMainAdmin || Boolean(adminRes.data),
    tournamentStarted: started,
  });
}
