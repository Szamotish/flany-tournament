# Magiczna kula — uruchomienie bez płatnego planu

Kod jest domyślnie wyłączony. Wdrożenie bez klucza, potwierdzenia planu Free lub migracji nie wysyła pytań do AI. Migracja również zaczyna od trybu `off`.

## Co trzeba zrobić na swoich kontach

1. Załóż konto w [Groq Console](https://console.groq.com/). Zostań na **Free**, nie dodawaj metody płatności i nie przechodź na Developer. Utwórz klucz API do tej aplikacji. Nie wysyłaj klucza na czacie i nie dodawaj go do repozytorium.
2. W Supabase → SQL Editor wykonaj cały plik `supabase/migrations/20261005_oracle_ai.sql`. Można uruchomić go ponownie: nie zeruje ustawień ani wykorzystania limitów. To nowe tabele; migracja nie zmienia punktów graczy ani turniejów.
3. W Vercel → Project → Settings → Environment Variables dodaj **tylko dla Production**:

   ```text
   GROQ_API_KEY=<twój klucz Groq>
   ORACLE_FREE_PLAN_CONFIRMED=true
   ORACLE_ENABLED=true
   ```

   Żadna z tych nazw nie może mieć prefiksu `NEXT_PUBLIC_`. Zmienne Supabase już używane przez aplikację pozostają takie same. W Preview i Development zostaw `ORACLE_ENABLED` niewłączone, aby kopie aplikacji nie korzystały z produkcyjnego limitu. Do testowania lokalnego można świadomie dodać te wartości do ignorowanego `.env.local`.
4. Wdróż kod / wykonaj redeploy, żeby Vercel wczytał zmienne. Pozostań na Vercel Hobby i Supabase Free.
5. Zaloguj się jako main admin → menu konta → **Test kuli** (`/admin/oracle`). Wybierz **Tylko main admin** i zapisz. Publiczne udostępnienie wymaga osobnego wybrania **Zalogowani, aktywni gracze**.

`ORACLE_FREE_PLAN_CONFIRMED` to potwierdzenie administratora, nie sprawdzanie planu przez API. Program nie może zabronić właścicielowi konta późniejszego włączenia płatnego planu. Gwarancja braku opłat wynika z utrzymania kont na darmowych planach; nasze liczniki dodatkowo ograniczają wykorzystanie. [Groq opisuje przejście na Developer po dodaniu metody płatności](https://console.groq.com/docs/billing-faqs). [Vercel Hobby](https://vercel.com/docs/plans/hobby) oraz [Supabase Free](https://supabase.com/docs/guides/platform/cost-control) mają limity zasobów — ich wyczerpanie może ograniczyć działanie aplikacji.

## Test jakości przed udostępnieniem

Panel pozwala testować `qwen/qwen3.8-27b` (model preview) i `openai/gpt-oss-120b`, oba przez Groq. Wybór modelu przy pytaniu jest dostępny wyłącznie main adminowi. **Zapisz ustawienia** zmienia również domyślny model dla graczy. Nie ma automatycznej zmiany modelu po błędzie.

Zadaj obu modelom kilka tych samych pytań: o wynik meczu, drobną życiową decyzję, kolegę z ligi i coś niezwiązanego z flankami. Oceń naturalność, trafność i długość odpowiedzi. Dopiero po tej próbie wybierz model i ewentualnie dopracuj styl na kilku zaakceptowanych odpowiedziach. Obecny prompt jest punktem wyjścia, nie gwarancją dobrego humoru.

Kula nie otrzymuje bazy graczy, ich ocen ani wyników. Wie, czym jest Flanki League; dostaje tylko bieżące pytanie i krótkie instrukcje stylu. Nie prowadzi historii rozmowy. Nasza baza nie przechowuje pytań ani odpowiedzi; pytanie jest jednak przesyłane do Groq. Nie wklejaj do niego sekretów.

## Limity i zachowanie przy błędach

- Maksymalnie **100 prób na całą aplikację** oraz **10 na konto** w ruchomym oknie ostatnich **24 godzin**. Limity odnawiają się stopniowo, 24 godziny po danej próbie, a nie o północy. Testy main admina także je zużywają.
- Dodatkowo: 4 próby/minutę, 15 sekund odstępu na konto, jedno trwające wywołanie i budżety 6000 tokenów/minutę oraz 100 000/24 godziny. Budżet tokenów może zatrzymać kulę wcześniej niż liczba pytań.
- Przed wywołaniem baza atomowo rezerwuje próbę i 4096 tokenów. Po poprawnej odpowiedzi dostawcy zapisuje faktycznie zgłoszone zużycie. Przy braku wiarygodnych danych zachowuje pełną rezerwację. Próby nie są zwracane.
- Pytanie: maksymalnie 180 znaków, małe ciało żądania HTTP. Odpowiedź modelu: najwyżej 768 tokenów, razem z ewentualnym rozumowaniem. Brak narzędzi, wyszukiwania, agentów, uploadów czy automatycznych ponowień.
- Klucz i wybór dostawcy pozostają na serwerze. Endpoint sprawdza sesję i aktywnego gracza, baza ponownie sprawdza uprawnienia. RPC i liczniki są niedostępne dla zwykłego klienta Supabase. Identyfikator próby zapobiega powtórnemu wykonaniu tego samego żądania.
- Odpowiedź 429 blokuje kulę według nagłówków dostawcy; jeśli nie wiadomo, który limit się wyczerpał i kiedy się odnowi, przyjmujemy dobę przerwy. Inne błędy również uruchamiają przerwę. Awaria funkcji pomiędzy rezerwacją a zapisaniem wyniku pozostawia blokadę do wygaśnięcia rezerwacji po 24 godzinach.
- **Wyłącz kulę** blokuje nowe próby. Trwające żądanie może jeszcze zakończyć się odpowiedzią. Przełączenie trybu/modelu nie zeruje limitów ani blokad. Awaryjnie ustaw `ORACLE_ENABLED=false` i wykonaj redeploy.

Przycisk na stronie głównej pojawia się dopiero po potwierdzeniu dostępności. Znosi go wyczerpanie limitu, brak konfiguracji lub błąd sprawdzania statusu. Otwarte okno zachowuje odebraną odpowiedź, ale blokuje wysłanie kolejnego pytania. Supabase Realtime powiadamia otwarte karty o zmianie dostępności; awaryjnie sprawdzamy status raz na minutę, przy powrocie do karty i o podanej godzinie ponownego sprawdzenia. To odczyt bazy, **bez wywołania modelu**. Chwilowo nieaktualny przycisk nie omija sprawdzenia na serwerze.

[Limity Groq są wspólne dla organizacji i mogą się zmieniać](https://console.groq.com/docs/rate-limits). Najlepiej nie używać tej samej organizacji Free do innych eksperymentów AI. Nawet inny klucz może zużywać wspólny limit. Brak płatnego fallbacku nie chroni reszty strony przed wyczerpaniem wspólnych zasobów Vercela/Supabase przy dużym ruchu.

## Weryfikacja techniczna

`npm test`, `npx tsc --noEmit`, `npm run lint`.

Testy bazy uruchamiają prawdziwy silnik PostgreSQL w PGlite, bez połączenia z produkcją. Ustaw `ORACLE_PGLITE_PATH` na zainstalowany poza repozytorium pakiet `@electric-sql/pglite`, następnie uruchom `node --test tests/oracle-database.test.cjs`. Bez tej zmiennej test jest jawnie pomijany. Testy API używają atrap odpowiedzi — nie potrzebują klucza i nie zużywają limitu Groq.

Test przeglądarki: ustaw `ORACLE_PLAYWRIGHT_PATH` na lokalny `playwright-core` i `ORACLE_CHROME_PATH` na Chrome; uruchom `node --test tests/oracle-browser.test.cjs`. Również działa wyłącznie na atrapach, z rzeczywistymi komponentami React.
