import { isKnownBeerName } from "./beers";

export const MAX_ROTATIONS = 100;
export const MAX_THROWS = 10;
export type NotebookPlayer = { id: string; name: string; teamId: string };
export type NotebookTeam = { id: string; name: string };
export type NotebookThrow = { id: string; thrown: boolean; center: boolean; opponent: boolean };
export type NotebookEntry = { throws: NotebookThrow[]; cheats: number };
export type NotebookRotation = { entries: Record<string, NotebookEntry>; hits: string[] };
export type Notebook = {
  schema: 1;
  players: Record<string, { beer: string | null; finishedAt: string | null }>;
  rotations: NotebookRotation[];
};
export type NotebookHit = { id: string; playerId: string; teamId: string; rotation: number; number: number; bonus: boolean };

const emptyThrow = (): NotebookThrow => ({ id: crypto.randomUUID(), thrown: false, center: false, opponent: false });
export function newRotation(players: NotebookPlayer[]): NotebookRotation {
  return { entries: Object.fromEntries(players.map(p => [p.id, { throws: [emptyThrow()], cheats: 0 }])), hits: [] };
}
export function newNotebook(players: NotebookPlayer[]): Notebook {
  return { schema: 1, players: Object.fromEntries(players.map(p => [p.id, { beer: null, finishedAt: null }])), rotations: [newRotation(players)] };
}

export function notebookHits(doc: Notebook, players: NotebookPlayer[]): NotebookHit[] {
  const counts = new Map<string, number>();
  return doc.rotations.flatMap((rotation, index) => {
    const hitById = new Map<string, Omit<NotebookHit, "number">>();
    for (const p of players) rotation.entries[p.id]?.throws.forEach((shot, n) => {
      if (shot.thrown && shot.center) hitById.set(shot.id, { id: shot.id, playerId: p.id, teamId: p.teamId, rotation: index, bonus: n > 0 });
    });
    return rotation.hits.flatMap(id => {
      const hit = hitById.get(id);
      if (!hit) return [];
      const number = (counts.get(hit.teamId) ?? 0) + 1;
      counts.set(hit.teamId, number);
      return [{ ...hit, number }];
    });
  });
}

// Corrections remove only dependent bonus throws and finish references to deleted hits.
export function editThrow(doc: Notebook, rotation: number, playerId: string, shotIndex: number,
  field: "thrown" | "center" | "opponent", checked: boolean): Notebook {
  const next = structuredClone(doc);
  const row = next.rotations[rotation];
  const entry = row.entries[playerId];
  const shot = entry.throws[shotIndex];
  shot[field] = checked;
  if (checked && field !== "thrown") shot.thrown = true;
  if (!shot.thrown) { shot.center = false; shot.opponent = false; }
  if (!shot.opponent) entry.throws.splice(shotIndex + 1);
  else if (entry.throws.length === shotIndex + 1 && entry.throws.length < MAX_THROWS) entry.throws.push(emptyThrow());
  if (shot.center && !row.hits.includes(shot.id)) row.hits.push(shot.id);
  const validHits = new Set(Object.values(row.entries).flatMap(e => e.throws.filter(s => s.center).map(s => s.id)));
  row.hits = row.hits.filter(id => validHits.has(id));
  const allHits = new Set(next.rotations.flatMap(r => r.hits));
  for (const p of Object.values(next.players)) if (p.finishedAt && !allHits.has(p.finishedAt)) p.finishedAt = null;
  return next;
}

export function moveNotebookHit(doc: Notebook, rotation: number, id: string, otherId: string): Notebook {
  const next = structuredClone(doc);
  const hits = next.rotations[rotation].hits;
  const a = hits.indexOf(id), b = hits.indexOf(otherId);
  if (a >= 0 && b >= 0) [hits[a], hits[b]] = [hits[b], hits[a]];
  return next;
}

export function playerNotebookTotals(doc: Notebook, playerId: string) {
  const entries = doc.rotations.flatMap(r => r.entries[playerId] ? [r.entries[playerId]] : []);
  return entries.reduce((totals, entry) => {
    totals.cheats += entry.cheats;
    entry.throws.forEach((shot, i) => {
      totals.throws += Number(shot.thrown);
      totals.hits += Number(shot.center);
      totals.opponentHits += Number(shot.opponent);
      totals.penaltyHits += Number(i > 0 && shot.center);
    });
    return totals;
  }, { throws: 0, hits: 0, opponentHits: 0, penaltyHits: 0, cheats: 0 });
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isNotebookId = uuid;

/** Validate and reconstruct trusted data; never accept totals, team IDs or bonus claims from a client. */
export function parseNotebook(value: unknown, roster: NotebookPlayer[]): Notebook | null {
  if (!record(value) || value.schema !== 1 || !record(value.players) || !Array.isArray(value.rotations) ||
    !value.rotations.length || value.rotations.length > MAX_ROTATIONS || !roster.length) return null;
  const playerIds = new Set(roster.map(p => p.id));
  const samePlayers = (obj: Record<string, unknown>) => Object.keys(obj).length === playerIds.size && Object.keys(obj).every(id => playerIds.has(id));
  if (!samePlayers(value.players)) return null;
  const players: Notebook["players"] = {};
  for (const { id } of roster) {
    const p = value.players[id];
    if (!record(p) || !(p.beer === null || typeof p.beer === "string" && isKnownBeerName(p.beer)) || !(p.finishedAt === null || uuid(p.finishedAt))) return null;
    players[id] = { beer: p.beer, finishedAt: p.finishedAt };
  }
  const ids = new Set<string>();
  const rotations: NotebookRotation[] = [];
  for (const r of value.rotations) {
    if (!record(r) || !record(r.entries) || !samePlayers(r.entries) || !Array.isArray(r.hits)) return null;
    const entries: NotebookRotation["entries"] = {};
    const centers = new Set<string>();
    for (const { id } of roster) {
      const entry = r.entries[id];
      if (!record(entry) || !Number.isInteger(entry.cheats) || Number(entry.cheats) < 0 || Number(entry.cheats) > 99 ||
        !Array.isArray(entry.throws) || !entry.throws.length || entry.throws.length > MAX_THROWS) return null;
      const shots: NotebookThrow[] = [];
      for (const s of entry.throws) {
        if (!record(s) || !uuid(s.id) || ids.has(s.id) || typeof s.thrown !== "boolean" || typeof s.center !== "boolean" || typeof s.opponent !== "boolean" ||
          (!s.thrown && (s.center || s.opponent)) || (shots.length > 0 && !shots[shots.length - 1].opponent)) return null;
        ids.add(s.id);
        shots.push({ id: s.id, thrown: s.thrown, center: s.center, opponent: s.opponent });
        if (s.center) centers.add(s.id);
      }
      if (shots.length < MAX_THROWS && shots[shots.length - 1].opponent) return null;
      entries[id] = { throws: shots, cheats: Number(entry.cheats) };
    }
    if (r.hits.length !== centers.size || new Set(r.hits).size !== r.hits.length || !r.hits.every(id => typeof id === "string" && centers.has(id))) return null;
    rotations.push({ entries, hits: r.hits as string[] });
  }
  const doc: Notebook = { schema: 1, players, rotations };
  const hits = notebookHits(doc, roster);
  for (const p of roster) if (players[p.id].finishedAt && !hits.some(h => h.id === players[p.id].finishedAt && h.teamId === p.teamId)) return null;
  return doc;
}
