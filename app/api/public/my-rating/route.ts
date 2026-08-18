import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { readAuthContext } from "@/app/api/admin/_auth";
import { ratingEligibilityForPair } from "@/lib/ratingEligibility";

export async function GET(req: Request) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) {
    return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });
  }

  const url = new URL(req.url);
  const ratedId = url.searchParams.get("ratedId") ?? "";

  if (!ratedId) {
    return NextResponse.json({ error: "missing_ratedId" }, { status: 400 });
  }

  if (ratedId === auth.ctx.playerId) {
    return NextResponse.json({
      value: null,
      updatedAt: null,
      canRate: false,
      cooldownState: "cooldown",
      hoursLeft: null,
      message: "Nie mozesz wystawic oceny sobie.",
      isSelf: true,
    });
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
    return NextResponse.json({
      value: null,
      updatedAt: null,
      canRate: false,
      cooldownState: "cooldown",
      hoursLeft: null,
      message: "Main admin musi odblokowac Ci ocenianie graczy.",
      isSelf: false,
    });
  }

  const { data, error } = await supabaseServer
    .from("ratings")
    .select("value, updated_at")
    .eq("rater_player_id", auth.ctx.playerId)
    .eq("rated_player_id", ratedId)
    .maybeSingle();

  if (error) {
    if (error.message.includes("rater_player_id")) {
      return NextResponse.json({ error: "missing_ratings_player_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const eligibility = await ratingEligibilityForPair(auth.ctx.playerId, ratedId, data?.updated_at ?? null);

  return NextResponse.json({
    value: data?.value ?? null,
    updatedAt: data?.updated_at ?? null,
    canRate: eligibility.canRate,
    cooldownState: eligibility.state,
    hoursLeft: eligibility.hoursLeft,
    message: eligibility.message,
    eligibilityReason: eligibility.reason,
    lastSharedMatchAt: eligibility.lastSharedMatchAt,
    windowExpiresAt: eligibility.windowExpiresAt,
    isSelf: false,
  });
}
