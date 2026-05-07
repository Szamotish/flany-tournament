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

        <section className="tour-rules-tablet-stage mt-4">
          <div className="tour-rules-tablet" aria-label="Bazowe zasady main admina">
            <div className="tour-rules-tablet-content">
              <h1>PRZYKAZANIA</h1>
              <pre className="tour-rules-pre">{content}</pre>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
