import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "hr" | "en";

const LANG_KEY = "vozlinija-lang";

const copy = {
  hr: {
    searchPlaceholder: "Traži stanicu ili liniju…",
    searchLabel: "Pretraži stanice i linije",
    favoritesAria: "Omiljene stanice",
    favorites: "Omiljene",
    favoritesEmpty: "Nema omiljenih. Zvjezdica na rezultatu tražilice sprema stanicu.",
    tram: "Tramvaj",
    bus: "Autobus",
    trams: "Tramvaji",
    buses: "Autobusi",
    stops: "Stanice",
    lines: "Linije",
    line: "Linija",
    loadingLines: "učitavam linije…",
    noLinesToday: "nema linija danas",
    linesPrefix: "Linije",
    addFav: "Dodaj u omiljene",
    removeFav: "Makni iz omiljenih",
    close: "Zatvori",
    station: "Stanica",
    loadingArrivals: "Učitavanje dolazaka…",
    noVehiclesNote: (note: string) => `Danas nema vozila. Vozi ${note}.`,
    noVehicles: "Nema vozila prema ovoj stanici.",
    noHeadsign: "Smjer nije naveden",
    live: "uživo",
    plan: "plan",
    later: (n: number) => `kasniji ${n}min`,
    earlier: (n: number) => `raniji ${n}min`,
    now: "sada",
    more: (n: number) => `Još ${n}`,
    less: "Manje",
    helpTitle: "Kratke upute",
    help1: "Upiši stanicu ili broj linije.",
    help2: "Zvjezdica na rezultatu sprema stanicu u omiljene.",
    help3: "Siva linija trenutno ne vozi prema toj stanici.",
    help4: "Klik na stanicu otvara dolaske. Klik na dolazak vodi do vozila.",
    help5: "Klik na vozilo na karti pokazuje njegovu rutu.",
    themeLight: "Svijetli način",
    themeDark: "Tamni način",
    info: "Informacije",
    news: "Obavijesti",
    newsClose: "Zatvori obavijesti",
    newsError: "Došlo je do pogreške pri učitavanju obavijesti.",
    newsEmpty: "Nema pronađenih obavijesti.",
    newsTraffic: "ZET · Promet",
    newsApp: "Aplikacija",
    newsZet: "ZET · Obavijesti",
    filter: "Filtar",
    filterToggle: "Uključi/isključi filtar linija",
    filterTitle: "Filtar linija",
    loadingRoutes: "Učitavanje linija…",
    noRoutes: "Nema dostupnih linija.",
    reset: "Reset",
    stale: (d: string) => `Zadnji podaci: prije ${d}`,
    mapError:
      "Karta se ne može pokrenuti: WebGL2 nije dostupan. Pokušajte drugi preglednik ili uključite hardversko ubrzanje.",
    unofficialBox:
      "ZET uživo je neslužbena aplikacija, neovisna o ZET-u. Za službene informacije obratite se ZET-u (zet.hr).",
    pageTitle: "ZET uživo — položaji tramvaja i autobusa (neslužbeno)",
    langTitle: "English",
    feedbackTitle: "Povratna informacija",
    feedbackNote:
      "U aplikaciji ZET uživo povratne informacije nisu omogućene: poruke se ne šalju niti pohranjuju. Za prijavu problema otvorite pitanje na GitHubu.",
    feedbackPlaceholder: "Opis problema ili prijedlog…",
    send: "Pošalji",
    thanks: "Hvala na poruci!",
    networkError: "Mrežna pogreška. Pokušajte ponovno.",
  },
  en: {
    searchPlaceholder: "Search a stop or a line…",
    searchLabel: "Search stops and lines",
    favoritesAria: "Favourite stops",
    favorites: "Favourites",
    favoritesEmpty: "No favourites yet. Tap the star on a search result to save a stop.",
    tram: "Tram",
    bus: "Bus",
    trams: "Trams",
    buses: "Buses",
    stops: "Stops",
    lines: "Lines",
    line: "Line",
    loadingLines: "loading lines…",
    noLinesToday: "no lines today",
    linesPrefix: "Lines",
    addFav: "Add to favourites",
    removeFav: "Remove from favourites",
    close: "Close",
    station: "Stop",
    loadingArrivals: "Loading arrivals…",
    noVehiclesNote: (note: string) => `No vehicles today. Runs ${note}.`,
    noVehicles: "No vehicles towards this stop.",
    noHeadsign: "Destination not listed",
    live: "live",
    plan: "scheduled",
    later: (n: number) => `${n} min late`,
    earlier: (n: number) => `${n} min early`,
    now: "now",
    more: (n: number) => `${n} more`,
    less: "Less",
    helpTitle: "Quick guide",
    help1: "Type a stop name or a line number.",
    help2: "The star on a result saves that stop to favourites.",
    help3: "A grey line is not running to this stop right now.",
    help4: "Tap a stop for arrivals. Tap an arrival to find that vehicle.",
    help5: "Tap a vehicle on the map to see its route.",
    themeLight: "Light mode",
    themeDark: "Dark mode",
    info: "About",
    news: "Notices",
    newsClose: "Close notices",
    newsError: "The notices could not be loaded.",
    newsEmpty: "No notices found.",
    newsTraffic: "ZET · Traffic",
    newsApp: "App",
    newsZet: "ZET · Notices",
    filter: "Filter",
    filterToggle: "Turn the line filter on or off",
    filterTitle: "Line filter",
    loadingRoutes: "Loading lines…",
    noRoutes: "No lines available.",
    reset: "Reset",
    stale: (d: string) => `Last update: ${d} ago`,
    mapError:
      "The map cannot start: WebGL2 is not available. Try another browser or turn on hardware acceleration.",
    unofficialBox:
      "ZET uživo is an unofficial app, independent of ZET. For official information contact ZET (zet.hr).",
    pageTitle: "ZET uživo — live tram and bus positions (unofficial)",
    langTitle: "Hrvatski",
    feedbackTitle: "Feedback",
    feedbackNote:
      "Feedback is turned off in ZET uživo: messages are neither sent nor stored. To report a problem, open an issue on GitHub.",
    feedbackPlaceholder: "Describe a problem or a suggestion…",
    send: "Send",
    thanks: "Thanks for the message!",
    networkError: "Network error. Please try again.",
  },
} as const;

export type Copy = (typeof copy)["hr"];

const WHEN_EN: Record<string, string> = {
  sutra: "tomorrow",
  vikendom: "weekend",
  pon: "Mon",
  uto: "Tue",
  sri: "Wed",
  čet: "Thu",
  pet: "Fri",
  sub: "Sat",
  ned: "Sun",
};

export function whenLabel(when: string, lang: Lang): string {
  if (!when || lang === "hr") return when;
  return WHEN_EN[when] ?? when;
}

export function readLang(): Lang {
  try {
    return window.localStorage.getItem(LANG_KEY) === "en" ? "en" : "hr";
  } catch {
    return "hr";
  }
}

function writeLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // ignore
  }
}

interface LangValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Copy;
}

const LangContext = createContext<LangValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const setLang = (next: Lang) => {
    writeLang(next);
    setLangState(next);
  };
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = copy[lang].pageTitle;
  }, [lang]);
  return (
    <LangContext.Provider value={{ lang, setLang, t: copy[lang] as Copy }}>
      {children}
    </LangContext.Provider>
  );
}

export function useI18n(): LangValue {
  const value = useContext(LangContext);
  if (!value) throw new Error("useI18n outside LangProvider");
  return value;
}
