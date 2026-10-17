import NotebookClient from "./NotebookClient";

export default async function NotebookPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ match?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <NotebookClient tournamentId={id} initialMatch={query.match ?? ""} />;
}
