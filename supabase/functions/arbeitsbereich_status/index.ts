// POST /arbeitsbereich_status: Status eines Gerüchts ändern (Dashboard, Tab 2).
// Body: { "geruecht_id": 12, "status": "bestätigt", "erwartet": "offen" }
// "erwartet" ist der Status, den die Seite gerade sieht; weicht der echte ab, antwortet die
// Function mit 409, damit zwei Personen sich nicht unbemerkt überschreiben.
// Nur Konten aus BEARBEITER (knut, thomas). Der Nutzername kommt aus dem Login-Token, nie aus
// dem Body, und landet in status_historie (geschrieben vom Trigger, siehe Migration 20261005140000).
import { db } from "../_shared/db.ts";
import { antwort, mitLogin } from "../_shared/login.ts";
import { statusErgebnisZuHttp, validiereStatusAnfrage } from "../_shared/arbeitsbereich_logik.ts";

Deno.serve(mitLogin("arbeitsbereich_status", "POST", async (req, cors, bearbeiter) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return antwort(400, { fehler: ["Der Body ist kein gültiges JSON"] }, cors);
  }
  const eingabe = validiereStatusAnfrage(body);
  if (!eingabe.ok) return antwort(400, { fehler: eingabe.fehler }, cors);

  const { data, error } = await db().rpc("status_setzen", {
    p_geruecht_id: eingabe.wert.geruecht_id,
    p_neu: eingabe.wert.status,
    p_erwartet: eingabe.wert.erwartet,
    p_von: bearbeiter,
  });
  if (error) {
    console.error("arbeitsbereich_status: fehlgeschlagen:", error.message);
    return antwort(500, { fehler: ["Der Status konnte nicht geändert werden"] }, cors);
  }
  const erg = statusErgebnisZuHttp(data);
  return antwort(erg.status, erg.body, cors);
}));
