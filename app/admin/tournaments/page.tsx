"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/authClient";

type Player = {
  id: string;
  name: string;
  active: boolean;
  mmr?: number | null;
  mmr_manual_override?: boolean | null;
  has_account?: boolean;
};

type Tournament = {
  id: string;
  name: string;
  created_at: string;
  format: "single_elim" | "double_elim";
  mode: "normal" | "ranked";
  bo_default: 1 | 3 | 5;
  bo_finals: 1 | 3 | 5;
};

type AppBackgroundVariant = "finn_bmo" | "finn_beer";

function parseBo(value: string): 1 | 3 | 5 | null {
  if (value === "1") return 1;
  if (value === "3") return 3;
  if (value === "5") return 5;
  return null;
}

function mapApiError(error: unknown): string {
  const text = String(error ?? "");
  if (text.includes("forbidden_main_admin_only")) return "Ta akcja wymaga roli Main Admin.";
  if (text.includes("invalid_or_expired_token")) return "Sesja wygasla. Zaloguj sie ponownie.";
  if (text.includes("missing_bearer_token")) return "Brak sesji. Zaloguj sie.";
  if (text.includes("missing_auth_schema")) return "Brak migracji auth w bazie (auth_user_id / is_main_admin).";
  if (text.includes("missing_tournament_admins_schema")) return "Brak tabeli tournament_admins.";
  return text || "Nieznany blad";
}

