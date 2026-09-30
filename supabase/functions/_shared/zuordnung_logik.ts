// Reine Logik der Zuordnungs-Pruefung: wohin gehoert eine neue Meldung ohne geruecht_id?
// Ohne Datenbank; das Netz nur ueber eine eingesetzte fetch-Funktion, damit testbar.
// Getestet in tests/zuordnung_logik_test.ts. Die Schnittstelle zu Thomas' n8n-Workflow ist in
// docs/zuordnung-pruefung.md beschrieben, beides muss zusammenpassen.
//
// Ablauf (Knuts Entscheidung, 2026-09-30):
//  1. Die SQL-Funktion geruecht_kandidaten liefert bis zu KANDIDATEN_MAX Geruechte, sortiert
//     nach der DURCHSCHNITTLICHEN Aehnlichkeit ueber alle ihre Meldungen (Average Linkage).
//     Bis dahin zaehlte nur die aehnlichste Einzelmeldung (Single Linkage); dadurch konnten
//     sich Meldungen ueber Ketten in fremde Geruechte hangeln.
//  2. Drei Zonen nach der Aehnlichkeit des besten Kandidaten:
//       ab ZUORDNUNG_SICHER_AB (0,95)            -> sicher: ohne Pruefung zuordnen
//       ab ZUORDNUNG_PRUEFEN_AB (0,75) bis 0,95  -> Graubereich: ein LLM (n8n) entscheidet
//       darunter                                 -> neues Geruecht
//     Grund fuer den Graubereich: das Embedding misst das Thema, nicht die Aussage. "Vertrieb
//     bekommt +7 % Bonus" und "Bonus wird halbiert" lagen bei 0,81.
//  3. Scheitert irgendetwas (Embedding, Suche, Webhook, ungueltige Antwort), entsteht KEIN
//     neues Geruecht (Knut): die Meldung bleibt im Zustand "offen" und wird nachgeholt.
// Die Grenzen sind Platzhalter, noch nicht kalibriert. Anhaltspunkt ist der Bestand vom
// 2026-09-30, Durchschnitt jeder Meldung zu den frueheren Meldungen ihres Geruechts:
//   falsch zusammengelegt: 0,72 bis 0,81 (Bonus +7 %, Montagelinie, Kantine schliesst, Halle 3)
//   richtig zusammengelegt: 0,84 bis 1,00 (ohne das durch Ketten verfaelschte Geruecht 45)

type Ergebnis<T> = { ok: true; wert: T } | { ok: false; fehler: string[] };
const ok = <T>(wert: T): Ergebnis<T> => ({ ok: true, wert });
const fehler = <T>(...f: string[]): Ergebnis<T> => ({ ok: false, fehler: f });

export const ZUORDNUNG_SICHER_AB = 0.95;
export const ZUORDNUNG_PRUEFEN_AB = 0.75;
export const KANDIDATEN_MAX = 3;
// So viele naechste Einzelmeldungen holt der Index, ihre Geruechte sind die Kandidaten
export const NACHBARN = 20;
export const BEISPIELE_MAX = 3;
export const ZUORDNUNG_ZEITLIMIT_MS = 10000;
export const PRUEF_BEGRUENDUNG_MAX = 1000;
// Offene Meldungen, die jede neue Meldung im Hintergrund mit nachholt
export const NACHHOLEN_HUCKEPACK = 3;
export const NACHHOLEN_STANDARD = 5;
export const NACHHOLEN_MAX = 20;

export type Zuordnungsart = "explizit" | "embedding" | "geprueft" | "neu" | "offen";

export interface Kandidat {
  geruecht_id: number;
  aehnlichkeit: number; // Durchschnitt ueber alle Meldungen des Geruechts
  max_aehnlichkeit: number; // aehnlichste Einzelmeldung, nur zum Kalibrieren
  anzahl_meldungen: number;
}

const zahl = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const positiveGanzzahl = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 1;

// Ergebnis von .rpc("geruecht_kandidaten")
export function parseKandidaten(roh: unknown): Ergebnis<Kandidat[]> {
  if (!Array.isArray(roh)) return fehler("Kandidatensuche lieferte keine Liste");
  const liste: Kandidat[] = [];
  for (const z of roh) {
    const r = (typeof z === "object" && z !== null ? z : {}) as Record<string, unknown>;
    if (!positiveGanzzahl(r.geruecht_id) || !zahl(r.aehnlichkeit) || !zahl(r.max_aehnlichkeit) ||
      !positiveGanzzahl(r.anzahl_meldungen)) {
      return fehler("Kandidatensuche lieferte eine ungueltige Zeile");
    }
    liste.push({
      geruecht_id: r.geruecht_id as number,
      aehnlichkeit: r.aehnlichkeit as number,
      max_aehnlichkeit: r.max_aehnlichkeit as number,
      anzahl_meldungen: r.anzahl_meldungen as number,
    });
  }
  return ok(liste);
}

