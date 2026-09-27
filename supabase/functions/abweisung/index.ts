// POST /abweisung: der Agent zaehlt eine Eingabe, die er nicht als Meldung speichert.
// Nur der Grund, nie der Text: die abgewiesene Eingabe kann genau das enthalten, was nicht
// gespeichert werden darf. Fuer die Abweisungs-Statistik im Dashboard.
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";
import { validiereAbweisung } from "../_shared/logik.ts";

Deno.serve(endpunkt("POST", async (req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { fehler: ["Der Body ist kein gültiges JSON"] });
  }
  const eingabe = validiereAbweisung(body);
  if (!eingabe.ok) return json(400, { fehler: eingabe.fehler });

  const { data, error } = await db()
    .from("abweisungen")
    .insert({ grund: eingabe.wert.grund })
    .select("abweisung_id, grund")
    .single();
  if (error) throw error;
  return json(201, data);
}));
