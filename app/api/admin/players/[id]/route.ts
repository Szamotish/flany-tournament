import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!assertMainAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: playerId } = await params;

  const { data: player, error: pErr } = await supabaseServer
    .from("players")
    .select("id,name")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const { error: ratingsErr } = await supabaseServer
    .from("ratings")
    .delete()
    .eq("rated_player_id", playerId);
  if (ratingsErr) return NextResponse.json({ error: ratingsErr.message }, { status: 500 });

  const { error: tpErr } = await supabaseServer
    .from("tournament_players")
    .delete()
    .eq("player_id", playerId);
  if (tpErr) return NextResponse.json({ error: tpErr.message }, { status: 500 });

  const { error: tmErr } = await supabaseServer
    .from("team_members")
    .delete()
    .eq("player_id", playerId);
  if (tmErr) return NextResponse.json({ error: tmErr.message }, { status: 500 });

  const { error: dErr } = await supabaseServer.from("players").delete().eq("id", playerId);
  if (!dErr) {
    return NextResponse.json({ deleted: true, playerId });
  }

  const { error: softErr } = await supabaseServer
    .from("players")
    .update({ active: false })
    .eq("id", playerId);
  if (softErr) return NextResponse.json({ error: softErr.message }, { status: 500 });

  return NextResponse.json({ deleted: false, softDeleted: true, playerId });
}
