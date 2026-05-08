import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { readAuthContext } from "@/app/api/admin/_auth";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { ratingCooldownFromUpdatedAt } from "@/lib/ratingCooldown";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `ratings:ip:${ip}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) {
    return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });
  }
  if (auth.ctx.playerActive !== true) {
    return NextResponse.json({ error: "player_inactive" }, { status: 403 });
  }

  const permission = await supabaseServer
    .from("players")
    .select("can_rate_others")
    .eq("id", auth.ctx.playerId)
    .maybeSingle();

  if (permission.error) {
    if (permission.error.message.includes("can_rate_others")) {
      return NextResponse.json({ error: "missing_player_rating_permission_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: permission.error.message }, { status: 500 });
  }

  if ((permission.data as { can_rate_others?: boolean | null } | null)?.can_rate_others !== true) {
    return NextResponse.json(
      { error: "rating_locked_by_admin", message: "Main admin musi odblokowac Ci ocenianie graczy." },
      { status: 403 }
    );
  }

  const userLimit = rateLimit({ key: `ratings:user:${auth.ctx.userId}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

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
    const cooldown = ratingCooldownFromUpdatedAt(existing.updated_at);
    if (!cooldown.canRate) {
      return NextResponse.json(
        {
          error: "cooldown",
          message: cooldown.message,
          hoursLeft: cooldown.hoursLeft,
        },
        { status: 429 }
      );
    }
  }

  const upsertPayload: {
    rater_player_id: string;
    rated_player_id: string;
    value: number;
    updated_at: string;
    rater_device_id: string;
  } = {
    rater_player_id: auth.ctx.playerId,
    rated_player_id: ratedId,
    value,
    updated_at: new Date().toISOString(),
    // Backward compatibility for older schema where rater_device_id is NOT NULL.
    rater_device_id: `auth:${auth.ctx.userId}`,
  };

  const primaryUpsert = await supabaseServer
    .from("ratings")
    .upsert(upsertPayload, { onConflict: "rater_player_id,rated_player_id" })
    .select("id,rater_player_id,rated_player_id,value,updated_at")
    .single();

  let data = primaryUpsert.data;
  let error = primaryUpsert.error;

  if (error && error.message.includes("rater_device_id")) {
    const fallbackUpsert = await supabaseServer
      .from("ratings")
      .upsert(
        {
          rater_player_id: auth.ctx.playerId,
          rated_player_id: ratedId,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "rater_player_id,rated_player_id" }
      )
      .select("id,rater_player_id,rated_player_id,value,updated_at")
      .single();
    data = fallbackUpsert.data;
    error = fallbackUpsert.error;
  }

  if (error) {
    if (error.message.includes("rater_player_id")) {
      return NextResponse.json({ error: "missing_ratings_player_schema" }, { status: 500 });
    }
    console.error("SUPABASE ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rating: data });
}
