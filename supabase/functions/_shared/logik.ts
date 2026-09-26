// Reine Logik der Edge Functions: keine Datenbank, kein Netzwerk, deshalb direkt testbar.
// Tests: supabase/functions/tests/logik_test.ts

export const STATUS_WERTE = ["offen", "bestätigt", "widerlegt", "nicht prüfbar"] as const;
export type Status = typeof STATUS_WERTE[number];

export const TEXT_MAX = 2000;
const USER_ID_MAX = 200;

export type Ergebnis<T> = { ok: true; wert: T } | { ok: false; fehler: string[] };

const ok = <T>(wert: T): Ergebnis<T> => ({ ok: true, wert });
const fehler = <T>(...meldungen: string[]): Ergebnis<T> => ({ ok: false, fehler: meldungen });

// --- Eingaben pruefen --------------------------------------------------------

export function parseStatusFilter(roh: string | null): Ergebnis<Status | "all"> {
  const erlaubt = ["all", ...STATUS_WERTE].join(", ");
  const wert = roh?.trim() ?? "";
  if (wert === "") return fehler(`Parameter 'status' fehlt. Erlaubt: ${erlaubt}`);
  if (wert === "all") return ok("all");
  if ((STATUS_WERTE as readonly string[]).includes(wert)) return ok(wert as Status);
  return fehler(`Unbekannter Status '${wert}'. Erlaubt: ${erlaubt}`);
}

export function parseGeruechtId(roh: unknown): Ergebnis<number> {
  let zahl: number | null = null;
  if (typeof roh === "number") zahl = roh;
  if (typeof roh === "string" && /^\d+$/.test(roh.trim())) zahl = Number(roh.trim());
  if (zahl === null || !Number.isSafeInteger(zahl) || zahl < 1) {
    return fehler("'geruecht_id' muss eine positive Ganzzahl sein");
  }
  return ok(zahl);
}

// Keine Kategorie: die vergibt ein eigener Klassifizierungs-Workflow, sobald ein
// Geruecht entsteht.
export interface MeldungEingabe {
  text: string;
  user_id: string | null;
  geruecht_id: number | null;
}

const MELDUNG_FELDER = ["text", "user_id", "geruecht_id"];

export function validiereMeldung(body: unknown): Ergebnis<MeldungEingabe> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fehler("Der Body muss ein JSON-Objekt sein");
  }
  const b = body as Record<string, unknown>;
  const probleme: string[] = [];

  // Unbekannte Felder ablehnen: ein Tippfehler wie "geruechte_id" wuerde sonst
  // still ignoriert und ein neues Geruecht anlegen.
  for (const feld of Object.keys(b)) {
    if (!MELDUNG_FELDER.includes(feld)) {
      probleme.push(`Unbekanntes Feld '${feld}'. Erlaubt: ${MELDUNG_FELDER.join(", ")}`);
    }
  }

  const text = typeof b.text === "string" ? b.text.trim() : null;
  if (text === null) probleme.push("'text' fehlt oder ist kein Text");
  else if (text === "") probleme.push("'text' darf nicht leer sein");
  else if (text.length > TEXT_MAX) probleme.push(`'text' ist länger als ${TEXT_MAX} Zeichen`);

  let userId: string | null = null;
  if (b.user_id !== undefined && b.user_id !== null) {
    if (typeof b.user_id !== "string" || b.user_id.trim() === "" || b.user_id.length > USER_ID_MAX) {
      probleme.push(`'user_id' muss ein nicht leerer Text mit höchstens ${USER_ID_MAX} Zeichen sein`);
    } else {
      userId = b.user_id.trim();
    }
  }

  let geruechtId: number | null = null;
  if (b.geruecht_id !== undefined && b.geruecht_id !== null) {
    // Im JSON-Body nur als Zahl, nicht als Text
    const e = typeof b.geruecht_id === "number" ? parseGeruechtId(b.geruecht_id) : parseGeruechtId(null);
    if (e.ok) geruechtId = e.wert;
    else probleme.push(...e.fehler);
  }

  if (probleme.length > 0) return { ok: false, fehler: probleme };
  return ok({ text: text!, user_id: userId, geruecht_id: geruechtId });
}

export const KERNAUSSAGE_MAX = 500;
export const BEGRUENDUNG_MAX = 1000;

