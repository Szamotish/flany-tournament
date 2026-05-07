"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/authClient";
import { ONE_V_ONE_PLAYER_LIMIT } from "@/lib/tournamentFormat";

type Player = {
  id: string;
  name: string;
  active: boolean;
  mmr?: number | null;
  prestige_points?: number | null;
  rating_override?: number | null;
  mmr_manual_override?: boolean | null;
  has_account?: boolean;
};

type Tournament = {
  id: string;
  name: string;
  created_at: string;
  format: "single_elim" | "double_elim" | "one_vs_one";
  mode: "normal" | "ranked";
  bo_default: 1 | 3 | 5;
  bo_finals: 1 | 3 | 5;
  gf_reset_enabled?: boolean | null;
  event_at?: string | null;
  event_location?: string | null;
  join_deadline_at?: string | null;
  is_private?: boolean | null;
};

type AppBackgroundVariant = "finn_bmo" | "finn_beer";

function parseBo(value: string): 1 | 3 | 5 | null {
  if (value === "1") return 1;
  if (value === "3") return 3;
  if (value === "5") return 5;
  return null;
}

function formatLabel(value: Tournament["format"]): string {
  if (value === "double_elim") return "Double elimination";
  if (value === "one_vs_one") return "1v1";
  return "Single elimination";
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
  const [format, setFormat] = useState<"single_elim" | "double_elim" | "one_vs_one">("double_elim");
  const [mode, setMode] = useState<"normal" | "ranked">("normal");
  const [boDefault, setBoDefault] = useState<1 | 3 | 5>(1);
  const [boFinals, setBoFinals] = useState<1 | 3 | 5>(3);
  const [gfResetEnabled, setGfResetEnabled] = useState(true);
  const [eventAt, setEventAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [joinDeadlineAt, setJoinDeadlineAt] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [editingTournamentId, setEditingTournamentId] = useState<string | null>(null);
  const [editingStarted, setEditingStarted] = useState(false);

  const [q, setQ] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [localAdminSelectedIds, setLocalAdminSelectedIds] = useState<string[]>([]);
  const [playerActionMenu, setPlayerActionMenu] = useState<{
    player: Player;
    x: number;
    y: number;
    openUp: boolean;
  } | null>(null);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [backgroundChoice, setBackgroundChoice] = useState<AppBackgroundVariant>("finn_bmo");
  const [savingBackground, setSavingBackground] = useState(false);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected]
  );
  const maxSelectedPlayers = format === "one_vs_one" ? ONE_V_ONE_PLAYER_LIMIT : Number.POSITIVE_INFINITY;
  const selectedCountValid =
    format === "one_vs_one"
      ? selectedIds.length === ONE_V_ONE_PLAYER_LIMIT
      : selectedIds.length >= 2;
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
      localAdminSelectedIds.filter(
        (id, index) =>
          localAdminOptions.some((player) => player.id === id) && localAdminSelectedIds.indexOf(id) === index
      ),
    [localAdminSelectedIds, localAdminOptions]
  );

  async function loadPlayers(query: string) {
    const res = await authedFetch(`/api/public/players/search?q=${encodeURIComponent(query)}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setPlayers(json.players ?? []);
    }
  }

  async function loadTournaments() {
    const res = await authedFetch("/api/public/tournaments", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setTournaments(json.tournaments ?? []);
  }

  function resetTournamentForm() {
    setEditingTournamentId(null);
    setEditingStarted(false);
    setName("");
    setFormat("double_elim");
    setMode("normal");
    setBoDefault(1);
    setBoFinals(3);
    setGfResetEnabled(true);
    setEventAt("");
    setEventLocation("");
    setJoinDeadlineAt("");
    setIsPrivate(false);
    setSelected({});
    setLocalAdminSelectedIds([]);
  }

  async function loadTournamentForEdit(tournamentId: string) {
    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad pobierania turnieju: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    const tournament = json.tournament as Tournament;
    setEditingTournamentId(tournamentId);
    setEditingStarted(json.started === true);
    setName(tournament.name ?? "");
    if (tournament.format === "double_elim" || tournament.format === "one_vs_one") {
      setFormat(tournament.format);
    } else {
      setFormat("single_elim");
    }
    setMode(tournament.mode === "ranked" ? "ranked" : "normal");
    setBoDefault(parseBo(String(tournament.bo_default)) ?? 1);
    setBoFinals(parseBo(String(tournament.bo_finals)) ?? 3);
    setGfResetEnabled(tournament.gf_reset_enabled !== false);
    setEventAt(typeof tournament.event_at === "string" ? tournament.event_at.slice(0, 16) : "");
    setEventLocation(typeof tournament.event_location === "string" ? tournament.event_location : "");
    setJoinDeadlineAt(typeof tournament.join_deadline_at === "string" ? tournament.join_deadline_at.slice(0, 16) : "");
    setIsPrivate(tournament.is_private === true);

    const nextSelected: Record<string, boolean> = {};
    for (const playerId of (json.playerIds ?? []) as string[]) {
      nextSelected[playerId] = true;
    }
    setSelected(nextSelected);
    const adminIds = ((json.localAdminPlayerIds ?? []) as string[]).filter(Boolean);
    setLocalAdminSelectedIds(adminIds);
    setMsg(
      json.started === true
        ? "Wczytano turniej. Turniej ma juz mecze, wiec nie zmieniaj formatu/BO/trybu."
        : "Wczytano turniej do edycji."
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const [authRes, playersRes, tournamentsRes, backgroundRes] = await Promise.all([
        authedFetch("/api/auth/me", { cache: "no-store" }),
        authedFetch("/api/public/players/search?q=", { cache: "no-store" }),
        authedFetch("/api/public/tournaments", { cache: "no-store" }),
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
    setLocalAdminSelectedIds((prev) => prev.filter((id) => localAdminOptions.some((player) => player.id === id)));
  }, [localAdminOptions]);

  useEffect(() => {
    if (format !== "one_vs_one" || selectedIds.length <= ONE_V_ONE_PLAYER_LIMIT) return;
    const keep = new Set(selectedIds.slice(0, ONE_V_ONE_PLAYER_LIMIT));
    setSelected((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of Object.keys(prev)) {
        next[id] = keep.has(id);
      }
      return next;
    });
    setMsg("Format 1v1: pozostawiono pierwszych 2 zaznaczonych zawodnikow.");
  }, [format, selectedIds]);

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
        isPrivate,
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
    setIsPrivate(false);
    setSelected({});
    setLocalAdminSelectedIds([]);
    await loadTournaments();
  }

  async function saveTournamentChanges() {
    if (!editingTournamentId) return;
    setMsg(null);

    const res = await authedFetch(`/api/admin/tournaments/${editingTournamentId}`, {
      method: "PATCH",
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
        isPrivate,
        playerIds: selectedIds,
        localAdminPlayerIds: localAdminIds,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad zapisu turnieju: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setMsg("Turniej zaktualizowany.");
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
    setLocalAdminSelectedIds((prev) => prev.filter((id) => id !== playerId));

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

  async function setPlayerRating(playerId: string, playerName: string, currentRating: number | null | undefined) {
    const current = Number(currentRating);
    const raw = window.prompt(
      `Manualny rating dla "${playerName}" (1-10). Zostaw puste, aby wyczyscic override:`,
      Number.isFinite(current) ? current.toFixed(1) : ""
    );
    if (raw === null) return;

    const trimmed = raw.trim();
    const ratingOverride = trimmed === "" ? null : Number(trimmed.replace(",", "."));
    if (ratingOverride !== null && !Number.isFinite(ratingOverride)) {
      setMsg("Blad ratingu: podaj liczbe, np. 8.5 albo zostaw puste.");
      return;
    }

    setMsg(null);
    const res = await authedFetch(`/api/admin/players/${playerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ratingOverride }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad ustawiania ratingu: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setMsg(ratingOverride === null ? "Manualny rating wyczyszczony." : "Manualny rating zawodnika zaktualizowany.");
    await loadPlayers(q);
  }

  async function setPlayerPrestige(playerId: string, playerName: string, currentPrestige: number | null | undefined) {
    const raw = window.prompt(
      `Punkty PP dla "${playerName}" (0-9999):`,
      Number.isFinite(Number(currentPrestige)) ? String(Math.floor(Number(currentPrestige))) : "0"
    );
    if (raw === null) return;

    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) {
      setMsg("Blad PP: podaj liczbe, np. 120");
      return;
    }

    setMsg(null);
    const res = await authedFetch(`/api/admin/players/${playerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prestigePoints: value }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad ustawiania PP: ${mapApiError(json.error ?? res.statusText)}`);
      return;
    }

    setMsg("Punkty PP zawodnika zaktualizowane.");
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

  function openPlayerActions(e: MouseEvent<HTMLButtonElement>, player: Player) {
    const rect = e.currentTarget.getBoundingClientRect();
    const panelHeight = 245;
    const openUp = rect.bottom + panelHeight > window.innerHeight;
    setPlayerActionMenu({
      player,
      x: Math.min(window.innerWidth - 12, rect.right),
      y: openUp ? rect.top - 6 : rect.bottom + 6,
      openUp,
    });
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
            <Link className="tour-action-btn" href="/admin/rules">
              Zasady
            </Link>
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
              <p className="tour-card-title">{editingTournamentId ? "Edytuj turniej" : "Utworz turniej"}</p>
              {editingTournamentId ? (
                <button className="tour-action-btn" type="button" onClick={resetTournamentForm}>
                  Nowy turniej
                </button>
              ) : null}
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
                      if (value === "single_elim" || value === "double_elim" || value === "one_vs_one") {
                        setFormat(value);
                      }
                    }}
                  >
                    <option value="double_elim">Double elimination</option>
                    <option value="single_elim">Single elimination</option>
                    <option value="one_vs_one">1v1</option>
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
                    disabled={format === "one_vs_one"}
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
                {format === "one_vs_one" ? <p className="tour-muted">W 1v1 pole BO finalu nie jest uzywane.</p> : null}

                <div>
                  <label className="tour-admin-label">Grand final reset</label>
                  <select
                    className="tour-admin-input"
                    value={gfResetEnabled ? "with_reset" : "no_reset"}
                    disabled={format === "one_vs_one"}
                    onChange={(e) => setGfResetEnabled(e.target.value === "with_reset")}
                  >
                    <option value="with_reset">Z resetem (2 mecze gdy WB przegra GF1)</option>
                    <option value="no_reset">Bez resetu (jeden final)</option>
                  </select>
                </div>
                {format === "one_vs_one" ? <p className="tour-muted">W 1v1 pole grand final reset nie jest uzywane.</p> : null}

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

                <label className="tour-admin-check">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                  />
                  <span>Turniej prywatny</span>
                </label>

                <div>
                  <label className="tour-admin-label">Admini lokalni</label>
                  <select
                    className="tour-admin-input"
                    value={localAdminIds}
                    multiple
                    size={Math.min(6, Math.max(3, localAdminOptions.length || 3))}
                    onChange={(e) => {
                      const values = Array.from(e.target.selectedOptions).map((option) => option.value);
                      setLocalAdminSelectedIds(values);
                    }}
                  >
                    {localAdminOptions.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                  <p className="tour-muted mt-1">
                    {localAdminOptions.length === 0
                      ? "Najpierw zaznacz zawodnikow z kontem."
                      : localAdminIds.length > 0
                        ? `Wybrani (${localAdminIds.length}): ${localAdminIds
                            .map((id) => localAdminOptions.find((player) => player.id === id)?.name ?? id)
                            .join(", ")}`
                        : "Mozesz zaznaczyc wiecej niz jednego admina (Ctrl/Cmd + klik)."}
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
                        if (format === "one_vs_one") {
                          const firstTwo = players.slice(0, ONE_V_ONE_PLAYER_LIMIT);
                          for (const p of firstTwo) next[p.id] = true;
                        } else {
                          for (const p of players) next[p.id] = true;
                        }
                        return next;
                      });
                    }}
                  >
                    Zaznacz wszystkich
                  </button>
                </div>

                <p className="tour-muted mt-2">Wybrani: {selectedIds.length}</p>
                {format === "one_vs_one" ? <p className="tour-muted">Limit dla 1v1: dokladnie 2 zawodnikow.</p> : null}
                <p className="tour-muted">Lokalni admini: {localAdminIds.length}</p>

                <div className="tour-admin-player-list mt-2" onScroll={() => setPlayerActionMenu(null)}>
                  {players.map((p) => {
                    const selectedNow = selected[p.id] === true;
                    return (
                      <div key={p.id} className="tour-admin-player-row">
                        <div className="tour-admin-player-main">
                          <input
                            type="checkbox"
                            checked={selectedNow}
                            onChange={(e) =>
                              setSelected((s) => {
                                if (!e.target.checked) return { ...s, [p.id]: false };
                                const alreadySelected = Object.values(s).filter(Boolean).length;
                                if (format === "one_vs_one" && !s[p.id] && alreadySelected >= maxSelectedPlayers) {
                                  return s;
                                }
                                return { ...s, [p.id]: true };
                              })
                            }
                          />
                          <span className="tour-admin-player-name">{p.name}</span>
                        </div>
                        <div className="tour-admin-player-meta">
                          <span className="tour-muted">{p.active ? "aktywny" : "nieaktywny"}</span>
                          <span className="tour-muted">
                            MMR {Number.isFinite(Number(p.mmr ?? 0)) ? Number(p.mmr ?? 0).toFixed(1) : "0.0"}
                          </span>
                          <button
                            className="tour-player-menu-trigger"
                            type="button"
                            aria-label={`Opcje zawodnika ${p.name}`}
                            title="Akcje"
                            onClick={(e) => openPlayerActions(e, p)}
                          >
                            ...
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="tour-admin-actions">
                <button
                  className="tour-action-btn"
                  disabled={!name || !selectedCountValid || localAdminIds.length < 1}
                  onClick={editingTournamentId ? saveTournamentChanges : createTournament}
                >
                  {editingTournamentId ? "Zapisz zmiany" : "Utworz turniej"}
                </button>
              </div>

              {editingStarted ? (
                <p className="tour-muted">
                  Ten turniej ma juz mecze. Zmiana uczestnikow/formatu/BO/trybu jest ograniczona, zeby nie uszkodzic drabinki.
                </p>
              ) : null}

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
                  <article
                    key={t.id}
                    className={`tour-card tour-card-clickable ${editingTournamentId === t.id ? "tour-card-selected" : ""}`}
                    onClick={() => void loadTournamentForEdit(t.id)}
                    title="Kliknij, aby edytowac turniej w formularzu po lewej"
                  >
                    <div className="tour-card-head">
                      <div>
                        <p className="tour-card-title">{t.name}</p>
                        <p className="tour-card-sub">
                          {t.mode === "ranked" ? "ranked" : "normal"} - {formatLabel(t.format)} - BO{t.bo_default} - final BO{t.bo_finals}
                        </p>
                        {t.is_private ? <p className="tour-card-sub">Prywatny</p> : null}
                      </div>
                      <div className="tour-admin-actions">
                        <Link className="tour-action-btn" href={`/tournaments/${t.id}`} onClick={(e) => e.stopPropagation()}>
                          Podglad
                        </Link>
                        <Link className="tour-action-btn" href={`/tournaments/${t.id}/rules`} onClick={(e) => e.stopPropagation()}>
                          Zasady
                        </Link>
                        <button
                          className="tour-action-btn tour-action-danger"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteTournament(t.id, t.name);
                          }}
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
      {playerActionMenu ? (
        <div
          className="tour-player-menu-backdrop"
          role="presentation"
          onClick={() => setPlayerActionMenu(null)}
        >
          <div
            className="tour-player-menu-panel tour-player-menu-panel-floating"
            style={{
              left: playerActionMenu.x,
              top: playerActionMenu.y,
              transform: playerActionMenu.openUp ? "translate(-100%, -100%)" : "translateX(-100%)",
            }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="tour-player-menu-item"
              type="button"
              onClick={() => {
                const p = playerActionMenu.player;
                setPlayerActionMenu(null);
                void renamePlayer(p.id, p.name);
              }}
            >
              Zmien nazwe
            </button>
            <button
              className="tour-player-menu-item"
              type="button"
              onClick={() => {
                const p = playerActionMenu.player;
                setPlayerActionMenu(null);
                void setPlayerMmr(p.id, p.name, p.mmr);
              }}
            >
              Ustaw MMR
            </button>
            <button
              className="tour-player-menu-item"
              type="button"
              onClick={() => {
                const p = playerActionMenu.player;
                setPlayerActionMenu(null);
                void setPlayerRating(p.id, p.name, p.rating_override);
              }}
            >
              Ustaw rating
            </button>
            <button
              className="tour-player-menu-item"
              type="button"
              onClick={() => {
                const p = playerActionMenu.player;
                setPlayerActionMenu(null);
                void setPlayerPrestige(p.id, p.name, p.prestige_points);
              }}
            >
              Ustaw PP
            </button>
            <button
              className="tour-player-menu-item"
              type="button"
              onClick={() => {
                const p = playerActionMenu.player;
                setPlayerActionMenu(null);
                void resetPlayerMmr(p.id, p.name);
              }}
            >
              Reset MMR / PP
            </button>
            <button
              className="tour-player-menu-item tour-player-menu-item-danger"
              type="button"
              onClick={() => {
                const p = playerActionMenu.player;
                setPlayerActionMenu(null);
                void deletePlayer(p.id, p.name);
              }}
            >
              Usun
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
