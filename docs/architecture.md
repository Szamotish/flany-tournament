# Architektura i przegląd projektu

## Granice odpowiedzialności

Strony i Route Handlers w `app/` są punktami wejścia Next.js. Nie należy ich usuwać na podstawie braku importów. Endpointy administracyjne sprawdzają uprawnienia przez istniejące moduły `_auth`; ukrycie przycisku nie zastępuje autoryzacji serwerowej.

Funkcje obliczeniowe (m.in. `rankedReplay`, `rankedStreak`, `profileHistory`, `bestPerformance`) są oddzielone od odczytów Supabase. Moduły `*Server`, `supabaseServer` i `oracleServer` służą tylko do pracy na serwerze. Nie importuj ich do komponentów `use client` ani do ich zależności.

Przeliczenie rankingu zachowuje ręczne bonusy i bazę punktową. Wspólne liczniki serii pozostają w logice rankingu; grafiki jedynie odzwierciedlają wynik. Winstreak jest widoczny od 2 zwycięstw, bonus +0,1 od 4 i +0,2 od 7; wariant graficzny high zaczyna się od 7. Losestreak jest widoczny od 3 porażek, a wariant high od 6. Liczenie wygranych turniejów i przegranych meczów ma różne reguły — nie należy ich ujednolicać przy porządkach UI.

`StreakBadge` odpowiada za wspólny układ grafiki i licznika, a `WinstreakBadge`/`LosestreakBadge` za warunki widoczności i opisy. Własny CSS Module izoluje wygląd od globalnych stylów. Cztery grafiki mają te same proporcje 3:1 i pozostają bez rozciągania.

## Porządki z 11.10.2026

Przejrzano zależności modułów aplikacji, odwołania do zasobów, konfigurację, testy, typy i lint. Usunięto:

- nieużywany `RankFrameToggle`, zastąpiony przez `ProfileSettingsButton`, oraz jego CSS;
- nieużywane `parseRankedState` i alternatywny szablon resetu hasła; działający reset nadal obsługuje Supabase Auth;
- stare rysowane SVG i animacje plakietek serii, zastąpione nowymi grafikami;
- domyślne, nieużywane SVG szablonu Next/Vercela;
- identyczne kopie teł z głównego katalogu (porównano SHA-256); wersje używane przez aplikację pozostały w `public/`;
- nieużywany `data/app-settings.json`; ustawienia aplikacja odczytuje i zapisuje w tabeli `app_settings` w Supabase.

Scalono nazwy piw i pliki etykiet w `lib/beers.ts`, zachowując kolejność losowania i obsługę dotychczasowych nazw. Usunięto puste konfiguracje skalowania etykiet, które zawsze zwracały wartości domyślne. Dodano `npm run check` i kontrolę nieużywanych zmiennych/parametrów TypeScript.

## Pozostałe sprawy

- Brakuje wersjonowanych migracji SQL. Repozytorium nie wystarcza obecnie do odtworzenia bazy od zera; należy odzyskać oryginalne migracje lub przygotować zweryfikowany schemat bazowy. Zachowano testy migracji, ponieważ opisują potrzebne kontrakty.
- Największe komponenty admina, `AuthControls` i globalny arkusz CSS warto dzielić przy planowanym odświeżeniu UI. Masowa relokacja w tej zmianie utrudniałaby ocenę regresji bez poprawy zachowania aplikacji.
- Część grafik może być materiałem do przyszłych funkcji. Plików użytkownika o niejasnym przeznaczeniu nie usunięto; ścieżki grafik używane dynamicznie przez mapowania rang również zachowano.
- Opcjonalne testy przeglądarkowe wymagają Chrome i Playwright, a testy SQL również migracji i PGlite. Zwykłe `npm test` pokazuje te pominięcia; nie oznaczają one weryfikacji bazy.

Przegląd i testy nie są pełnym audytem bezpieczeństwa ani potwierdzeniem konfiguracji produkcyjnej. Porządki nie wykonują operacji na produkcyjnych danych ani nie zmieniają limitów kuli AI.
