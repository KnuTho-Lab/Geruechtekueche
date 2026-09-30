// POST /meldung: speichert eine Meldung samt Embedding.
// Mit geruecht_id wird sie genau diesem Geruecht zugeordnet (expliziter Override).
// Ohne wird sie zuerst im Zustand "offen" (noch ohne Geruecht) gespeichert und gleich danach
// zugeordnet (_shared/zuordnung.ts): Kandidaten nach Average Linkage, ab 0,95 sicher, im
// Graubereich 0,75 bis 0,95 entscheidet Thomas' n8n-Workflow, darunter neues Geruecht.
// Scheitert dabei etwas (Embedding, Suche, Workflow), bleibt die Meldung offen und wird
// nachgeholt: im Hintergrund jeder weiteren Meldung und per POST /zuordnung_nachholen.
// Eine Meldung geht nie verloren, und ein Ausfall erzeugt nie ein neues Geruecht.
// Die Kategorie vergibt danach der Klassifizierungs-Workflow (Trigger auf meldungen).
import { db } from "../_shared/db.ts";
import { berechneEmbedding } from "../_shared/embedding.ts";
import { endpunkt, json } from "../_shared/http.ts";
import { leseRateLimits, pruefeRateLimit, validiereMeldung, vektorAlsText } from "../_shared/logik.ts";
import { holeOffeneNach, ordneMeldungZu } from "../_shared/zuordnung.ts";
import { baueMeldungAntwort, NACHHOLEN_HUCKEPACK, type ZuordnungsErgebnis } from "../_shared/zuordnung_logik.ts";

// Laeuft nach der Antwort weiter, damit das Nachholen die meldende Person nicht warten laesst
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
function imHintergrund(arbeit: () => Promise<unknown>): void {
  if (typeof EdgeRuntime === "undefined") return;
  EdgeRuntime.waitUntil(arbeit().catch((e) => console.error("Nachholen im Hintergrund fehlgeschlagen:", e)));
}

// Zaehlt die gespeicherten Meldungen je Zeitfenster. Nicht atomar: bei gleichzeitigen
// Aufrufen kann das Limit knapp ueberschritten werden, als Bremse reicht das.
async function zaehleMeldungen(fensterSekunden: number): Promise<number> {
  const seit = new Date(Date.now() - fensterSekunden * 1000).toISOString();
  const { count, error } = await db()
    .from("meldungen")
    .select("meldung_id", { count: "exact", head: true })
    .gte("eingegangen_am", seit);
  if (error) throw error;
  return count ?? 0;
}

Deno.serve(endpunkt("POST", async (req) => {
  // Vor allem anderen, damit ein Ausreisser weder Embeddings noch Klassifizierungen kostet
  const limits = leseRateLimits((name) => Deno.env.get(name));
  const anzahl = await Promise.all(limits.map((l) => zaehleMeldungen(l.fenster_sekunden)));
  const bremse = pruefeRateLimit(limits, anzahl);
  if (!bremse.ok) {
    console.error("Rate-Limit erreicht:", bremse.fehler);
    return json(429, { fehler: bremse.fehler }, { "Retry-After": String(bremse.retry_after) });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { fehler: ["Der Body ist kein gültiges JSON"] });
  }
  const eingabe = validiereMeldung(body);
  if (!eingabe.ok) return json(400, { fehler: eingabe.fehler });
  const m = eingabe.wert;

  // Erst pruefen, dann das Embedding bezahlen
  if (m.geruecht_id !== null) {
    const g = await db().from("geruechte").select("geruecht_id").eq("geruecht_id", m.geruecht_id).maybeSingle();
    if (g.error) throw g.error;
    if (!g.data) return json(404, { fehler: [`Gerücht ${m.geruecht_id} existiert nicht`] });
  }

  // Embedding immer berechnen, auch bei expliziter geruecht_id: spaetere Meldungen
  // sollen auch diese Meldung finden koennen
  let embeddingFehler: string | null = null;
  const emb = await berechneEmbedding(m.text);
  if (!emb.ok) {
    console.error("Embedding fehlgeschlagen:", emb.fehler[0]);
    embeddingFehler = emb.fehler[0];
  }
  const vektorText = emb.ok ? vektorAlsText(emb.wert) : null;

  // Mit geruecht_id sofort dort, sonst erst offen und gleich danach zugeordnet
  const explizit = m.geruecht_id !== null;
  const speichern = (embedding: string | null) =>
    db()
      .from("meldungen")
      .insert({
        geruecht_id: m.geruecht_id,
        zuordnung_art: explizit ? "explizit" : "offen",
        text: m.text,
        user_id: m.user_id,
        standort: m.standort,
        emotion: m.emotion,
        quellenkette: m.quellenkette,
        geschwaerzte_namen: m.geschwaerzte_namen,
        embedding,
        embedding_fehler: embeddingFehler,
      })
      .select("meldung_id")
      .single();

  let meldung = await speichern(vektorText);
  let gespeicherterVektor = vektorText;
  if (meldung.error && vektorText !== null) {
    // Scheitert es am Embedding, die Meldung wenigstens ohne speichern
    console.error("Speichern mit Embedding fehlgeschlagen, neuer Versuch ohne:", meldung.error);
    embeddingFehler = "Embedding konnte nicht gespeichert werden, Details im Function-Log";
    gespeicherterVektor = null;
    meldung = await speichern(null);
  }
  if (meldung.error) throw meldung.error;
  const meldungId: number = meldung.data.meldung_id;

  let zuordnung: ZuordnungsErgebnis;
  if (explizit) {
    zuordnung = { art: "explizit", geruecht_id: m.geruecht_id, neues_geruecht: false, geruecht_aehnlichkeit: null };
  } else if (gespeicherterVektor === null) {
    // Ohne Embedding keine Suche: offen lassen, das Nachholen berechnet es erneut. Nicht
    // sofort noch einmal versuchen, der Dienst ist gerade ausgefallen.
    zuordnung = { art: "offen", geruecht_id: null, neues_geruecht: false, geruecht_aehnlichkeit: null };
  } else {
    zuordnung = await ordneMeldungZu({ meldung_id: meldungId, text: m.text, embedding: gespeicherterVektor });
  }

  imHintergrund(() => holeOffeneNach(NACHHOLEN_HUCKEPACK, meldungId));
  return json(201, baueMeldungAntwort(meldungId, zuordnung, embeddingFehler));
}));
