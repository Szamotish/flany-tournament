# Premia za trafienia

## Uruchomienie

1. Wykonaj w Supabase SQL Editor plik `supabase/migrations/20261106_hit_rewards.sql`. Korzysta z już działającej funkcji `persist_ranked_replay`, tabeli rewizji rankingu i notatników. Migracja jest powtarzalna i sama nie przelicza punktów.
2. Wdróż kod aplikacji.
3. W głównym panelu admina kliknij **Przelicz MMR ranked**. Uwzględni to także wcześniej zapisane statystyki. Dalej przeliczanie następuje po zapisie notatnika zakończonego meczu, zgłoszeniu lub korekcie wyniku, resecie/usunięciu turnieju oraz edycji terminu rozpoczętego turnieju rankingowego.

Nie wdrażaj samego kodu przed migracją: nowy zapis rankingu wymaga funkcji i tabeli premii. Migracja nie potrzebuje nowego klucza ani zmiennych środowiskowych.

## Zasady

- Trzy trafienia w puli dają jeden punkt premii: +0,1 MMR, a po osiągnięciu 10 MMR +1 PP.
- Do puli liczą się trafienia środka (w tym celne karne) i puszki przeciwnika. Puszka przeciwnika i następnie celny karny dają dwa trafienia. Karnych nie dodajemy ponownie do liczby trafień środka.
- Z jednej pojedynczej gry liczą się maksymalnie trzy trafienia łącznie. Gry 1–3 w BO3 i 1–5 w BO5 mają niezależne limity; dodatkowe trafienia powyżej limitu nie przechodzą do puli. Surowe statystyki nadal pokazują wszystkie trafienia.
- Reszta 0–2 trafień przechodzi między grami, meczami i turniejami. Punkt przypisujemy grze, w której dopełniono trójkę. Okno „ostatni mecz” lub „10 meczów” sumuje przypisane punkty, a nie liczy puli od nowa dla tego okna.
- Uwzględniamy rozegrane gry zakończonych meczów rankingowych, także prywatnych i 1v1, niezależnie od wygranej. Mecze oczekujące, BYE, gry poza zapisanym wynikiem i turnieje towarzyskie nie dają premii.
- Kolejność puli: termin turnieju, numer danego dnia, turniej, runda/mecz, numer gry. Późniejsze dopisanie albo korekta danych przebudowuje całą pulę i przypisania punktów.
- Premie naliczamy osobno od serii wygranych/przegranych: nie zmieniają serii, nie korzystają z mnożników ani nie odblokowują kolejnych 1v1.

## Prezentacja i zapis

W panelu rankingowym jest licznik „Trafienia do premii: 0/3”. Panel statystyk pokazuje sumę „Punkty za trafienia” dla aktualnego widoku. Jeden punkt oznacza 0,1 MMR lub 1 PP, również gdy gracz jest poniżej Mastera. Na wykresie zbiorcza premia za trafienia jest osobnym punktem bezpośrednio po danym turnieju. Kula otrzymuje sumę punktów w danych statystycznych. Prywatne turnieje nie ujawniają dodatkowych nazw ani linków w zbiorczych statystykach.

`player_hit_rewards` przechowuje przyznane punkty i liczone trafienia per gracz/mecz/gra. Odczyt i zapis dostępne są tylko dla backendu. `ranked_hit_remainder` jest zapisywane razem z rankingiem. Nowa funkcja transakcyjna rozszerza istniejący zapis rankingu, zachowując premię za performance, ręczne zmiany i dotychczasowe serie. Zmiana notatnika lub terminu unieważnia równoległe przeliczenie; zapis ze starą rewizją jest ponawiany. Nie dopisujemy premii przy każdym kliknięciu — odbudowujemy ich komplet.

Jeżeli notatnik zapisze się, a przeliczenie zawiedzie, klient informuje o tym i ponawia identyczny zapis. Kopia robocza pozostaje do czasu potwierdzenia rankingu, także po ponownym otwarciu. Ręczne **Przelicz MMR ranked** pozwala również wznowić przerwane przeliczenie po zamknięciu aplikacji. Statystyki są buforowane do minuty; udane przeliczenie unieważnia bufor obsługującego je procesu.

Testy bazy korzystają wyłącznie z lokalnego PostgreSQL/WASM: ustaw `HIT_REWARDS_PGLITE_PATH` na pakiet `@electric-sql/pglite` i uruchom `node --test tests/hit-rewards-database.test.cjs`.