// konfidenz, begruendung und manuell_pruefen sind optional und werden vorerst nur
// mitprotokolliert.
export interface KlassifizierungEingabe {
  geruecht_id: number;
  kategorie: string;
  kernaussage: string;
  konfidenz: number | null;
  begruendung: string | null;
  manuell_pruefen: boolean;
}

const KLASSIFIZIERUNG_FELDER = ["geruecht_id", "kategorie", "kernaussage", "konfidenz", "begruendung", "manuell_pruefen"];

export function validiereKlassifizierung(body: unknown): Ergebnis<KlassifizierungEingabe> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fehler("Der Body muss ein JSON-Objekt sein");
  }
  const b = body as Record<string, unknown>;
  const probleme: string[] = [];

  for (const feld of Object.keys(b)) {
    if (!KLASSIFIZIERUNG_FELDER.includes(feld)) {
      probleme.push(`Unbekanntes Feld '${feld}'. Erlaubt: ${KLASSIFIZIERUNG_FELDER.join(", ")}`);
    }
  }

  // Im JSON-Body nur als Zahl, nicht als Text
  const id = typeof b.geruecht_id === "number" ? parseGeruechtId(b.geruecht_id) : parseGeruechtId(null);
  if (!id.ok) probleme.push(...id.fehler);

  const kategorie = typeof b.kategorie === "string" ? b.kategorie.trim() : "";
  if (kategorie === "") probleme.push("'kategorie' fehlt oder ist leer");

  const kernaussage = typeof b.kernaussage === "string" ? b.kernaussage.trim() : "";
  if (kernaussage === "") probleme.push("'kernaussage' fehlt oder ist leer");
  else if (kernaussage.length > KERNAUSSAGE_MAX) {
    probleme.push(`'kernaussage' ist länger als ${KERNAUSSAGE_MAX} Zeichen`);
  }

  let konfidenz: number | null = null;
  if (b.konfidenz !== undefined && b.konfidenz !== null) {
    if (typeof b.konfidenz !== "number" || !Number.isFinite(b.konfidenz) || b.konfidenz < 0 || b.konfidenz > 1) {
      probleme.push("'konfidenz' muss eine Zahl zwischen 0 und 1 sein");
    } else {
      konfidenz = b.konfidenz;
    }
  }

  let begruendung: string | null = null;
  if (b.begruendung !== undefined && b.begruendung !== null) {
    if (typeof b.begruendung !== "string" || b.begruendung.length > BEGRUENDUNG_MAX) {
      probleme.push(`'begruendung' muss ein Text mit höchstens ${BEGRUENDUNG_MAX} Zeichen sein`);
    } else {
      begruendung = b.begruendung.trim() || null;
    }
  }

  let manuellPruefen = false;
  if (b.manuell_pruefen !== undefined && b.manuell_pruefen !== null) {
    if (typeof b.manuell_pruefen !== "boolean") probleme.push("'manuell_pruefen' muss true oder false sein");
    else manuellPruefen = b.manuell_pruefen;
  }

  if (probleme.length > 0 || !id.ok) return { ok: false, fehler: probleme };
  return ok({ geruecht_id: id.wert, kategorie, kernaussage, konfidenz, begruendung, manuell_pruefen: manuellPruefen });
}

// --- Embedding und Zuordnung -------------------------------------------------

export const EMBEDDING_MODELL = "google/gemini-embedding-001";
export const EMBEDDING_URL = "https://openrouter.ai/api/v1/embeddings";
// Gemessen am 2026-09-25, muss zur Spalte meldungen.embedding (halfvec(3072)) passen
export const EMBEDDING_DIMENSION = 3072;

// PLATZHALTER: Ab dieser Kosinus-Aehnlichkeit gilt eine Meldung als dasselbe Geruecht.
// Wird spaeter mit 40 bis 60 von Hand markierten Meldungspaaren kalibriert.
// Startwert 0.80 aus Stichproben vom 2026-09-25 (gemini-embedding-001):
//   gleiches Geruecht, umformuliert:          0.79 bis 0.97
//   verschiedene Geruechte:                   0.56 bis 0.66
//   verschiedene Geruechte, beide mit [TEST]: 0.68 bis 0.76 (gemeinsames Praefix hebt an)
// Eher hoch gewaehlt: eine falsche Zusammenlegung verfaelscht eine Akte, eine falsche
// Trennung ergibt nur zwei Akten zum selben Geruecht.
export const AEHNLICHKEITS_SCHWELLE = 0.8;

