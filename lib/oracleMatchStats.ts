import { buildGameStats, playerStats, recentStatsAwards, STAT_CATEGORIES, type StatsSnapshot, type StatView } from "./matchStats";
import { resolveOraclePlayers } from "./oracleLeague";

export function oracleMatchStatsFacts(snapshot: StatsSnapshot, question: string, askingId: string): string[] {
  const q = question.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");
  const named = resolveOraclePlayers(question, snapshot.players).players.slice(0, 2).map(p => p.id);
  const ids = [...new Set([...named, askingId])];
  const games = buildGameStats(snapshot);
  const fmt = (n: number | null) => n === null ? "brak danych" : String(Math.round(n * 10) / 10);
  const safe = (name: string) => JSON.stringify(name.replace(/[\r\n\t]/g, " ").slice(0, 80));
  const view: StatView = /ostatni mecz|ostatnim meczu/.test(q) ? "last" : /wszystk|cala histor|zawsze/.test(q) ? "all" : "recent";
  const facts: string[] = [];
  if (/naj|kto|lider|top\b/.test(q)) {
    const data = recentStatsAwards(snapshot);
    const categories = /pij|pic|piw|szybk/.test(q) ? ["drinking"] : /oszuk|kombin/.test(q) ? ["cheats"] : /karn/.test(q) ? ["penalty"] : /przeciwn|puszk/.test(q) ? ["opponent"] : ["accuracy", "hits"];
    for (const award of data.awards.filter(a => categories.includes(a.category))) {
      const names = award.leaders.slice(0, 4).map(p => safe(p.name)).join(", ");
      facts.push(`${STAT_CATEGORIES[award.category]} (${data.count} ostatnich turniejów): ${names}${award.leaders.length > 4 ? " i inni współliderzy" : ""}, wynik ${fmt(award.value)}${award.category === "accuracy" ? "% (min.5 rzutów)" : ""}.`);
    }
  }
  for (const id of ids) {
    const p = snapshot.players.find(p => p.id === id);
    if (!p) continue;
    const s = playerStats(snapshot, id, games).views[view];
    const scope = view === "last" ? "ostatni mecz" : view === "recent" ? "ostatnie 10 meczów" : "cała historia";
    if (!s.games) { facts.push(`${safe(p.name)}: ${scope}, brak wpisanych statystyk.`); continue; }
    const throwing = `${safe(p.name)} (${scope}; dane ${s.matches}/${s.expectedMatches} meczów): rzuty ${s.throws}, środek ${s.hits}, celność ${fmt(s.accuracy)}%, karne ${s.penaltyHits} (w trafieniach), puszki przeciwnika ${s.opponentHits}, oszustwa ${s.cheats}.`;
    const drinking = `${safe(p.name)} (${scope}): piwo kończy przy trafieniu drużyny śr.${fmt(s.finishAverage)} (${s.finishes} ukończeń; nie sekundy); marki ${s.beers.slice(0, 3).map(b => `${safe(b.name)}:${b.count}`).join(", ")}.`;
    facts.push(...(/pij|pic|piw|szybk/.test(q) ? [drinking, throwing] : [throwing, drinking]));
  }
  facts.push("Notatniki obejmują tylko wpisane dane; brak wpisu nie oznacza zera.");
  return facts;
}
