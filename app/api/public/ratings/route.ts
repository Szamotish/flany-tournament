import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { readAuthContext } from "@/app/api/admin/_auth";

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 dni

export async function POST(req: Request) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) {
    return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });
  }
  if (auth.ctx.playerActive !== true) {
    return NextResponse.json({ error: "player_inactive" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const ratedId = typeof body?.ratedId === "string" ? body.ratedId : "";
  const value = Number(body?.value);

  if (!ratedId) {
    return NextResponse.json({ error: "invalid_player" }, { status: 400 });
  }
  if (ratedId === auth.ctx.playerId) {
    return NextResponse.json({ error: "cannot_rate_self" }, { status: 400 });
  }
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return NextResponse.json({ error: "invalid_value" }, { status: 400 });
  }

  const { data: existing, error: existingErr } = await supabaseServer
    .from("ratings")
    .select("id, updated_at, value")
    .eq("rater_player_id", auth.ctx.playerId)
    .eq("rated_player_id", ratedId)
    .maybeSingle();

  if (existingErr) {
    if (existingErr.message.includes("rater_player_id")) {
      return NextResponse.json({ error: "missing_ratings_player_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }

  if (existing?.updated_at) {
    const last = new Date(existing.updated_at).getTime();
    const now = Date.now();
    const age = now - last;

    if (age < COOLDOWN_MS) {
      const msLeft = COOLDOWN_MS - age;
      const hoursLeft = Math.ceil(msLeft / (1000 * 60 * 60));
      return NextResponse.json(
        {
          error: "cooldown",
          message: `Możesz zmienić ocenę za ~${hoursLeft}h`,
          hoursLeft,
        },
        { status: 429 }
      );
    }
  }

  const { data, error } = await supabaseServer
    .from("ratings")
    .upsert(
      { rater_player_id: auth.ctx.playerId, rated_player_id: ratedId, value, updated_at: new Date().toISOString() },
      { onConflict: "rater_player_id,rated_player_id" }
    )
    .select("id,rater_player_id,rated_player_id,value,updated_at")
    .single();

  if (error) {
    if (error.message.includes("rater_player_id")) {
      return NextResponse.json({ error: "missing_ratings_player_schema" }, { status: 500 });
    }
    console.error("SUPABASE ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rating: data });
}
