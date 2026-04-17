import AdminMatchesPanel from "./AdminMatchesPanel";

export default async function AdminMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminMatchesPanel tournamentId={id} />;
}