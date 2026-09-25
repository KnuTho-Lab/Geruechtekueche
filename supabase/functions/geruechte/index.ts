// GET /geruechte?status=<all|offen|...>: Geruechte gefiltert nach Status.
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";
import { baueGeruechtListe, parseStatusFilter } from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", async (req) => {
  const filter = parseStatusFilter(new URL(req.url).searchParams.get("status"));
  if (!filter.ok) return json(400, { fehler: filter.fehler });

  let abfrage = db()
    .from("geruechte")
    .select("geruecht_id, status, kategorien(name), meldungen(text, eingegangen_am)")
    .order("geruecht_id");
  if (filter.wert !== "all") abfrage = abfrage.eq("status", filter.wert);

  const { data, error } = await abfrage;
  if (error) throw error;
  const geruechte = baueGeruechtListe(data);
  return json(200, { status: filter.wert, anzahl: geruechte.length, geruechte });
}));
