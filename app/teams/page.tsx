import Link from "next/link";

type BatchSummary = { id: string; team_size: number };
type PlayerBrief = { id: string; name: string };
type TeamSummary = { id: string; name: string; players: PlayerBrief[] };

export default async function TeamsPage() {
  const res = await fetch("http://localhost:3000/api/public/teams/latest", {
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  const payload = (json ?? {}) as { batch?: BatchSummary | null; teams?: TeamSummary[] };
  const batch = payload.batch ?? null;
  const teams = payload.teams ?? [];

  return (
    <main className="p-6">
      <Link className="underline opacity-80" href="/">
        ← Wróć
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Drużyny</h1>

      {!batch ? (
        <p className="mt-3 opacity-70">Brak wygenerowanych drużyn.</p>
      ) : (
        <p className="mt-2 text-sm opacity-70">
          Batch: {batch.id} • team_size={batch.team_size}
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {teams.map((t) => (
          <div key={t.id} className="rounded-xl border p-4">
            <h2 className="text-lg font-medium">{t.name}</h2>
            <ul className="mt-2 space-y-1">
              {t.players.map((p) => (
                <li key={p.id}>
                  <Link className="underline" href={`/players/${p.id}`}>
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
