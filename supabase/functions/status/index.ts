// GET /status?geruecht_id=<id>: Status eines einzelnen Geruechts.
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";
import { parseGeruechtId } from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", async (req) => {
  const id = parseGeruechtId(new URL(req.url).searchParams.get("geruecht_id"));
  if (!id.ok) return json(400, { fehler: id.fehler });

  const { data, error } = await db()
    .from("geruechte")
    .select("geruecht_id, status")
    .eq("geruecht_id", id.wert)
    .maybeSingle();
  if (error) throw error;
  if (!data) return json(404, { fehler: [`Gerücht ${id.wert} existiert nicht`] });
  return json(200, data);
}));
