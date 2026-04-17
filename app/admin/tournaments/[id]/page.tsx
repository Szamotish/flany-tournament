import Link from "next/link";
import { supabasePublic } from "@/lib/supabasePublic";

type PlayerRef = { id: string; name: string };

function isPlayerRef(value: unknown): value is PlayerRef {
  if (!value || typeof value !== "object") return false;
  const player = value as { id?: unknown; name?: unknown };
  return typeof player.id === "string" && typeof player.name === "string";
}

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: t, error: tErr } = await supabasePublic
    .from("tournaments_public")
    .select("id,name,created_at,format,bo_default,bo_finals")
    .eq("id", id)
    .single();

  const { data: tp, error: tpErr } = await supabasePublic
    .from("tournament_players")
    .select("player_id, players(id,name)")
    .eq("tournament_id", id);

  const players = (tp ?? [])
    .map((x) => x.players as unknown)
    .filter(isPlayerRef)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="p-6">
      <Link className="underline opacity-80" href="/">
        ← Wróć
      </Link>

      <div className="mt-4 rounded-xl border p-4">
        {tErr ? (
          <p className="text-red-600">Błąd: {tErr.message}</p>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{t?.name}</h1>
            <p className="mt-1 text-sm opacity-70">
              Format: {t?.format} • BO{t?.bo_default} • finały BO{t?.bo_finals}
            </p>
          </>
        )}
      </div>

      <div className="mt-4 rounded-xl border p-4">
        <h2 className="text-lg font-medium">Zawodnicy</h2>

        {tpErr ? (
          <p className="mt-2 text-sm text-red-600">Błąd: {tpErr.message}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {players.map((p) => (
              <li key={p.id}>
                <Link className="underline" href={`/players/${p.id}`}>
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 rounded-xl border p-4">
        <p className="text-sm opacity-70">
          Następny krok: wygenerujemy drużyny dla tego turnieju i później drabinkę.
        </p>
      </div>
    </main>
  );
}
