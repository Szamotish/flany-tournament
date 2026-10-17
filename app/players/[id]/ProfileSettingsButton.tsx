"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { BEER_LIST } from "@/lib/beers";
import { authedFetch } from "@/lib/authClient";
import { PLAYER_PROFILE_COLORS } from "@/lib/ui/playerProfile";
import { availablePanels, resolvePanelRank, validChartRange, type ProfilePreferences } from "@/lib/profilePreferences";
import { rankLabel, type DisplayRank } from "@/lib/playerRank";
import ProfileRankPanel from "@/app/components/ProfileRankPanel";
import { STAT_VIEWS, STAT_VIEW_LABELS, type StatView } from "@/lib/matchStats";
import UploadAvatar from "./UploadAvatar";

type ProfileSettingsButtonProps = {
  playerId: string;
  initialRankFrameEnabled: boolean;
  initialProfileColor: string | null;
  initialFavoriteBeer: string | null;
  currentRank: DisplayRank;
  initialPreferences: ProfilePreferences;
};

export default function ProfileSettingsButton({
  playerId,
  initialRankFrameEnabled,
  initialProfileColor,
  initialFavoriteBeer,
  currentRank,
  initialPreferences,
}: ProfileSettingsButtonProps) {
  const router = useRouter();
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [rankFrameEnabled, setRankFrameEnabled] = useState(initialRankFrameEnabled);
  const [profileColor, setProfileColor] = useState(initialProfileColor ?? "");
  const [favoriteBeer, setFavoriteBeer] = useState(initialFavoriteBeer ?? "");
  const [chartFrom, setChartFrom] = useState(initialPreferences.chart_from ?? "");
  const [chartTo, setChartTo] = useState(initialPreferences.chart_to ?? "");
  const [rankPanel, setRankPanel] = useState(initialPreferences.rank_panel === null ? "" : resolvePanelRank(initialPreferences.rank_panel, currentRank));
  const [saving, setSaving] = useState(false);
  const [statsView, setStatsView] = useState<StatView>(initialPreferences.stats_view ?? "last");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function checkAccess() {
      const res = await authedFetch("/api/auth/me", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!mounted) return;
      const owner = typeof json.player?.id === "string" && json.player.id === playerId;
      setCanEdit(Boolean(json.isMainAdmin) || owner);
    }
    void checkAccess();
    return () => {
      mounted = false;
    };
  }, [playerId]);

  async function saveSettings() {
    if (!validChartRange(chartFrom || null, chartTo || null)) {
      setMessage("Podaj poprawny zakres dat. Data końcowa nie może być wcześniejsza niż początkowa.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await authedFetch(`/api/public/players/${playerId}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rankFrameEnabled,
          profileColor: profileColor || null,
          favoriteBeer: favoriteBeer || null,
          chartFrom: chartFrom || null,
          chartTo: chartTo || null,
          rankPanel: rankPanel || null,
          statsView,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errors: Record<string, string> = {
          missing_stats_preferences: "Domyślny widok statystyk wymaga nowej migracji bazy: 20261017_stats_view.sql.",
          missing_profile_chart_preferences: "Nowe ustawienia wymagają aktualizacji bazy danych przez administratora.",
          rank_panel_not_unlocked: "Ten panel nie jest dostępny przy Twojej aktualnej randze. Odśwież profil i wybierz ponownie.",
          invalid_chart_range: "Data końcowa nie może być wcześniejsza niż początkowa.",
        };
        setMessage(errors[json.error] ?? `Błąd zapisu: ${json.error ?? res.statusText}`);
        return;
      }

      setMessage("Ustawienia zapisane.");
      router.refresh();
    } catch { setMessage("Nie udało się zapisać ustawień. Spróbuj ponownie."); }
    finally { setSaving(false); }
  }

  if (!canEdit) return null;

  return (
    <>
      <button
        type="button"
        className="profile-settings-trigger"
        aria-label="Ustawienia profilu"
        title="Ustawienia profilu"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a9 9 0 0 0-.1 1.5c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
        </svg>
      </button>

      {open ? createPortal(
        <div className="auth-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="auth-modal profile-settings-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-head">
              <p className="auth-modal-title">Ustawienia profilu</p>
              <button className="auth-modal-close" type="button" onClick={() => setOpen(false)}>
                Zamknij
              </button>
            </div>
            <div className="auth-modal-body profile-settings-body">
              <UploadAvatar playerId={playerId} />
              <label className="profile-frame-toggle-row">
                <input
                  type="checkbox"
                  checked={rankFrameEnabled}
                  disabled={saving}
                  onChange={(e) => setRankFrameEnabled(e.target.checked)}
                />
                <span>Pokazuj obramowke rangi</span>
              </label>

              <div>
                <label className="tour-admin-label">Kolor profilu i paneli</label>
                <div className="profile-color-row">
                  <select
                    className="tour-admin-input"
                    value={profileColor}
                    disabled={saving}
                    onChange={(e) => setProfileColor(e.target.value)}
                  >
                    {PLAYER_PROFILE_COLORS.map((color) => (
                      <option key={color.name} value={color.value}>
                        {color.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="profile-color-input"
                    type="color"
                    value={profileColor || "#bdefff"}
                    disabled={saving}
                    onChange={(e) => setProfileColor(e.target.value)}
                    aria-label="Wlasny kolor profilu"
                  />
                </div>
              </div>

              <div>
                <label className="tour-admin-label">Ulubione piwo</label>
                <select
                  className="tour-admin-input"
                  value={favoriteBeer}
                  disabled={saving}
                  onChange={(e) => setFavoriteBeer(e.target.value)}
                >
                  <option value="">Brak wybranego</option>
                  {BEER_LIST.map((beer) => (
                    <option key={beer.name} value={beer.name}>
                      {beer.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="tour-admin-label">Pierwszy widok statystyk gry
                <select className="tour-admin-input" value={statsView} disabled={saving} onChange={e => setStatsView(e.target.value as StatView)}>
                  {STAT_VIEWS.map(view => <option key={view} value={view}>{STAT_VIEW_LABELS[view]}</option>)}
                </select>
              </label>
              <fieldset className="profile-chart-settings" disabled={saving}>
                <legend>Okres historii MMR</legend>
                <div className="profile-chart-date-inputs">
                  <label>Od<input className="tour-admin-input" type="date" value={chartFrom} max={chartTo || undefined} onChange={e => setChartFrom(e.target.value)} /></label>
                  <label>Do<input className="tour-admin-input" type="date" value={chartTo} min={chartFrom || undefined} onChange={e => setChartTo(e.target.value)} /></label>
                </div>
                <p className="profile-muted">Puste „Od” oznacza od początku, a puste „Do” obejmuje też przyszłe gry.</p>
                <button className="tour-action-btn" type="button" onClick={() => { setChartFrom(""); setChartTo(""); }}>Cała historia</button>
              </fieldset>
              <div>
                <label className="tour-admin-label" htmlFor="profile-rank-panel">Wygląd panelu rankingowego</label>
                <select id="profile-rank-panel" className="tour-admin-input" value={rankPanel} disabled={saving} onChange={e => setRankPanel(e.target.value)}>
                  <option value="">Automatycznie według rangi</option>
                  {availablePanels(currentRank).map(rank => <option key={rank} value={rank}>{rankLabel(rank)}</option>)}
                </select>
                <div className="profile-panel-preview" aria-label={`Podgląd panelu: ${rankLabel(resolvePanelRank(rankPanel, currentRank))}`}>
                  <ProfileRankPanel rank={resolvePanelRank(rankPanel, currentRank)}><div className="profile-rating-layout"><p>{rankLabel(resolvePanelRank(rankPanel, currentRank))}</p></div></ProfileRankPanel>
                </div>
              </div>

              <div className="profile-settings-actions">
                <button className="tour-action-btn" type="button" disabled={saving} onClick={saveSettings}>
                  {saving ? "Zapisywanie..." : "Zapisz ustawienia"}
                </button>
              </div>
              {message ? <p className="profile-muted">{message}</p> : null}
            </div>
          </div>
        </div>, document.body,
      ) : null}
    </>
  );
}
