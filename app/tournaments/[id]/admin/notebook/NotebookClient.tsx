"use client";

import { useEffect, useMemo, useState } from "react";
import BackNavButton from "@/app/components/BackNavButton";
import { authedFetch } from "@/lib/authClient";
import { BEER_LIST } from "@/lib/beers";
import { editThrow, MAX_ROTATIONS, MAX_THROWS, moveNotebookHit, newRotation, notebookHits, playerNotebookTotals,
  type Notebook, type NotebookPlayer, type NotebookTeam } from "@/lib/notebook";
import type { NotebookMatch } from "@/lib/notebookServer";
import useNotebook, { notebookMessage } from "./useNotebook";
import styles from "./Notebook.module.css";

type Catalog = { matches: NotebookMatch[]; teams: NotebookTeam[]; players: NotebookPlayer[]; viewerId: string };
export default function NotebookClient({ tournamentId, initialMatch }: { tournamentId: string; initialMatch: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [matchId, setMatchId] = useState(initialMatch);
  const [game, setGame] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/notebook`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(notebookMessage(data.error)); return; }
        setCatalog(data);
        const ready = data.matches.filter((m: NotebookMatch) => m.team_a_id && m.team_b_id);
        setMatchId(id => ready.some((m: NotebookMatch) => m.id === id) ? id : ready.find((m: NotebookMatch) => m.status !== "finished")?.id ?? ready[0]?.id ?? "");
      } catch { if (!cancelled) setError(notebookMessage("network")); }
    })();
    return () => { cancelled = true; };
  }, [tournamentId]);
  const match = catalog?.matches.find(m => m.id === matchId);
  const roster = useMemo(() => catalog?.players.filter(p => p.teamId === match?.team_a_id || p.teamId === match?.team_b_id) ?? [], [catalog, match]);
  const teams = catalog?.teams.filter(t => t.id === match?.team_a_id || t.id === match?.team_b_id) ?? [];
  const teamName = (id: string | null) => catalog?.teams.find(t => t.id === id)?.name ?? "—";

  return <main className="tour-root"><div className="tour-shell">
    <div className="tour-topbar"><BackNavButton fallbackHref={`/tournaments/${tournamentId}/admin`} /></div>
    <section className={`glass-card ${styles.heading}`}><h1 className="tour-title">Notatnik</h1>
      {error && <p role="alert">{error}</p>}
      {!error && !catalog && <p>Wczytywanie…</p>}
      {catalog && <div className={styles.selectors}>
        <label>Mecz<select aria-label="Mecz" value={matchId} onChange={e => { setMatchId(e.target.value); setGame(1); }}>
          {catalog.matches.filter(m => m.team_a_id && m.team_b_id).map(m => <option key={m.id} value={m.id}>
            R{m.round_no} · M{m.match_no} · {teamName(m.team_a_id)} – {teamName(m.team_b_id)}{m.status === "finished" ? " · zakończony" : ""}
          </option>)}
        </select></label>
        {match && <label>Gra<select aria-label="Gra" value={game} onChange={e => setGame(Number(e.target.value))}>
          {Array.from({ length: match.bo }, (_, i) => <option key={i} value={i + 1}>{i + 1} / BO{match.bo}</option>)}
        </select></label>}
        {!match && <p>Notatnik będzie dostępny po utworzeniu meczów z obiema drużynami.</p>}
      </div>}
    </section>
    {catalog && match && roster.length > 0 && <GameNotebook key={`${matchId}:${game}`} tournamentId={tournamentId} matchId={matchId}
      game={game} viewerId={catalog.viewerId} roster={roster} teams={teams} />}
  </div></main>;
}

function GameNotebook({ tournamentId, matchId, game, viewerId, roster, teams }: {
  tournamentId: string; matchId: string; game: number; viewerId: string; roster: NotebookPlayer[]; teams: NotebookTeam[];
}) {
  const editor = useNotebook(tournamentId, matchId, game, viewerId, roster);
  const [rotation, setRotation] = useState(0);
  const { state } = editor;
  const doc = state?.document;
  const hits = useMemo(() => doc ? notebookHits(doc, roster) : [], [doc, roster]);
  function change(edit: (draft: Notebook) => void) {
    if (!doc) return;
    const next = structuredClone(doc); edit(next); editor.update(next);
  }
  function setThrow(playerId: string, index: number, field: "thrown" | "center" | "opponent", checked: boolean) {
    if (!doc) return;
    const next = editThrow(doc, rotation, playerId, index, field, checked);
    const before = doc.rotations[rotation].entries[playerId].throws;
    const after = next.rotations[rotation].entries[playerId].throws;
    const removesBonusData = before.slice(after.length).some(s => s.thrown || s.center || s.opponent);
    const removesFinish = Object.keys(doc.players).some(id => doc.players[id].finishedAt && !next.players[id].finishedAt);
    if ((removesBonusData || removesFinish) && !window.confirm("Ta korekta usunie zależne rzuty bonusowe lub przypisanie ukończenia piwa. Kontynuować?")) return;
    editor.update(next);
  }
  function reload() {
    if (!window.confirm("Wczytać wersję z serwera zamiast lokalnych zmian? Możesz najpierw pobrać kopię.")) return;
    setRotation(0); void editor.load(true);
  }
  if (editor.error) return <section className={`glass-card ${styles.heading}`}><p role="alert">{editor.error}</p>
    <div className={styles.actions}><button onClick={() => void editor.load()}>Spróbuj ponownie</button><button onClick={editor.download}>Pobierz kopię</button><button onClick={reload}>Wczytaj zapis z serwera</button></div>
  </section>;
  if (!doc || !state) return <p className={styles.heading}>Wczytywanie wpisów…</p>;
  return <div className={styles.notebook}>
    <div className={`glass-card ${styles.toolbar}`}>
      <div className={styles.actions}>
        <button disabled={rotation === 0} onClick={() => setRotation(r => r - 1)}>Poprzednia</button>
        <label className={styles.rotation}>Rotacja<select aria-label="Rotacja" value={rotation} onChange={e => setRotation(Number(e.target.value))}>
          {doc.rotations.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
        </select></label>
        <button disabled={state.blocked || rotation === MAX_ROTATIONS - 1} onClick={() => {
          if (rotation === doc.rotations.length - 1) change(d => { d.rotations.push(newRotation(roster)); });
          setRotation(r => r + 1);
        }}>Następna</button>
      </div>
      <p role="status">{state.status}</p>
      {editor.localWarning && <p role="alert">Przeglądarka nie zapisała kopii lokalnej. Nie zamykaj tej strony, dopóki wpisy nie zostaną zapisane na serwerze.</p>}
      <div className={styles.actions}>
        {!state.blocked && state.dirty && <button onClick={() => void editor.save()}>Zapisz teraz</button>}
        <button onClick={editor.download}>Pobierz kopię</button>
        {state.blocked && <button onClick={reload}>Wczytaj zapis z serwera</button>}
      </div>
    </div>
    <div className={styles.teams}>{teams.map(team => {
      const teamHits = hits.filter(h => h.teamId === team.id);
      const rotationHits = teamHits.filter(h => h.rotation === rotation);
      return <section key={team.id} className={`glass-card ${styles.team}`}>
        <h2>{team.name}<small>Trafienia środka: {teamHits.length}</small></h2>
        {roster.filter(p => p.teamId === team.id).map(player => {
          const entry = doc.rotations[rotation].entries[player.id];
          const totals = playerNotebookTotals(doc, player.id);
          const finish = teamHits.find(h => h.id === doc.players[player.id].finishedAt);
          return <fieldset key={player.id} className={styles.player} disabled={state.blocked}>
            <legend>{player.name}</legend>
            {entry.throws.map((shot, index) => <div key={shot.id} className={styles.shot}>
              <span className={styles.shotLabel}>{index ? `Rzut bonusowy ${index}` : "Rzut"}</span>
              <div className={styles.checks}>
                {([['thrown', 'Rzucił'], ['center', 'Środek'], ['opponent', 'Puszka przeciwnika']] as const).map(([field, label]) =>
                  <label key={field}><input type="checkbox" aria-label={`${player.name}, ${index ? `bonus ${index}` : "rzut"}, ${label}`}
                    checked={shot[field]} onChange={e => setThrow(player.id, index, field, e.target.checked)} />{label}
                    {field === "center" && shot.center && <strong>#{teamHits.find(h => h.id === shot.id)?.number}</strong>}
                  </label>)}
              </div>
            </div>)}
            {entry.throws.length === MAX_THROWS && entry.throws[MAX_THROWS - 1].opponent && <p>Osiągnięto limit 10 kolejnych rzutów w tej rotacji.</p>}
            <div className={styles.playerFields}>
              <div className={styles.counter}><span>Oszustwa</span><button aria-label={`${player.name}, mniej oszustw`} disabled={state.blocked || entry.cheats === 0}
                onClick={() => change(d => { d.rotations[rotation].entries[player.id].cheats--; })}>−</button><output>{entry.cheats}</output>
                <button aria-label={`${player.name}, więcej oszustw`} disabled={state.blocked || entry.cheats === 99}
                  onClick={() => change(d => { d.rotations[rotation].entries[player.id].cheats++; })}>+</button></div>
              <label>Skończył przy trafieniu<select aria-label={`${player.name}, skończył przy trafieniu`} value={doc.players[player.id].finishedAt ?? ""}
                onChange={e => change(d => { d.players[player.id].finishedAt = e.target.value || null; })}>
                <option value="">Nie zaznaczono</option>{teamHits.map(h => <option key={h.id} value={h.id}>#{h.number} · rotacja {h.rotation + 1} · {roster.find(p => p.id === h.playerId)?.name}</option>)}
              </select></label>
              {!finish && rotationHits.length > 0 && <button onClick={() => change(d => { d.players[player.id].finishedAt = rotationHits[rotationHits.length - 1].id; })}>Skończył przy #{rotationHits[rotationHits.length - 1].number}</button>}
            </div>
            <details><summary>Piwo i suma z tej gry{finish ? ` · ukończone przy #${finish.number}` : ""}</summary>
              <label>Piwo<select aria-label={`${player.name}, piwo`} value={doc.players[player.id].beer ?? ""} onChange={e => change(d => { d.players[player.id].beer = e.target.value || null; })}>
                <option value="">Nieznane</option>{BEER_LIST.map(b => <option key={b.name}>{b.name}</option>)}
              </select></label>
              <p>Rzuty: {totals.throws} · Środek: {totals.hits} · Puszka przeciwnika: {totals.opponentHits} · Oszustwa: {totals.cheats}</p>
            </details>
          </fieldset>;
        })}
        {rotationHits.length > 0 && <details className={styles.hitOrder}><summary>Kolejność trafień w tej rotacji</summary>
          <ol>{rotationHits.map((hit, i) => <li key={hit.id}><span>#{hit.number} {roster.find(p => p.id === hit.playerId)?.name}{hit.bonus ? " · bonus" : ""}</span>
            <button disabled={state.blocked || i === 0} aria-label={`Trafienie ${hit.number} wcześniej`} onClick={() => editor.update(moveNotebookHit(doc, rotation, hit.id, rotationHits[i - 1].id))}>Wcześniej</button>
            <button disabled={state.blocked || i === rotationHits.length - 1} aria-label={`Trafienie ${hit.number} później`} onClick={() => editor.update(moveNotebookHit(doc, rotation, hit.id, rotationHits[i + 1].id))}>Później</button>
          </li>)}</ol>
        </details>}
      </section>;
    })}</div>
  </div>;
}