export function baueEmbeddingAnfrage(text: string) {
  return { model: EMBEDDING_MODELL, input: text };
}

// Prueft die Antwort von OpenRouter und liefert den Vektor. Auch bei HTTP 200 kann
// statt data ein error-Objekt kommen, deshalb wird die Form vollstaendig geprueft.
export function parseEmbeddingAntwort(roh: unknown, dimension = EMBEDDING_DIMENSION): Ergebnis<number[]> {
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) {
    return fehler("Embedding-Antwort ist kein JSON-Objekt");
  }
  const r = roh as Record<string, unknown>;
  if (typeof r.error === "object" && r.error !== null) {
    const meldung = (r.error as Record<string, unknown>).message;
    return fehler(`Embedding-Dienst meldet Fehler: ${typeof meldung === "string" ? meldung : "ohne Text"}`);
  }
  const erstes = Array.isArray(r.data) ? r.data[0] : undefined;
  const vektor = typeof erstes === "object" && erstes !== null
    ? (erstes as Record<string, unknown>).embedding
    : undefined;
  if (!Array.isArray(vektor)) return fehler("Embedding-Antwort enthaelt kein data[0].embedding");
  if (vektor.length !== dimension) {
    return fehler(`Embedding hat ${vektor.length} statt ${dimension} Dimensionen`);
  }
  if (!vektor.every((x) => typeof x === "number" && Number.isFinite(x))) {
    return fehler("Embedding enthaelt Werte, die keine endlichen Zahlen sind");
  }
  return ok(vektor as number[]);
}

// PostgREST nimmt den Vektor als Text in pgvector-Schreibweise '[0.1,0.2,...]' entgegen
export function vektorAlsText(vektor: number[]): string {
  return JSON.stringify(vektor);
}

export interface Treffer {
  geruecht_id: number;
  aehnlichkeit: number;
}

// Ergebnis von .rpc("aehnlichstes_geruecht"): keine oder eine Zeile
export function parseTreffer(roh: unknown): Ergebnis<Treffer | null> {
  if (!Array.isArray(roh)) return fehler("Suchergebnis ist keine Liste");
  if (roh.length === 0) return ok(null);
  const z = roh[0] as Record<string, unknown> | null;
  const id = typeof z?.geruecht_id === "number" ? parseGeruechtId(z.geruecht_id) : parseGeruechtId(null);
  const aehnlichkeit = z?.aehnlichkeit;
  if (!id.ok || typeof aehnlichkeit !== "number" || !Number.isFinite(aehnlichkeit)) {
    return fehler("Suchergebnis hat keine gueltige geruecht_id und aehnlichkeit");
  }
  return ok({ geruecht_id: id.wert, aehnlichkeit });
}

export type Zuordnung =
  | { art: "explizit"; geruecht_id: number; aehnlichkeit: null }
  | { art: "embedding"; geruecht_id: number; aehnlichkeit: number }
  | { art: "neu"; geruecht_id: null; aehnlichkeit: null };

// Entscheidet, wohin eine Meldung gehoert. Eine angegebene geruecht_id gewinnt immer.
// Die Schwelle wird hier noch einmal geprueft, auch wenn die Datenbank schon filtert:
// die Entscheidung haengt so nicht allein an der SQL-Funktion.
export function entscheideZuordnung(
  explizit: number | null,
  treffer: Treffer | null,
  schwelle = AEHNLICHKEITS_SCHWELLE,
): Zuordnung {
  if (explizit !== null) return { art: "explizit", geruecht_id: explizit, aehnlichkeit: null };
  if (treffer && treffer.aehnlichkeit >= schwelle) {
    return { art: "embedding", geruecht_id: treffer.geruecht_id, aehnlichkeit: treffer.aehnlichkeit };
  }
  return { art: "neu", geruecht_id: null, aehnlichkeit: null };
}

// --- Rate-Limit fuer POST /meldung -------------------------------------------

