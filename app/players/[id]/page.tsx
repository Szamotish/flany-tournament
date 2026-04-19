import Link from "next/link";
import RatePlayer from "./RatePlayer";
import UploadAvatar from "./UploadAvatar";
import { trimmedMean } from "@/lib/rating";
import { supabaseServer } from "@/lib/supabaseServer";
import TrophyIcon from "@/app/components/TrophyIcon";
import BackNavButton from "@/app/components/BackNavButton";
import { PRESTIGE_POINTS_PER_MMR } from "@/lib/ranked";

export const dynamic = "force-dynamic";

type PlayerBrief = { id: string; name: string };

type HistoryEntry = {
  tournamentId: string;
  tournamentName: string;
  tournamentCreatedAt: string | null;
  teamId: string;
  teamName: string;
  placement: number;
  teamRoster: PlayerBrief[];
};

function formatShortDate(iso: string | null): string {
  if (!iso) return "--.--";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
}

function formatPlacement(place: number): string {
  const n = Math.max(1, Math.floor(place));
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function parsePlayerBrief(value: unknown): PlayerBrief | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const player = source as { id?: unknown; name?: unknown };
  if (typeof player.id !== "string" || typeof player.name !== "string") return null;
  return { id: player.id, name: player.name };
}

function prestigeTier(pointsValue: number | null): number {
  const points = Number(pointsValue ?? 0);
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.floor(points / PRESTIGE_POINTS_PER_MMR);
}

