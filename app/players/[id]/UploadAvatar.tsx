"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/lib/authClient";

type UploadAvatarProps = {
  playerId: string;
  className?: string;
};

export default function UploadAvatar({ playerId, className }: UploadAvatarProps) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canEdit, setCanEdit] = useState<boolean | null>(null);
  const router = useRouter();

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

  async function onPick(file: File | null) {
    if (!file) return;

    setMsg(null);
    setBusy(true);

    const fd = new FormData();
    fd.append("file", file);

    const res = await authedFetch(`/api/public/players/${playerId}/avatar`, {
      method: "POST",
      body: fd,
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (json.error === "forbidden_player_owner_only") {
        setMsg("Mozesz zmienic tylko swoj avatar.");
      } else if (json.error === "invalid_or_expired_token") {
        setMsg("Sesja wygasla. Zaloguj sie ponownie.");
      } else {
        setMsg(`Blad: ${json.error ?? res.statusText}`);
      }
      setBusy(false);
      return;
    }

    setMsg("Avatar zapisany.");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className={className ?? ""}>
      {canEdit ? (
        <label className="profile-btn profile-btn-file profile-btn-primary">
          {busy ? "Zapisywanie..." : "Zmien avatar"}
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        <p className="profile-muted">Avatar moze zmienic tylko wlasciciel profilu.</p>
      )}

      {msg && <p className="profile-muted mt-2">{msg}</p>}
    </div>
  );
}
