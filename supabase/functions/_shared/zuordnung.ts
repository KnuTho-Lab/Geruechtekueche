// Zuordnung einer offenen Meldung zu einem Geruecht: Embedding, Kandidatensuche, Zonen und
// gegebenenfalls die LLM-Pruefung in Thomas' n8n-Workflow. Genutzt von POST /meldung (gleich
// nach dem Speichern) und von POST /zuordnung_nachholen. Die Entscheidungen selbst stecken
// in zuordnung_logik.ts und sind dort getestet, hier nur Datenbank und Netz.
// Grundsatz (Knut, 2026-09-30): scheitert irgendetwas, bleibt die Meldung offen und wird
// nachgeholt. Es entsteht nie ein neues Geruecht, nur weil ein Dienst ausgefallen ist.
import { db } from "./db.ts";
import { berechneEmbedding } from "./embedding.ts";
import { vektorAlsText } from "./logik.ts";
import {
  BEISPIELE_MAX,
  baueZuordnungsAnfrage,
  entscheideZone,
  type Kandidat,
  type KandidatDetail,
  KANDIDATEN_MAX,
  type Kennzahlen,
  kennzahlen,
  leseZuordnungsKonfig,
  NACHBARN,
  parseKandidaten,
  rufeZuordnungsWebhook,
  type ZuordnungsErgebnis,
} from "./zuordnung_logik.ts";

export interface OffeneMeldung {
  meldung_id: number;
  text: string;
  embedding: string | null;
}

export interface Nachholergebnis extends ZuordnungsErgebnis {
  meldung_id: number;
  fehler: string | null;
}



const OFFEN = (fehler: string): ZuordnungsErgebnis & { fehler: string } => ({
  art: "offen",
  geruecht_id: null,
  neues_geruecht: false,
  geruecht_aehnlichkeit: null,
  fehler,
});

// Das Protokoll darf nie die Zuordnung verhindern
async function protokolliere(eintrag: {
  meldung_id: number;
  kandidaten: Kandidat[];
  ergebnis: "gleich" | "keiner" | "fehler";
  geruecht_id?: number | null;
  begruendung?: string | null;
  dauer_ms?: number | null;
  fehler?: string | null;
}): Promise<void> {
  try {
    const { error } = await db().from("zuordnung_pruefungen").insert({
      meldung_id: eintrag.meldung_id,
      kandidaten: eintrag.kandidaten,
      ergebnis: eintrag.ergebnis,
      geruecht_id: eintrag.geruecht_id ?? null,
      begruendung: eintrag.begruendung ?? null,
      dauer_ms: eintrag.dauer_ms ?? null,
      fehler: eintrag.fehler ?? null,
    });
    if (error) console.error("Zuordnungs-Protokoll nicht gespeichert:", error.message);
  } catch (e) {
    console.error("Zuordnungs-Protokoll nicht gespeichert:", e);
  }
}

async function bleibtOffen(meldungId: number, kandidaten: Kandidat[], grund: string, dauerMs: number | null = null) {
  console.error(`Meldung ${meldungId} bleibt offen: ${grund}`);
  await protokolliere({ meldung_id: meldungId, kandidaten, ergebnis: "fehler", fehler: grund, dauer_ms: dauerMs });
  return OFFEN(grund);
}

// Atomar per SQL-Funktion meldung_zuordnen: legt bei geruechtId null das neue Geruecht im
// selben Schritt an. Liefert die Funktion null, war die Meldung schon zugeordnet (ein
// gleichzeitiger Nachhol-Versuch war schneller): dann gilt dessen Ergebnis.
async function ordneEin(
  meldungId: number,
  geruechtId: number | null,
  art: "embedding" | "geprueft" | "neu",
  kz: Kennzahlen,
  kandidaten: Kandidat[],
): Promise<ZuordnungsErgebnis & { fehler: string | null }> {
  const r = await db().rpc("meldung_zuordnen", {
    p_meldung_id: meldungId,
    p_geruecht_id: geruechtId,
    p_art: art,
    p_beste_aehnlichkeit: kz.beste_aehnlichkeit,
    p_geruecht_aehnlichkeit: kz.geruecht_aehnlichkeit,
  });
  if (r.error) return await bleibtOffen(meldungId, kandidaten, `Zuordnen fehlgeschlagen: ${r.error.message}`);
  if (r.data === null) {
    const jetzt = await db().from("meldungen").select("geruecht_id, zuordnung_art, geruecht_aehnlichkeit")
      .eq("meldung_id", meldungId).single();
    if (jetzt.error) throw jetzt.error;
    return {
      art: jetzt.data.zuordnung_art,
      geruecht_id: jetzt.data.geruecht_id,
      neues_geruecht: false,
      geruecht_aehnlichkeit: jetzt.data.geruecht_aehnlichkeit,
      fehler: null,
    };
  }
  return {
    art,
    geruecht_id: r.data as number,
    neues_geruecht: geruechtId === null,
    geruecht_aehnlichkeit: kz.geruecht_aehnlichkeit,
    fehler: null,
  };
}

// Kernaussage und die ersten BEISPIELE_MAX Meldungen je Kandidat, in Kandidaten-Reihenfolge
async function ladeDetails(ids: number[]): Promise<KandidatDetail[]> {
  const g = await db().from("geruechte").select("geruecht_id, kernaussage").in("geruecht_id", ids);
  if (g.error) throw g.error;
  const m = await db().from("meldungen").select("geruecht_id, text").in("geruecht_id", ids)
    .order("eingegangen_am").order("meldung_id");
  if (m.error) throw m.error;
  return ids.map((id) => ({
    geruecht_id: id,
    kernaussage: g.data.find((z) => z.geruecht_id === id)?.kernaussage ?? null,
    beispiele: m.data.filter((z) => z.geruecht_id === id).map((z) => z.text).slice(0, BEISPIELE_MAX),
  }));
}

