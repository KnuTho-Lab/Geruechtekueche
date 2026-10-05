// GET /arbeitsbereich: Gerüchte für den Arbeitsbereich des Dashboards (dashboard-k/, Tab 2).
//   ohne Parameter       -> Liste aller Gerüchte (ohne Meldungstexte)
//   ?geruecht_id=<id>    -> ein Gerücht mit Meldungen und Statushistorie
// Nur Konten aus BEARBEITER (knut, thomas), geprüft über das Login-Token. Ausgeliefert werden
// nie user_id, Embeddings oder Zuordnungs-Interna, die Auswahl trifft die SQL-Funktion.
import { db } from "../_shared/db.ts";
import { antwort, mitLogin } from "../_shared/login.ts";
import { parseGeruechtId } from "../_shared/logik.ts";

Deno.serve(mitLogin("arbeitsbereich", "GET", async (req, cors) => {
  const roh = new URL(req.url).searchParams.get("geruecht_id");
  if (roh === null) {
    const { data, error } = await db().rpc("arbeitsbereich_liste");
    if (error) {
      console.error("arbeitsbereich: Liste fehlgeschlagen:", error.message);
      return antwort(500, { fehler: ["Die Liste konnte nicht geladen werden"] }, cors);
    }
    return antwort(200, data, cors);
  }

  const id = parseGeruechtId(roh);
  if (!id.ok) return antwort(400, { fehler: id.fehler }, cors);
  const { data, error } = await db().rpc("arbeitsbereich_geruecht", { p_geruecht_id: id.wert });
  if (error) {
    console.error("arbeitsbereich: Detail fehlgeschlagen:", error.message);
    return antwort(500, { fehler: ["Das Gerücht konnte nicht geladen werden"] }, cors);
  }
  if (!data) return antwort(404, { fehler: ["Dieses Gerücht gibt es nicht"] }, cors);
  return antwort(200, data, cors);
}));