function prestigeColor(tier: number): string {
  if (tier <= 0) return "rgba(80, 48, 8, 0.24)";
  const tones = ["#059669", "#0284c7", "#7c3aed", "#d97706", "#e11d48", "#65a30d"];
  return tones[(tier - 1) % tones.length];
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: playerId } = await params;

  const { data: player, error: playerErr } = await supabaseServer
    .from("players")
    .select("id,name,active,avatar_url,mmr,prestige_points")
    .eq("id", playerId)
    .maybeSingle();

  if (playerErr) {
    return (
      <main className="player-profile-root">
        <BackNavButton className="underline opacity-80" fallbackHref="/players" />
        <p className="mt-4 text-red-600">Blad: {playerErr.message}</p>
      </main>
    );
  }

  if (!player) {
    return (
      <main className="player-profile-root">
        <BackNavButton className="underline opacity-80" fallbackHref="/players" />
        <p className="mt-4 text-red-600">Nie znaleziono zawodnika.</p>
      </main>
    );
  }

  const { data: ratings, error: ratingsErr } = await supabaseServer
    .from("ratings")
    .select("value")
    .eq("rated_player_id", playerId);

  const ratingValues = (ratings ?? []).map((r) => Number(r.value)).filter(Number.isFinite);
  const rating = trimmedMean(ratingValues, 0.1);

  const { data: memberships, error: membershipsErr } = await supabaseServer
    .from("team_members")
    .select("team_id")
    .eq("player_id", playerId);

  const teamIds = (memberships ?? []).map((x) => String(x.team_id));

  let beers = 0;
  let history: HistoryEntry[] = [];

  if (teamIds.length > 0) {
    const { data: beerMatches, error: beersErr } = await supabaseServer
      .from("tournament_matches")
      .select("team_a_id,team_b_id,status")
      .eq("status", "finished")
      .or(`team_a_id.in.(${teamIds.join(",")}),team_b_id.in.(${teamIds.join(",")})`);

    if (!beersErr) {
      beers = (beerMatches ?? []).reduce((sum, m) => {
        const hasA = typeof m.team_a_id === "string" && m.team_a_id.length > 0;
        const hasB = typeof m.team_b_id === "string" && m.team_b_id.length > 0;
        return sum + (hasA && hasB ? 1 : 0);
      }, 0);
    }

    const { data: results, error: resultsErr } = await supabaseServer
      .from("tournament_results")
      .select("tournament_id,team_id,placement")
      .in("team_id", teamIds)
      .order("placement", { ascending: true });

    if (!resultsErr) {
      const tournamentIds = Array.from(new Set((results ?? []).map((r) => String(r.tournament_id))));

      const tournamentsMap = new Map<string, { name: string; created_at: string | null }>();
      const teamsMap = new Map<string, string>();
      const rosterMap = new Map<string, PlayerBrief[]>();

      if (tournamentIds.length > 0) {
        const { data: tournaments } = await supabaseServer
          .from("tournaments")
          .select("id,name,created_at")
          .in("id", tournamentIds);

        for (const t of tournaments ?? []) {
          tournamentsMap.set(String(t.id), {
            name: String(t.name ?? "(unknown)"),
            created_at: t.created_at ? String(t.created_at) : null,
          });
        }
      }

      const { data: teams } = await supabaseServer
        .from("teams")
        .select("id,name")
        .in("id", teamIds);

      for (const t of teams ?? []) {
        teamsMap.set(String(t.id), String(t.name ?? "Druzyna"));
      }

      const { data: members } = await supabaseServer
        .from("team_members")
        .select("team_id, players(id,name)")
        .in("team_id", teamIds);

      for (const m of members ?? []) {
        const teamId = String(m.team_id);
        const playerRef = parsePlayerBrief((m as { players?: unknown }).players);
        if (!playerRef) continue;
        const current = rosterMap.get(teamId) ?? [];
        current.push(playerRef);
        rosterMap.set(teamId, current);
      }

      for (const [key, roster] of rosterMap.entries()) {
        rosterMap.set(
          key,
          roster.sort((a, b) => a.name.localeCompare(b.name, "pl"))
        );
      }

      history = (results ?? []).map((r) => {
        const tournamentId = String(r.tournament_id);
        const teamId = String(r.team_id);
        const t = tournamentsMap.get(tournamentId);

        return {
          tournamentId,
          tournamentName: t?.name ?? "(unknown)",
          tournamentCreatedAt: t?.created_at ?? null,
          teamId,
          teamName: teamsMap.get(teamId) ?? "Druzyna",
          placement: Number(r.placement ?? 0),
          teamRoster: rosterMap.get(teamId) ?? [],
        };
      });

      history.sort((a, b) => {
        const da = a.tournamentCreatedAt ? new Date(a.tournamentCreatedAt).getTime() : 0;
        const db = b.tournamentCreatedAt ? new Date(b.tournamentCreatedAt).getTime() : 0;
        if (db !== da) return db - da;
        return a.placement - b.placement;
      });
    }
  }

  const trophies = history.filter((h) => h.placement === 1);
  const rankedTier = prestigeTier(Number(player.prestige_points ?? 0));
  const rankedMmr = Number(player.mmr ?? 0);
  const rankedPrestigePoints = Math.max(0, Number(player.prestige_points ?? 0));

  return (
    <main className="player-profile-root">
      <div className="profile-topbar">
        <BackNavButton className="underline opacity-80" fallbackHref="/players" />
        <span className="profile-kicker">Profil zawodnika</span>
      </div>

      <section className="player-grid mt-4">
        <article className="profile-card profile-hero">
          <div className="profile-hero-top">
            {player.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={player.avatar_url} alt="avatar" className="profile-avatar" />
            ) : (
              <div className="profile-avatar profile-avatar-fallback">{player.name.slice(0, 1).toUpperCase()}</div>
            )}

            <div>
              <h1 className="profile-name">{player.name}</h1>
              <p className="profile-muted">{player.active ? "aktywny" : "nieaktywny"}</p>
            </div>
          </div>

          <UploadAvatar playerId={playerId} className="mt-4" />

          <div className="profile-rating-box mt-5">
            <p className="profile-section-title">Rating</p>
            <div className="profile-rating-row">
              <span className="profile-rating-value">{rating !== null ? rating.toFixed(1) : "--"}</span>
              <span className="profile-rating-scale">/10</span>
            </div>
            <p className="profile-muted mt-1">Liczba ocen: {ratingValues.length}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="profile-rating-chip">MMR {Number.isFinite(rankedMmr) ? rankedMmr.toFixed(1) : "0.0"}</span>
              <span
                className="profile-rating-chip"
                style={{
                  borderColor: prestigeColor(rankedTier),
                }}
              >
                {rankedTier > 0 ? `Prestige +${rankedTier}` : "Prestige 0"}
              </span>
            </div>
            <p className="profile-muted mt-1">Punkty prestige: {Number.isFinite(rankedPrestigePoints) ? rankedPrestigePoints : 0}</p>
            {ratingsErr && <p className="profile-muted mt-1">Blad ocen: {ratingsErr.message}</p>}
            {membershipsErr && <p className="profile-muted mt-1">Blad historii: {membershipsErr.message}</p>}
          </div>
        </article>

        <article className="profile-card profile-trophies">
          <p className="profile-section-title">Wygrane</p>

          {trophies.length === 0 ? (
            <p className="profile-muted mt-3">Brak pucharow.</p>
          ) : (
            <div className="trophy-grid mt-3">
              {trophies.slice(0, 8).map((t, idx) => (
                <div key={`${t.tournamentId}-${idx}`} className="trophy-item">
                  <TrophyIcon seed={`${idx}`} />
                  <p className="trophy-name" title={t.tournamentName}>
                    {t.tournamentName}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="profile-card profile-history">
          <p className="profile-section-title">Historia gier</p>

          {history.length === 0 ? (
            <p className="profile-muted mt-3">Brak historii turniejowej.</p>
          ) : (
            <div className="history-list mt-3">
              {history.map((h, idx) => (
                <details key={`${h.tournamentId}-${h.teamId}-${idx}`} className="history-row">
                  <summary>
                    <span className="history-date">{formatShortDate(h.tournamentCreatedAt)}</span>
                    <span className="history-place">{formatPlacement(h.placement)}</span>
                    <span className="history-team">{h.teamName}</span>
                    <span className="history-menu">&gt;</span>
                  </summary>

                  <div className="history-expand">
                    <p>
                      Turniej:{" "}
                      <Link className="underline" href={`/tournaments/${h.tournamentId}`}>
                        {h.tournamentName}
                      </Link>
                    </p>
                    <p className="mt-1">Druzyna: {h.teamName}</p>
                    {h.teamRoster.length > 0 && (
                      <p className="mt-1">Sklad: {h.teamRoster.map((p) => p.name).join(", ")}</p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </article>

        <article className="profile-card profile-beers">
          <p className="profile-section-title">Wypite piwa</p>
          <p className="profile-beers-value">{beers}</p>
        </article>

        <article className="profile-card profile-rate">
          <RatePlayer playerId={playerId} />
        </article>
      </section>
    </main>
  );
}
