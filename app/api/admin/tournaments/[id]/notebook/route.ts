import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { isNotebookId, parseNotebook, type NotebookPlayer } from "@/lib/notebook";
import { NotebookError, notebookStorageError, readNotebookCatalog, rosterForMatch, sameNotebookRoster } from "@/lib/notebookServer";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const fail = (e: unknown) => e instanceof NotebookError ? json({ error: e.code }, e.status) : json({ error: "notebook_storage_failed" }, 500);

export async function GET(req: Request, { params }: Context) {
  const { id } = await params;
  if (!isNotebookId(id)) return json({ error: "invalid_tournament" }, 400);
  const auth = await assertTournamentAdmin(req, id);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    const query = new URL(req.url).searchParams;
    const matchId = query.get("matchId");
    if (matchId && !isNotebookId(matchId)) return json({ error: "invalid_match" }, 400);
    const catalog = await readNotebookCatalog(id, matchId ?? undefined);
    if (!matchId) return json({ ...catalog, viewerId: auth.ctx.userId });
    if (!isNotebookId(matchId)) return json({ error: "invalid_match" }, 400);
    const game = Number(query.get("game"));
    const roster = rosterForMatch(catalog, matchId, game);
    const { data, error } = await supabaseServer.from("match_notebooks").select("document,revision,roster,updated_at")
      .eq("tournament_id", id).eq("match_id", matchId).eq("game_no", game).maybeSingle();
    if (error) throw notebookStorageError(error);
    if (data && !sameNotebookRoster(data.roster as NotebookPlayer[], roster)) throw new NotebookError("roster_changed", 409);
    return json({ document: data?.document ?? null, revision: data?.revision ?? 0, roster });
  } catch (e) { return fail(e); }
}

export async function PUT(req: Request, { params }: Context) {
  const { id } = await params;
  if (!isNotebookId(id)) return json({ error: "invalid_tournament" }, 400);
  const auth = await assertTournamentAdmin(req, id);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const limit = rateLimit({ key: `notebook:${auth.ctx.userId}`, limit: 180, windowMs: 60_000 });
  if (!limit.ok) return rateLimitResponse(limit);
  if (Number(req.headers.get("content-length")) > 1_500_000) return json({ error: "notebook_too_large" }, 413);
  const text = await req.text();
  if (text.length > 1_500_000) return json({ error: "notebook_too_large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "invalid_notebook" }, 400); }
  if (!isNotebookId(body?.matchId) || !Number.isInteger(body?.game) || !Number.isInteger(body?.revision) || body.revision < 0 || body.revision > 2_000_000_000) {
    return json({ error: "invalid_notebook" }, 400);
  }
  try {
    const catalog = await readNotebookCatalog(id, body.matchId);
    const roster = rosterForMatch(catalog, body.matchId, body.game);
    const document = parseNotebook(body.document, roster);
    if (!document) return json({ error: "invalid_notebook" }, 400);
    const { data: existing, error: readError } = await supabaseServer.from("match_notebooks").select("revision,roster,document")
      .eq("tournament_id", id).eq("match_id", body.matchId).eq("game_no", body.game).maybeSingle();
    if (readError) throw notebookStorageError(readError);
    if (existing && !sameNotebookRoster(existing.roster as NotebookPlayer[], roster)) throw new NotebookError("roster_changed", 409);
    // A lost response can cause the same draft to be retried. Accept it without another write.
    if (existing && JSON.stringify(parseNotebook(existing.document, roster)) === JSON.stringify(document)) return json({ revision: existing.revision });
    if ((existing?.revision ?? 0) !== body.revision) throw new NotebookError("revision_conflict", 409);
    const values = { document, roster, revision: body.revision + 1, updated_by: auth.ctx.userId, updated_at: new Date().toISOString() };
    const result = existing
      ? await supabaseServer.from("match_notebooks").update(values).eq("tournament_id", id).eq("match_id", body.matchId)
        .eq("game_no", body.game).eq("revision", body.revision).select("revision").maybeSingle()
      : await supabaseServer.from("match_notebooks").insert({ ...values, tournament_id: id, match_id: body.matchId, game_no: body.game })
        .select("revision").single();
    if (result.error?.code === "23505" || !result.error && !result.data) throw new NotebookError("revision_conflict", 409);
    if (result.error) throw notebookStorageError(result.error);
    return json({ revision: result.data!.revision });
  } catch (e) { return fail(e); }
}
