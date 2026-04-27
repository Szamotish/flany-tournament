"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/lib/authClient";

type RatePlayerProps = {
  playerId: string;
  className?: string;
};

export default function RatePlayer({ playerId, className }: RatePlayerProps) {
  const [value, setValue] = useState(7);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [isOwnProfile, setIsOwnProfile] = useState(false);

  const router = useRouter();

  useEffect(() => {
    async function init() {
      const meRes = await authedFetch("/api/auth/me", { cache: "no-store" });
      const meJson = await meRes.json().catch(() => ({}));

      if (!meJson.authenticated) {
        setAuthenticated(false);
        setLoading(false);
        return;
      }

      setAuthenticated(true);

      if (typeof meJson.player?.id === "string" && meJson.player.id === playerId) {
        setIsOwnProfile(true);
        setLoading(false);
        return;
      }

      const res = await authedFetch(`/api/public/my-rating?ratedId=${playerId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));

      if (res.ok && typeof json.value === "number") {
        setValue(json.value);
      }

      setLoading(false);
    }

    void init();
  }, [playerId]);

  async function save() {
    if (!authenticated || isOwnProfile) return;

    setMsg(null);

    const res = await authedFetch("/api/public/ratings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ratedId: playerId, value }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 429) {
        setMsg(json.message ?? "Cooldown aktywny");
      } else {
        if (json.error === "missing_player_profile") {
          setMsg("Twoje konto nie jest jeszcze podlaczone do zawodnika.");
        } else if (json.error === "cannot_rate_self") {
          setMsg("Nie mozesz ocenic samego siebie.");
        } else if (json.error === "missing_ratings_player_schema") {
          setMsg("Brakuje migracji rankingu w bazie (rater_player_id).");
        } else if (json.error === "invalid_or_expired_token") {
          setMsg("Sesja wygasla. Zaloguj sie ponownie.");
        } else {
          setMsg(`Blad: ${json.error ?? res.statusText}`);
        }
      }
      return;
    }

    setMsg("Ocena zapisana.");
    router.refresh();
  }

  return (
    <div className={className ?? ""}>
      <p className="profile-section-title">Ocena gracza</p>

      {loading ? (
        <p className="profile-muted mt-2">Ladowanie Twojej oceny...</p>
      ) : !authenticated ? (
        <p className="profile-muted mt-2">Zaloguj sie, aby oceniac zawodnikow.</p>
      ) : isOwnProfile ? (
        <p className="profile-muted mt-2">Nie mozesz wystawic oceny sobie.</p>
      ) : (
        <>
          <p className="profile-muted mt-2">Twoja ocena: {value}/10</p>

          <input
            className="profile-range mt-3 w-full"
            type="range"
            min={1}
            max={10}
            step={1}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
          />
          <div className="profile-range-scale">
            <span>1</span>
            <span>10</span>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="profile-rating-chip">{value}</span>
            <button className="profile-btn profile-btn-primary" onClick={save}>
              Zapisz ocene
            </button>
          </div>

          {msg && <p className="profile-muted mt-3">{msg}</p>}
        </>
      )}
    </div>
  );
}
