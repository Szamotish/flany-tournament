"use client";

import { useState } from "react";

type RankFrameToggleProps = {
  playerId: string;
  initialEnabled: boolean;
};

export default function RankFrameToggle({ playerId, initialEnabled }: RankFrameToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(nextEnabled: boolean) {
    setError(null);
    setSaving(true);

    const res = await fetch(`/api/public/players/${playerId}/profile`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ rankFrameEnabled: nextEnabled }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        json.error === "missing_rank_frame_enabled_column"
          ? "Brak kolumny rank_frame_enabled w bazie."
          : `Blad zapisu: ${json.error ?? res.statusText}`
      );
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
          disabled={saving}
          onChange={(e) => void handleChange(e.target.checked)}
        />
        <span>Pokazuj obramowke rangi</span>
      </label>
      <p className="profile-muted">{saving ? "Zapisywanie..." : enabled ? "Obramowka wlaczona." : "Obramowka wylaczona."}</p>
      {error ? <p className="profile-muted text-red-600">{error}</p> : null}
    </div>
  );
}
