// GET /kategorien: alle erlaubten Kategorien mit Beschreibung (Umfang und Abgrenzung).
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";
import { baueKategorienListe } from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", async () => {
  const { data, error } = await db().from("kategorien").select("name, beschreibung").order("kategorie_id");
  if (error) throw error;
  return json(200, baueKategorienListe(data));
}));
