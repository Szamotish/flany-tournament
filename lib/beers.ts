type MatchTeams = {
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
};

export type BeerOfTheDay = {
  name: string;
};

export const BEER_LIST: BeerOfTheDay[] = [
  { name: "Tatra" },
  { name: "\u017Bywiec" },
  { name: "Warka" },
  { name: "Lech" },
  { name: "\u0141om\u017Ca" },
  { name: "Tyskie" },
  { name: "Per\u0142a" },
  { name: "Okocim" },
  { name: "Harna\u015B" },
  { name: "Kasztelan" },
  { name: "Ksi\u0105\u017C\u0119ce" },
  { name: "Kr\u00F3lewskie" },
  { name: "Namys\u0142\u00F3w" },
  { name: "Desperados" },
  { name: "Heineken" },
  { name: "Carlsberg" },
  { name: "\u017Bubr" },
  { name: "D\u0119bowe" },
  { name: "Specjal" },
  { name: "EB" },
  { name: "Captain Jack" },
  { name: "Guinness" },
  { name: "Kozel" },
  { name: "Pilsner Urquell" },
  { name: "Budweiser" },
  { name: "Bud Light" },
  { name: "Beck\u2019s" },
  { name: "Paulaner" },
  { name: "Super Bock" },
  { name: "Perlenbacher" },
  { name: "Argus" },
  { name: "Kustosz" },
  { name: "Karpackie" },
  { name: "Romper" },
  { name: "Brok" },
];

export function beerOfTheDay(dayKey: string): BeerOfTheDay {
  let hash = 0;
  for (let i = 0; i < dayKey.length; i++) {
    hash = (hash * 33 + dayKey.charCodeAt(i)) >>> 0;
  }
  return BEER_LIST[hash % BEER_LIST.length];
}

export function isKnownBeerName(value: string): boolean {
  return BEER_LIST.some((beer) => beer.name === value);
}

export function computeBeersFromFinishedMatches(
  matches: MatchTeams[],
  teamSizeMap: Map<string, number>
): number {
  return matches.reduce((sum, m) => {
    if (m.status !== "finished") return sum;
    if (!m.team_a_id || !m.team_b_id) return sum;
    const aSize = teamSizeMap.get(m.team_a_id) ?? 0;
    const bSize = teamSizeMap.get(m.team_b_id) ?? 0;
    return sum + aSize + bSize;
  }, 0);
}
