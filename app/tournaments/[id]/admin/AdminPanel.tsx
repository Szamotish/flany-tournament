"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { teamToneVars } from "@/lib/ui/teamTone";
import { authedFetch } from "@/lib/authClient";

type TeamEntry = {
  id: string;
  name: string;
  captainPlayerId?: string | null;
  players: { id: string; name: string; isCaptain?: boolean }[];
};

type PlayerOption = {
  id: string;
  name: string;
  active: boolean;
  has_account?: boolean;
};

type JoinRequestRow = {
  id: string;
  status: string;
  created_at: string;
  player_id: string;
  players?: { id: string; name: string; avatar_url?: string | null } | null;
};

type InviteRow = {
  id: string;
  status: string;
  created_at: string;
  player_id: string;
  players?: { id: string; name: string; avatar_url?: string | null } | null;
};

type TournamentFormat = "single_elim" | "double_elim" | "one_vs_one";

export default function AdminPanel({ tournamentId }: { tournamentId: string }) {
  const [accessChecked, setAccessChecked] = useState(false);
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const [teamSize, setTeamSize] = useState(5);
  const [allowUneven, setAllowUneven] = useState(true);
  const [iterations, setIterations] = useState(500);
  const [mode, setMode] = useState<"reset" | "overwrite">("reset");
  const [generationMode, setGenerationMode] = useState<"balanced" | "full_random">("balanced");
  const [msg, setMsg] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [tournamentPlayers, setTournamentPlayers] = useState<PlayerOption[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<PlayerOption[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [requests, setRequests] = useState<JoinRequestRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [eventAt, setEventAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [joinDeadlineAt, setJoinDeadlineAt] = useState("");
  const [metaBusy, setMetaBusy] = useState(false);
  const [swapPlayerAId, setSwapPlayerAId] = useState("");
  const [swapPlayerBId, setSwapPlayerBId] = useState("");
  const [tournamentFormat, setTournamentFormat] = useState<TournamentFormat>("single_elim");

  const isOneVsOne = tournamentFormat === "one_vs_one";

  const loadMeta = useCallback(async () => {
    const res = await fetch(`/api/public/tournaments/${tournamentId}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return;

    const eventAtIso = typeof json.tournament?.event_at === "string" ? json.tournament.event_at : "";
    const joinDeadlineIso =
      typeof json.tournament?.join_deadline_at === "string" ? json.tournament.join_deadline_at : "";
    const formatValue = json.tournament?.format;
    setTournamentFormat(
      formatValue === "double_elim" || formatValue === "one_vs_one" ? formatValue : "single_elim"
    );

    setEventAt(eventAtIso ? eventAtIso.slice(0, 16) : "");
    setJoinDeadlineAt(joinDeadlineIso ? joinDeadlineIso.slice(0, 16) : "");
    setEventLocation(typeof json.tournament?.event_location === "string" ? json.tournament.event_location : "");
  }, [tournamentId]);

  useEffect(() => {
    if (!isOneVsOne) return;
    setTeamSize(1);
    setAllowUneven(false);
  }, [isOneVsOne]);

  const loadJoinRequests = useCallback(async () => {
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/requests`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad pobierania prosb: ${json.error ?? res.statusText}`);
      return;
    }
    setRequests((json.requests ?? []) as JoinRequestRow[]);
  }, [tournamentId]);

  const loadInvites = useCallback(async () => {
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/invites`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad pobierania zaproszen: ${json.error ?? res.statusText}`);
      return;
    }
    setInvites((json.invites ?? []) as InviteRow[]);
  }, [tournamentId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await authedFetch(`/api/public/tournaments/${tournamentId}/membership`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (cancelled) return;

      const canAccess = res.ok && json.isTournamentAdmin === true;
      setHasAdminAccess(canAccess);
      setAccessChecked(true);

      if (!canAccess) {
        setMsg("Brak uprawnien lokalnego admina.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  useEffect(() => {
    if (!hasAdminAccess) return;
    void loadMeta();
    void loadJoinRequests();
    void loadInvites();
  }, [hasAdminAccess, loadInvites, loadJoinRequests, loadMeta]);

  async function generate() {
    setMsg(null);
    const effectiveTeamSize = isOneVsOne ? 1 : teamSize;
    const effectiveAllowUneven = isOneVsOne ? false : allowUneven;

    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/teams/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        teamSize: effectiveTeamSize,
        allowUneven: effectiveAllowUneven,
        iterations,
        mode,
        generationMode,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMsg(`Blad: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg(
      generationMode === "full_random"
        ? "Druzyny zostaly wygenerowane losowo."
        : "Druzyny zostaly wygenerowane (balans)."
    );
    await loadTeams();
  }

  async function loadTeams(silent = false) {
    if (!silent) {
      setLoadingTeams(true);
      setMsg(null);
    }
    try {
      const res = await fetch(`/api/public/tournaments/${tournamentId}/teams`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`Blad pobierania druzyn: ${json.error ?? res.statusText}`);
        return;
      }
      setTeams(json.teams ?? []);
    } finally {
      if (!silent) setLoadingTeams(false);
    }
  }

  async function renameTeam(teamId: string, name: string) {
    setMsg(null);

    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/teams/rename`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
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

  async function loadTournamentPlayers(silent = false): Promise<PlayerOption[]> {
    if (!silent) {
      setLoadingPlayers(true);
      setMsg(null);
    }
    try {
      const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/players`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`Blad pobierania zawodnikow: ${json.error ?? res.statusText}`);
        return [];
      }
      const list = (json.players ?? []) as PlayerOption[];
      setTournamentPlayers(list);
      return list;
    } finally {
      if (!silent) setLoadingPlayers(false);
    }
  }

  async function searchPlayers(query: string, currentTournamentPlayers = tournamentPlayers) {
    const res = await fetch(`/api/public/players/search?q=${encodeURIComponent(query)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad wyszukiwania zawodnikow: ${json.error ?? res.statusText}`);
      return;
    }

    const inTournament = new Set(currentTournamentPlayers.map((p) => p.id));
    const list: PlayerOption[] = (json.players ?? [])
      .filter((p: PlayerOption) => p.active && !inTournament.has(p.id))
      .sort((a: PlayerOption, b: PlayerOption) => a.name.localeCompare(b.name, "pl"));
    setAvailablePlayers(list);
  }

  async function refreshPlayerLists(silent = false) {
    const current = await loadTournamentPlayers(silent);
    await searchPlayers(playerSearch, current);
  }

  useEffect(() => {
    if (!hasAdminAccess) return;

    let cancelled = false;
    async function tick(silent = true) {
      if (cancelled) return;
      await Promise.all([
        loadTeams(silent),
        refreshPlayerLists(silent),
        loadJoinRequests(),
        loadInvites(),
      ]);
    }

    void tick(false);
    const interval = window.setInterval(() => void tick(true), 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // playerSearch intentionally excluded; it has a separate debounced effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAdminAccess, tournamentId]);

  useEffect(() => {
    if (!hasAdminAccess) return;
    const timeout = window.setTimeout(() => {
      void searchPlayers(playerSearch);
    }, 250);
    return () => window.clearTimeout(timeout);
    // searchPlayers reads the latest tournamentPlayers value from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAdminAccess, playerSearch, tournamentPlayers]);

  async function addPlayer(playerId: string) {
    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/players`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ playerId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad dodawania zawodnika: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Dodano zawodnika do turnieju. Wygeneruj druzyny ponownie.");
    await refreshPlayerLists();
    setTeams([]);
  }

  async function removePlayer(playerId: string, playerName: string) {
    if (!window.confirm(`Usunac ${playerName} z tego turnieju?`)) return;

    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/players`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ playerId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad usuwania zawodnika: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Usunieto zawodnika z turnieju. Wygeneruj druzyny ponownie.");
    await refreshPlayerLists();
    setTeams([]);
  }

  async function saveMeta() {
    setMetaBusy(true);
    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/meta`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        eventAt,
        eventLocation,
        joinDeadlineAt,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setMetaBusy(false);
    if (!res.ok) {
      setMsg(`Blad zapisu metadanych: ${json.error ?? res.statusText}`);
      return;
    }
    setMsg("Zapisano termin/miejsce/deadline turnieju.");
    await loadMeta();
  }

  async function resolveRequest(requestId: string, action: "accept" | "reject") {
    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/requests`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad obslugi prosby: ${json.error ?? res.statusText}`);
      return;
    }
    setMsg(action === "accept" ? "Prosba zaakceptowana." : "Prosba odrzucona.");
    await Promise.all([loadJoinRequests(), refreshPlayerLists()]);
  }

  async function invitePlayer(playerId: string) {
    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad wysylania zaproszenia: ${json.error ?? res.statusText}`);
      return;
    }
    setMsg("Wyslano zaproszenie.");
    await loadInvites();
  }

  async function swapPlayers() {
    if (!swapPlayerAId || !swapPlayerBId || swapPlayerAId === swapPlayerBId) {
      setMsg("Wybierz dwoch roznych zawodnikow do zamiany.");
      return;
    }

    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/teams/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerAId: swapPlayerAId, playerBId: swapPlayerBId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad swapu: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Zamiana zawodnikow wykonana.");
    await loadTeams();
    setSwapPlayerAId("");
    setSwapPlayerBId("");
  }

  const activeTeamPlayers = teams.flatMap((team) =>
    team.players.map((player) => ({
      id: player.id,
      name: player.isCaptain ? `${player.name} (K)` : player.name,
      teamName: team.name,
    }))
  );

  if (!accessChecked) {
    return (
      <main className="tour-root">
        <div className="tour-shell">
          <div className="tour-topbar">
            <Link className="underline opacity-80" href={`/tournaments/${tournamentId}`}>
              Back
            </Link>
            <span className="tour-kicker">Lokalny admin</span>
          </div>
          <section className="tour-admin-panel mt-4">
            <p className="tour-muted">Sprawdzanie uprawnien...</p>
          </section>
        </div>
      </main>
    );
  }

  if (!hasAdminAccess) {
    return (
      <main className="tour-root">
        <div className="tour-shell">
          <div className="tour-topbar">
            <Link className="underline opacity-80" href={`/tournaments/${tournamentId}`}>
              Back
            </Link>
            <span className="tour-kicker">Lokalny admin</span>
          </div>
          <section className="tour-admin-panel mt-4">
            <p className="tour-card-title">Brak dostepu</p>
            <p className="tour-muted mt-2">Tylko lokalny admin tego turnieju moze wejsc do tego panelu.</p>
          </section>
        </div>
      </main>
    );
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
            <div className="tour-admin-grid-2">
              <div>
                <label className="tour-admin-label">Rozmiar druzyny</label>
                <input
                  className="tour-admin-input"
                  type="number"
                  min={isOneVsOne ? 1 : 2}
                  max={20}
                  value={isOneVsOne ? 1 : teamSize}
                  onChange={(e) => setTeamSize(Number(e.target.value))}
                  disabled={isOneVsOne}
                />
                {isOneVsOne ? <p className="tour-muted mt-1">Dla formatu 1v1 rozmiar druzyny jest wymuszony na 1.</p> : null}
              </div>

              <div>
                <label className="tour-admin-label tour-admin-label-inline">
                  Liczba prob balansu
                  <span className="tour-info-tooltip" tabIndex={0} aria-label="Informacja o liczbie prob balansu">
                    i
                    <span className="tour-info-tooltip-box">
                      Szybki jest najszybszy, ale podzial moze byc gorszy. Zbalansowany to mieszanka czasu i jakosci
                      balansu. Dokladny daje najlepszy balans kosztem dluzszego liczenia.
                    </span>
                  </span>
                </label>
                <select
                  className="tour-admin-input"
                  value={iterations}
                  disabled={generationMode === "full_random"}
                  onChange={(e) => setIterations(Number(e.target.value))}
                >
                  <option value={200}>Szybki (200)</option>
                  <option value={1000}>Zbalansowany (1000)</option>
                  <option value={2000}>Dokladny (2000)</option>
                </select>
              </div>
            </div>

            <label className="tour-admin-check">
              <input
                type="checkbox"
                checked={isOneVsOne ? false : allowUneven}
                onChange={(e) => setAllowUneven(e.target.checked)}
                disabled={isOneVsOne}
              />
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

            <div>
              <p className="tour-admin-label">Podzial druzyn</p>
              <div className="tour-admin-radio-wrap">
                <label className="tour-admin-radio">
                  <input
                    type="radio"
                    name="generationMode"
                    checked={generationMode === "balanced"}
                    onChange={() => setGenerationMode("balanced")}
                  />
                  <span>Balans (rating + mmr)</span>
                </label>
                <label className="tour-admin-radio">
                  <input
                    type="radio"
                    name="generationMode"
                    checked={generationMode === "full_random"}
                    onChange={() => setGenerationMode("full_random")}
                  />
                  <span>Full random</span>
                </label>
              </div>
            </div>

            <div className="tour-admin-grid-2">
              <div>
                <label className="tour-admin-label">Data i godzina turnieju</label>
                <input
                  className="tour-admin-input"
                  type="datetime-local"
                  value={eventAt}
                  onChange={(e) => setEventAt(e.target.value)}
                />
              </div>
              <div>
                <label className="tour-admin-label">Miejsce</label>
                <input
                  className="tour-admin-input"
                  value={eventLocation}
                  onChange={(e) => setEventLocation(e.target.value)}
                  placeholder="np. Sarbsk"
                />
              </div>
              <div>
                <label className="tour-admin-label">Deadline prosb o dolaczenie</label>
                <input
                  className="tour-admin-input"
                  type="datetime-local"
                  value={joinDeadlineAt}
                  onChange={(e) => setJoinDeadlineAt(e.target.value)}
                />
              </div>
              <div className="tour-admin-actions">
                <button className="tour-action-btn" onClick={saveMeta} disabled={metaBusy}>
                  {metaBusy ? "Zapisywanie..." : "Zapisz meta turnieju"}
                </button>
              </div>
            </div>

            <div className="tour-admin-actions">
              <button className="tour-action-btn" onClick={generate}>
                Generuj druzyny
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
                <p className="tour-muted mt-2">
                  {loadingPlayers ? "Ladowanie zawodnikow..." : "Brak zawodnikow w turnieju."}
                </p>
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
                      <div className="tour-admin-actions">
                        <button
                          className="tour-action-btn"
                          type="button"
                          onClick={() => void addPlayer(p.id)}
                        >
                          Dodaj
                        </button>
                        <button
                          className="tour-action-btn"
                          type="button"
                          disabled={!p.has_account}
                          onClick={() => void invitePlayer(p.id)}
                          title={!p.has_account ? "Gracz nie ma jeszcze konta" : "Wyslij zaproszenie"}
                        >
                          Zapros
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </section>

        <section className="tour-admin-panel mt-4">
          <div className="tour-admin-grid-2">
            <article className="tour-card" style={{ padding: "0.75rem" }}>
              <div className="tour-card-head">
                <p className="tour-card-title">Prosby o dolaczenie</p>
              </div>
              {requests.length === 0 ? (
                <p className="tour-muted mt-2">Brak prosb.</p>
              ) : (
                <div className="tour-admin-player-list mt-2">
                  {requests.map((r) => (
                    <div key={r.id} className="tour-admin-player-row">
                      <div className="tour-admin-player-main">
                        <span>{r.players?.name ?? r.player_id}</span>
                        <span className="tour-muted">{r.status}</span>
                      </div>
                      {r.status === "pending" ? (
                        <div className="tour-admin-actions">
                          <button className="tour-action-btn" type="button" onClick={() => void resolveRequest(r.id, "accept")}>
                            Akceptuj
                          </button>
                          <button className="tour-action-btn" type="button" onClick={() => void resolveRequest(r.id, "reject")}>
                            Odrzuc
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="tour-card" style={{ padding: "0.75rem" }}>
              <div className="tour-card-head">
                <p className="tour-card-title">Wyslane zaproszenia</p>
              </div>
              {invites.length === 0 ? (
                <p className="tour-muted mt-2">Brak zaproszen.</p>
              ) : (
                <div className="tour-admin-player-list mt-2">
                  {invites.map((invite) => (
                    <div key={invite.id} className="tour-admin-player-row">
                      <div className="tour-admin-player-main">
                        <span>{invite.players?.name ?? invite.player_id}</span>
                        <span className="tour-muted">{invite.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </section>

        <section className="tour-admin-panel mt-4">
          <div className="tour-admin-grid">
            <div className="tour-card" style={{ padding: "0.75rem" }}>
              <div className="tour-card-head">
                <p className="tour-card-title">Swap zawodnikow miedzy druzynami</p>
              </div>
              <p className="tour-muted mt-1">Dziala tylko przed startem turnieju.</p>
              <div className="tour-admin-grid-2 mt-2">
                <div>
                  <label className="tour-admin-label">Zawodnik A</label>
                  <select
                    className="tour-admin-input"
                    value={swapPlayerAId}
                    onChange={(e) => setSwapPlayerAId(e.target.value)}
                  >
                    <option value="">Wybierz</option>
                    {activeTeamPlayers.map((row) => (
                      <option key={`a-${row.id}`} value={row.id}>
                        {row.name} ({row.teamName})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="tour-admin-label">Zawodnik B</label>
                  <select
                    className="tour-admin-input"
                    value={swapPlayerBId}
                    onChange={(e) => setSwapPlayerBId(e.target.value)}
                  >
                    <option value="">Wybierz</option>
                    {activeTeamPlayers.map((row) => (
                      <option key={`b-${row.id}`} value={row.id}>
                        {row.name} ({row.teamName})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="tour-admin-actions mt-2">
                <button className="tour-action-btn" type="button" onClick={() => void swapPlayers()}>
                  Zrob swap
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="tour-list mt-4">
          {teams.length === 0 ? (
            <article className="tour-card">
              <p className="tour-muted">
                {loadingTeams ? "Ladowanie druzyn..." : "Brak druzyn do edycji. Wygeneruj druzyny."}
              </p>
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
          {team.captainPlayerId ? (
            <p className="tour-card-sub">
              Kapitan: {team.players.find((p) => p.id === team.captainPlayerId)?.name ?? "brak"}
            </p>
          ) : null}
          {team.players.length > 0 && (
            <p className="tour-card-sub">
              Sklad: {team.players.map((p) => (p.isCaptain ? `${p.name} (K)` : p.name)).join(", ")}
            </p>
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
