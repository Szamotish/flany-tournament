export const BUG_REPORT_TOPICS = [
  "Logowanie i konto",
  "Profil gracza",
  "Awatary i wyglad",
  "Ranking i oceny",
  "Turnieje",
  "Druzyny i kapitanowie",
  "Mecze i wyniki",
  "Drabinka",
  "Powiadomienia",
  "Menu i nawigacja",
  "Wydajnosc aplikacji",
  "Inne",
] as const;

export type BugReportTopic = (typeof BUG_REPORT_TOPICS)[number];

export function isBugReportTopic(value: unknown): value is BugReportTopic {
  return typeof value === "string" && (BUG_REPORT_TOPICS as readonly string[]).includes(value);
}

