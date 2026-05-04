"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BEER_LIST } from "@/lib/beers";
import { authedFetch } from "@/lib/authClient";
import { PLAYER_PROFILE_COLORS } from "@/lib/ui/playerProfile";

type ProfileSettingsButtonProps = {
  playerId: string;
  initialRankFrameEnabled: boolean;
  initialProfileColor: string | null;
  initialFavoriteBeer: string | null;
};

export default function ProfileSettingsButton({
  playerId,
  initialRankFrameEnabled,
  initialProfileColor,
  initialFavoriteBeer,
}: ProfileSettingsButtonProps) {
  const router = useRouter();
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [rankFrameEnabled, setRankFrameEnabled] = useState(initialRankFrameEnabled);
  const [profileColor, setProfileColor] = useState(initialProfileColor ?? "");
  const [favoriteBeer, setFavoriteBeer] = useState(initialFavoriteBeer ?? "");
  const [saving, setSaving] = useState(false);
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
    setSaving(true);
    setMessage(null);
    const res = await authedFetch(`/api/public/players/${playerId}/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rankFrameEnabled,
        profileColor: profileColor || null,
        favoriteBeer: favoriteBeer || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setMessage(`Blad zapisu: ${json.error ?? res.statusText}`);
      return;
    }

    setMessage("Ustawienia zapisane.");
    router.refresh();
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

      {open ? (
        <div className="auth-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div className="auth-modal profile-settings-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-head">
              <p className="auth-modal-title">Ustawienia profilu</p>
              <button className="auth-modal-close" type="button" onClick={() => setOpen(false)}>
                Zamknij
              </button>
            </div>
            <div className="auth-modal-body profile-settings-body">
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

              <div className="profile-settings-actions">
                <button className="tour-action-btn" type="button" disabled={saving} onClick={saveSettings}>
                  {saving ? "Zapisywanie..." : "Zapisz ustawienia"}
                </button>
              </div>
              {message ? <p className="profile-muted">{message}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