export type Zone =
  | { zone: "sicher"; kandidat: Kandidat }
  | { zone: "pruefen"; kandidaten: Kandidat[] }
  | { zone: "neu" };

// Die Zone haengt nur am besten Kandidaten. Im Graubereich gehen alle Kandidaten ab der
// unteren Grenze an das LLM (hoechstens KANDIDATEN_MAX), damit es auch den zweitbesten
// waehlen kann, wenn der erste nur thematisch passt.
export function entscheideZone(
  kandidaten: Kandidat[],
  sicherAb = ZUORDNUNG_SICHER_AB,
  pruefenAb = ZUORDNUNG_PRUEFEN_AB,
): Zone {
  const sortiert = [...kandidaten].sort((a, b) => b.aehnlichkeit - a.aehnlichkeit);
  const bester = sortiert[0];
  if (!bester || bester.aehnlichkeit < pruefenAb) return { zone: "neu" };
  if (bester.aehnlichkeit >= sicherAb) return { zone: "sicher", kandidat: bester };
  return { zone: "pruefen", kandidaten: sortiert.filter((k) => k.aehnlichkeit >= pruefenAb).slice(0, KANDIDATEN_MAX) };
}

// Was an der Meldung zum Kalibrieren gespeichert wird: die aehnlichste Einzelmeldung
// (beste_aehnlichkeit) und der Durchschnitt des besten Geruechts (geruecht_aehnlichkeit)
export interface Kennzahlen {
  beste_aehnlichkeit: number | null;
  geruecht_aehnlichkeit: number | null;
}

export function kennzahlen(kandidaten: Kandidat[]): Kennzahlen {
  if (kandidaten.length === 0) return { beste_aehnlichkeit: null, geruecht_aehnlichkeit: null };
  return {
    beste_aehnlichkeit: Math.max(...kandidaten.map((k) => k.max_aehnlichkeit)),
    geruecht_aehnlichkeit: Math.max(...kandidaten.map((k) => k.aehnlichkeit)),
  };
}

export interface KandidatDetail {
  geruecht_id: number;
  kernaussage: string | null;
  beispiele: string[];
}

// Body an den n8n-Workflow. Die Aehnlichkeitswerte gehen bewusst NICHT mit: das LLM soll
// allein nach dem Inhalt entscheiden, nicht nach der Zahl.
export function baueZuordnungsAnfrage(meldung: { meldung_id: number; text: string }, details: KandidatDetail[]) {
  return {
    meldung: { meldung_id: meldung.meldung_id, text: meldung.text },
    kandidaten: details.map((d) => ({
      geruecht_id: d.geruecht_id,
      kernaussage: d.kernaussage,
      beispiele: d.beispiele.slice(0, BEISPIELE_MAX),
    })),
  };
}

export interface PruefAntwort {
  geruecht_id: number | null;
  begruendung: string | null;
}

// Wertet die Antwort des Workflows aus. Gueltig ist nur Status 200 mit einer der angebotenen
// IDs oder null. Alles andere ist ein Fehler, die Meldung bleibt dann offen. Eine Liste mit
// genau einem Eintrag wird angenommen, weil n8n je nach Einstellung so antwortet.
export function werteZuordnungsAntwortAus(status: number, rohText: string, erlaubt: number[]): Ergebnis<PruefAntwort> {
  if (status !== 200) return fehler(`Workflow antwortet mit Status ${status}`);
  let roh: unknown;
  try {
    roh = JSON.parse(rohText);
  } catch {
    return fehler("Workflow-Antwort ist kein JSON");
  }
  if (Array.isArray(roh)) {
    if (roh.length !== 1) return fehler("Workflow-Antwort ist eine Liste, aber nicht mit genau einem Eintrag");
    roh = roh[0];
  }
  if (typeof roh !== "object" || roh === null) return fehler("Workflow-Antwort ist kein JSON-Objekt");
  const r = roh as Record<string, unknown>;
  if (!("geruecht_id" in r)) return fehler("Workflow-Antwort ohne 'geruecht_id'");
  const id = r.geruecht_id;
  if (id !== null && !(typeof id === "number" && Number.isInteger(id) && erlaubt.includes(id))) {
    return fehler(`Workflow nennt geruecht_id ${JSON.stringify(id)}, angeboten waren ${erlaubt.join(", ")}`);
  }
  const begruendung = typeof r.begruendung === "string" && r.begruendung.trim()
    ? r.begruendung.trim().slice(0, PRUEF_BEGRUENDUNG_MAX)
    : null;
  return ok({ geruecht_id: id as number | null, begruendung });
}

