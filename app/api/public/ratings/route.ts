import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabaseServer";

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 dni

export async function POST(req: Request) {
  const jar = await cookies();
  const deviceId = jar.get("device_id")?.value;

  if (!deviceId) {
    return NextResponse.json({ error: "no_device_id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const ratedId = typeof body?.ratedId === "string" ? body.ratedId : "";
  const value = Number(body?.value);

  if (!ratedId) {
    return NextResponse.json({ error: "invalid_player" }, { status: 400 });
  }
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return NextResponse.json({ error: "invalid_value" }, { status: 400 });
  }

  const { data: existing, error: existingErr } = await supabaseServer
    .from("ratings")
    .select("id, updated_at, value")
    .eq("rater_device_id", deviceId)
    .eq("rated_player_id", ratedId)
    .maybeSingle();

  if (existingErr) {
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
      { rater_device_id: deviceId, rated_player_id: ratedId, value, updated_at: new Date().toISOString() },
      { onConflict: "rater_device_id,rated_player_id" }
    )
    .select("id,rater_device_id,rated_player_id,value,updated_at")
    .single();

  if (error) {
    console.error("SUPABASE ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rating: data });
}