import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabasePublic } from "@/lib/supabasePublic";

export async function GET(req: Request) {
  const jar = await cookies();
  const deviceId = jar.get("device_id")?.value;

  if (!deviceId) {
    return NextResponse.json({ error: "no_device_id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const ratedId = url.searchParams.get("ratedId") ?? "";

  if (!ratedId) {
    return NextResponse.json({ error: "missing_ratedId" }, { status: 400 });
  }

  const { data, error } = await supabasePublic
    .from("ratings")
    .select("value, updated_at")
    .eq("rater_device_id", deviceId)
    .eq("rated_player_id", ratedId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    value: data?.value ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}