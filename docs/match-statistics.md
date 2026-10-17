# Prezentacja statystyk z notatnika

## Wdrożenie

Uruchom w Supabase SQL Editor `supabase/migrations/20261017_stats_view.sql`, a następnie wdróż kod. Migracja dodaje wyłącznie `players.stats_view` (`last`, `recent`, `all`). Nie zmienia istniejących wpisów notatnika. Do samego odczytu statystyk wystarcza już istniejąca tabela `match_notebooks`; migracja jest potrzebna do zapisania domyślnego widoku profilu.

## Zasady obliczeń

- Statystyki obejmują zakończone mecze rankingowe, w tym 1v1. BO3/BO5 liczy się jako jeden mecz, a gry mają osobne wpisy. Gry powyżej sumy wyniku meczu są pomijane.
- Datą jest `event_at`, z zastępstwem `started_at` i `created_at`. Wpisanie starego turnieju dzisiaj nie przesuwa go na początek historii.
- Ostatni mecz i ostatnie 10 meczów dotyczą faktycznie rozegranych meczów zawodnika, także tych bez notatek. Nie zastępujemy ich starszymi meczami z wpisami. Średnie liczymy tylko z zapisanych danych, pokazując pokrycie meczów i gier. Pusta rubryka zawodnika nie oznacza zerowego występu.
- Liczniki średnie są sumą podzieloną przez liczbę meczów z wpisami danego gracza. Celność to suma trafień środka / suma rzutów, a nie średnia procentów. Trafienia karne są podzbiorem wszystkich trafień; próby bonusowe wliczają się do rzutów.
- Tempo picia to średni numer trafienia drużyny, przy którym ukończono piwo, z podaniem liczby zapisanych ukończeń. Brak zaznaczenia nie oznacza zera ani nieukończenia.
- Dotychczasowy licznik „Wypite piwa” zachowuje dotychczasowe naliczanie i występuje jako „Wypite piwa · łącznie” w każdym widoku. Pozostałe liczby dotyczą wybranego zakresu rankingowego. Lista marek pokazuje piwo przypisane do zapisanej gry, nie deklaruje jego ukończenia.

## Widoki

Strona główna zachowuje Best Performance. Kolejne slajdy wyróżniają celność (minimum 5 prób), średnie tempo picia, trafienia środka, puszki przeciwnika, oszustwa i celne karne. Remisy zachowują wszystkich współliderów. Karne pojawiają się dopiero po zapisaniu trafienia; kategorie bez wyniku są pomijane. Okno obejmuje 10 ostatnich zakończonych turniejów rankingowych całej ligi. Przy małej próbce zawsze podawana jest jej wielkość.

Slajdy zmieniają się co 8 sekund. Przy interakcji i aktywnym fokusie są wstrzymywane, a po ręcznej zmianie czekają na „Wznów”. Ustawienie ograniczonego ruchu wyłącza automatyczne przełączanie. Są strzałki, wybór slajdu i przesuwanie palcem.

Profil wykorzystuje dotychczasowy kafelek piw. Domyślny zakres zapisuje właściciel profilu lub main admin. Każdy odwiedzający może zmienić widok bez zapisywania preferencji właściciela.

Turniej pokazuje wyróżnienia, a strona meczów rozwijane podsumowania wszystkich zakończonych meczów oraz wpisy poszczególnych gier i marki piw.

## Prywatność i kula

Prywatne turnieje wliczają się do profili i wyróżnień wyłącznie zbiorczo. Dane wysyłane do komponentów profilu i strony głównej nie zawierają identyfikatorów prywatnych meczów/turniejów, nazw, dat ani składów. Szczegółowy endpoint turnieju sprawdza dostęp main admina, lokalnego admina, uczestnika lub zaproszonego gracza przed odczytaniem statystyk; odpowiedzi mają `private, no-store`.

Kula korzysta z tych samych obliczeń. Dostaje ograniczony zestaw faktów o pytającym, wskazanych graczach lub liderach, bez surowych notatek i szczegółów prywatnych turniejów. Fakty są pakowane do istniejącego budżetu promptu; limity Groq i tokenów nie są zwiększane. Niedostępność notatników nie wyłącza pozostałego kontekstu kuli.

Odczyt ligi jest współdzielony i buforowany przez maksymalnie 60 sekund na instancji serwera. Wpisy, korekty i cofnięcie wyniku odświeżają statystyki po wygaśnięciu bufora. Błędy odczytu nie są zastępowane zerowymi wynikami.

## Sprawdzenie

`npm run check`; dodatkowe testy przeglądarki: `PROFILE_PLAYWRIGHT_PATH`, `PROFILE_CHROME_PATH`. Test nowej migracji: `NOTEBOOK_PGLITE_PATH`. Wszystkie testy używają fikcyjnych danych lub lokalnej bazy, bez zapytań do produkcji i bez wywołań modeli AI.
