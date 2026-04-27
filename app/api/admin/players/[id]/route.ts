import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { BASE_MMR_CAP } from "@/lib/ranked";

function roundToOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function clampMmr(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > BASE_MMR_CAP) return BASE_MMR_CAP;
  return roundToOne(value);
}

async function writeMmrHistoryEntry(
  playerId: string,
  mmr: number | null | undefined,
  prestigePoints: number | null | undefined,
  reason: "admin_set_mmr" | "admin_reset_mmr"
) {
  if (!Number.isFinite(Number(mmr))) return;
  const insert = await supabaseServer.from("player_mmr_history").insert({
    player_id: playerId,
    reason,
    delta: null,
    mmr: roundToOne(Number(mmr)),
    prestige_points: Number.isFinite(Number(prestigePoints)) ? Number(prestigePoints) : 0,
  });
  if (insert.error && !insert.error.message.includes("player_mmr_history")) {
    throw new Error(insert.error.message);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { id: playerId } = await params;

  const body = await req.json().catch(() => null);
  const hasName = typeof body?.name === "string";
  const name = hasName ? String(body?.name ?? "").trim() : "";
  const hasMmr = body && Object.prototype.hasOwnProperty.call(body, "mmr");
  const resetMmr = body?.resetMmr === true;

  if (hasName && !name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (hasName && name.length > 40) return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  if (!hasName && !hasMmr && !resetMmr) {
    return NextResponse.json({ error: "missing_update_fields" }, { status: 400 });
  }

  let normalizedMmr: number | null = null;
  if (hasMmr) {
    const numericMmr = Number(body?.mmr);
    if (!Number.isFinite(numericMmr)) {
      return NextResponse.json({ error: "invalid_mmr" }, { status: 400 });
    }
    normalizedMmr = clampMmr(numericMmr);
  }

  const { data: player, error: pErr } = await supabaseServer
    .from("players")
    .select("id")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const updatePayload: {
    name?: string;
    mmr?: number;
    prestige_points?: number;
    mmr_manual_override?: boolean;
  } = {};
  if (hasName) updatePayload.name = name;
  if (resetMmr) {
    updatePayload.mmr = 0;
    updatePayload.prestige_points = 0;
    updatePayload.mmr_manual_override = false;
  } else if (hasMmr && normalizedMmr !== null) {
    updatePayload.mmr = normalizedMmr;
    updatePayload.mmr_manual_override = true;
  }

  const primaryUpdate = await supabaseServer
    .from("players")
    .update(updatePayload)
    .eq("id", playerId)
    .select("id,name,active,mmr,mmr_manual_override,rank_frame_enabled")
    .single();

  if (
    primaryUpdate.error &&
    (primaryUpdate.error.message.includes("mmr_manual_override") ||
      primaryUpdate.error.message.includes("rank_frame_enabled"))
  ) {
    const fallbackUpdatePayload = { ...updatePayload };
    delete fallbackUpdatePayload.mmr_manual_override;

    const retry = await supabaseServer
      .from("players")
      .update(fallbackUpdatePayload)
      .eq("id", playerId)
      .select("id,name,active,mmr")
      .single();

    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
    if (hasMmr || resetMmr) {
      try {
        await writeMmrHistoryEntry(
          playerId,
          (retry.data as { mmr?: number | null }).mmr ?? null,
          resetMmr ? 0 : null,
          resetMmr ? "admin_reset_mmr" : "admin_set_mmr"
        );
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "mmr_history_write_failed" },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({ player: retry.data });
  }

  if (primaryUpdate.error) return NextResponse.json({ error: primaryUpdate.error.message }, { status: 500 });

  if (hasMmr || resetMmr) {
    const row = primaryUpdate.data as { mmr?: number | null; prestige_points?: number | null };
    try {
      await writeMmrHistoryEntry(
        playerId,
        row.mmr ?? null,
        row.prestige_points ?? null,
        resetMmr ? "admin_reset_mmr" : "admin_set_mmr"
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "mmr_history_write_failed" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ player: primaryUpdate.data });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { id: playerId } = await params;

  const { data: player, error: pErr } = await supabaseServer
    .from("players")
    .select("id,name")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const ratingsDelete = await supabaseServer
    .from("ratings")
    .delete()
    .or(`rated_player_id.eq.${playerId},rater_player_id.eq.${playerId}`);

  if (ratingsDelete.error && ratingsDelete.error.message.includes("rater_player_id")) {
    const legacyRatingsDelete = await supabaseServer
      .from("ratings")
      .delete()
      .eq("rated_player_id", playerId);
    if (legacyRatingsDelete.error) {
      return NextResponse.json({ error: legacyRatingsDelete.error.message }, { status: 500 });
    }
  } else if (ratingsDelete.error) {
    return NextResponse.json({ error: ratingsDelete.error.message }, { status: 500 });
  }

  const { error: tpErr } = await supabaseServer
    .from("tournament_players")
    .delete()
    .eq("player_id", playerId);
  if (tpErr) return NextResponse.json({ error: tpErr.message }, { status: 500 });

  const { error: taErr } = await supabaseServer
    .from("tournament_admins")
    .delete()
    .eq("player_id", playerId);
  if (taErr && !taErr.message.includes("tournament_admins")) {
    return NextResponse.json({ error: taErr.message }, { status: 500 });
  }

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
