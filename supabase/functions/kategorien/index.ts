// GET /kategorien: alle erlaubten Kategorien als Namensliste.
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";

Deno.serve(endpunkt("GET", async () => {
  const { data, error } = await db().from("kategorien").select("name").order("kategorie_id");
  if (error) throw error;
  return json(200, { kategorien: data.map((z) => z.name) });
}));