export default function AdminTournamentsPage() {
  const [isMainAdmin, setIsMainAdmin] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"single_elim" | "double_elim">("double_elim");
  const [mode, setMode] = useState<"normal" | "ranked">("normal");
  const [boDefault, setBoDefault] = useState<1 | 3 | 5>(1);
  const [boFinals, setBoFinals] = useState<1 | 3 | 5>(3);
  const [gfResetEnabled, setGfResetEnabled] = useState(true);
  const [eventAt, setEventAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [joinDeadlineAt, setJoinDeadlineAt] = useState("");

  const [q, setQ] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [localAdminId, setLocalAdminId] = useState("");

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [backgroundChoice, setBackgroundChoice] = useState<AppBackgroundVariant>("finn_bmo");
  const [savingBackground, setSavingBackground] = useState(false);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );
  const localAdminOptions = useMemo(
    () =>
      selectedIds
        .map((id) => players.find((player) => player.id === id))
        .filter((player): player is Player => Boolean(player && player.has_account === true))
        .sort((a, b) => a.name.localeCompare(b.name, "pl")),
    [selectedIds, players]
  );
  const localAdminIds = useMemo(
    () =>
      localAdminId && localAdminOptions.some((player) => player.id === localAdminId)
        ? [localAdminId]
        : [],
    [localAdminId, localAdminOptions]
  );

  async function loadPlayers(query: string) {
    const res = await fetch(`/api/public/players/search?q=${encodeURIComponent(query)}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setPlayers(json.players ?? []);
    }
  }

  async function loadTournaments() {
    const res = await fetch("/api/public/tournaments", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setTournaments(json.tournaments ?? []);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const [authRes, playersRes, tournamentsRes, backgroundRes] = await Promise.all([
        authedFetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/public/players/search?q=", { cache: "no-store" }),
        fetch("/api/public/tournaments", { cache: "no-store" }),
        fetch("/api/public/background", { cache: "no-store" }),
      ]);

      const authJson = await authRes.json().catch(() => ({}));
      const playersJson = await playersRes.json().catch(() => ({}));
      const tournamentsJson = await tournamentsRes.json().catch(() => ({}));
      const backgroundJson = await backgroundRes.json().catch(() => ({}));

      if (cancelled) return;
      setIsMainAdmin(authJson.authenticated === true && authJson.isMainAdmin === true);

      if (playersRes.ok) setPlayers(playersJson.players ?? []);
      if (tournamentsRes.ok) setTournaments(tournamentsJson.tournaments ?? []);
      if (
        backgroundRes.ok &&
        (backgroundJson.background === "finn_bmo" || backgroundJson.background === "finn_beer")
      ) {
        setBackgroundChoice(backgroundJson.background);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (localAdminId && !localAdminOptions.some((player) => player.id === localAdminId)) {
      setLocalAdminId("");
    }
  }, [localAdminId, localAdminOptions]);

  async function createTournament() {
    setMsg(null);

    const res = await authedFetch("/api/admin/tournaments/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        format,
        mode,
        boDefault,
        boFinals,
        gfResetEnabled,
        eventAt,
        eventLocation,
        joinDeadlineAt,
        playerIds: selectedIds,
        localAdminPlayerIds: localAdminIds,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setMsg("Turniej zostal utworzony.");
    setName("");
    setMode("normal");
    setEventAt("");
    setEventLocation("");
    setJoinDeadlineAt("");
    setSelected({});
    setLocalAdminId("");
    await loadTournaments();
  }

  async function deletePlayer(playerId: string, playerName: string) {
    if (!window.confirm(`Usunac zawodnika "${playerName}"?`)) return;

    setMsg(null);
    const res = await authedFetch(`/api/admin/players/${playerId}`, {
      method: "DELETE",
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad usuwania zawodnika: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setSelected((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
    if (localAdminId === playerId) {
      setLocalAdminId("");
    }

    setMsg(json.softDeleted ? "Zawodnik zdezaktywowany." : "Zawodnik usuniety.");
    await Promise.all([loadPlayers(q), loadTournaments()]);
  }

  async function renamePlayer(playerId: string, currentName: string) {
    const nextName = window.prompt("Nowa nazwa zawodnika:", currentName)?.trim() ?? "";
    if (!nextName || nextName === currentName) return;

    setMsg(null);
    const res = await authedFetch(`/api/admin/players/${playerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad zmiany nazwy: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setMsg("Nazwa zawodnika zmieniona.");
    await Promise.all([loadPlayers(q), loadTournaments()]);
  }

  async function setPlayerMmr(playerId: string, playerName: string, currentMmr: number | null | undefined) {
    const raw = window.prompt(
      `Nowy MMR dla "${playerName}" (zakres 0-10, np. 7.3):`,
      Number.isFinite(Number(currentMmr)) ? Number(currentMmr).toFixed(1) : "0.0"
    );
    if (raw === null) return;

    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) {
      setMsg("Blad MMR: podaj liczbe, np. 6.5");
      return;
    }

    setMsg(null);
    const res = await authedFetch(`/api/admin/players/${playerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mmr: value }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad ustawiania MMR: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setMsg("MMR zawodnika zaktualizowany (manual override aktywny).");
    await loadPlayers(q);
  }

  async function resetPlayerMmr(playerId: string, playerName: string) {
    if (!window.confirm(`Zresetowac MMR i Prestige dla "${playerName}" do stanu poczatkowego?`)) return;

    setMsg(null);
    const res = await authedFetch(`/api/admin/players/${playerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resetMmr: true }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad resetu MMR: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setMsg("MMR i Prestige zawodnika zresetowane.");
    await loadPlayers(q);
  }

  async function deleteTournament(tournamentId: string, tournamentName: string) {
    if (!window.confirm(`Usunac turniej "${tournamentName}"?`)) return;

    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}`, {
      method: "DELETE",
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad usuwania turnieju: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setMsg("Turniej usuniety.");
    await loadTournaments();
  }

  async function saveBackgroundChoice() {
    setMsg(null);
    setSavingBackground(true);
    try {
      const res = await authedFetch("/api/admin/background", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ background: backgroundChoice }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`Blad tla: ${mapApiError(json.error ?? res.statusText)}`);
        return;
      }

      setMsg("Tlo aplikacji zapisane.");
    } finally {
      setSavingBackground(false);
    }
  }

  if (isMainAdmin === null) {
    return (
      <main className="tour-root">
        <div className="tour-shell">
          <p className="tour-muted mt-6">Ladowanie panelu admina...</p>
        </div>
      </main>
    );
  }

  if (!isMainAdmin) {
    return (
      <main className="tour-root">
        <div className="tour-shell">
          <div className="tour-topbar">
            <Link className="underline opacity-80" href="/">
              Back
            </Link>
          </div>
          <section className="tour-admin-panel mt-4">
            <p className="tour-card-title">Brak dostepu</p>
            <p className="tour-muted mt-2">
              Zaloguj sie na koncie z rola Main Admin.
            </p>
            <Link href="/auth?next=/admin/tournaments" className="tour-action-btn mt-3 inline-flex">
              Przejdz do logowania
            </Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href="/">
            Back
          </Link>
          <span className="tour-kicker">Main admin</span>
        </div>

        <section className="tour-detail-main mt-4">
          <h1 className="tour-title">Turnieje - panel glowny</h1>
        </section>

        <section className="tour-admin-panel mt-4">
          <div className="tour-card-head">
            <p className="tour-card-title">Tlo aplikacji</p>
          </div>
          <div className="tour-admin-grid mt-3">
            <div>
              <label className="tour-admin-label">Wariant tla</label>
              <select
                className="tour-admin-input"
                value={backgroundChoice}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === "finn_bmo" || next === "finn_beer") setBackgroundChoice(next);
                }}
              >
                <option value="finn_bmo">BMO</option>
                <option value="finn_beer">Finn z piwem</option>
              </select>
            </div>
            <div className="tour-admin-actions">
              <button className="tour-action-btn" type="button" disabled={savingBackground} onClick={saveBackgroundChoice}>
                {savingBackground ? "Zapisywanie..." : "Zapisz tlo"}
              </button>
            </div>
          </div>
        </section>

        <div className="tour-admin-split mt-4">
          <section className="tour-admin-panel">
            <div className="tour-card-head">
              <p className="tour-card-title">Utworz turniej</p>
            </div>

            <div className="tour-admin-grid mt-3">
              <div>
                <label className="tour-admin-label">Nazwa turnieju</label>
                <input
                  className="tour-admin-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Flany Cup #1"
                />
              </div>

              <div className="tour-admin-grid-2">
                <div>
                  <label className="tour-admin-label">Format</label>
                  <select
                    className="tour-admin-input"
                    value={format}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "single_elim" || value === "double_elim") {
                        setFormat(value);
                      }
                    }}
                  >
                    <option value="double_elim">Double elimination</option>
                    <option value="single_elim">Single elimination</option>
                  </select>
                </div>

                <div>
                  <label className="tour-admin-label">Tryb</label>
                  <select
                    className="tour-admin-input"
                    value={mode}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "normal" || value === "ranked") {
                        setMode(value);
                      }
                    }}
                  >
                    <option value="normal">Normal</option>
                    <option value="ranked">Ranked</option>
                  </select>
                </div>

                <div>
                  <label className="tour-admin-label">BO domyslne</label>
                  <select
                    className="tour-admin-input"
                    value={boDefault}
                    onChange={(e) => {
                      const parsed = parseBo(e.target.value);
                      if (parsed) setBoDefault(parsed);
                    }}
                  >
                    <option value={1}>BO1</option>
                    <option value={3}>BO3</option>
                    <option value={5}>BO5</option>
                  </select>
                </div>

                <div>
                  <label className="tour-admin-label">BO finalu</label>
                  <select
                    className="tour-admin-input"
                    value={boFinals}
                    onChange={(e) => {
                      const parsed = parseBo(e.target.value);
                      if (parsed) setBoFinals(parsed);
                    }}
                  >
                    <option value={1}>BO1</option>
                    <option value={3}>BO3</option>
                    <option value={5}>BO5</option>
                  </select>
                </div>

                {format === "double_elim" ? (
                  <div>
                    <label className="tour-admin-label">Grand final reset</label>
                    <select
                      className="tour-admin-input"
                      value={gfResetEnabled ? "with_reset" : "no_reset"}
                      onChange={(e) => setGfResetEnabled(e.target.value === "with_reset")}
                    >
                      <option value="with_reset">Z resetem (2 mecze gdy WB przegra GF1)</option>
                      <option value="no_reset">Bez resetu (jeden final)</option>
                    </select>
                  </div>
                ) : null}

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
                    placeholder="np. Sarbsk, domek nr 12"
                    maxLength={140}
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

                <div>
                  <label className="tour-admin-label">Admin lokalny</label>
                  <select
                    className="tour-admin-input"
                    value={localAdminId}
                    onChange={(e) => setLocalAdminId(e.target.value)}
                  >
                    <option value="">Wybierz zawodnika</option>
                    {localAdminOptions.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                  <p className="tour-muted mt-1">
                    {localAdminOptions.length === 0
                      ? "Najpierw zaznacz zawodnikow z kontem."
                      : localAdminId
                        ? `Wybrany: ${localAdminOptions.find((player) => player.id === localAdminId)?.name ?? "brak"}`
                        : "Wybierz lokalnego admina z listy."}
                  </p>
                </div>
              </div>

              <div className="tour-card" style={{ padding: "0.75rem" }}>
                <div className="tour-admin-search-row">
                  <div>
                    <label className="tour-admin-label">Wyszukaj zawodnikow</label>
                    <input
                      className="tour-admin-input"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="np. mac"
                    />
                  </div>
                  <button className="tour-action-btn" onClick={() => loadPlayers(q)}>
                    Szukaj
                  </button>
                  <button
                    className="tour-action-btn"
                    type="button"
                    onClick={() => {
                      setSelected((prev) => {
                        const next = { ...prev };
                        for (const p of players) next[p.id] = true;
                        return next;
                      });
                    }}
                  >
                    Zaznacz wszystkich
                  </button>
                </div>

                <p className="tour-muted mt-2">Wybrani: {selectedIds.length}</p>
                <p className="tour-muted">Lokalni admini: {localAdminIds.length}</p>

                <div className="tour-admin-player-list mt-2">
                  {players.map((p) => {
                    const selectedNow = selected[p.id] === true;
                    return (
                      <div key={p.id} className="tour-admin-player-row">
                        <div className="tour-admin-player-main">
                          <input
                            type="checkbox"
                            checked={selectedNow}
                            onChange={(e) => setSelected((s) => ({ ...s, [p.id]: e.target.checked }))}
                          />
                          <span className="tour-admin-player-name">{p.name}</span>
                        </div>
                        <div className="tour-admin-player-meta">
                          <span className="tour-muted">{p.active ? "aktywny" : "nieaktywny"}</span>
                          <span className="tour-muted">
                            MMR {Number.isFinite(Number(p.mmr ?? 0)) ? Number(p.mmr ?? 0).toFixed(1) : "0.0"}
                          </span>
                          <details className="tour-player-menu">
                            <summary className="tour-player-menu-trigger" aria-label={`Opcje zawodnika ${p.name}`} title="Akcje">
                              ...
                            </summary>
                            <div className="tour-player-menu-panel">
                              <button
                                className="tour-player-menu-item"
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  void renamePlayer(p.id, p.name);
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                }}
                              >
                                Zmien nazwe
                              </button>
                              <button
                                className="tour-player-menu-item"
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  void setPlayerMmr(p.id, p.name, p.mmr);
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                }}
                              >
                                Ustaw MMR
                              </button>
                              <button
                                className="tour-player-menu-item"
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  void resetPlayerMmr(p.id, p.name);
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                }}
                              >
                                Reset MMR
                              </button>
                              <button
                                className="tour-player-menu-item tour-player-menu-item-danger"
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  void deletePlayer(p.id, p.name);
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                }}
                              >
                                Usun
                              </button>
                            </div>
                          </details>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="tour-admin-actions">
                <button
                  className="tour-action-btn"
                  disabled={!name || selectedIds.length < 2 || localAdminIds.length < 1}
                  onClick={createTournament}
                >
                  Utworz turniej
                </button>
              </div>

              {msg ? (
                <p className={`tour-admin-msg ${msg.toLowerCase().includes("blad") ? "tour-admin-msg-error" : ""}`}>
                  {msg}
                </p>
              ) : null}
            </div>
          </section>

          <section className="tour-admin-panel">
            <div className="tour-card-head">
              <p className="tour-card-title">Lista turniejow</p>
              <button className="tour-action-btn" onClick={loadTournaments}>
                Odswiez
              </button>
            </div>

            {tournaments.length === 0 ? (
              <p className="tour-muted mt-3">Brak turniejow.</p>
            ) : (
              <div className="tour-list mt-3">
                {tournaments.map((t) => (
                  <article key={t.id} className="tour-card">
                    <div className="tour-card-head">
                      <div>
                        <p className="tour-card-title">{t.name}</p>
                        <p className="tour-card-sub">
                          {t.mode === "ranked" ? "ranked" : "normal"} - {t.format} - BO{t.bo_default} - final BO{t.bo_finals}
                        </p>
                      </div>
                      <div className="tour-admin-actions">
                        <Link className="tour-action-btn" href={`/tournaments/${t.id}`}>
                          Podglad
                        </Link>
                        <button className="tour-action-btn" type="button" onClick={() => void deleteTournament(t.id, t.name)}>
                          Usun
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
