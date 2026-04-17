import AdminPanel from "./AdminPanel";

export default async function TournamentAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <AdminPanel tournamentId={id} />;
}