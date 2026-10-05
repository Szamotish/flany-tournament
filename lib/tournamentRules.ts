import { supabaseServer } from "@/lib/supabaseServer";

export const DEFAULT_RULES_TEXT = [
  "1. Zasady turnieju beda uzupelnione przez admina.",
  "2. Lokalne ustalenia turnieju maja pierwszenstwo przed szablonem.",
].join("\n");

export async function readDefaultRules(options: { strict?: boolean } = {}): Promise<string> {
  const res = await supabaseServer
    .from("rule_templates")
    .select("content")
    .eq("id", "default")
    .maybeSingle();

  if (options.strict && (res.error || typeof res.data?.content !== "string"
    || !res.data.content.trim() || res.data.content.trim() === DEFAULT_RULES_TEXT)) {
    throw new Error("rules_unavailable");
  }
  if (res.error || !res.data?.content) return DEFAULT_RULES_TEXT;
  return String(res.data.content);
}

export async function readTournamentRules(tournamentId: string): Promise<{ content: string; source: "custom" | "default" }> {
  const custom = await supabaseServer
    .from("tournament_rules")
    .select("content")
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (!custom.error && custom.data?.content) {
    return { content: String(custom.data.content), source: "custom" };
  }

  return { content: await readDefaultRules(), source: "default" };
}
