# Master+ i kary punktowe

## Wdrożenie

1. W Supabase SQL Editor uruchom `supabase/migrations/20261110_ranked_penalties.sql`. Wymaga wdrożonej wcześniej migracji premii za trafienia (`persist_ranked_replay_with_hit_rewards`).
2. Wdróż kod aplikacji. Migracja powinna poprzedzać wdrożenie; w czasie pomiędzy nimi nie zapisuj nowych wyników.
3. Po wdrożeniu kliknij globalne „Przelicz MMR ranked”, aby przeliczyć wszystkich graczy i historię wykresów od początku z karą −6 PP. Jeśli migracja kar była już wykonana, ta korekta nie wymaga kolejnej migracji SQL — wystarczy nowy kod i przeliczenie.

## Przegrane

Wszystkie zwykłe przegrane z PP kosztują 6 PP, również historyczne. Przeliczanie odtwarza pełną historię według tej zasady, bez daty granicznej. Pole `ranked_prestige_loss_points` utworzone w pierwszej wersji migracji nie jest już odczytywane ani używane do naliczania punktów; stare wartości 9 nie wpływają na wynik. Pozostaje w bazie dla zgodności, bez potrzeby usuwania danych.

Dotyczy to zwykłych przegranych z PP. Gdy PP jest mniej niż stawka, spadają do zera; dotychczasowa ochrona MMR w tym kroku pozostaje. Przy zerowych PP przegrana nadal odejmuje 0,3 MMR. Punktacja 1v1, zyski i serie pozostają bez zmian.

## Kara admina

Menu gracza w głównym panelu admina → „Kara punktowa”. Tylko główny admin może wpisać 1–100 punktów i uzasadnienie. 1 punkt oznacza 1 PP albo 0,1 MMR. Najpierw zużywane są PP, pozostała część kary obniża MMR, do minimum 0. Nie ma mnożnika za porażkę, odznaki ani zmiany serii. Podgląd w formularzu korzysta z aktualnie załadowanego wyniku gracza; zapis odtwarza najnowszy ranking.

Kara jest trwałym zdarzeniem w `player_ranked_penalties`, nie ręcznym ustawieniem salda. Odtwarzana jest w dacie nadania, po premiach przy tym samym czasie, przed ręcznym ustawieniem MMR. Wykres pokazuje osobny punkt „Kara punktowa” i rzeczywiście odjęte MMR/PP. Uzasadnienie i autor zostają w rejestrze administracyjnym, bez publicznej odznaki. Nawet u gracza bez rozegranych meczów obniżone MMR jest widoczne; sama kara nie odblokowuje rangi.

Serwer utrwala stan bazowy przed nadaniem kary. UUID żądania zapewnia bezpieczne ponowienie po błędzie sieci/przeliczania; inna treść pod tym samym UUID jest odrzucana. Nadanie kary unieważnia przeliczenia ze starszą rewizją. Nowy RPC zapisuje ranking, historię kar i premie za trafienia w jednej transakcji, bez duplikatów. Dostęp do rejestru i funkcji nadawania mają wyłącznie uprawnienia backendu, a funkcja dodatkowo sprawdza rolę głównego admina.
