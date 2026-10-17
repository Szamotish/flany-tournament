# Notatnik lokalnego admina

## Uruchomienie

W Supabase SQL Editor wykonaj `supabase/migrations/20261017_match_notebooks.sql`, następnie wdróż aplikację. Migracja dodaje jedną tabelę; nie zmienia rankingu, wyników ani istniejących graczy. Można wykonać ją ponownie.

Wejście: turniej → lokalny admin → **Notatnik** lub **Admin mecze → Notatnik meczu**. Dostęp ma main admin i administrator przypisany do konkretnego turnieju. Notatniki prywatnych turniejów nie są dostępne publicznie. W tej wersji nie ma publicznych rankingów tych statystyk.

## Wpisy

- Wybierz mecz i pojedynczą grę w BO1/BO3/BO5. Każda gra ma osobne wpisy, liczniki trafień i ukończenia piwa.
- Każda rotacja ma osobne rzuty zawodników. Następna rotacja zachowuje historię; można wrócić do poprzedniej.
- Trafienie puszki przeciwnika otwiera kolejny rzut tego samego gracza w tej samej rotacji. Kolejne takie trafienie również daje bonus. Limit techniczny: 10 rzutów na gracza i rotację, 100 rotacji na grę.
- Trafienie środka i puszki przeciwnika automatycznie oznacza wykonanie rzutu. Puste pola nie dodają rzutów do statystyk.
- Celny rzut bonusowy zwiększa **łączną liczbę rzutów i trafień**, a dodatkowo jest wyliczany jako celny rzut karny. `playerNotebookTotals` udostępnia `penaltyHits` do przyszłej prezentacji. Nie dodawaj tej wartości ponownie do `hits`.
- Trafienia środkowej puszki numerowane są od początku gry, osobno dla obu drużyn. Licznik uwzględnia trafienia z rzutów bonusowych, ale nie trafienia puszki przeciwnika.
- Ukończenie piwa wskazuje konkretne trafienie drużyny, a nie czas. Po korekcie kolejności numer zmieni się wraz z tym trafieniem. Można zmienić przypisanie w polu zawodnika. Usunięcie wskazanego trafienia czyści przypisanie po potwierdzeniu.
- Marka piwa (domyślnie nieznana) i ukończenie dotyczą całej gry; oszustwa liczone są osobno w każdej rotacji.

## Zapis i korekty

Zmiany są przechowywane w localStorage urządzenia i wysyłane po krótkiej przerwie w edycji. Przy utracie połączenia aplikacja ponawia zapis; trzeba zaczekać na status **Zapisane**, zanim będzie można polegać na kopii serwerowej. Pierwsze otwarcie notatnika wymaga połączenia i sprawdzenia uprawnień. Nie jest to kompletna aplikacja offline.

Klucz kopii lokalnej zawiera identyfikator użytkownika, turnieju, meczu i gry. Nie zawiera tokenów sesji. Przy wyłączonym localStorage aplikacja pokazuje ostrzeżenie. Eksport JSON służy jako kopia bezpieczeństwa; automatyczny import nie jest częścią tej wersji.

Zapis stosuje atomowe porównanie numeru rewizji. Konflikt z drugim administratorem lub kartą blokuje nadpisanie. Można pobrać lokalną kopię i wczytać najnowszą wersję serwerową. Nie ma automatycznego scalania sprzecznych wpisów.

Zmiana składu drużyn po zapisaniu notatnika blokuje dalszą edycję tej gry, zamiast przypisywać stare dane innym graczom. **Usunięcie meczu lub reset drabinki usuwa także jego notatniki** (klucz obcy `ON DELETE CASCADE`); przed resetem można wyeksportować potrzebne wpisy. Zwykła korekta wyniku meczu zachowuje notatnik.

## Testy

`npm run check` uruchamia testy logiki i API. Test przeglądarkowy wymaga `PROFILE_PLAYWRIGHT_PATH` i `PROFILE_CHROME_PATH`, a nowej migracji — `NOTEBOOK_PGLITE_PATH`, wskazującego pakiet `@electric-sql/pglite`. Test bazy tworzy lokalny schemat testowy i nie korzysta z produkcji.
