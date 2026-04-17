"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type UploadAvatarProps = {
  playerId: string;
  className?: string;
};

export default function UploadAvatar({ playerId, className }: UploadAvatarProps) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onPick(file: File | null) {
    if (!file) return;

    setMsg(null);
    setBusy(true);

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch(`/api/public/players/${playerId}/avatar`, {
      method: "POST",
      body: fd,
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMsg(`Blad: ${json.error ?? res.statusText}`);
      setBusy(false);
      return;
    }

    setMsg("Avatar zapisany.");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className={className ?? ""}>
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

      {msg && <p className="profile-muted mt-2">{msg}</p>}
    </div>
  );
}
