// POST /meldung: speichert eine Meldung. Mit geruecht_id wird sie diesem Geruecht
// zugeordnet, ohne entsteht zuerst ein neues, noch nicht klassifiziertes Geruecht.
// Die Kategorie vergibt danach ein eigener Klassifizierungs-Workflow.
// Spaeter uebernimmt hier der Vektorvergleich die Zuordnung.
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";
import { validiereMeldung } from "../_shared/logik.ts";

Deno.serve(endpunkt("POST", async (req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { fehler: ["Der Body ist kein gültiges JSON"] });
  }
  const eingabe = validiereMeldung(body);
  if (!eingabe.ok) return json(400, { fehler: eingabe.fehler });
  const m = eingabe.wert;

  let geruechtId: number;
  let neuesGeruecht = false;
  if (m.geruecht_id !== null) {
    const g = await db().from("geruechte").select("geruecht_id").eq("geruecht_id", m.geruecht_id).maybeSingle();
    if (g.error) throw g.error;
    if (!g.data) return json(404, { fehler: [`Gerücht ${m.geruecht_id} existiert nicht`] });
    geruechtId = m.geruecht_id;
  } else {
    // kategorie_id bleibt leer, Status startet per Standardwert als 'offen'
    const neu = await db().from("geruechte").insert({ kategorie_id: null }).select("geruecht_id").single();
    if (neu.error) throw neu.error;
    geruechtId = neu.data.geruecht_id;
    neuesGeruecht = true;
  }

  const meldung = await db()
    .from("meldungen")
    .insert({ geruecht_id: geruechtId, text: m.text, user_id: m.user_id })
    .select("meldung_id")
    .single();
  if (meldung.error) {
    // Keine leere Akte zuruecklassen, wenn die Meldung selbst nicht gespeichert wurde
    if (neuesGeruecht) await db().from("geruechte").delete().eq("geruecht_id", geruechtId);
    throw meldung.error;
  }

  return json(201, { meldung_id: meldung.data.meldung_id, geruecht_id: geruechtId, neues_geruecht: neuesGeruecht });
}));
