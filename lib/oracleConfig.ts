// Safe to import in the browser. Secrets and provider calls live in oracleServer.
export const ORACLE_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"] as const;
export type OracleModel = (typeof ORACLE_MODELS)[number];
export type OracleMode = "off" | "admin" | "public";
export const ORACLE_QUESTION_LENGTH = 180;
export type OracleConfigurationIssue = {
  variable: "ORACLE_ENABLED" | "ORACLE_FREE_PLAN_CONFIRMED" | "GROQ_API_KEY";
  reason: "missing" | "not_true";
};
export type OracleStatus = {
  available: boolean;
  reason: string;
  retryAt?: string | null;
  remainingGlobal?: number;
  remainingUser?: number;
};
export function isOracleModel(value: unknown): value is OracleModel {
  return ORACLE_MODELS.some((model) => model === value);
}
export function oracleStatusText(status: OracleStatus | null): string {
  if (!status) return "Sprawdzam dostępność kuli…";
  const messages: Record<string, string> = {
    ready: "Kula jest gotowa.", disabled: "Kula jest wyłączona lub niedostępna dla Twojego konta.",
    global_limit: "Kula wykorzystała wspólny limit pytań.", personal_limit: "Wykorzystałeś swój limit pytań.",
    provider_limit: "Kula ma przerwę. Spróbuj po odnowieniu dostępności.",
    busy: "Kula odpowiada na inne pytanie.", cooldown: "Daj kuli chwilę przed kolejnym pytaniem.",
    minute_limit: "Kula ma krótką przerwę.", uncertain: "Kula jest chwilowo niedostępna.",
    duplicate: "To pytanie zostało już wysłane.", unavailable: "Kula jest chwilowo niedostępna.",
    rules_unavailable: "Kula nie może teraz odczytać zasad gry z aplikacji.",
    context_unavailable: "Kula nie może teraz odczytać statystyk ligi. Spróbuj później.",
    prompt_budget_exceeded: "Pytanie, instrukcje kuli i regulamin przekraczają budżet. Skróć pytanie lub poproś main admina o skrócenie instrukcji kuli.",
  };
  const message = messages[status.reason] ?? messages.unavailable;
  const date = status.retryAt ? new Date(status.retryAt) : null;
  return date && Number.isFinite(date.getTime())
    ? `${message} Ponowne sprawdzenie: ${date.toLocaleString("pl-PL")}.` : message;
}