// Bremse gegen Ausreisser, vor allem gegen einen Agenten in einer Schleife: jede Meldung
// kostet ein Embedding, jedes neue Geruecht eine LLM-Klassifizierung in n8n.
// Gezaehlt werden gespeicherte Meldungen je Zeitfenster, projektweit (die Meldungen sind
// anonym, eine Grenze je Person gibt es deshalb nicht).
// Die Standardwerte sind gewaehlt, nicht gemessen; ueberschreibbar per Supabase-Secret
// ohne neues Deployment, etwa fuer den Praesentationstag.
export interface RateLimit {
  name: string;
  fenster_sekunden: number;
  max: number;
}

export const RATE_LIMITS: RateLimit[] = [
  { name: "MELDUNG_LIMIT_PRO_MINUTE", fenster_sekunden: 60, max: 30 },
  { name: "MELDUNG_LIMIT_PRO_TAG", fenster_sekunden: 86_400, max: 1000 },
];

// Liest die Grenzwerte aus der Umgebung. Ungueltige Werte fallen auf den Standard zurueck,
// damit ein Tippfehler im Secret die Bremse nicht abschaltet.
export function leseRateLimits(env: (name: string) => string | undefined, standard = RATE_LIMITS): RateLimit[] {
  return standard.map((l) => {
    const roh = env(l.name)?.trim() ?? "";
    const wert = /^\d+$/.test(roh) ? Number(roh) : NaN;
    return Number.isSafeInteger(wert) && wert >= 1 ? { ...l, max: wert } : l;
  });
}

// anzahl[i] = gespeicherte Meldungen im Fenster von limits[i]. Ist ein Fenster voll,
// kommt die Wartezeit (Retry-After) des laengsten vollen Fensters zurueck.
export function pruefeRateLimit(
  limits: RateLimit[],
  anzahl: number[],
): { ok: true } | { ok: false; fehler: string[]; retry_after: number } {
  const voll = limits.filter((l, i) => anzahl[i] >= l.max);
  if (voll.length === 0) return { ok: true };
  return {
    ok: false,
    fehler: voll.map((l) => `Zu viele Meldungen: höchstens ${l.max} in ${beschreibeFenster(l.fenster_sekunden)}`),
    retry_after: Math.max(...voll.map((l) => l.fenster_sekunden)),
  };
}

function beschreibeFenster(sekunden: number): string {
  if (sekunden === 60) return "einer Minute";
  if (sekunden === 86_400) return "24 Stunden";
  return `${sekunden} Sekunden`;
}

// --- Paginierung fuer GET /geruechte -----------------------------------------

export const SEITE_STANDARD = 50;
export const SEITE_MAX = 200;

export function parsePaginierung(
  limitRoh: string | null,
  offsetRoh: string | null,
): Ergebnis<{ limit: number; offset: number }> {
  const probleme: string[] = [];
  const zahl = (roh: string | null, standard: number) => {
    const w = roh?.trim() ?? "";
    if (w === "") return standard;
    return /^\d+$/.test(w) ? Number(w) : NaN;
  };
  const limit = zahl(limitRoh, SEITE_STANDARD);
  const offset = zahl(offsetRoh, 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SEITE_MAX) {
    probleme.push(`'limit' muss eine Ganzzahl von 1 bis ${SEITE_MAX} sein (Standard ${SEITE_STANDARD})`);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    probleme.push("'offset' muss eine Ganzzahl ab 0 sein (Standard 0)");
  }
  if (probleme.length > 0) return { ok: false, fehler: probleme };
  return ok({ limit, offset });
}

// --- Zugang ------------------------------------------------------------------

// Vergleich in konstanter Zeit, damit die Antwortzeit nichts ueber den Schluessel verraet.
// Ohne konfigurierten Schluessel ist alles zu (fail closed).
export function pruefeApiKey(gesendet: string | null, erwartet: string | undefined): boolean {
  if (!erwartet || !gesendet) return false;
  const a = new TextEncoder().encode(gesendet);
  const b = new TextEncoder().encode(erwartet);
  let unterschied = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    unterschied |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return unterschied === 0;
}

// Supabase stellt den Admin-Schluessel je nach Projekt als Legacy-Variable oder als
// JSON-Verzeichnis der neuen Secret Keys bereit.
export function waehleAdminKey(legacy: string | undefined, secretKeysJson: string | undefined): string | null {
  if (legacy) return legacy;
  if (!secretKeysJson) return null;
  try {
    const keys = JSON.parse(secretKeysJson) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? null;
  } catch {
    return null;
  }
}

