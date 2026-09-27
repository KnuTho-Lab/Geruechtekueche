// GET /calls: Uebersicht aller Endpunkte mit Anleitung fuer den Agenten, Parametern samt
// Typ, Grenzen und Beispiel, Antwortfeldern und Fehlercodes.
import { endpunkt, json } from "../_shared/http.ts";
import {
  ABLAUF_FUER_AGENTEN,
  ALLGEMEINE_FEHLER,
  AUSGEHENDE_AUFRUFE,
  ENDPUNKTE,
  PROTOKOLLIERUNG,
} from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", () =>
  json(200, {
    basis_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1`,
    authentifizierung: "Header 'x-api-key' bei jedem Aufruf",
    ablauf_fuer_agenten: ABLAUF_FUER_AGENTEN,
    allgemeine_fehler: ALLGEMEINE_FEHLER,
    endpunkte: ENDPUNKTE,
    ausgehende_aufrufe: AUSGEHENDE_AUFRUFE,
    protokollierung: PROTOKOLLIERUNG,
  })));
