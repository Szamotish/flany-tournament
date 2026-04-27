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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) {
    return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });
  }

  const { id: tournamentId } = await params;

  if (await hasTournamentStarted(tournamentId)) {
    return NextResponse.json({ error: "tournament_already_started" }, { status: 400 });
  }

  const membershipDelete = await supabaseServer
    .from("tournament_players")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("player_id", auth.ctx.playerId);

  if (membershipDelete.error) {
    return NextResponse.json({ error: membershipDelete.error.message }, { status: 500 });
  }

  const adminDelete = await supabaseServer
    .from("tournament_admins")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("player_id", auth.ctx.playerId);

  if (adminDelete.error && !adminDelete.error.message.includes("tournament_admins")) {
    return NextResponse.json({ error: adminDelete.error.message }, { status: 500 });
  }

  return NextResponse.json({ left: true });
}
