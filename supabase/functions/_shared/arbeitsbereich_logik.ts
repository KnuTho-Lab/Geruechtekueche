// Reine Logik der Functions arbeitsbereich und arbeitsbereich_status (Dashboard, Tab 2).
// Ohne Netzwerk, getestet in tests/arbeitsbereich_logik_test.ts.
import { STATUS_WERTE, type Status } from "./logik.ts";

// Nur diese Konten dürfen den Arbeitsbereich nutzen (Knut, 2026-10-05). Die Konten sind
// <name>@knutho-lab.github.io, die Domain ist fest (siehe melden/logik.js, nutzernameZuEmail).
export const BEARBEITER = ["knut", "thomas"] as const;
export const NUTZER_DOMAIN = "knutho-lab.github.io";

type Ergebnis<T> = { ok: true; wert: T } | { ok: false; fehler: string[] };

// Nutzername des Bearbeiters oder null, wenn das Konto nicht berechtigt ist.
export function bearbeiterName(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const m = /^([a-z0-9._-]{1,40})@([^@]+)$/.exec(email.trim().toLowerCase());
  if (!m || m[2] !== NUTZER_DOMAIN) return null;
  return (BEARBEITER as readonly string[]).includes(m[1]) ? m[1] : null;
}

export interface StatusAnfrage {
  geruecht_id: number;
  status: Status;
  // Der Status, den die Seite gerade sieht. Weicht der echte ab, hat eine zweite Person
  // inzwischen geändert und es gibt 409 statt eines stillen Überschreibens.
  erwartet: Status | null;
}

const ERLAUBTE_FELDER = ["geruecht_id", "status", "erwartet"];

function alsStatus(roh: unknown): Status | null {
  return typeof roh === "string" && (STATUS_WERTE as readonly string[]).includes(roh) ? (roh as Status) : null;
}

export function validiereStatusAnfrage(body: unknown): Ergebnis<StatusAnfrage> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, fehler: ["Der Body muss ein JSON-Objekt sein"] };
  }
  const feld = body as Record<string, unknown>;
  const fehler: string[] = [];
  const unbekannt = Object.keys(feld).filter((k) => !ERLAUBTE_FELDER.includes(k));
  if (unbekannt.length) fehler.push(`Unbekannte Felder: ${unbekannt.join(", ")}`);

  const id = feld.geruecht_id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
    fehler.push("'geruecht_id' muss eine positive Ganzzahl sein");
  }
  const status = alsStatus(feld.status);
  if (!status) fehler.push(`'status' muss einer von ${STATUS_WERTE.join(", ")} sein`);
  let erwartet: Status | null = null;
  if (feld.erwartet !== undefined && feld.erwartet !== null) {
    erwartet = alsStatus(feld.erwartet);
    if (!erwartet) fehler.push(`'erwartet' muss einer von ${STATUS_WERTE.join(", ")} sein`);
  }
  if (fehler.length) return { ok: false, fehler };
  return { ok: true, wert: { geruecht_id: id as number, status: status as Status, erwartet } };
}

// Übersetzt das Ergebnis der SQL-Funktion status_setzen in HTTP-Status und Antwort.
export function statusErgebnisZuHttp(erg: unknown): { status: number; body: Record<string, unknown> } {
  const e = (erg ?? {}) as Record<string, unknown>;
  switch (e.ergebnis) {
    case "ok":
      return { status: 200, body: { ergebnis: "ok", status: e.status, vorher: e.vorher } };
    case "unveraendert":
      return { status: 200, body: { ergebnis: "unveraendert", status: e.status } };
    case "konflikt":
      return {
        status: 409,
        body: { fehler: ["Der Status wurde inzwischen von jemand anderem geändert"], aktuell: e.status },
      };
    case "nicht_gefunden":
      return { status: 404, body: { fehler: ["Dieses Gerücht gibt es nicht"] } };
    default:
      return { status: 500, body: { fehler: ["Unerwartetes Ergebnis der Statusänderung"] } };
  }
}
