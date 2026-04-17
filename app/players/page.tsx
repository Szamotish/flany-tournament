import Link from "next/link";
import { supabasePublic } from "@/lib/supabasePublic";

type PlayerRow = {
  id: string;
  name: string;
  active: boolean;
  avatar_url: string | null;
};

export default async function PlayersPage() {
  const { data, error } = await supabasePublic
    .from("players")
    .select("id,name,active,avatar_url")
    .order("name", { ascending: true });

  const players = (data ?? []) as PlayerRow[];

  return (
    <main className="p-6">
      <Link className="underline opacity-80" href="/">
        Back
      </Link>

      <h1 className="mt-4 text-3xl font-semibold">Zawodnicy</h1>

      {error ? (
        <p className="mt-3 text-sm text-red-600">Blad pobierania: {error.message}</p>
      ) : players.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Brak zawodnikow.</p>
      ) : (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {players.map((p) => (
            <Link
              key={p.id}
              href={`/players/${p.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border bg-white/60 px-3 py-2 no-underline backdrop-blur-sm transition hover:bg-white/80"
            >
              <div className="flex items-center gap-3">
                <span className="inline-grid h-10 w-10 place-items-center overflow-hidden rounded-full border bg-white text-sm font-semibold">
                  {p.avatar_url ? (
                    <span
                      className="block h-full w-full bg-cover bg-center"
                      style={{ backgroundImage: `url('${p.avatar_url}')` }}
                    />
                  ) : (
                    p.name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="font-medium">{p.name}</span>
              </div>
              <span className="text-xs opacity-70">{p.active ? "aktywny" : "nieaktywny"}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
