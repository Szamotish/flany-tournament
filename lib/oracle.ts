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
  | "food"
  | "time"
  | "party"
  | "default";

const PARTY_WORDS = [
  "flan",
  "flany",
  "flanki",
  "piw",
  "browar",
  "browca",
  "alko",
  "alkohol",
  "wodk",
  "wódk",
  "whisky",
  "rum",
  "wino",
  "drinka",
  "drink",
  "najeb",
  "napic",
  "napić",
  "picie",
  "imprez",
  "balet",
  "melanz",
  "melanż",
];

const BLOCKED_WORDS = [
  "zle sie czuje",
  "źle się czuję",
  "zle się czuje",
  "źle sie czuję",
  "chor",
  "lekarz",
  "lek",
  "szpital",
  "boli",
  "depres",
  "samopoczuc",
  "problem",
  "problemy",
  "nie chce mi sie zyc",
  "nie chce mi się żyć",
];

const FOOD_WORDS = ["jesc", "jeść", "jedzenie", "zjesc", "zjeść", "glod", "głód", "pizza", "kebab", "obiad", "kolacja"];
const TIME_WORDS = ["jaki dzien", "jaki dzień", "ktory dzien", "który dzień", "dzisiaj", "jutro", "data", "godzina", "weekend"];

const VERDICTS = [
  "Kula nie ma watpliwosci:",
  "Wyrocznia przemowila:",
  "Po konsultacji z piana wychodzi:",
  "Znaki na puszce mowia:",
  "Odpowiedz z dna kufla jest prosta:",
  "Kula zakrecila sie i wskazuje:",
];

const PARTY_ANSWERS = [
  "tak, oczywiscie. Piwko i flany to jest plan, a nie pytanie.",
  "tak. Jedna szybka rundka brzmi jak minimum przyzwoitosci.",
  "oczywiscie, ze tak. Ktos musi pilnowac poziomu ligi.",
  "tak, ale kula sugeruje zaczac od zimnego piwka.",
  "brzmi jak legalny pretekst do odpalenia flanek.",
  "tak. Nie ma sensu walczyc z przeznaczeniem.",
];

const DEFAULT_ANSWERS = [
  "mysle, ze musisz napic sie piwka i zagrac we flany.",
  "odpowiedz jest niejasna, ale piwko wyraznie poprawia czytelnosc sytuacji.",
  "zamiast to analizowac, lepiej ustawic puszke i zagrac jedna gre.",
  "kula widzi chaos. Flany moga go ladnie uporzadkowac.",
  "to brzmi jak temat do omowienia przy piwku, nie na sucho.",
  "najpierw flany, potem filozofia.",
];

const FOOD_ANSWERS = [
  "najedz sie porzadnie, bo na pustym baku gorzej sie celuje w puszke.",
  "zjedz cos konkretnego. Potem flany beda wchodzily duzo lepiej.",
  "kula poleca jedzenie przed gra. Stabilna reka zaczyna sie od pelnego brzucha.",
  "najpierw szama, potem puszka na srodek i mozna grac.",
];

const TIME_SUFFIXES = [
  "idealny moment na piwko i flany.",
  "statystycznie bardzo dobry dzien na ustawienie puszki.",
  "kula twierdzi, ze kalendarz sprzyja flanom.",
  "czyli dzien jak kazdy: mozna zagrac.",
];

const ENDINGS = [
  "Nie kloc sie z kula.",
  "Tak zostalo zapisane w regulaminie wszechswiata.",
  "Kula bierze za to pelna nieodpowiedzialnosc.",
  "Interpretacja jest ostateczna do nastepnego potrzasniecia.",
  "Mozna dyskutowac, ale po co.",
];

const DAY_LABELS = ["niedziela", "poniedzialek", "wtorek", "sroda", "czwartek", "piatek", "sobota"];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(normalize(word)));
}

function pick<T>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;
  return values[Math.floor(Math.random() * values.length)] ?? fallback;
}

function classify(question: string): OracleCategory {
  const normalized = normalize(question);
  if (!normalized) return "default";
  if (includesAny(normalized, BLOCKED_WORDS)) return "blocked";
  if (normalized.includes("najlepsz") && normalized.includes("gracz")) return "best_player";
  if (normalized.includes("najlepsz") && (normalized.includes("piw") || normalized.includes("browar"))) return "best_beer";
  if (includesAny(normalized, FOOD_WORDS)) return "food";
  if (includesAny(normalized, TIME_WORDS)) return "time";
  if (includesAny(normalized, PARTY_WORDS)) return "party";
  return "default";
}

function withFrame(answer: string): string {
  return `${pick(VERDICTS, "Kula mowi:")} ${answer} ${pick(ENDINGS, "")}`.trim();
}

export function answerOracle(question: string, context: OracleContext): string {
  const category = classify(question);
  const now = context.now ?? new Date();

  if (category === "blocked") return "Relax";

  if (category === "best_player") {
    const player = pick(context.playerNames, "ten, kto akurat trzyma puszke najpewniej");
    return withFrame(`najlepszym graczem jest dzisiaj ${player}. Jutro kula moze udawac, ze tego nie mowila.`);
  }

  if (category === "best_beer") {
    const beerPool = context.beerOfDay ? [context.beerOfDay, ...context.beerNames] : context.beerNames;
    const beer = pick(beerPool, "zimne");
    return withFrame(`najlepsze piwo to ${beer}. Reszta to juz tylko tlo fabularne.`);
  }

  if (category === "food") {
    return withFrame(pick(FOOD_ANSWERS, FOOD_ANSWERS[0]));
  }

  if (category === "time") {
    const day = DAY_LABELS[now.getDay()] ?? "dzisiaj";
    return withFrame(`${day} to ${pick(TIME_SUFFIXES, TIME_SUFFIXES[0])}`);
  }

  if (category === "party") {
    return withFrame(pick(PARTY_ANSWERS, PARTY_ANSWERS[0]));
  }

  return withFrame(pick(DEFAULT_ANSWERS, DEFAULT_ANSWERS[0]));
}