export async function ordneMeldungZu(m: OffeneMeldung): Promise<ZuordnungsErgebnis & { fehler: string | null }> {
  // 1. Embedding, falls es beim Speichern gescheitert war
  let vektor = m.embedding;
  if (vektor === null) {
    const emb = await berechneEmbedding(m.text);
    if (!emb.ok) return await bleibtOffen(m.meldung_id, [], `Embedding fehlgeschlagen: ${emb.fehler[0]}`);
    vektor = vektorAlsText(emb.wert);
    const upd = await db().from("meldungen").update({ embedding: vektor, embedding_fehler: null })
      .eq("meldung_id", m.meldung_id);
    if (upd.error) return await bleibtOffen(m.meldung_id, [], `Embedding nicht gespeichert: ${upd.error.message}`);
  }

  // 2. Kandidaten nach Average Linkage
  const suche = await db().rpc("geruecht_kandidaten", {
    p_embedding: vektor,
    p_anzahl: KANDIDATEN_MAX,
    p_nachbarn: NACHBARN,
  });
  const kandidaten = suche.error ? null : parseKandidaten(suche.data);
  if (!kandidaten?.ok) {
    return await bleibtOffen(m.meldung_id, [], `Kandidatensuche fehlgeschlagen: ${suche.error?.message ?? kandidaten?.fehler[0]}`);
  }
  const alle = kandidaten.wert;
  const kz = kennzahlen(alle);
  const zone = entscheideZone(alle);

  // 3. Sicher oder neu: ohne Pruefung
  if (zone.zone === "sicher") return await ordneEin(m.meldung_id, zone.kandidat.geruecht_id, "embedding", kz, alle);
  if (zone.zone === "neu") return await ordneEin(m.meldung_id, null, "neu", kz, alle);

  // 4. Graubereich: Thomas' Workflow entscheidet
  const konfig = leseZuordnungsKonfig((n) => Deno.env.get(n));
  if (!konfig) {
    return await bleibtOffen(m.meldung_id, zone.kandidaten, "Zuordnungs-Webhook nicht konfiguriert (ZUORDNUNG_WEBHOOK_URL/SECRET)");
  }
  const ids = zone.kandidaten.map((k) => k.geruecht_id);
  let details: KandidatDetail[];
  try {
    details = await ladeDetails(ids);
  } catch (e) {
    return await bleibtOffen(m.meldung_id, zone.kandidaten, `Kandidaten nicht lesbar: ${String(e)}`);
  }
  const start = performance.now();
  const antwort = await rufeZuordnungsWebhook(konfig, baueZuordnungsAnfrage(m, details), ids);
  const dauer = Math.round(performance.now() - start);
  if (!antwort.ok) return await bleibtOffen(m.meldung_id, zone.kandidaten, antwort.fehler[0], dauer);

  const ziel = antwort.wert.geruecht_id;
  await protokolliere({
    meldung_id: m.meldung_id,
    kandidaten: zone.kandidaten,
    ergebnis: ziel === null ? "keiner" : "gleich",
    geruecht_id: ziel,
    begruendung: antwort.wert.begruendung,
    dauer_ms: dauer,
  });
  // Bei "gleich" zaehlt die Aehnlichkeit des gewaehlten Geruechts, nicht die des besten
  const gewaehlt = zone.kandidaten.find((k) => k.geruecht_id === ziel);
  const kzZiel = gewaehlt ? { ...kz, geruecht_aehnlichkeit: gewaehlt.aehnlichkeit } : kz;
  return await ordneEin(m.meldung_id, ziel, ziel === null ? "neu" : "geprueft", kzZiel, zone.kandidaten);
}

// Holt die aeltesten offenen Meldungen nach, eine nach der anderen (nicht parallel, siehe
// die Ausfaelle beim gleichzeitigen Versand an den Klassifizierer am 2026-09-30)
export async function holeOffeneNach(anzahl: number, ausser: number | null = null): Promise<Nachholergebnis[]> {
  let abfrage = db().from("meldungen").select("meldung_id, text, embedding")
    .eq("zuordnung_art", "offen").order("eingegangen_am").order("meldung_id").limit(anzahl);
  if (ausser !== null) abfrage = abfrage.neq("meldung_id", ausser);
  const offen = await abfrage;
  if (offen.error) throw offen.error;
  const ergebnisse: Nachholergebnis[] = [];
  for (const m of offen.data as OffeneMeldung[]) {
    try {
      ergebnisse.push({ meldung_id: m.meldung_id, ...(await ordneMeldungZu(m)) });
    } catch (e) {
      console.error(`Nachholen von Meldung ${m.meldung_id} fehlgeschlagen:`, e);
      ergebnisse.push({ meldung_id: m.meldung_id, ...OFFEN(`Nachholen fehlgeschlagen: ${String(e)}`) });
    }
  }
  return ergebnisse;
}

export async function zaehleOffene(): Promise<number> {
  const { count, error } = await db().from("meldungen").select("meldung_id", { count: "exact", head: true })
    .eq("zuordnung_art", "offen");
  if (error) throw error;
  return count ?? 0;
}
