import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function assertAdmin(req: Request) {
  const pass = req.headers.get("x-admin-password");
  return !!pass && pass === process.env.ADMIN_PASSWORD;
}

export async function POST(req: Request) {
  if (!assertAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  const raterId = typeof body?.raterId === "string" ? body.raterId : "";
  const ratedId = typeof body?.ratedId === "string" ? body.ratedId : "";
  const value = Number(body?.value);

  if (!raterId || !ratedId || raterId === ratedId) {
    return NextResponse.json({ error: "invalid_players" }, { status: 400 });
  }
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return NextResponse.json({ error: "invalid_value" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("ratings")
    .upsert(
      { rater_player_id: raterId, rated_player_id: ratedId, value },
      { onConflict: "rater_player_id,rated_player_id" }
    )
    .select("id,rater_player_id,rated_player_id,value,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rating: data });
}