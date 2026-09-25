// GET /calls: Uebersicht aller Endpunkte mit ihren Parametern.
import { endpunkt, json } from "../_shared/http.ts";
import { ENDPUNKTE } from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", () =>
  json(200, {
    basis_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1`,
    authentifizierung: "Header 'x-api-key' bei jedem Aufruf",
    endpunkte: ENDPUNKTE,
  })));
