import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { id: tournamentId } = await params;

  const { data: tournament, error: tErr } = await supabaseServer
    .from("tournaments")
    .select("id")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tournament) return NextResponse.json({ error: "tournament_not_found" }, { status: 404 });

  const { data: batches, error: bErr } = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const batchIds = (batches ?? []).map((b) => String(b.id));

  let teamIds: string[] = [];
  if (batchIds.length > 0) {
    const { data: teams, error: teamsErr } = await supabaseServer
      .from("teams")
      .select("id")
      .in("batch_id", batchIds);
    if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 });
    teamIds = (teams ?? []).map((t) => String(t.id));
  }

  const { error: resultsErr } = await supabaseServer
    .from("tournament_results")
    .delete()
    .eq("tournament_id", tournamentId);
  if (resultsErr) return NextResponse.json({ error: resultsErr.message }, { status: 500 });

  const { error: matchesErr } = await supabaseServer
    .from("tournament_matches")
    .delete()
    .eq("tournament_id", tournamentId);
  if (matchesErr) return NextResponse.json({ error: matchesErr.message }, { status: 500 });

  const { error: tpErr } = await supabaseServer
    .from("tournament_players")
    .delete()
    .eq("tournament_id", tournamentId);
  if (tpErr) return NextResponse.json({ error: tpErr.message }, { status: 500 });

  const { error: adminLinksErr } = await supabaseServer
    .from("tournament_admins")
    .delete()
    .eq("tournament_id", tournamentId);
  if (adminLinksErr && !adminLinksErr.message.includes("tournament_admins")) {
    return NextResponse.json({ error: adminLinksErr.message }, { status: 500 });
  }

  if (teamIds.length > 0) {
    const { error: membersErr } = await supabaseServer
      .from("team_members")
      .delete()
      .in("team_id", teamIds);
    if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 });
  }

  if (batchIds.length > 0) {
    const { error: teamsDelErr } = await supabaseServer
      .from("teams")
      .delete()
      .in("batch_id", batchIds);
    if (teamsDelErr) return NextResponse.json({ error: teamsDelErr.message }, { status: 500 });
  }

  const { error: batchesErr } = await supabaseServer
    .from("team_batches")
    .delete()
    .eq("tournament_id", tournamentId);
  if (batchesErr) return NextResponse.json({ error: batchesErr.message }, { status: 500 });

  const { error: delTournamentErr } = await supabaseServer
    .from("tournaments")
    .delete()
    .eq("id", tournamentId);
  if (delTournamentErr) return NextResponse.json({ error: delTournamentErr.message }, { status: 500 });

  return NextResponse.json({ deleted: true, tournamentId });
}
