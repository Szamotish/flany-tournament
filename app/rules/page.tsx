import Link from "next/link";
import { readDefaultRules } from "@/lib/tournamentRules";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const content = await readDefaultRules();

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href="/">
            Back
          </Link>
          <span className="tour-kicker">Zasady</span>
        </div>

        <section className="tour-rules-stage mt-4">
          <div className="tour-rules-scroll" aria-label="Bazowe zasady turniejow">
            <div className="tour-rules-scroll-content">
              <h1>Zasady</h1>
              <pre className="tour-rules-pre">{content}</pre>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
