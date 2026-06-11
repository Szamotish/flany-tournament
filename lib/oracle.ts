export type OracleContext = {
  playerNames: string[];
  beerNames: string[];
  beerOfDay?: string | null;
  now?: Date;
};

type OracleCategory =
  | "blocked"
  | "best_player"
  | "best_beer"
  | "drink"
  | "flany"
  | "food"
  | "time"
  | "work"
  | "weather"
  | "money"
  | "love"
  | "place"
  | "amount"
  | "decision"
  | "default";

const BLOCKED_PHRASES = [
  "zle sie czuje",
  "chor",
  "lekarz",
  "szpital",
  "boli",
  "depres",
  "samopoczuc",
  "problem",
  "problemy",
  "nie chce mi sie zyc",
];

const DRINK_WORDS = [
  "piw",
  "browar",
  "browca",
  "alko",
  "alkohol",
  "wodk",
  "whisky",
  "rum",
  "wino",
  "drink",
  "napic",
  "pic",
  "pije",
  "picia",
  "najeb",
  "trzez",
];

const FLANY_WORDS = ["flan", "flany", "flanki", "puszka", "zagrac", "grac", "gramy", "gra"];
const FOOD_WORDS = ["jesc", "jedzenie", "zjesc", "glod", "pizza", "kebab", "obiad", "kolacja", "szama", "zarcie"];
const WORK_WORDS = ["praca", "roboty", "robota", "szkola", "studia", "uczyc", "nauka", "egzamin", "kolokwium"];
const WEATHER_WORDS = ["pogoda", "deszcz", "pada", "slonce", "zimno", "cieplo", "wiatr"];
const MONEY_WORDS = ["kupic", "kasa", "pieniadz", "hajs", "wydac", "oplaca", "skladka"];
const LOVE_WORDS = ["dziewczyn", "chlopak", "randka", "koch", "milosc", "odpisac", "zwiazek"];
const PLACE_WORDS = ["gdzie", "dokad", "miejsce", "lokalizacja"];
const AMOUNT_WORDS = ["ile", "duzo", "malo", "wiecej", "mniej"];
const DECISION_WORDS = ["czy", "mam", "powinien", "warto", "wybrac", "robic", "zrobic"];

const TIME_PHRASES = [
  "jaki dzien",
  "ktory dzien",
  "jaki mamy dzien",
  "co dzis za dzien",
  "co dzisiaj za dzien",
  "jaka data",
  "ktora godzina",
  "jaki weekend",
];

const DRINK_ANSWERS = [
  "Zimne piwko.",
  "Piwko. Proste.",
  "Browar i flany.",
  "Puszka na start.",
  "Najpierw piwko.",
  "Pij i celuj.",
  "Jedno na odwage.",
  "Kula wybiera piwo.",
];

const FLANY_ANSWERS = [
  "Gramy we flany.",
  "Puszka na srodek.",
  "Flany. Bez gadania.",
  "Jedna rundka minimum.",
  "Ustaw puszke.",
  "Czas na flany.",
  "Rzucaj pierwszy.",
  "Piwko i flany.",
];

const DEFAULT_ANSWERS = [
  "Piwko i flany.",
  "Flany to plan.",
  "Kula wybiera piwko.",
  "Ustaw puszke.",
  "Najpierw piwko.",
  "To brzmi jak flany.",
  "Zagraj jedna gre.",
  "Piwko pomoze.",
];

const FOOD_ANSWERS = [
  "Najedz sie i graj.",
  "Szama przed flanami.",
  "Pelny brzuch, pewna reka.",
  "Zjedz, potem puszka.",
  "Kebab i flany.",
  "Obiad, potem browar.",
];

const WORK_ANSWERS = [
  "Po pracy flany.",
  "Robota poczeka.",
  "Studia, potem piwko.",
  "Najpierw zalicz, potem flany.",
  "Kula wybiera przerwe.",
  "Piwko po obowiazkach.",
];

const WEATHER_ANSWERS = [
  "Pod dachem tez sie gra.",
  "Pogoda nie rzuca.",
  "Deszcz? Graj w srodku.",
  "Slonce sprzyja puszce.",
  "Wiatr tylko testuje.",
  "Piwko pasuje zawsze.",
];

const MONEY_ANSWERS = [
  "Kup piwko.",
  "Hajs na browar.",
  "Oplaca sie na flany.",
  "Jedno piwo nie zbankrutuje.",
  "Kula inwestuje w puszke.",
];

const LOVE_ANSWERS = [
  "Odpisz po rundzie.",
  "Randka na flanach.",
  "Piwko doda odwagi.",
  "Najpierw puszka.",
  "Kula nie swata.",
];

