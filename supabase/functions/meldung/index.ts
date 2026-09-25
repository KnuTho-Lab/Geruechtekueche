// POST /meldung: speichert eine Meldung samt Embedding.
// Mit geruecht_id wird sie genau diesem Geruecht zugeordnet (expliziter Override).
// Ohne sucht die Datenbank die aehnlichste bisherige Meldung; liegt deren Aehnlichkeit
// ueber der Schwelle, landet die neue Meldung in deren Geruecht, sonst entsteht ein
// neues, noch nicht klassifiziertes Geruecht. Die Kategorie vergibt danach ein eigener
// Klassifizierungs-Workflow.
// Faellt der Embedding-Dienst oder die Suche aus, wird die Meldung trotzdem gespeichert
// (ohne Embedding, ohne geruecht_id in einem neuen Geruecht) und der Grund in
// embedding_fehler gemeldet. Eine Meldung darf nie verloren gehen.
import { db } from "../_shared/db.ts";
import { berechneEmbedding } from "../_shared/embedding.ts";
import { endpunkt, json } from "../_shared/http.ts";
import {
  AEHNLICHKEITS_SCHWELLE,
  entscheideZuordnung,
  parseTreffer,
  type Treffer,
  validiereMeldung,
  vektorAlsText,
} from "../_shared/logik.ts";

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
    console.error("Embedding fehlgeschlagen:", emb.fehler);
    embeddingFehler = emb.fehler[0];
  }
  const vektorText = emb.ok ? vektorAlsText(emb.wert) : null;

  let treffer: Treffer | null = null;
  if (m.geruecht_id === null && vektorText !== null) {
    const suche = await db().rpc("aehnlichstes_geruecht", {
      p_embedding: vektorText,
      p_schwelle: AEHNLICHKEITS_SCHWELLE,
    });
    const t = suche.error ? null : parseTreffer(suche.data);
    if (t?.ok) {
      treffer = t.wert;
    } else {
      console.error("Aehnlichkeitssuche fehlgeschlagen:", suche.error ?? t?.fehler);
      embeddingFehler = "Ähnlichkeitssuche fehlgeschlagen, Details im Function-Log";
    }
  }

  const zuordnung = entscheideZuordnung(m.geruecht_id, treffer);
  let geruechtId: number;
  let neuesGeruecht = false;
  if (zuordnung.geruecht_id !== null) {
    geruechtId = zuordnung.geruecht_id;
  } else {
    // kategorie_id bleibt leer, Status startet per Standardwert als 'offen'
    const neu = await db().from("geruechte").insert({ kategorie_id: null }).select("geruecht_id").single();
    if (neu.error) throw neu.error;
    geruechtId = neu.data.geruecht_id;
    neuesGeruecht = true;
  }

  const speichern = (embedding: string | null) =>
    db()
      .from("meldungen")
      .insert({ geruecht_id: geruechtId, text: m.text, user_id: m.user_id, embedding })
      .select("meldung_id")
      .single();

  let meldung = await speichern(vektorText);
  if (meldung.error && vektorText !== null) {
    // Scheitert es am Embedding, die Meldung wenigstens ohne speichern
    console.error("Speichern mit Embedding fehlgeschlagen, neuer Versuch ohne:", meldung.error);
    embeddingFehler = "Embedding konnte nicht gespeichert werden, Details im Function-Log";
    meldung = await speichern(null);
  }
  if (meldung.error) {
    // Keine leere Akte zuruecklassen, wenn die Meldung selbst nicht gespeichert wurde
    if (neuesGeruecht) await db().from("geruechte").delete().eq("geruecht_id", geruechtId);
    throw meldung.error;
  }

  return json(201, {
    meldung_id: meldung.data.meldung_id,
    geruecht_id: geruechtId,
    neues_geruecht: neuesGeruecht,
    per_embedding_zugeordnet: zuordnung.art === "embedding",
    aehnlichkeit: zuordnung.aehnlichkeit,
    embedding_fehler: embeddingFehler,
  });
}));
