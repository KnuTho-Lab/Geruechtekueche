// POST /risiko_nachholen: liefert das Risiko fuer klassifizierte Geruechte nach, deren Modell-
// Aufruf nicht geklappt hat (risiko_status 'queue'). Aelteste zuerst, ein einziger Aufruf des
// Modells fuer alle. Knut stoesst das selbst an, nachdem sein Rechner und der Docker-Container
// wieder laufen. Nur Geruechte in der Queue werden angefasst, nie ein berechneter Wert.
import { db } from "../_shared/db.ts";
import { endpunkt, json } from "../_shared/http.ts";
import {
  leseRisikoKonfig,
  parseRisikoNachholAnzahl,
  RISIKO_MODELL,
  RISIKO_TEXT_MAX,
  rufeRisikomodell,
} from "../_shared/risiko_logik.ts";

async function zaehleQueue(): Promise<number> {
  const z = await db().from("geruechte").select("geruecht_id", { count: "exact", head: true })
    .eq("risiko_status", "queue");
  if (z.error) throw z.error;
  return z.count ?? 0;
}

Deno.serve(endpunkt("POST", async (req) => {
  const roh = await req.text();
  let body: unknown = null;
  if (roh.trim()) {
    try {
      body = JSON.parse(roh);
    } catch {
      return json(400, { fehler: ["Der Body ist kein gültiges JSON"] });
    }
  }
  const anzahl = parseRisikoNachholAnzahl(body);
  if (!anzahl.ok) return json(400, { fehler: anzahl.fehler });

  const konfig = leseRisikoKonfig((n) => Deno.env.get(n));
  if (!konfig) return json(503, { fehler: ["Risikomodell nicht konfiguriert (Secrets RISIKO_URL und RISIKO_TOKEN)"] });

  // Die Queue, aelteste zuerst, je Geruecht der Text der ersten Meldung
  const q = await db()
    .from("geruechte")
    .select("geruecht_id, erste:meldungen(text, eingegangen_am)")
    .eq("risiko_status", "queue")
    .order("eingegangen_am", { referencedTable: "erste", ascending: true })
    .limit(1, { referencedTable: "erste" })
    .order("geruecht_id")
    .limit(anzahl.wert);
  if (q.error) throw q.error;

  const kandidaten = q.data.map((g) => ({
    geruecht_id: g.geruecht_id as number,
    text: ((g.erste as { text: string }[] | null)?.[0]?.text ?? "").trim().slice(0, RISIKO_TEXT_MAX),
  }));
  const ohneText = kandidaten.filter((k) => k.text === "");
  const bewertbar = kandidaten.filter((k) => k.text !== "");
  if (bewertbar.length === 0) {
    return json(200, {
      bearbeitet: 0,
      ergebnisse: ohneText.map((k) => ({ geruecht_id: k.geruecht_id, risiko: null, fehler: "keine Meldung mit Text" })),
      noch_in_queue: await zaehleQueue(),
    });
  }

  const antwort = await rufeRisikomodell(konfig, bewertbar.map((k) => k.text));
  if (!antwort.ok) {
    return json(502, {
      fehler: antwort.fehler,
      hinweis: "Alle Gerüchte bleiben in der Queue. Läuft der Rechner und der Container 'geruechte-risiko'?",
      noch_in_queue: await zaehleQueue(),
    });
  }

  const ergebnisse: { geruecht_id: number; risiko: number | null; fehler: string | null }[] = [];
  for (const [i, k] of bewertbar.entries()) {
    const risiko = antwort.wert[i];
    // Bedingt auf 'queue': ein gleichzeitiger Lauf oder ein Eingriff von Hand wird nie ueberschrieben
    const upd = await db().from("geruechte")
      .update({
        risiko,
        risiko_status: "berechnet",
        risiko_berechnet_am: new Date().toISOString(),
        risiko_modell: RISIKO_MODELL,
      })
      .eq("geruecht_id", k.geruecht_id)
      .eq("risiko_status", "queue")
      .select("geruecht_id");
    if (upd.error) {
      ergebnisse.push({ geruecht_id: k.geruecht_id, risiko: null, fehler: upd.error.message });
    } else if (upd.data.length === 0) {
      ergebnisse.push({ geruecht_id: k.geruecht_id, risiko: null, fehler: "nicht mehr in der Queue" });
    } else {
      ergebnisse.push({ geruecht_id: k.geruecht_id, risiko, fehler: null });
    }
  }
  for (const k of ohneText) {
    ergebnisse.push({ geruecht_id: k.geruecht_id, risiko: null, fehler: "keine Meldung mit Text" });
  }
  return json(200, {
    bearbeitet: ergebnisse.filter((e) => e.fehler === null).length,
    ergebnisse,
    noch_in_queue: await zaehleQueue(),
  });
}));
