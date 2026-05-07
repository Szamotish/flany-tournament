import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { teamToneVars } from "@/lib/ui/teamTone";
import { playerToneStyle } from "@/lib/ui/playerProfile";
import { pickTeamCaptainId } from "@/lib/teamCaptain";

export const dynamic = "force-dynamic";

type PlayerBrief = { id: string; name: string; avatarUrl: string | null; profileColor: string | null };
type TeamSummary = { id: string; name: string; captainPlayerId: string | null; players: PlayerBrief[] };

function parsePlayerRef(value: unknown): PlayerBrief | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const p = source as { id?: unknown; name?: unknown; avatar_url?: unknown; profile_color?: unknown };
  if (typeof p.id !== "string" || typeof p.name !== "string") return null;
  return {
    id: p.id,
    name: p.name,
    avatarUrl: typeof p.avatar_url === "string" ? p.avatar_url : null,
    profileColor: typeof p.profile_color === "string" ? p.profile_color : null,
  };
}

export default async function TournamentTeamsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: tournamentId } = await params;

  const [batchRes, tournamentRes] = await Promise.all([
    supabaseServer
      .from("team_batches")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("is_active", true)
      .maybeSingle(),
    supabaseServer
      .from("tournaments")
      .select("format")
      .eq("id", tournamentId)
      .maybeSingle(),
  ]);

  const batch = batchRes.data;
  const batchErr = batchRes.error;
  const isOneVsOne = tournamentRes.data?.format === "one_vs_one";

  let teams: TeamSummary[] = [];

  if (batch?.id) {
    const { data: teamRows } = await supabaseServer
      .from("teams")
      .select("id,name")
      .eq("batch_id", batch.id)
      .order("name", { ascending: true });

    const teamIds = (teamRows ?? []).map((t) => String(t.id));

    const { data: members } = await supabaseServer
      .from("team_members")
      .select("team_id, players(id,name,avatar_url,profile_color)")
      .in("team_id", teamIds);

    const rosterMap = new Map<string, PlayerBrief[]>();
    for (const m of members ?? []) {
      const teamId = String(m.team_id);
      const p = parsePlayerRef((m as { players?: unknown }).players);
      if (!p) continue;
      const current = rosterMap.get(teamId) ?? [];
      current.push(p);
      rosterMap.set(teamId, current);
    }

    for (const [teamId, roster] of rosterMap.entries()) {
      rosterMap.set(
        teamId,
        roster.sort((a, b) => a.name.localeCompare(b.name, "pl"))
      );
    }

    teams = (teamRows ?? []).map((t) => {
      const roster = rosterMap.get(String(t.id)) ?? [];
      const captainPlayerId = isOneVsOne ? null : pickTeamCaptainId(String(t.id), roster.map((p) => p.id));
      return {
        id: String(t.id),
        name: String(t.name ?? "Druzyna"),
        captainPlayerId,
        players: roster,
      };
    });
  }

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href={`/tournaments/${tournamentId}`}>
            Back
          </Link>
          <span className="tour-kicker">Sklady druzyn</span>
        </div>

        <section className="tour-detail-main mt-4">
          <h1 className="tour-title">Druzyny turnieju</h1>
        </section>

        {batchErr ? (
          <p className="mt-4 text-sm text-red-600">Blad: {batchErr.message}</p>
        ) : !batch ? (
          <p className="mt-4 tour-muted">Brak wygenerowanych druzyn.</p>
        ) : teams.length === 0 ? (
          <p className="mt-4 tour-muted">Brak druzyn w aktywnym batchu.</p>
        ) : (
          <section className="tour-list mt-4">
            {teams.map((team) => (
              <article key={team.id} className="tour-card team-tone-card" style={teamToneVars(team.id)}>
                <div className="tour-card-head">
                  <div>
                    <p className="tour-card-title">{team.name}</p>
                    {team.captainPlayerId ? (
                      <p className="tour-card-sub">
                        Kapitan: {team.players.find((p) => p.id === team.captainPlayerId)?.name ?? "brak"}
                      </p>
                    ) : null}
                  </div>
                </div>

                {team.players.length === 0 ? (
                  <p className="tour-muted mt-3">Brak zawodnikow.</p>
                ) : (
                  <div className="tour-players-grid mt-3">
                    {team.players.map((p) => (
                      <Link key={p.id} className="tour-player-chip tour-player-chip-avatar player-tone-card" style={playerToneStyle(p.profileColor)} href={`/players/${p.id}`}>
                        {p.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.avatarUrl} alt="" className="tour-player-avatar" />
                        ) : (
                          <span className="tour-player-avatar tour-player-avatar-fallback">
                            {p.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span>{p.name}</span>
                        {team.captainPlayerId === p.id ? <span className="tour-player-captain-badge">K</span> : null}
                      </Link>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        )}
      </div>

      <Link href={`/tournaments/${tournamentId}/admin`} className="admin-fab" aria-label="Panel lokalnego admina">
        Admin
      </Link>
    </main>
  );
}



