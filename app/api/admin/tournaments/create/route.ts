import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { assertMainAdmin } from "@/app/api/admin/_auth";

export async function POST(req: Request) {
  if (!assertMainAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  const name = String(body?.name ?? "").trim();
  const format = body?.format === "double_elim" ? "double_elim" : "single_elim";
  const boDefault = Number(body?.boDefault ?? 1);
  const boFinals = Number(body?.boFinals ?? 3);
  const gfResetEnabled = Boolean(body?.gfResetEnabled ?? false);
  const localAdminPassword = String(body?.localAdminPassword ?? "").trim();
  const playerIds = Array.isArray(body?.playerIds) ? body.playerIds : [];

  if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (!["single_elim", "double_elim"].includes(format)) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }
  if (![1, 3, 5].includes(boDefault)) {
    return NextResponse.json({ error: "invalid_boDefault" }, { status: 400 });
  }
  if (![1, 3, 5].includes(boFinals)) {
    return NextResponse.json({ error: "invalid_boFinals" }, { status: 400 });
  }
  if (!localAdminPassword) {
    return NextResponse.json({ error: "missing_localAdminPassword" }, { status: 400 });
  }
  if (!Array.isArray(playerIds) || playerIds.length < 2) {
    return NextResponse.json({ error: "invalid_playerIds" }, { status: 400 });
  }

  const { data: t, error: tErr } = await supabaseServer
    .from("tournaments")
    .insert({
      name,
      format,
      bo_default: boDefault,
      bo_finals: boFinals,
      gf_reset_enabled: format === "double_elim" ? gfResetEnabled : false,
      local_admin_password: localAdminPassword,
    })
    .select("id")
    .single();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const tournamentId = t.id as string;

  const rows = playerIds.map((id: string) => ({ tournament_id: tournamentId, player_id: id }));
  const { error: pErr } = await supabaseServer.from("tournament_players").insert(rows);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  return NextResponse.json({ tournamentId });
}
