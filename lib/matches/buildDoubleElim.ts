import { supabaseServer } from "@/lib/supabaseServer";

type Outcome = "winner" | "loser";
type InsertMatchPayload = {
  tournament_id: string;
  bracket: "winners" | "losers" | "grand_final";
  round_no: number;
  match_no: number;
  bo: number;
  status: "pending" | "finished";
  team_a_id?: string | null;
  team_b_id?: string | null;
  src_a_match_id?: string;
  src_a_outcome?: Outcome;
  src_b_match_id?: string;
  src_b_outcome?: Outcome;
  is_reset_match?: boolean;
};

function nextPow2(n: number) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export async function buildDoubleElimBracket(
  tournamentId: string,
  options?: { clearExisting?: boolean }
) {
  const clearExisting = options?.clearExisting ?? true;

  const { data: t, error: tErr } = await supabaseServer
    .from("tournaments")
    .select("id,format,bo_default,bo_finals,gf_reset_enabled")
    .eq("id", tournamentId)
    .single();

  if (tErr) throw new Error(tErr.message);
  if (t.format !== "double_elim") throw new Error("not_double_elim");

  const { data: batch, error: bErr } = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("is_active", true)
    .maybeSingle();

  if (bErr) throw new Error(bErr.message);
  if (!batch?.id) throw new Error("no_active_team_batch");

  const { data: teams, error: teamsErr } = await supabaseServer
    .from("teams")
    .select("id,name,created_at")
    .eq("batch_id", batch.id)
    .order("created_at", { ascending: true });

  if (teamsErr) throw new Error(teamsErr.message);
  const teamIds = (teams ?? []).map((x) => x.id);
  if (teamIds.length < 2) throw new Error("need_at_least_2_teams");

  if (clearExisting) {
    const { error: delErr } = await supabaseServer
      .from("tournament_matches")
      .delete()
      .eq("tournament_id", tournamentId);
    if (delErr) throw new Error(delErr.message);
  }

  const N = teamIds.length;
  const P = nextPow2(N);
  const k = Math.log2(P);

  const slots: (string | null)[] = [...teamIds, ...Array(P - N).fill(null)];

  async function insertMatch(payload: InsertMatchPayload) {
    const { data, error } = await supabaseServer
      .from("tournament_matches")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  const W: string[][] = Array.from({ length: k + 1 }, () => []);

  const w1Matches = P / 2;
  for (let m = 1; m <= w1Matches; m++) {
    const a = slots[(m - 1) * 2];
    const b = slots[(m - 1) * 2 + 1];
    const id = await insertMatch({
      tournament_id: tournamentId,
      bracket: "winners",
      round_no: 1,
      match_no: m,
      bo: t.bo_default,
      team_a_id: a,
      team_b_id: b,
      status: "pending",
    });
    W[1][m] = id;
  }

  for (let r = 2; r <= k; r++) {
    const matches = P / 2 ** r;
    for (let m = 1; m <= matches; m++) {
      const src1 = W[r - 1][(m - 1) * 2 + 1];
      const src2 = W[r - 1][(m - 1) * 2 + 2];
      const id = await insertMatch({
        tournament_id: tournamentId,
        bracket: "winners",
        round_no: r,
        match_no: m,
        bo: r === k ? t.bo_finals : t.bo_default,
        src_a_match_id: src1,
        src_a_outcome: "winner",
        src_b_match_id: src2,
        src_b_outcome: "winner",
        status: "pending",
      });
      W[r][m] = id;
    }
  }

  const Lrounds = Math.max(1, 2 * k - 2);
  const L: string[][] = Array.from({ length: Lrounds + 1 }, () => []);

  if (k >= 2) {
    const l1Matches = P / 4;
    for (let m = 1; m <= l1Matches; m++) {
      const wLoss1 = W[1][(m - 1) * 2 + 1];
      const wLoss2 = W[1][(m - 1) * 2 + 2];
      const id = await insertMatch({
        tournament_id: tournamentId,
        bracket: "losers",
        round_no: 1,
        match_no: m,
        bo: t.bo_default,
        src_a_match_id: wLoss1,
        src_a_outcome: "loser",
        src_b_match_id: wLoss2,
        src_b_outcome: "loser",
        status: "pending",
      });
      L[1][m] = id;
    }
  }

  for (let lr = 2; lr <= Lrounds; lr++) {
    const even = lr % 2 === 0;

    if (even) {
      const wr = lr / 2 + 1;
      const matches = P / 2 ** wr;
      for (let m = 1; m <= matches; m++) {
        const fromL = L[lr - 1][m];
        const fromW = W[wr][m];
        const id = await insertMatch({
          tournament_id: tournamentId,
          bracket: "losers",
          round_no: lr,
          match_no: m,
          bo: wr === k ? t.bo_finals : t.bo_default,
          src_a_match_id: fromL,
          src_a_outcome: "winner",
          src_b_match_id: fromW,
          src_b_outcome: "loser",
          status: "pending",
        });
        L[lr][m] = id;
      }
    } else {
      const prev = L[lr - 1];
      const prevCount = prev.length - 1;
      const matches = Math.floor(prevCount / 2);
      for (let m = 1; m <= matches; m++) {
        const a = prev[(m - 1) * 2 + 1];
        const b = prev[(m - 1) * 2 + 2];
        const id = await insertMatch({
          tournament_id: tournamentId,
          bracket: "losers",
          round_no: lr,
          match_no: m,
          bo: t.bo_default,
          src_a_match_id: a,
          src_a_outcome: "winner",
          src_b_match_id: b,
          src_b_outcome: "winner",
          status: "pending",
        });
        L[lr][m] = id;
      }
    }
  }

  const gfId = await insertMatch({
    tournament_id: tournamentId,
    bracket: "grand_final",
    round_no: 1,
    match_no: 1,
    bo: t.bo_finals,
    src_a_match_id: W[k][1],
    src_a_outcome: "winner",
    src_b_match_id: L[Lrounds][1],
    src_b_outcome: "winner",
    status: "pending",
  });

  if (t.gf_reset_enabled) {
    await insertMatch({
      tournament_id: tournamentId,
      bracket: "grand_final",
      round_no: 2,
      match_no: 1,
      bo: t.bo_finals,
      src_a_match_id: gfId,
      src_a_outcome: "winner",
      src_b_match_id: gfId,
      src_b_outcome: "loser",
      is_reset_match: true,
      status: "pending",
    });
  }

  return {
    ok: true,
    teams: teamIds.length,
    pow2: P,
    winnersRounds: k,
    losersRounds: Lrounds,
  };
}
