// POST /zuordnung_nachholen: ordnet offene Meldungen erneut zu (Zustand "offen", weil
// Embedding, Kandidatensuche oder Thomas' Pruef-Workflow beim ersten Versuch gescheitert
// sind). Die aeltesten zuerst, eine nach der anderen. Ohne Body die Standardanzahl.
// Dasselbe passiert im Hintergrund jeder neuen Meldung fuer bis zu 3 offene; dieser
// Endpunkt ist fuer das gezielte Nachholen, etwa nachdem der Workflow wieder laeuft.
import { endpunkt, json } from "../_shared/http.ts";
import { holeOffeneNach, zaehleOffene } from "../_shared/zuordnung.ts";
import { parseNachholAnzahl } from "../_shared/zuordnung_logik.ts";

Deno.serve(endpunkt("POST", async (req) => {
  const roh = await req.text();
  let body: unknown = null;
  if (roh.trim()) {
    try {
      body = JSON.parse(roh);
    } catch {
      return json(400, { fehler: ["Der Body ist kein gültiges JSON"] });
    }
  }
  const anzahl = parseNachholAnzahl(body);
  if (!anzahl.ok) return json(400, { fehler: anzahl.fehler });

  const ergebnisse = await holeOffeneNach(anzahl.wert);
  return json(200, {
    bearbeitet: ergebnisse.length,
    ergebnisse: ergebnisse.map((e) => ({
      meldung_id: e.meldung_id,
      zuordnung: e.art,
      geruecht_id: e.geruecht_id,
      neues_geruecht: e.neues_geruecht,
      fehler: e.fehler,
    })),
    noch_offen: await zaehleOffene(),
  });
}));
