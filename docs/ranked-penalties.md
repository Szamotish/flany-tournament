# Master+ i kary punktowe

## Wdrożenie

1. W Supabase SQL Editor uruchom `supabase/migrations/20261110_ranked_penalties.sql`. Wymaga wdrożonej wcześniej migracji premii za trafienia (`persist_ranked_replay_with_hit_rewards`).
2. Wdróż kod aplikacji. Migracja powinna poprzedzać wdrożenie; w czasie pomiędzy nimi nie zapisuj nowych wyników.
3. Nie trzeba przeliczać dawnych wyników: ich zasady pozostają takie same. Późniejsze „Przelicz MMR ranked” zachowa stare stawki i odtworzy kary.

## Przegrane

Zakończone mecze dostają w migracji zapamiętaną stawkę 9 PP. Pierwszy zapis zakończenia kolejnego meczu zapisuje stawkę 6 PP. Stawka jest niezmienna przy poprawkach, cofnięciu wyniku i ponownym rozegraniu tego samego wpisu meczu. Powtórzenie migracji również jej nie zmienia. Liczy się pierwszy zapis wyniku, nie edytowalny termin turnieju: zaległy mecz wpisany po wdrożeniu otrzymuje nową stawkę.

Dotyczy to zwykłych przegranych z PP. Gdy PP jest mniej niż stawka, spadają do zera; dotychczasowa ochrona MMR w tym kroku pozostaje. Przy zerowych PP przegrana nadal odejmuje 0,3 MMR. Punktacja 1v1, zyski i serie pozostają bez zmian.

## Kara admina

Menu gracza w głównym panelu admina → „Kara punktowa”. Tylko główny admin może wpisać 1–100 punktów i uzasadnienie. 1 punkt oznacza 1 PP albo 0,1 MMR. Najpierw zużywane są PP, pozostała część kary obniża MMR, do minimum 0. Nie ma mnożnika za porażkę, odznaki ani zmiany serii. Podgląd w formularzu korzysta z aktualnie załadowanego wyniku gracza; zapis odtwarza najnowszy ranking.

Kara jest trwałym zdarzeniem w `player_ranked_penalties`, nie ręcznym ustawieniem salda. Odtwarzana jest w dacie nadania, po premiach przy tym samym czasie, przed ręcznym ustawieniem MMR. Wykres pokazuje osobny punkt „Kara punktowa” i rzeczywiście odjęte MMR/PP. Uzasadnienie i autor zostają w rejestrze administracyjnym, bez publicznej odznaki. Nawet u gracza bez rozegranych meczów obniżone MMR jest widoczne; sama kara nie odblokowuje rangi.

Serwer utrwala stan bazowy przed nadaniem kary. UUID żądania zapewnia bezpieczne ponowienie po błędzie sieci/przeliczania; inna treść pod tym samym UUID jest odrzucana. Nadanie kary unieważnia przeliczenia ze starszą rewizją. Nowy RPC zapisuje ranking, historię kar i premie za trafienia w jednej transakcji, bez duplikatów. Dostęp do rejestru i funkcji nadawania mają wyłącznie uprawnienia backendu, a funkcja dodatkowo sprawdza rolę głównego admina.
