"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/authClient";

type RankFrameToggleProps = {
  playerId: string;
  initialEnabled: boolean;
};

export default function RankFrameToggle({ playerId, initialEnabled }: RankFrameToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState<boolean | null>(null);

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

  async function handleChange(nextEnabled: boolean) {
    setError(null);
    setSaving(true);

    const res = await authedFetch(`/api/public/players/${playerId}/profile`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ rankFrameEnabled: nextEnabled }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (json.error === "missing_rank_frame_enabled_column") {
        setError("Brak kolumny rank_frame_enabled w bazie.");
      } else if (json.error === "forbidden_player_owner_only") {
        setError("Mozesz zmienic ustawienia tylko na swoim profilu.");
      } else if (json.error === "invalid_or_expired_token") {
        setError("Sesja wygasla. Zaloguj sie ponownie.");
      } else {
        setError(`Blad zapisu: ${json.error ?? res.statusText}`);
      }
      setSaving(false);
      return;
    }

    setEnabled(nextEnabled);
    setSaving(false);
  }

  return (
    <div className="profile-frame-toggle mt-3">
      <label className="profile-frame-toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving || !canEdit}
          onChange={(e) => void handleChange(e.target.checked)}
        />
        <span>Pokazuj obramowke rangi</span>
      </label>
      <p className="profile-muted">
        {canEdit === false
          ? "To ustawienie moze zmienic tylko wlasciciel profilu."
          : saving
            ? "Zapisywanie..."
            : enabled
              ? "Obramowka wlaczona."
              : "Obramowka wylaczona."}
      </p>
      {error ? <p className="profile-muted text-red-600">{error}</p> : null}
    </div>
  );
}
