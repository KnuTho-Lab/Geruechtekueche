// GET /meldungsschema: Bauanleitung fuer POST /meldung.
import { endpunkt, json } from "../_shared/http.ts";
import {
  MELDUNG_ANTWORT_BEISPIEL,
  MELDUNG_ANTWORT_FELDER,
  MELDUNG_BEISPIEL,
  MELDUNG_FEHLER,
  MELDUNGSSCHEMA,
} from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", () =>
  json(200, {
    endpunkt: "POST /functions/v1/meldung",
    header: { "Content-Type": "application/json", "x-api-key": "<euer Schlüssel>" },
    schema: MELDUNGSSCHEMA,
    beispiel: MELDUNG_BEISPIEL,
    antwort_beispiel: MELDUNG_ANTWORT_BEISPIEL,
    antwort_felder: MELDUNG_ANTWORT_FELDER,
    fehler: MELDUNG_FEHLER,
  })));
