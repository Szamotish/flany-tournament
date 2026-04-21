"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Player = { id: string; name: string; active: boolean };
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

export default function AdminTournamentsPage() {
  const [adminPass, setAdminPass] = useState("");
  const [name, setName] = useState("");
  const [newPlayerName, setNewPlayerName] = useState("");
  const [format, setFormat] = useState<"single_elim" | "double_elim">("double_elim");
  const [mode, setMode] = useState<"normal" | "ranked">("normal");
  const [boDefault, setBoDefault] = useState<1 | 3 | 5>(1);
  const [boFinals, setBoFinals] = useState<1 | 3 | 5>(3);
  const [gfResetEnabled, setGfResetEnabled] = useState(true);
  const [localAdminPassword, setLocalAdminPassword] = useState("");

  const [q, setQ] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [backgroundChoice, setBackgroundChoice] = useState<AppBackgroundVariant>("finn_bmo");
  const [savingBackground, setSavingBackground] = useState(false);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );

  async function loadPlayers(query: string) {
    const res = await fetch(`/api/public/players/search?q=${encodeURIComponent(query)}`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) setPlayers(json.players ?? []);
  }

  async function loadTournaments() {
    const res = await fetch(`/api/public/tournaments`);
    const json = await res.json().catch(() => ({}));
    if (res.ok) setTournaments(json.tournaments ?? []);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const [playersRes, tournamentsRes, backgroundRes] = await Promise.all([
        fetch("/api/public/players/search?q="),
        fetch("/api/public/tournaments"),
        fetch("/api/public/background", { cache: "no-store" }),
      ]);
      const playersJson = await playersRes.json().catch(() => ({}));
      const tournamentsJson = await tournamentsRes.json().catch(() => ({}));
      const backgroundJson = await backgroundRes.json().catch(() => ({}));

      if (cancelled) return;
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

  async function createTournament() {
    setMsg(null);

    const res = await fetch("/api/admin/tournaments/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-password": adminPass,
      },
      body: JSON.stringify({
        name,
        format,
        mode,
        boDefault,
        boFinals,
        gfResetEnabled,
        localAdminPassword,
        playerIds: selectedIds,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMsg(`Blad: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Turniej zostal utworzony.");
    setName("");
    setMode("normal");
    setLocalAdminPassword("");
    setSelected({});
    await loadTournaments();
  }

  async function addPlayer() {
    setMsg(null);

    const res = await fetch("/api/admin/players", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-password": adminPass,
      },
      body: JSON.stringify({ name: newPlayerName }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad dodawania zawodnika: ${json.error ?? res.statusText}`);
      return;
    }

    setNewPlayerName("");
    setMsg("Dodano zawodnika.");
    await loadPlayers(q);
  }

  async function deletePlayer(playerId: string, playerName: string) {
    if (!window.confirm(`Usunac zawodnika "${playerName}"?`)) return;

    setMsg(null);
    const res = await fetch(`/api/admin/players/${playerId}`, {
      method: "DELETE",
      headers: { "x-admin-password": adminPass },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad usuwania zawodnika: ${json.error ?? res.statusText}`);
      return;
    }

    setSelected((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });

    setMsg(json.softDeleted ? "Zawodnik zdezaktywowany." : "Zawodnik usuniety.");
    await Promise.all([loadPlayers(q), loadTournaments()]);
  }

  async function renamePlayer(playerId: string, currentName: string) {
    const nextName = window.prompt("Nowa nazwa zawodnika:", currentName)?.trim() ?? "";
    if (!nextName || nextName === currentName) return;

    setMsg(null);
    const res = await fetch(`/api/admin/players/${playerId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-admin-password": adminPass,
      },
      body: JSON.stringify({ name: nextName }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad zmiany nazwy: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Nazwa zawodnika zmieniona.");
    await Promise.all([loadPlayers(q), loadTournaments()]);
  }

  async function deleteTournament(tournamentId: string, tournamentName: string) {
    if (!window.confirm(`Usunac turniej "${tournamentName}"?`)) return;

    setMsg(null);
    const res = await fetch(`/api/admin/tournaments/${tournamentId}`, {
      method: "DELETE",
      headers: { "x-admin-password": adminPass },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad usuwania turnieju: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Turniej usuniety.");
    await loadTournaments();
  }

  async function saveBackgroundChoice() {
    setMsg(null);
    setSavingBackground(true);
    try {
      const res = await fetch("/api/admin/background", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-password": adminPass,
        },
        body: JSON.stringify({ background: backgroundChoice }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`Blad tla: ${json.error ?? res.statusText}`);
        return;
      }

      setMsg("Tlo aplikacji zapisane.");
    } finally {
      setSavingBackground(false);
    }
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
              <button
                className="tour-action-btn"
                type="button"
                disabled={!adminPass || savingBackground}
                onClick={saveBackgroundChoice}
              >
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
                <label className="tour-admin-label">Haslo main admina</label>
                <input
                  className="tour-admin-input"
                  type="password"
                  value={adminPass}
                  onChange={(e) => setAdminPass(e.target.value)}
                />
              </div>

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

                <div>
                  <label className="tour-admin-label">Haslo lokalnego admina</label>
                  <input
                    className="tour-admin-input"
                    value={localAdminPassword}
                    onChange={(e) => setLocalAdminPassword(e.target.value)}
                    placeholder="np. admin-kuba"
                  />
                </div>

                {format === "double_elim" && (
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
                )}
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

                <div className="tour-rename-row mt-2">
                  <input
                    className="tour-admin-input"
                    value={newPlayerName}
                    onChange={(e) => setNewPlayerName(e.target.value)}
                    placeholder="Nowy zawodnik"
                  />
                  <button className="tour-action-btn" disabled={!adminPass || !newPlayerName.trim()} onClick={addPlayer}>
                    Dodaj zawodnika
                  </button>
                </div>

                <p className="tour-muted mt-2">Wybrani: {selectedIds.length}</p>

                <div className="tour-admin-player-list mt-2">
                  {players.map((p) => (
                    <label key={p.id} className="tour-admin-player-row">
                      <div className="tour-admin-player-main">
                        <input
                          type="checkbox"
                          checked={!!selected[p.id]}
                          onChange={(e) =>
                            setSelected((s) => ({
                              ...s,
                              [p.id]: e.target.checked,
                            }))
                          }
                        />
                        <span>{p.name}</span>
                      </div>
                      <div className="tour-admin-actions">
                        <span className="tour-muted">{p.active ? "aktywny" : "nieaktywny"}</span>
                        <button
                          className="tour-action-btn"
                          type="button"
                          disabled={!adminPass}
                          onClick={(e) => {
                            e.preventDefault();
                            void renamePlayer(p.id, p.name);
                          }}
                        >
                          Zmien nazwe
                        </button>
                        <button
                          className="tour-action-btn"
                          type="button"
                          disabled={!adminPass}
                          onClick={(e) => {
                            e.preventDefault();
                            void deletePlayer(p.id, p.name);
                          }}
                        >
                          Usun
                        </button>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="tour-admin-actions">
                <button
                  className="tour-action-btn"
                  disabled={!adminPass || !name || !localAdminPassword || selectedIds.length < 2}
                  onClick={createTournament}
                >
                  Utworz turniej
                </button>
              </div>

              {msg && (
                <p className={`tour-admin-msg ${msg.toLowerCase().includes("blad") ? "tour-admin-msg-error" : ""}`}>
                  {msg}
                </p>
              )}
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
                        <button
                          className="tour-action-btn"
                          type="button"
                          disabled={!adminPass}
                          onClick={() => void deleteTournament(t.id, t.name)}
                        >
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
