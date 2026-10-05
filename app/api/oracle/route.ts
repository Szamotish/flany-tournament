import { readAuthContext } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { askGroq, oracleConfigured, parseOracleQuestion, prepareOraclePrompt, readSmallJson } from "@/lib/oracleServer";
import { isOracleModel, type OracleStatus } from "@/lib/oracleConfig";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
const unavailable: OracleStatus = { available: false, reason: "unavailable" };
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, private" } });
}
function throttle(req: Request) {
  return !rateLimit({ key: `oracle:${clientIp(req)}`, limit: 120, windowMs: 60000 }).ok;
}
async function gate(userId: string, requestId: string | null = null) {
  const { data, error } = await supabaseServer.rpc("oracle_gate", { p_user: userId, p_request: requestId });
  if (error || !data || typeof data.available !== "boolean" || typeof data.reason !== "string")
    throw new Error("oracle_gate_failed");
  return data as OracleStatus & { model?: string };
}
function publicStatus(status: OracleStatus): OracleStatus {
  return { available: status.available, reason: status.reason, retryAt: status.retryAt,
    remainingGlobal: status.remainingGlobal, remainingUser: status.remainingUser };
}
function promptStatus(error: unknown): OracleStatus {
  const reason = error instanceof Error ? error.message : "";
  return { available: false, reason: ["prompt_budget_exceeded", "context_unavailable"].includes(reason)
    ? reason : "rules_unavailable" };
}

export async function GET(req: Request) {
  if (!oracleConfigured()) return reply({ available: false, reason: "disabled" });
  if (throttle(req)) return reply(unavailable, 429);
  try {
    const auth = await readAuthContext(req);
    if (!auth.ok) return reply(unavailable, auth.status);
    const status = await gate(auth.ctx.userId);
    if (status.available) {
      try { await prepareOraclePrompt(); }
      catch (error) { return reply(promptStatus(error)); }
    }
    return reply(publicStatus(status));
  } catch { return reply(unavailable, 503); }
}

export async function POST(req: Request) {
  if (!oracleConfigured()) return reply({ status: { available: false, reason: "disabled" } }, 503);
  if (throttle(req)) return reply({ status: unavailable }, 429);
  let body;
  try { body = parseOracleQuestion(await readSmallJson(req)); }
  catch { return reply({ error: "Nieprawidłowe pytanie." }, 400); }
  try {
    const auth = await readAuthContext(req);
    if (!auth.ok) return reply({ status: unavailable }, auth.status);
    if (!auth.ctx.playerId) return reply({ status: unavailable }, 403);
    if (body.model && !auth.ctx.isMainAdmin) return reply({ status: unavailable }, 403);
    const availability = await gate(auth.ctx.userId);
    if (!availability.available) return reply({ status: publicStatus(availability) }, 429);
    let systemPrompt: string;
    try { systemPrompt = await prepareOraclePrompt(body.question, auth.ctx.playerId); }
    catch (error) { return reply({ status: promptStatus(error) }, 503); }
    // Only reserve after rules and prompt validation; concurrent calls are checked again here.
    const reservation = await gate(auth.ctx.userId, body.requestId);
    if (!reservation.available) return reply({ status: publicStatus(reservation) }, reservation.reason === "duplicate" ? 409 : 429);
    const model = body.model ?? reservation.model;
    let result: { answer: string | null; tokens: number | null; blockSeconds: number };
    try {
      if (!isOracleModel(model)) throw new Error("invalid_model");
      result = await askGroq(body.question, model, systemPrompt);
    } catch { result = { answer: null, tokens: null, blockSeconds: 86400 }; }
    const { error } = await supabaseServer.rpc("oracle_finish", {
      p_request: body.requestId, p_tokens: result.tokens, p_block_seconds: result.blockSeconds,
    });
    // A lost finalization leaves the durable reservation in place (fail closed).
    let status = unavailable;
    if (!error) {
      try { status = publicStatus(await gate(auth.ctx.userId)); } catch { /* keep hidden */ }
    }
    return reply({ answer: result.answer, status,
      ...(!result.answer ? { error: "Kula nie mogła odpowiedzieć. Spróbuj później." } : {}),
    }, result.answer ? 200 : 503);
  } catch { return reply({ status: unavailable }, 503); }
}