const PLACE_ANSWERS = [
  "Tam, gdzie jest puszka.",
  "Na srodku boiska.",
  "Blisko lodowki.",
  "Tam, gdzie sa flany.",
  "Pod dachem i gramy.",
];

const AMOUNT_ANSWERS = [
  "Jedno to rozgrzewka.",
  "Tyle, zeby trafic.",
  "Minimum jedna runda.",
  "Dwa brzmi uczciwie.",
  "Nie licz, graj.",
];

const DECISION_ANSWERS = [
  "Tak, ale z piwkiem.",
  "Tak. I flany.",
  "Kula mowi: graj.",
  "Wybierz puszke.",
  "Nie komplikuj. Flany.",
  "Tak, po browarze.",
];

const TIME_SUFFIXES = [
  "idealny dzien na piwko.",
  "idealny dzien na flany.",
  "dobry dzien na puszke.",
  "dobry dzien na browar.",
  "flany pasuja idealnie.",
];

const DAY_LABELS = ["niedziela", "poniedzialek", "wtorek", "sroda", "czwartek", "piatek", "sobota"];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(normalize(word)));
}

function hasSpecificTimeQuestion(value: string): boolean {
  return TIME_PHRASES.some((phrase) => value.includes(normalize(phrase)));
}

function pick<T>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;
  return values[Math.floor(Math.random() * values.length)] ?? fallback;
}

function classify(question: string): OracleCategory {
  const normalized = normalize(question);
  if (!normalized) return "default";

  if (includesAny(normalized, BLOCKED_PHRASES)) return "blocked";

  const asksBest = normalized.includes("najlepsz") || normalized.includes("najlepszy") || normalized.includes("top");
  if (asksBest && (normalized.includes("gracz") || normalized.includes("zawodnik"))) return "best_player";
  if (asksBest && (normalized.includes("piw") || normalized.includes("browar"))) return "best_beer";

  if (includesAny(normalized, FOOD_WORDS)) return "food";
  if (includesAny(normalized, DRINK_WORDS)) return "drink";
  if (includesAny(normalized, FLANY_WORDS)) return "flany";
  if (hasSpecificTimeQuestion(normalized)) return "time";
  if (includesAny(normalized, WEATHER_WORDS)) return "weather";
  if (includesAny(normalized, WORK_WORDS)) return "work";
  if (includesAny(normalized, MONEY_WORDS)) return "money";
  if (includesAny(normalized, LOVE_WORDS)) return "love";
  if (includesAny(normalized, PLACE_WORDS)) return "place";
  if (includesAny(normalized, AMOUNT_WORDS)) return "amount";
  if (includesAny(normalized, DECISION_WORDS)) return "decision";

  return "default";
}

export function answerOracle(question: string, context: OracleContext): string {
  const category = classify(question);
  const now = context.now ?? new Date();

  if (category === "blocked") return "Relax";

  if (category === "best_player") {
    const player = pick(context.playerNames, "ten z puszka");
    return `Dzisiaj ${player}.`;
  }

  if (category === "best_beer") {
    const beerPool = context.beerOfDay ? [context.beerOfDay, ...context.beerNames] : context.beerNames;
    const beer = pick(beerPool, "zimne");
    return `${beer}. Bez pytan.`;
  }

  if (category === "drink") return pick(DRINK_ANSWERS, DRINK_ANSWERS[0]);
  if (category === "flany") return pick(FLANY_ANSWERS, FLANY_ANSWERS[0]);
  if (category === "food") return pick(FOOD_ANSWERS, FOOD_ANSWERS[0]);
  if (category === "work") return pick(WORK_ANSWERS, WORK_ANSWERS[0]);
  if (category === "weather") return pick(WEATHER_ANSWERS, WEATHER_ANSWERS[0]);
  if (category === "money") return pick(MONEY_ANSWERS, MONEY_ANSWERS[0]);
  if (category === "love") return pick(LOVE_ANSWERS, LOVE_ANSWERS[0]);
  if (category === "place") return pick(PLACE_ANSWERS, PLACE_ANSWERS[0]);
  if (category === "amount") return pick(AMOUNT_ANSWERS, AMOUNT_ANSWERS[0]);
  if (category === "decision") return pick(DECISION_ANSWERS, DECISION_ANSWERS[0]);

  if (category === "time") {
    const day = DAY_LABELS[now.getDay()] ?? "dzisiaj";
    return `${day}: ${pick(TIME_SUFFIXES, TIME_SUFFIXES[0])}`;
  }

  return pick(DEFAULT_ANSWERS, DEFAULT_ANSWERS[0]);
}
