// Reine Logik des Risikomodells: Konfiguration, Aufruf, Antwort pruefen. Ohne Datenbank; das
// Netz nur ueber eine eingesetzte fetch-Funktion, damit testbar (tests/risiko_logik_test.ts).
// Das Modell (gbert-large v2, Knut) laeuft LOKAL auf Knuts Rechner in Docker und ist ueber den
// Tailscale Funnel erreichbar. Ist der Rechner aus oder der Container gestoppt, antwortet es
// nicht. Das ist ein erwarteter Zustand: das Geruecht bekommt risiko_status 'queue' und wird auf
// Knuts Anstoss (POST risiko_nachholen) nachgeliefert, die Klassifizierung blockiert es nie.

type Ergebnis<T> = { ok: true; wert: T } | { ok: false; fehler: string[] };
const ok = <T>(wert: T): Ergebnis<T> => ({ ok: true, wert });
const fehler = <T>(...f: string[]): Ergebnis<T> => ({ ok: false, fehler: f });

export const RISIKO_STATUS_WERTE = ["ausstehend", "berechnet", "queue"] as const;
export type RisikoStatus = typeof RISIKO_STATUS_WERTE[number];

// Name des Modells, wird mit dem Wert gespeichert (Spalte risiko_modell)
export const RISIKO_MODELL = "gbert-large-v2";
export const RISIKO_ZEITLIMIT_MS = 30000;
export const RISIKO_NACHHOLEN_STANDARD = 20;
// Obergrenze des Modell-Dienstes je Aufruf (MAX_TEXTE in space/risiko.py)
export const RISIKO_NACHHOLEN_MAX = 50;
// Obergrenze je Text im Modell-Dienst (MAX_ZEICHEN in space/risiko.py)
export const RISIKO_TEXT_MAX = 2000;

// Status eines Gerüchts nach dem Klassifizieren: Wert da = berechnet, sonst queue
export function risikoStatusFuer(risiko: number | null): "berechnet" | "queue" {
  return risiko === null ? "queue" : "berechnet";
}

// Body von POST /risiko_nachholen: optional {anzahl}
export function parseRisikoNachholAnzahl(body: unknown): Ergebnis<number> {
  if (body === null || body === undefined) return ok(RISIKO_NACHHOLEN_STANDARD);
  if (typeof body !== "object" || Array.isArray(body)) return fehler("Der Body muss ein JSON-Objekt sein");
  const b = body as Record<string, unknown>;
  const unbekannt = Object.keys(b).filter((f) => f !== "anzahl");
  if (unbekannt.length > 0) return fehler(`Unbekanntes Feld '${unbekannt[0]}'. Erlaubt: anzahl`);
  if (b.anzahl === undefined || b.anzahl === null) return ok(RISIKO_NACHHOLEN_STANDARD);
  if (
    typeof b.anzahl !== "number" || !Number.isInteger(b.anzahl) || b.anzahl < 1 || b.anzahl > RISIKO_NACHHOLEN_MAX
  ) {
    return fehler(`'anzahl' muss eine Ganzzahl von 1 bis ${RISIKO_NACHHOLEN_MAX} sein`);
  }
  return ok(b.anzahl);
}

export interface RisikoKonfig {
  url: string;
  token: string;
  zeitlimit_ms: number;
}

// Secrets RISIKO_URL (https) und RISIKO_TOKEN, optional RISIKO_TIMEOUT_MS (1000 bis 120000)
export function leseRisikoKonfig(env: (name: string) => string | undefined): RisikoKonfig | null {
  const url = env("RISIKO_URL")?.trim();
  const token = env("RISIKO_TOKEN")?.trim();
  if (!url || !/^https:\/\//.test(url) || !token) return null;
  const roh = env("RISIKO_TIMEOUT_MS")?.trim() ?? "";
  const zeit = /^\d+$/.test(roh) ? Number(roh) : NaN;
  const zeitlimit_ms = zeit >= 1000 && zeit <= 120000 ? zeit : RISIKO_ZEITLIMIT_MS;
  return { url, token, zeitlimit_ms };
}

// Antwort des Modell-Dienstes pruefen: {risiko: [Zahl 0..1, ...]} genau so lang wie die Anfrage
export function werteRisikoAntwortAus(status: number, text: string, erwartet: number): Ergebnis<number[]> {
  if (status === 401) return fehler("Modell lehnt das Token ab (401), RISIKO_TOKEN prüfen");
  if (status === 429) return fehler("Modell ist ausgelastet (429)");
  if (status < 200 || status >= 300) return fehler(`Modell antwortet mit HTTP ${status}`);
  let daten: unknown;
  try {
    daten = JSON.parse(text);
  } catch {
    return fehler("Modell-Antwort ist kein gültiges JSON");
  }
  const werte = (daten as { risiko?: unknown } | null)?.risiko;
  if (!Array.isArray(werte) || werte.length !== erwartet) {
    return fehler(`Modell-Antwort hat nicht ${erwartet} Werte`);
  }
  if (!werte.every((w) => typeof w === "number" && Number.isFinite(w) && w >= 0 && w <= 1)) {
    return fehler("Modell-Antwort enthält Werte außerhalb von 0 bis 1");
  }
  return ok(werte as number[]);
}

// Ruft das Modell einmal fuer alle Texte auf. Jeder Fehler (nicht erreichbar, Zeitlimit, HTTP,
// ungueltige Antwort) ergibt ein fehler-Ergebnis: dann bleibt alles in der Queue.
export async function rufeRisikomodell(
  konfig: RisikoKonfig,
  texte: string[],
  abruf: typeof fetch = fetch,
): Promise<Ergebnis<number[]>> {
  let antwort: Response;
  try {
    antwort = await abruf(konfig.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${konfig.token}` },
      body: JSON.stringify({ texte }),
      signal: AbortSignal.timeout(konfig.zeitlimit_ms),
    });
  } catch (e) {
    const zeitlimit = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    return fehler(
      zeitlimit
        ? `Modell hat das Zeitlimit von ${konfig.zeitlimit_ms} ms überschritten, vermutlich ist der Rechner oder der Container aus`
        : "Modell nicht erreichbar, vermutlich ist der Rechner oder der Container aus",
    );
  }
  let text: string;
  try {
    text = await antwort.text();
  } catch {
    return fehler("Modell-Antwort nicht lesbar");
  }
  return werteRisikoAntwortAus(antwort.status, text, texte.length);
}
