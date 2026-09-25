// Embedding eines Meldungstexts ueber OpenRouter. Wirft nie: jeder Fehler kommt als
// Ergebnis zurueck, damit POST /meldung die Meldung trotzdem speichern kann.
// Die Pruefung der Antwort steckt in logik.ts (parseEmbeddingAntwort) und ist dort getestet.
import { baueEmbeddingAnfrage, EMBEDDING_URL, type Ergebnis, parseEmbeddingAntwort } from "./logik.ts";

const TIMEOUT_MS = 10_000;

export async function berechneEmbedding(text: string): Promise<Ergebnis<number[]>> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return { ok: false, fehler: ["OPENROUTER_API_KEY fehlt in der Umgebung"] };
  try {
    const antwort = await fetch(EMBEDDING_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(baueEmbeddingAnfrage(text)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let roh: unknown = null;
    try {
      roh = await antwort.json();
    } catch {
      // Kein JSON, etwa eine HTML-Fehlerseite: unten per Statuscode gemeldet
    }
    if (!antwort.ok) {
      const grund = parseEmbeddingAntwort(roh);
      const detail = grund.ok ? "" : `: ${grund.fehler[0]}`;
      return { ok: false, fehler: [`Embedding-Dienst antwortet mit HTTP ${antwort.status}${detail}`] };
    }
    return parseEmbeddingAntwort(roh);
  } catch (e) {
    const grund = e instanceof DOMException && e.name === "TimeoutError"
      ? `keine Antwort nach ${TIMEOUT_MS / 1000} s`
      : String(e);
    return { ok: false, fehler: [`Embedding-Dienst nicht erreichbar: ${grund}`] };
  }
}
