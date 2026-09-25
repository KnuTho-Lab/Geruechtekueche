// POST /klassifizierung_setzen: der Klassifizierungs-Workflow schreibt Kategorie und
// Kernaussage eines Geruechts zurueck. Nur einmal: ein bereits klassifiziertes
// Geruecht wird nicht ueberschrieben (409).
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";
import { validiereKlassifizierung } from "../_shared/logik.ts";

Deno.serve(endpunkt("POST", async (req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { fehler: ["Der Body ist kein gültiges JSON"] });
  }
  const eingabe = validiereKlassifizierung(body);
  if (!eingabe.ok) return json(400, { fehler: eingabe.fehler });
  const k = eingabe.wert;

  // Kategorie per Name nachschlagen, das Backend vertraut dem LLM nicht blind
  const kat = await db().from("kategorien").select("kategorie_id").eq("name", k.kategorie).maybeSingle();
  if (kat.error) throw kat.error;
  if (!kat.data) {
    const alle = await db().from("kategorien").select("name").order("kategorie_id");
    if (alle.error) throw alle.error;
    return json(400, {
      fehler: [`Unbekannte Kategorie '${k.kategorie}'`],
      gueltige_kategorien: alle.data.map((z) => z.name),
    });
  }

  // Bedingtes Update in einem Schritt: greift nur, solange noch keine Kategorie gesetzt ist
  const upd = await db()
    .from("geruechte")
    .update({
      kategorie_id: kat.data.kategorie_id,
      kernaussage: k.kernaussage,
      kategorie_konfidenz: k.konfidenz,
      kategorie_begruendung: k.begruendung,
      manuell_pruefen: k.manuell_pruefen,
    })
    .eq("geruecht_id", k.geruecht_id)
    .is("kategorie_id", null)
    .select("geruecht_id");
  if (upd.error) throw upd.error;

  if (upd.data.length === 0) {
    const g = await db().from("geruechte").select("geruecht_id").eq("geruecht_id", k.geruecht_id).maybeSingle();
    if (g.error) throw g.error;
    if (!g.data) return json(404, { fehler: [`Gerücht ${k.geruecht_id} existiert nicht`] });
    return json(409, { fehler: [`Gerücht ${k.geruecht_id} ist bereits klassifiziert`] });
  }

  return json(200, k);
}));
