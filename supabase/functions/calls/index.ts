// GET /calls: Uebersicht aller Endpunkte mit Parametern, Antwortfeldern und Fehlercodes.
import { endpunkt, json } from "../_shared/http.ts";
import { ALLGEMEINE_FEHLER, AUSGEHENDE_AUFRUFE, ENDPUNKTE } from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", () =>
  json(200, {
    basis_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1`,
    authentifizierung: "Header 'x-api-key' bei jedem Aufruf",
    allgemeine_fehler: ALLGEMEINE_FEHLER,
    endpunkte: ENDPUNKTE,
    ausgehende_aufrufe: AUSGEHENDE_AUFRUFE,
  })));
