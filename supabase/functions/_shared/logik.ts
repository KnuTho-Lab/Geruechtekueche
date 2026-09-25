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

export interface KlassifizierungEingabe {
  geruecht_id: number;
  kategorie: string;
  kernaussage: string;
}

const KLASSIFIZIERUNG_FELDER = ["geruecht_id", "kategorie", "kernaussage"];

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

  if (probleme.length > 0 || !id.ok) return { ok: false, fehler: probleme };
  return ok({ geruecht_id: id.wert, kategorie, kernaussage });
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

interface GeruechtZeile {
  geruecht_id: number;
  status: string;
  kernaussage: string | null;
  kategorien: { name: string } | { name: string }[] | null;
  meldungen: { text: string; eingegangen_am: string }[] | null;
}

export function baueGeruechtListe(zeilen: GeruechtZeile[]) {
  return zeilen.map((z) => {
    const kat = Array.isArray(z.kategorien) ? z.kategorien[0] : z.kategorien;
    const meldungen = [...(z.meldungen ?? [])].sort((a, b) =>
      Date.parse(a.eingegangen_am) - Date.parse(b.eingegangen_am)
    );
    return {
      geruecht_id: z.geruecht_id,
      kategorie: kat?.name ?? null,
      kernaussage: z.kernaussage,
      status: z.status,
      anzahl_meldungen: meldungen.length,
      beispieltext: meldungen[0]?.text ?? null,
      erste_meldung_am: meldungen[0]?.eingegangen_am ?? null,
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
        "Optional. Gesetzt: Meldung wird diesem bestehenden Gerücht zugeordnet (IDs aus GET /functions/v1/geruechte). " +
        "Weggelassen: es entsteht ein neues Gerücht, die Kategorie vergibt danach der Klassifizierungs-Workflow.",
    },
  },
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
      "Status, Anzahl Meldungen und Beispieltext (erste Meldung).",
    parameter: [{
      name: "status",
      ort: "query",
      pflicht: true,
      beschreibung: `Filter: all oder einer von ${STATUS_WERTE.join(", ")}`,
    }],
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
    beschreibung: "Speichert eine Meldung, legt bei Bedarf ein neues Gerücht an.",
    parameter: [
      { name: "text", ort: "body", pflicht: true, beschreibung: "Meldungstext, Namen geschwärzt" },
      { name: "user_id", ort: "body", pflicht: false, beschreibung: "VORLÄUFIG, Kennung der Person" },
      { name: "geruecht_id", ort: "body", pflicht: false, beschreibung: "bestehendes Gerücht, sonst neues" },
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
    ],
  }),
];