export interface ZuordnungsKonfig {
  url: string;
  geheimnis: string;
  zeitlimit_ms: number;
}

// Secrets ZUORDNUNG_WEBHOOK_URL und ZUORDNUNG_WEBHOOK_SECRET, optional ZUORDNUNG_TIMEOUT_MS
// (1000 bis 60000). Fehlt etwas, gibt es keine Pruefung: der Graubereich bleibt offen.
export function leseZuordnungsKonfig(env: (name: string) => string | undefined): ZuordnungsKonfig | null {
  const url = env("ZUORDNUNG_WEBHOOK_URL")?.trim();
  const geheimnis = env("ZUORDNUNG_WEBHOOK_SECRET");
  if (!url || !/^https:\/\//.test(url) || !geheimnis) return null;
  const roh = env("ZUORDNUNG_TIMEOUT_MS")?.trim() ?? "";
  const zeit = /^\d+$/.test(roh) ? Number(roh) : NaN;
  const zeitlimit_ms = zeit >= 1000 && zeit <= 60000 ? zeit : ZUORDNUNG_ZEITLIMIT_MS;
  return { url, geheimnis, zeitlimit_ms };
}

// Ruft den Workflow synchron auf und wartet hoechstens zeitlimit_ms
export async function rufeZuordnungsWebhook(
  konfig: ZuordnungsKonfig,
  anfrage: ReturnType<typeof baueZuordnungsAnfrage>,
  erlaubt: number[],
  abruf: typeof fetch = fetch,
): Promise<Ergebnis<PruefAntwort>> {
  let antwort: Response;
  try {
    antwort = await abruf(konfig.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": konfig.geheimnis },
      body: JSON.stringify(anfrage),
      signal: AbortSignal.timeout(konfig.zeitlimit_ms),
    });
  } catch (e) {
    const zeitlimit = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    return fehler(
      zeitlimit
        ? `Workflow hat das Zeitlimit von ${konfig.zeitlimit_ms} ms ueberschritten`
        : "Workflow nicht erreichbar",
    );
  }
  let text: string;
  try {
    text = await antwort.text();
  } catch {
    return fehler("Workflow-Antwort nicht lesbar");
  }
  return werteZuordnungsAntwortAus(antwort.status, text, erlaubt);
}

// Body von POST /zuordnung_nachholen: optional {anzahl}
export function parseNachholAnzahl(body: unknown): Ergebnis<number> {
  if (body === null || body === undefined) return ok(NACHHOLEN_STANDARD);
  if (typeof body !== "object" || Array.isArray(body)) return fehler("Der Body muss ein JSON-Objekt sein");
  const b = body as Record<string, unknown>;
  const unbekannt = Object.keys(b).filter((f) => f !== "anzahl");
  if (unbekannt.length > 0) return fehler(`Unbekanntes Feld '${unbekannt[0]}'. Erlaubt: anzahl`);
  if (b.anzahl === undefined || b.anzahl === null) return ok(NACHHOLEN_STANDARD);
  if (typeof b.anzahl !== "number" || !Number.isInteger(b.anzahl) || b.anzahl < 1 || b.anzahl > NACHHOLEN_MAX) {
    return fehler(`'anzahl' muss eine Ganzzahl von 1 bis ${NACHHOLEN_MAX} sein`);
  }
  return ok(b.anzahl);
}

export interface ZuordnungsErgebnis {
  art: Zuordnungsart;
  geruecht_id: number | null;
  neues_geruecht: boolean;
  geruecht_aehnlichkeit: number | null;
}

// Antwort von POST /meldung
export function baueMeldungAntwort(meldungId: number, z: ZuordnungsErgebnis, embeddingFehler: string | null) {
  const perAehnlichkeit = z.art === "embedding" || z.art === "geprueft";
  return {
    meldung_id: meldungId,
    geruecht_id: z.geruecht_id,
    neues_geruecht: z.neues_geruecht,
    zuordnung: z.art,
    zuordnung_offen: z.art === "offen",
    per_embedding_zugeordnet: perAehnlichkeit,
    aehnlichkeit: perAehnlichkeit ? z.geruecht_aehnlichkeit : null,
    embedding_fehler: embeddingFehler,
  };
}
