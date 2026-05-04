import RulesPageClient from "./RulesPageClient";

export default async function TournamentRulesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RulesPageClient tournamentId={id} />;
}