// --- Antworten formen --------------------------------------------------------

// Die Datenbank liefert je Geruecht nur noch die Anzahl (anzahl: [{count}]) und die
// frueheste Meldung (erste, auf eine Zeile begrenzt), nicht mehr alle Meldungstexte.
interface GeruechtZeile {
  geruecht_id: number;
  status: string;
  kernaussage: string | null;
  kategorien: { name: string } | { name: string }[] | null;
  anzahl: { count: number }[] | null;
  erste: { text: string; eingegangen_am: string }[] | null;
}

export function baueGeruechtListe(zeilen: GeruechtZeile[]) {
  return zeilen.map((z) => {
    const kat = Array.isArray(z.kategorien) ? z.kategorien[0] : z.kategorien;
    // Sortiert die Datenbank schon, hier nur zur Sicherheit, falls doch mehr kommt
    const erste = [...(z.erste ?? [])].sort((a, b) =>
      Date.parse(a.eingegangen_am) - Date.parse(b.eingegangen_am)
    )[0];
    return {
      geruecht_id: z.geruecht_id,
      kategorie: kat?.name ?? null,
      kernaussage: z.kernaussage,
      status: z.status,
      anzahl_meldungen: z.anzahl?.[0]?.count ?? 0,
      beispieltext: erste?.text ?? null,
      erste_meldung_am: erste?.eingegangen_am ?? null,
    };
  });
}

// --- Selbstbeschreibung der API ----------------------------------------------

export const MELDUNG_BEISPIEL = {
  text: "Ich habe gehört, dass Abteilung X zum Jahresende aufgelöst wird.",
  user_id: "vorlaeufig-123",
};

export const MELDUNGSSCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Meldung",
  description: "Body für POST /functions/v1/meldung",
  type: "object",
  required: ["text"],
  additionalProperties: false,
  properties: {
    text: {
      type: "string",
      minLength: 1,
      maxLength: TEXT_MAX,
      description: "Was die Person gehört hat, Namen bereits geschwärzt.",
    },
    user_id: {
      type: ["string", "null"],
      maxLength: USER_ID_MAX,
      description: "VORLÄUFIG, wird ersetzt. Kennung der meldenden Person, optional.",
    },
    geruecht_id: {
      type: ["integer", "null"],
      minimum: 1,
      description:
        "Optional. Gesetzt: Meldung wird genau diesem bestehenden Gerücht zugeordnet (IDs aus GET /functions/v1/geruechte). " +
        "Weggelassen: die Meldung wird per Embedding dem ähnlichsten bestehenden Gerücht zugeordnet, " +
        `wenn die Kosinus-Ähnlichkeit mindestens ${AEHNLICHKEITS_SCHWELLE} beträgt. Sonst entsteht ein neues Gerücht, ` +
        "die Kategorie vergibt danach der Klassifizierungs-Workflow.",
    },
  },
};

export const MELDUNG_ANTWORT_BEISPIEL = {
  meldung_id: 12,
  geruecht_id: 7,
  neues_geruecht: false,
  per_embedding_zugeordnet: true,
  aehnlichkeit: 0.87,
  embedding_fehler: null,
};

export const MELDUNG_ANTWORT_FELDER = {
  meldung_id: "ID der gespeicherten Meldung",
  geruecht_id: "Gerücht, dem die Meldung zugeordnet wurde",
  neues_geruecht: "true, wenn dafür ein neues Gerücht angelegt wurde",
  per_embedding_zugeordnet: "true, wenn die Zuordnung über die Ähnlichkeitssuche kam (nicht über geruecht_id)",
  aehnlichkeit: "Kosinus-Ähnlichkeit zur ähnlichsten Meldung, nur bei per_embedding_zugeordnet, sonst null",
  embedding_fehler: "null, wenn alles lief. Sonst der Grund, warum kein Embedding gespeichert oder nicht gesucht " +
    "werden konnte. Die Meldung ist trotzdem gespeichert, ohne geruecht_id dann in einem neuen Gerücht.",
};

export interface Endpunkt {
  name: string;
  methode: "GET" | "POST";
  pfad: string;
  beschreibung: string;
  parameter: { name: string; ort: "query" | "body"; pflicht: boolean; beschreibung: string }[];
}

