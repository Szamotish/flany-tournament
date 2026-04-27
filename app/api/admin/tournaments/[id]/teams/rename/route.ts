import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  }

  const body = await req.json().catch(() => null);
  const teamId = String(body?.teamId ?? "");
  const name = String(body?.name ?? "").trim();

  if (!teamId) return NextResponse.json({ error: "missing_teamId" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (name.length > 40) return NextResponse.json({ error: "name_too_long" }, { status: 400 });

  const { data: batch, error: bErr } = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("is_active", true)
    .maybeSingle();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "no_active_batch" }, { status: 400 });

  const { data: team, error: tErr } = await supabaseServer
    .from("teams")
    .select("id,batch_id")
    .eq("id", teamId)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!team) return NextResponse.json({ error: "team_not_found" }, { status: 404 });
  if (team.batch_id !== batch.id) {
    return NextResponse.json({ error: "team_not_in_active_batch" }, { status: 403 });
  }

  const { data: updated, error: uErr } = await supabaseServer
    .from("teams")
    .update({ name })
    .eq("id", teamId)
    .select("id,name")
    .single();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  return NextResponse.json({ team: updated });
}
