# Flanki League

Aplikacja ligi: turnieje, drużyny, ranking MMR/PP, profile graczy i kula AI. Next.js App Router, React, TypeScript i Supabase. Wdrożenie na Vercelu.

## Uruchomienie

```sh
npm ci
npm run dev
```

Serwer lokalny: `http://localhost:3000`. Zmienne umieść w `.env.local` (nie commituj tego pliku):

| Zmienna | Zastosowanie |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Adres projektu Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publiczny klucz Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Klucz serwerowy; nigdy w kodzie klienta |
| `NEXT_PUBLIC_SITE_URL` / `SITE_URL` | Adres aplikacji w linkach i przekierowaniach |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Ochrona formularzy; sekret wymagany w produkcji |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | Opcjonalne powiadomienia e-mail |
| `GROQ_API_KEY`, `ORACLE_ENABLED`, `ORACLE_FREE_PLAN_CONFIRMED` | Kula AI; obie flagi muszą mieć wartość `true` |

Samo ustawienie flag kuli nie zmienia planu rozliczeniowego dostawcy. Ustawienia dostępności i modelu są w panelu administratora. Instrukcje modelu: `lib/oraclePrompt.ts`; zasady gry i kontekst ligi ładowane są po stronie serwera.

## Weryfikacja

```sh
npm run check   # ESLint, TypeScript i testy
npm run build  # produkcyjny build; next/font pobiera fonty Google
```

Testy przeglądarkowe są opcjonalne. Wskaż zainstalowany `playwright-core` przez `PROFILE_PLAYWRIGHT_PATH` i Chrome przez `PROFILE_CHROME_PATH`; testy kuli korzystają z analogicznych zmiennych `ORACLE_PLAYWRIGHT_PATH` i `ORACLE_CHROME_PATH`. Zmienne nie są potrzebne aplikacji w produkcji.

**Baza danych:** obecny checkout nie zawiera migracji SQL. Testy migracji odwołują się do `supabase/migrations/` i domyślnie są pomijane. Do odtworzenia nowej bazy lub uruchomienia tych testów potrzebne są oryginalne migracje i PGlite, wskazany przez zmienne opisane w odpowiednich testach. Nie uruchamiaj testów na bazie produkcyjnej.

## Organizacja

- `app/` — strony i endpointy Next.js; `app/components/` — wspólne elementy interfejsu.
- `lib/` — logika domenowa i odczyty serwerowe; `lib/ui/` — mapowania wyglądu, `lib/matches/` — drabinki i rozstrzyganie meczów.
- `public/` — grafiki i modele. Nowe plakietki serii są w `public/streaks/`.
- `tests/` — testy logiki, kontraktów API oraz opcjonalne testy bazy i przeglądarki.
- `docs/` — opis architektury i ustalenia z przeglądu.

Piwo dodaje się w `lib/beers.ts`: nazwa i `labelFile` w jednym wpisie. Etykietę umieść w `public/models/etykiety clean/`. Wspólny katalog obsługuje ulubione piwo, piwo dnia, panel admina i model puszki.

Szczegóły: [architektura i przegląd projektu](docs/architecture.md).
