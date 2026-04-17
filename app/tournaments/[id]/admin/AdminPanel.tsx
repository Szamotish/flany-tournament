"use client";

import Link from "next/link";
import { useState } from "react";
import { teamToneVars } from "@/lib/ui/teamTone";

type TeamEntry = {
  id: string;
  name: string;
  players: { id: string; name: string }[];
};

type PlayerOption = {
  id: string;
  name: string;
  active: boolean;
};

export default function AdminPanel({ tournamentId }: { tournamentId: string }) {
  const [localPass, setLocalPass] = useState("");
  const [teamSize, setTeamSize] = useState(5);
  const [allowUneven, setAllowUneven] = useState(true);
  const [iterations, setIterations] = useState(500);
  const [mode, setMode] = useState<"reset" | "overwrite">("reset");
  const [msg, setMsg] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [tournamentPlayers, setTournamentPlayers] = useState<PlayerOption[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<PlayerOption[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [loadingPlayers, setLoadingPlayers] = useState(false);

  async function generate() {
    setMsg(null);

    const res = await fetch(`/api/admin/tournaments/${tournamentId}/teams/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tournament-admin-password": localPass,
      },
      body: JSON.stringify({ teamSize, allowUneven, iterations, mode }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMsg(`Blad: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Druzyny zostaly wygenerowane.");
  }

  async function loadTeams() {
    setLoadingTeams(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/public/tournaments/${tournamentId}/teams`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`Blad pobierania druzyn: ${json.error ?? res.statusText}`);
        return;
      }
      setTeams(json.teams ?? []);
    } finally {
      setLoadingTeams(false);
    }
  }

  async function renameTeam(teamId: string, name: string) {
    setMsg(null);

    const res = await fetch(`/api/admin/tournaments/${tournamentId}/teams/rename`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-tournament-admin-password": localPass,
      },
      body: JSON.stringify({ teamId, name }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad zmiany nazwy: ${json.error ?? res.statusText}`);
      return;
    }

    setTeams((prev) =>
      prev.map((t) => (t.id === teamId ? { ...t, name: json.team?.name ?? name } : t))
    );
    setMsg("Nazwa druzyny zostala zmieniona.");
  }

  async function loadTournamentPlayers() {
    if (!localPass) {
      setMsg("Podaj haslo lokalnego admina.");
      return;
    }

    setLoadingPlayers(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/players`, {
        headers: { "x-tournament-admin-password": localPass },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`Blad pobierania zawodnikow: ${json.error ?? res.statusText}`);
        return;
      }
      setTournamentPlayers(json.players ?? []);
    } finally {
      setLoadingPlayers(false);
    }
  }

  async function searchPlayers(query: string) {
    const res = await fetch(`/api/public/players/search?q=${encodeURIComponent(query)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad wyszukiwania zawodnikow: ${json.error ?? res.statusText}`);
      return;
    }

    const inTournament = new Set(tournamentPlayers.map((p) => p.id));
    const list: PlayerOption[] = (json.players ?? [])
      .filter((p: PlayerOption) => p.active && !inTournament.has(p.id))
      .sort((a: PlayerOption, b: PlayerOption) => a.name.localeCompare(b.name, "pl"));
    setAvailablePlayers(list);
  }

  async function addPlayer(playerId: string) {
    setMsg(null);
    const res = await fetch(`/api/admin/tournaments/${tournamentId}/players`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tournament-admin-password": localPass,
      },
      body: JSON.stringify({ playerId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad dodawania zawodnika: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Dodano zawodnika do turnieju. Wygeneruj druzyny ponownie.");
    await loadTournamentPlayers();
    await searchPlayers(playerSearch);
    setTeams([]);
  }

  async function removePlayer(playerId: string, playerName: string) {
    if (!window.confirm(`Usunac ${playerName} z tego turnieju?`)) return;

    setMsg(null);
    const res = await fetch(`/api/admin/tournaments/${tournamentId}/players`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-tournament-admin-password": localPass,
      },
      body: JSON.stringify({ playerId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad usuwania zawodnika: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Usunieto zawodnika z turnieju. Wygeneruj druzyny ponownie.");
    await loadTournamentPlayers();
    await searchPlayers(playerSearch);
    setTeams([]);
  }

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href={`/tournaments/${tournamentId}`}>
            Back
          </Link>
          <span className="tour-kicker">Lokalny admin</span>
        </div>

        <section className="tour-detail-main mt-4">
          <h1 className="tour-title">Panel turnieju</h1>
        </section>

        <section className="tour-admin-panel mt-4">
          <div className="tour-admin-grid">
            <div>
              <label className="tour-admin-label">Haslo lokalnego admina</label>
              <input
                className="tour-admin-input"
                type="password"
                value={localPass}
                onChange={(e) => setLocalPass(e.target.value)}
              />
            </div>

            <div className="tour-admin-grid-2">
              <div>
                <label className="tour-admin-label">Rozmiar druzyny</label>
                <input
                  className="tour-admin-input"
                  type="number"
                  min={2}
                  max={20}
                  value={teamSize}
                  onChange={(e) => setTeamSize(Number(e.target.value))}
                />
              </div>

              <div>
                <label className="tour-admin-label">Iteracje</label>
                <input
                  className="tour-admin-input"
                  type="number"
                  min={1}
                  max={5000}
                  value={iterations}
                  onChange={(e) => setIterations(Number(e.target.value))}
                />
              </div>
            </div>

            <label className="tour-admin-check">
              <input type="checkbox" checked={allowUneven} onChange={(e) => setAllowUneven(e.target.checked)} />
              <span>Dopusc nierowne druzyny (roznica maksymalnie 1)</span>
            </label>

            <div>
              <p className="tour-admin-label">Tryb generowania</p>
              <div className="tour-admin-radio-wrap">
                <label className="tour-admin-radio">
                  <input type="radio" name="mode" checked={mode === "reset"} onChange={() => setMode("reset")} />
                  <span>Reset (archiwizuj poprzednie)</span>
                </label>
                <label className="tour-admin-radio">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "overwrite"}
                    onChange={() => setMode("overwrite")}
                  />
                  <span>Nadpisz (usun poprzednie)</span>
                </label>
              </div>
            </div>

            <div className="tour-admin-actions">
              <button className="tour-action-btn" onClick={generate} disabled={!localPass}>
                Generuj druzyny
              </button>
              <button className="tour-action-btn" onClick={loadTeams}>
                {loadingTeams ? "Ladowanie..." : "Pokaz druzyny"}
              </button>
              <button className="tour-action-btn" onClick={loadTournamentPlayers} disabled={!localPass}>
                {loadingPlayers ? "Ladowanie..." : "Zawodnicy turnieju"}
              </button>
              <Link className="tour-action-btn" href={`/tournaments/${tournamentId}/admin-matches`}>
                Admin mecze
              </Link>
            </div>

            {msg && (
              <p className={`tour-admin-msg ${msg.toLowerCase().includes("blad") ? "tour-admin-msg-error" : ""}`}>
                {msg}
              </p>
            )}
          </div>
        </section>

        <section className="tour-admin-panel mt-4">
          <div className="tour-admin-grid-2">
            <article className="tour-card" style={{ padding: "0.75rem" }}>
              <div className="tour-card-head">
                <p className="tour-card-title">Zawodnicy w turnieju</p>
              </div>

              {tournamentPlayers.length === 0 ? (
                <p className="tour-muted mt-2">Brak zawodnikow. Uzyj przycisku Zawodnicy turnieju.</p>
              ) : (
                <div className="tour-admin-player-list mt-2">
                  {tournamentPlayers.map((p) => (
                    <div key={p.id} className="tour-admin-player-row">
                      <div className="tour-admin-player-main">
                        <span>{p.name}</span>
                      </div>
                      <button
                        className="tour-action-btn"
                        type="button"
                        disabled={!localPass}
                        onClick={() => void removePlayer(p.id, p.name)}
                      >
                        Usun
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="tour-card" style={{ padding: "0.75rem" }}>
              <div className="tour-card-head">
                <p className="tour-card-title">Dodaj zawodnika do turnieju</p>
              </div>

              <div className="tour-admin-search-row mt-2">
                <input
                  className="tour-admin-input"
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  placeholder="Szukaj zawodnika"
                />
                <button className="tour-action-btn" onClick={() => void searchPlayers(playerSearch)}>
                  Szukaj
                </button>
                <button className="tour-action-btn" onClick={loadTournamentPlayers} disabled={!localPass}>
                  Odswiez
                </button>
              </div>

              {availablePlayers.length === 0 ? (
                <p className="tour-muted mt-2">Brak wynikow.</p>
              ) : (
                <div className="tour-admin-player-list mt-2">
                  {availablePlayers.map((p) => (
                    <div key={p.id} className="tour-admin-player-row">
                      <div className="tour-admin-player-main">
                        <span>{p.name}</span>
                      </div>
                      <button
                        className="tour-action-btn"
                        type="button"
                        disabled={!localPass}
                        onClick={() => void addPlayer(p.id)}
                      >
                        Dodaj
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </section>

        <section className="tour-list mt-4">
          {teams.length === 0 ? (
            <article className="tour-card">
              <p className="tour-muted">Brak druzyn do edycji. Uzyj przycisku Pokaz druzyny.</p>
            </article>
          ) : (
            teams.map((team) => (
              <article key={team.id} className="tour-card team-tone-card" style={teamToneVars(team.id)}>
                <TeamRenameRow team={team} onSave={renameTeam} />
              </article>
            ))
          )}
        </section>

      </div>
    </main>
  );
}

function TeamRenameRow({
  team,
  onSave,
}: {
  team: TeamEntry;
  onSave: (teamId: string, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(team.name);

  return (
    <div>
      <div className="tour-card-head">
        <div>
          <p className="tour-card-title">{team.name}</p>
          {team.players.length > 0 && (
            <p className="tour-card-sub">Sklad: {team.players.map((p) => p.name).join(", ")}</p>
          )}
        </div>
      </div>

      <div className="tour-rename-row mt-3">
        <input className="tour-admin-input" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="tour-action-btn" onClick={() => onSave(team.id, name)}>
          Zapisz nazwe
        </button>
      </div>
    </div>
  );
}
