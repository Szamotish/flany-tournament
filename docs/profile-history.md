# Historia rankingu na profilu

Wykres przedstawia sumę faktycznie przyznanych zmian według dat rozegrania turniejów. Nie przelicza zasad rankingu, premii za serie ani wyników przeciwników. Zaległy wynik dopisany dzisiaj trafia na datę `event_at` (zastępczo `started_at`, `created_at`). Premie za performance i ręczne korekty pozostają przy dacie ich przyznania.

## Kolejność i wartości

- Najpierw odtwarzamy kolejność zapisanych stanów `player_mmr_history`: czas zapisu, mecz, wygrana turnieju, performance, ręczna korekta. Mecze o tym samym czasie używają kolejności rundy/meczu oraz identyfikatora meczu, tak jak `rankedReplay`. Losowe UUID wpisów nie ustalają kolejności meczu i premii turniejowej.
- Różnice między kolejnymi stanami dają faktycznie zastosowane zmiany MMR/PP. Dzięki temu zachowujemy obcięcie strat PP do zera, przejście przez próg 10 MMR i ręczne korekty. Nominalne `delta` nie jest równoznaczne z liczbą przyznanych lub odjętych PP.
- Wpisy meczów i premia za wygranie tego samego turnieju tworzą jeden punkt. Opis pokazuje łączną zmianę bez rozbicia w nawiasach. Numer publicznego turnieju jest linkiem do jego strony; prywatny turniej ma ogólną etykietę bez nazwy i linku.
- Zmiany sumujemy od stanu bazowego w kolejności dat turniejów. Nie przestawiamy starych sum punktów razem z datami. MMR i PP wyrażamy wspólnie w jednostkach 0,1 MMR / 1 PP; wartości ponad 10 MMR pokazujemy jako PP.
- Ostatni punkt musi zgadzać się z aktualnym stanem profilu. Brak zgodności lub niemożliwy ujemny bilans zgłasza błąd odczytu wykresu, zamiast dopisywać fikcyjną korektę. Jeżeli brakuje stanu bazowego, pierwszy znany zapis jest kotwicą i nie pokazujemy dla niego nieznanej zmiany.
- Filtrowanie dat i przybliżanie następują po zbudowaniu pełnej historii; nie zerują punktów na początku wybranego okresu.

To prezentacja zaksięgowanych zmian według dat wydarzeń, a nie symulacja alternatywnego naliczenia rankingu przy innej kolejności wprowadzania meczów. Nie modyfikuje tabel ani nie wymaga migracji SQL.

Premie `hit_bonus` mają osobny punkt po turnieju, z tą samą datą wydarzenia i opisem „Premia za trafienia”. W kolejności naliczania wypadają po meczach i premii turniejowej, przed premią performance przy tym samym czasie zapisu. Ich uruchomienie wymaga migracji opisanej w [hit-rewards.md](hit-rewards.md).
