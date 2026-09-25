// GET /meldungsschema: Bauanleitung fuer POST /meldung.
import { endpunkt, json } from "../_shared/http.ts";
import { MELDUNG_BEISPIEL, MELDUNGSSCHEMA } from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", () =>
  json(200, {
    endpunkt: "POST /functions/v1/meldung",
    header: { "Content-Type": "application/json", "x-api-key": "<euer Schlüssel>" },
    schema: MELDUNGSSCHEMA,
    beispiel: MELDUNG_BEISPIEL,
    antwort_beispiel: { meldung_id: 12, geruecht_id: 7, neues_geruecht: true },
    fehler: {
      "400": "Body ungültig oder Kategorie unbekannt, Details in 'fehler'",
      "401": "x-api-key fehlt oder ist falsch",
      "404": "geruecht_id angegeben, aber das Gerücht existiert nicht",
    },
  })));
