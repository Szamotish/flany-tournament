# Automatyczne nazwy turniejów

Nowe turnieje otrzymują nazwę `FL #DDMMRRN`: dzień, miesiąc, dwie cyfry roku i kolejny numer turnieju danego dnia, bez separatorów. Przykłady dla 2 października 2026: `FL #0210261`, `FL #0210262`, `FL #02102610`.

Numeracja jest wspólna dla wszystkich trybów i formatów. Datą jest termin turnieju w strefie Europe/Warsaw, a przy braku terminu — dzień utworzenia. Formularze terminu i zgłoszeń również używają czasu polskiego.

Nazwę ustala baza w transakcji podczas tworzenia turnieju. Równoczesne operacje korzystają z blokowanego licznika dziennego. Usunięcie turnieju nie zwalnia jego numeru. Przeniesienie nowego turnieju na inny dzień nadaje kolejny numer z nowej daty; zmiana godziny w obrębie dnia albo lokalizacji zachowuje numer. Techniczne ID oraz link do turnieju pozostają stałe.

Pole ręcznej nazwy zostało usunięte. W formularzu pozostaje lokalizacja, wyświetlana na listach turniejów, stronie turnieju, przy pucharach i w historii gracza.

Migracja historycznych turniejów nadaje im ten sam format nazwy, według terminu turnieju (lub daty utworzenia, gdy nie ma terminu), w czasie polskim. W obrębie dnia numeruje stare turnieje chronologicznie; przy identycznym terminie rozstrzyga data utworzenia, następnie ID. Jeśli tego dnia istnieją już automatycznie nazwane turnieje, ich numery pozostają bez zmian, a historyczne turnieje otrzymują kolejno wolne numery. Dotychczasowa nazwa trafia do lokalizacji tylko wtedy, gdy lokalizacja jest pusta (także gdy zawiera same spacje). Istniejące lokalizacje pozostają bez zmian.

## Wdrożenie

Wykonaj migracje w tej kolejności:

1. `supabase/migrations/20261002_automatic_tournament_names.sql` — dodaje metadane numeracji, licznik i trigger; wymagana przed wdrożeniem kodu. Jeśli została już wykonana, nie trzeba jej powtarzać.
2. `supabase/migrations/20261003_backfill_tournament_names.sql` — nadaje automatyczne nazwy istniejącym turniejom i przenosi stare nazwy do pustych lokalizacji.

Druga migracja działa w jednej transakcji i na czas aktualizacji blokuje zmiany w tabeli turniejów. Można ją uruchomić ponownie: już przemianowane rekordy nie zmienią nazw ani lokalizacji, a liczniki nie zostaną cofnięte. Obie migracje zachowują ID, linki, wyniki i powiązania pucharów. Nie wymagają przeliczenia MMR.

## Weryfikacja

`npm test` sprawdza parsowanie i odtwarzanie polskiego czasu, w tym północ, zmianę czasu i nieprawidłowe daty.

Testy migracji PostgreSQL są opcjonalne. Ustaw `TOURNAMENT_NAMING_PGLITE_PATH` na lokalną instalację `@electric-sql/pglite` i uruchom `node --test tests/tournament-naming-database.test.cjs tests/tournament-naming-backfill.test.cjs`. Testy działają w pamięci, bez połączenia z bazą produkcyjną, i sprawdzają numerację, usunięcia, zmiany terminu, stare nazwy, rollback, uprawnienia oraz migrację historycznych nazw i lokalizacji.
