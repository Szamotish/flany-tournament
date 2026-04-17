"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type RatePlayerProps = {
  playerId: string;
  className?: string;
};

export default function RatePlayer({ playerId, className }: RatePlayerProps) {
  const [value, setValue] = useState(7);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const router = useRouter();

  useEffect(() => {
    async function init() {
      await fetch("/api/public/device").catch(() => {});

      const res = await fetch(`/api/public/my-rating?ratedId=${playerId}`);
      const json = await res.json().catch(() => ({}));

      if (res.ok && typeof json.value === "number") {
        setValue(json.value);
      }

      setLoading(false);
    }

    void init();
  }, [playerId]);

  async function save() {
    setMsg(null);

    const res = await fetch("/api/public/ratings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ratedId: playerId, value }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 429) {
        setMsg(json.message ?? "Cooldown aktywny");
      } else {
        setMsg(`Blad: ${json.error ?? res.statusText}`);
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