const ep = (e: Omit<Endpunkt, "pfad">): Endpunkt => ({ ...e, pfad: `/functions/v1/${e.name}` });

export const ENDPUNKTE: Endpunkt[] = [
  ep({
    name: "calls",
    methode: "GET",
    beschreibung: "Diese Übersicht: alle Endpunkte mit ihren Parametern.",
    parameter: [],
  }),
  ep({
    name: "kategorien",
    methode: "GET",
    beschreibung: "Alle Kategorien, die der Klassifizierungs-Workflow vergeben kann.",
    parameter: [],
  }),
  ep({
    name: "geruechte",
    methode: "GET",
    beschreibung: "Gerüchte mit Kategorie und Kernaussage (beide null = noch nicht klassifiziert), " +
      "Status, Anzahl Meldungen und Beispieltext (erste Meldung). Seitenweise, aufsteigend nach geruecht_id; " +
      "'gesamt' nennt die Anzahl aller Treffer.",
    parameter: [
      {
        name: "status",
        ort: "query",
        pflicht: true,
        beschreibung: `Filter: all oder einer von ${STATUS_WERTE.join(", ")}`,
      },
      {
        name: "limit",
        ort: "query",
        pflicht: false,
        beschreibung: `Gerüchte pro Seite, 1 bis ${SEITE_MAX}, Standard ${SEITE_STANDARD}`,
      },
      { name: "offset", ort: "query", pflicht: false, beschreibung: "so viele Gerüchte überspringen, Standard 0" },
    ],
  }),
  ep({
    name: "status",
    methode: "GET",
    beschreibung: "Status eines einzelnen Gerüchts.",
    parameter: [{ name: "geruecht_id", ort: "query", pflicht: true, beschreibung: "ID des Gerüchts" }],
  }),
  ep({
    name: "meldungsschema",
    methode: "GET",
    beschreibung: "Bauanleitung für POST meldung: JSON Schema, Beispiel und Beispielantwort.",
    parameter: [],
  }),
  ep({
    name: "meldung",
    methode: "POST",
    beschreibung: "Speichert eine Meldung samt Embedding. Ohne geruecht_id wird sie per Ähnlichkeitssuche " +
      "dem passenden bestehenden Gerücht zugeordnet, sonst entsteht ein neues. " +
      "Rate-Limit projektweit, bei Überschreitung 429 mit Header Retry-After. " +
      "Antwort: meldung_id, geruecht_id, neues_geruecht, per_embedding_zugeordnet, aehnlichkeit, embedding_fehler.",
    parameter: [
      { name: "text", ort: "body", pflicht: true, beschreibung: "Meldungstext, Namen geschwärzt" },
      { name: "user_id", ort: "body", pflicht: false, beschreibung: "VORLÄUFIG, Kennung der Person" },
      {
        name: "geruecht_id",
        ort: "body",
        pflicht: false,
        beschreibung: "erzwingt dieses bestehende Gerücht, sonst Zuordnung per Ähnlichkeitssuche",
      },
    ],
  }),
  ep({
    name: "klassifizierung_setzen",
    methode: "POST",
    beschreibung: "Für den Klassifizierungs-Workflow: setzt Kategorie und Kernaussage eines Gerüchts. " +
      "Nur einmal möglich, ein bereits klassifiziertes Gerücht liefert 409.",
    parameter: [
      { name: "geruecht_id", ort: "body", pflicht: true, beschreibung: "aus dem Trigger-Aufruf" },
      { name: "kategorie", ort: "body", pflicht: true, beschreibung: "Name aus GET kategorien" },
      {
        name: "kernaussage",
        ort: "body",
        pflicht: true,
        beschreibung: `neutral formuliert, höchstens ${KERNAUSSAGE_MAX} Zeichen`,
      },
      { name: "konfidenz", ort: "body", pflicht: false, beschreibung: "0 bis 1, wird mitprotokolliert" },
      {
        name: "begruendung",
        ort: "body",
        pflicht: false,
        beschreibung: `höchstens ${BEGRUENDUNG_MAX} Zeichen, wird mitprotokolliert`,
      },
      { name: "manuell_pruefen", ort: "body", pflicht: false, beschreibung: "true/false, Standard false" },
    ],
  }),
];
