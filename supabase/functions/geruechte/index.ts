// GET /geruechte?status=<all|offen|...>&limit=<1..200>&offset=<0..>: Geruechte gefiltert
// nach Status, seitenweise. Je Geruecht holt die Datenbank nur die Anzahl der Meldungen und
// die frueheste Meldung, nicht alle Texte: die Antwort bleibt klein, egal wie viel gemeldet wird.
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";
import { baueGeruechtListe, parsePaginierung, parseStatusFilter } from "../_shared/logik.ts";

Deno.serve(endpunkt("GET", async (req) => {
  const params = new URL(req.url).searchParams;
  const filter = parseStatusFilter(params.get("status"));
  if (!filter.ok) return json(400, { fehler: filter.fehler });
  const seite = parsePaginierung(params.get("limit"), params.get("offset"));
  if (!seite.ok) return json(400, { fehler: seite.fehler });
  const { limit, offset } = seite.wert;

  let abfrage = db()
    .from("geruechte")
    .select(
      "geruecht_id, status, kernaussage, kategorien(name), anzahl:meldungen(count), erste:meldungen(text, eingegangen_am)",
      { count: "exact" },
    )
    .order("eingegangen_am", { referencedTable: "erste", ascending: true })
    .limit(1, { referencedTable: "erste" })
    .order("geruecht_id")
    .range(offset, offset + limit - 1);
  if (filter.wert !== "all") abfrage = abfrage.eq("status", filter.wert);

  const { data, error, count } = await abfrage;
  // offset hinter dem letzten Treffer: PostgREST meldet 416 (PGRST103), fuer die API ist
  // das einfach eine leere Seite
  if (error?.code === "PGRST103") {
    let zaehlen = db().from("geruechte").select("geruecht_id", { count: "exact", head: true });
    if (filter.wert !== "all") zaehlen = zaehlen.eq("status", filter.wert);
    const z = await zaehlen;
    if (z.error) throw z.error;
    return json(200, { status: filter.wert, gesamt: z.count ?? 0, limit, offset, anzahl: 0, geruechte: [] });
  }
  if (error) throw error;
  const geruechte = baueGeruechtListe(data);
  return json(200, { status: filter.wert, gesamt: count ?? 0, limit, offset, anzahl: geruechte.length, geruechte });
}));
