import Link from "next/link";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabaseServer";
import { trimmedMean } from "@/lib/rating";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const COOLDOWN_SOON_MS = 24 * 60 * 60 * 1000;

type PlayerRow = {
  id: string;
  name: string;
  active: boolean;
  avatar_url: string | null;
};

type CooldownState = "ready" | "cooldown" | "soon";

function cooldownStatus(updatedAtIso: string | null): { state: CooldownState; hint: string } {
  if (!updatedAtIso) {
    return { state: "ready", hint: "Mozesz teraz wystawic ocene." };
  }

  const updatedAtMs = new Date(updatedAtIso).getTime();
  if (!Number.isFinite(updatedAtMs)) {
    return { state: "ready", hint: "Mozesz teraz wystawic ocene." };
  }

  const msLeft = COOLDOWN_MS - (Date.now() - updatedAtMs);
  if (msLeft <= 0) {
    return { state: "ready", hint: "Mozesz teraz wystawic ocene." };
  }

  if (msLeft <= COOLDOWN_SOON_MS) {
    const hoursLeft = Math.max(1, Math.ceil(msLeft / (1000 * 60 * 60)));
    return { state: "soon", hint: `Cooldown konczy sie za ok. ${hoursLeft}h.` };
  }

  const daysLeft = Math.max(1, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  return { state: "cooldown", hint: `Cooldown aktywny, pozostalo ok. ${daysLeft} dni.` };
}

function badgeTone(state: CooldownState): string {
  if (state === "ready") {
    return "border-emerald-700/40 bg-emerald-100/80 text-emerald-900";
  }
  if (state === "soon") {
    return "border-amber-700/45 bg-amber-100/80 text-amber-900";
  }
  return "border-rose-700/40 bg-rose-100/80 text-rose-900";
}

function badgeLabel(state: CooldownState): string {
  if (state === "ready") return "GO";
  if (state === "soon") return "~1d";
  return "CD";
}

function formatAverage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return value.toFixed(1);
}

export default async function PlayersPage() {
  const { data, error } = await supabaseServer
    .from("players")
    .select("id,name,active,avatar_url")
    .eq("active", true)
    .order("name", { ascending: true });

  const players = (data ?? []) as PlayerRow[];
  const playerIds = players.map((player) => player.id);

  const averageRatingByPlayer = new Map<string, number | null>();
  for (const player of players) {
    averageRatingByPlayer.set(player.id, null);
  }

  let ratingsError: string | null = null;
  if (playerIds.length > 0) {
    const { data: ratingsData, error: ratingsQueryError } = await supabaseServer
      .from("ratings")
      .select("rated_player_id,value")
      .in("rated_player_id", playerIds);

    if (ratingsQueryError) {
      ratingsError = ratingsQueryError.message;
    } else {
      const grouped = new Map<string, number[]>();
      for (const row of ratingsData ?? []) {
        const playerId = typeof row.rated_player_id === "string" ? row.rated_player_id : "";
        const value = Number(row.value);
        if (!playerId || !Number.isFinite(value)) continue;
        const current = grouped.get(playerId) ?? [];
        current.push(value);
        grouped.set(playerId, current);
      }

      for (const playerId of playerIds) {
        averageRatingByPlayer.set(playerId, trimmedMean(grouped.get(playerId) ?? []));
      }
    }
  }

  const cooldownByPlayer = new Map<string, { state: CooldownState; hint: string }>();
  for (const player of players) {
    cooldownByPlayer.set(player.id, { state: "ready", hint: "Mozesz teraz wystawic ocene." });
  }

  let cooldownError: string | null = null;
  const deviceId = (await cookies()).get("device_id")?.value ?? null;

  if (deviceId && playerIds.length > 0) {
    const { data: myRatings, error: myRatingsError } = await supabaseServer
      .from("ratings")
      .select("rated_player_id,updated_at")
      .eq("rater_device_id", deviceId)
      .in("rated_player_id", playerIds);

    if (myRatingsError) {
      cooldownError = myRatingsError.message;
    } else {
      for (const row of myRatings ?? []) {
        const playerId = typeof row.rated_player_id === "string" ? row.rated_player_id : "";
        if (!playerId) continue;
        const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
        cooldownByPlayer.set(playerId, cooldownStatus(updatedAt));
      }
    }
  }

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
            <Link key={p.id} href={`/players/${p.id}`} className="no-underline">
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-white/60 px-3 py-2 backdrop-blur-sm transition hover:bg-white/80">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border bg-white text-sm font-semibold">
                    {p.avatar_url ? (
                      <span
                        className="block h-full w-full bg-cover bg-center"
                        style={{ backgroundImage: `url('${p.avatar_url}')` }}
                      />
                    ) : (
                      p.name.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="truncate font-medium">{p.name}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-70">{p.active ? "aktywny" : "nieaktywny"}</span>
                  <span
                    title={cooldownByPlayer.get(p.id)?.hint ?? "Status cooldownu niedostepny."}
                    className={`inline-flex h-12 min-w-[3.6rem] flex-col items-center justify-center rounded-lg border px-2 ${badgeTone(
                      cooldownByPlayer.get(p.id)?.state ?? "ready"
                    )}`}
                  >
                    <span className="text-sm font-extrabold leading-none">{formatAverage(averageRatingByPlayer.get(p.id) ?? null)}</span>
                    <span className="text-[0.58rem] font-semibold uppercase tracking-[0.08em] leading-none mt-1">
                      {badgeLabel(cooldownByPlayer.get(p.id)?.state ?? "ready")}
                    </span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {ratingsError ? <p className="mt-3 text-xs text-red-600">Blad ocen: {ratingsError}</p> : null}
      {cooldownError ? <p className="mt-1 text-xs text-red-600">Blad cooldownu: {cooldownError}</p> : null}
    </main>
  );
}
