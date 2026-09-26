// Tests fuer die reine Logik der Edge Functions (ohne Netzwerk und ohne Datenbank).
// Ausfuehren: deno test supabase/functions/tests/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  AEHNLICHKEITS_SCHWELLE,
  baueEmbeddingAnfrage,
  baueGeruechtListe,
  BEGRUENDUNG_MAX,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODELL,
  ENDPUNKTE,
  entscheideZuordnung,
  KERNAUSSAGE_MAX,
  leseRateLimits,
  MELDUNG_ANTWORT_BEISPIEL,
  MELDUNG_ANTWORT_FELDER,
  MELDUNG_BEISPIEL,
  parseEmbeddingAntwort,
  parseTreffer,
  parseGeruechtId,
  parsePaginierung,
  parseStatusFilter,
  pruefeApiKey,
  pruefeRateLimit,
  RATE_LIMITS,
  SEITE_MAX,
  SEITE_STANDARD,
  STATUS_WERTE,
  TEXT_MAX,
  validiereKlassifizierung,
  validiereMeldung,
  vektorAlsText,
  waehleAdminKey,
} from "../_shared/logik.ts";

// --- parseStatusFilter -------------------------------------------------------

Deno.test("status: fehlt -> Fehler mit erlaubten Werten", () => {
  const e = parseStatusFilter(null);
  assert(!e.ok);
  assert(e.fehler[0].includes("all"));
});

Deno.test("status: leer -> Fehler", () => {
  assert(!parseStatusFilter("").ok);
  assert(!parseStatusFilter("   ").ok);
});

Deno.test("status: all ist erlaubt", () => {
  assertEquals(parseStatusFilter("all"), { ok: true, wert: "all" });
});

Deno.test("status: jeder Wert aus dem Plan ist erlaubt", () => {
  for (const s of STATUS_WERTE) {
    assertEquals(parseStatusFilter(s), { ok: true, wert: s });
  }
});

Deno.test("status: Leerzeichen am Rand werden ignoriert", () => {
  assertEquals(parseStatusFilter(" offen "), { ok: true, wert: "offen" });
});

Deno.test("status: unbekannter Wert -> Fehler", () => {
  assert(!parseStatusFilter("geschlossen").ok);
  assert(!parseStatusFilter("Offen").ok);
});

// --- parseGeruechtId ---------------------------------------------------------

Deno.test("geruecht_id: positive Ganzzahl als Zahl oder Text", () => {
  assertEquals(parseGeruechtId(7), { ok: true, wert: 7 });
  assertEquals(parseGeruechtId("7"), { ok: true, wert: 7 });
});

Deno.test("geruecht_id: ungueltige Werte", () => {
  for (const roh of [null, undefined, "", "abc", "7.5", "-3", "0", 0, -1, 1.5, "1e3", true, {}]) {
    assert(!parseGeruechtId(roh).ok, `sollte ungueltig sein: ${JSON.stringify(roh)}`);
  }
});

// --- validiereMeldung --------------------------------------------------------

Deno.test("meldung: Minimalfall nur text", () => {
  assertEquals(validiereMeldung({ text: "X wird aufgelöst" }), {
    ok: true,
    wert: { text: "X wird aufgelöst", user_id: null, geruecht_id: null },
  });
});

Deno.test("meldung: alle Felder, Text wird getrimmt", () => {
  const e = validiereMeldung({ text: "  X  ", user_id: "u1", geruecht_id: 3 });
  assertEquals(e, { ok: true, wert: { text: "X", user_id: "u1", geruecht_id: 3 } });
});

Deno.test("meldung: null bei optionalen Feldern ist erlaubt", () => {
  assert(validiereMeldung({ text: "X", user_id: null, geruecht_id: null }).ok);
});

Deno.test("meldung: kein Objekt -> Fehler", () => {
  for (const body of [null, "text", 42, ["text"]]) {
    assert(!validiereMeldung(body).ok);
  }
});

Deno.test("meldung: Text fehlt -> Fehler", () => {
  const e = validiereMeldung({});
  assert(!e.ok);
  assertEquals(e.fehler.length, 1);
});

Deno.test("meldung: leerer Text -> Fehler", () => {
  assert(!validiereMeldung({ text: "   " }).ok);
});

Deno.test("meldung: Text zu lang -> Fehler, Grenze selbst ist erlaubt", () => {
  assert(validiereMeldung({ text: "a".repeat(TEXT_MAX) }).ok);
  assert(!validiereMeldung({ text: "a".repeat(TEXT_MAX + 1) }).ok);
});

Deno.test("meldung: falsche Typen -> Fehler", () => {
  assert(!validiereMeldung({ text: 5 }).ok);
  assert(!validiereMeldung({ text: "X", user_id: 12 }).ok);
  assert(!validiereMeldung({ text: "X", geruecht_id: "sieben" }).ok);
});

Deno.test("meldung: Kategorie wird abgelehnt, die vergibt der Klassifizierungs-Workflow", () => {
  const e = validiereMeldung({ text: "X", kategorie: "Personal" });
  assert(!e.ok);
  assert(e.fehler[0].includes("kategorie"));
});

Deno.test("meldung: Tippfehler im Feldnamen wird abgelehnt statt ignoriert", () => {
  // geruechte_id statt geruecht_id wuerde sonst still ein neues Geruecht anlegen
  const e = validiereMeldung({ text: "X", geruechte_id: 7 });
  assert(!e.ok);
  assert(e.fehler[0].includes("geruechte_id"));
});

Deno.test("meldung: das Beispiel aus dem Schema ist selbst gueltig", () => {
  assert(validiereMeldung(MELDUNG_BEISPIEL).ok);
});

// --- validiereKlassifizierung -----------------------------------------------

Deno.test("klassifizierung: Minimalfall, Texte getrimmt, Protokollfelder mit Standardwerten", () => {
  assertEquals(
    validiereKlassifizierung({ geruecht_id: 7, kategorie: " Organisation ", kernaussage: " Abteilung X wird aufgelöst. " }),
    {
      ok: true,
      wert: {
        geruecht_id: 7,
        kategorie: "Organisation",
        kernaussage: "Abteilung X wird aufgelöst.",
        konfidenz: null,
        begruendung: null,
        manuell_pruefen: false,
      },
    },
  );
});

Deno.test("klassifizierung: Protokollfelder werden uebernommen", () => {
  const e = validiereKlassifizierung({
    geruecht_id: 7, kategorie: "Organisation", kernaussage: "X",
    konfidenz: 0.42, begruendung: " passt ", manuell_pruefen: true,
  });
  assert(e.ok);
  assertEquals([e.wert.konfidenz, e.wert.begruendung, e.wert.manuell_pruefen], [0.42, "passt", true]);
});

Deno.test("klassifizierung: Protokollfelder ungueltig -> Fehler, Grenzen erlaubt", () => {
  const basis = { geruecht_id: 7, kategorie: "Organisation", kernaussage: "X" };
  assert(validiereKlassifizierung({ ...basis, konfidenz: 0 }).ok);
  assert(validiereKlassifizierung({ ...basis, konfidenz: 1 }).ok);
  assert(validiereKlassifizierung({ ...basis, konfidenz: null, begruendung: null, manuell_pruefen: null }).ok);
  assert(!validiereKlassifizierung({ ...basis, konfidenz: 1.1 }).ok);
  assert(!validiereKlassifizierung({ ...basis, konfidenz: -0.1 }).ok);
  assert(!validiereKlassifizierung({ ...basis, konfidenz: "0.9" }).ok);
  assert(!validiereKlassifizierung({ ...basis, begruendung: 5 }).ok);
  assert(!validiereKlassifizierung({ ...basis, begruendung: "a".repeat(BEGRUENDUNG_MAX + 1) }).ok);
  assert(!validiereKlassifizierung({ ...basis, manuell_pruefen: "ja" }).ok);
});

Deno.test("klassifizierung: alle drei Felder sind Pflicht, Fehler gesammelt", () => {
  const e = validiereKlassifizierung({});
  assert(!e.ok);
  assertEquals(e.fehler.length, 3);
});

Deno.test("klassifizierung: leere oder falsche Werte -> Fehler", () => {
  const basis = { geruecht_id: 7, kategorie: "Organisation", kernaussage: "X" };
  assert(!validiereKlassifizierung({ ...basis, geruecht_id: "7" }).ok);
  assert(!validiereKlassifizierung({ ...basis, geruecht_id: 0 }).ok);
  assert(!validiereKlassifizierung({ ...basis, kategorie: "" }).ok);
  assert(!validiereKlassifizierung({ ...basis, kategorie: null }).ok);
  assert(!validiereKlassifizierung({ ...basis, kernaussage: "   " }).ok);
  assert(!validiereKlassifizierung({ ...basis, kernaussage: "a".repeat(KERNAUSSAGE_MAX + 1) }).ok);
  assert(validiereKlassifizierung({ ...basis, kernaussage: "a".repeat(KERNAUSSAGE_MAX) }).ok);
});

Deno.test("klassifizierung: unbekannte Felder werden abgelehnt", () => {
  const e = validiereKlassifizierung({ geruecht_id: 7, kategorie: "Organisation", kernaussage: "X", sicherheit: 0.9 });
  assert(!e.ok);
  assert(e.fehler[0].includes("sicherheit"));
});

Deno.test("klassifizierung: kein Objekt -> Fehler", () => {
  for (const body of [null, "x", 3, []]) assert(!validiereKlassifizierung(body).ok);
});

// --- Embedding: Anfrage und Antwort ------------------------------------------

const antwortMit = (embedding: unknown) => ({ object: "list", data: [{ index: 0, embedding }], model: "x" });
const vektor = (n: number, wert = 0.01) => Array.from({ length: n }, () => wert);

Deno.test("embedding: Anfrage nennt Modell und Text", () => {
  assertEquals(baueEmbeddingAnfrage("X wird aufgelöst"), { model: EMBEDDING_MODELL, input: "X wird aufgelöst" });
});

Deno.test("embedding: gueltige Antwort liefert den Vektor", () => {
  const v = vektor(EMBEDDING_DIMENSION);
  assertEquals(parseEmbeddingAntwort(antwortMit(v)), { ok: true, wert: v });
});

Deno.test("embedding: Dimension wird geprueft, Standard ist die Spaltenbreite", () => {
  assertEquals(EMBEDDING_DIMENSION, 3072);
  assert(!parseEmbeddingAntwort(antwortMit(vektor(EMBEDDING_DIMENSION - 1))).ok);
  assert(!parseEmbeddingAntwort(antwortMit(vektor(EMBEDDING_DIMENSION + 1))).ok);
  assert(parseEmbeddingAntwort(antwortMit(vektor(3)), 3).ok);
});

Deno.test("embedding: Fehlerobjekt des Dienstes wird mit Text gemeldet", () => {
  const e = parseEmbeddingAntwort({ error: { message: "Invalid API key", code: 401 } });
  assert(!e.ok);
  assert(e.fehler[0].includes("Invalid API key"));
  assert(!parseEmbeddingAntwort({ error: {} }).ok);
});

Deno.test("embedding: kaputte Formen -> Fehler statt Absturz", () => {
  for (const roh of [null, undefined, "text", 42, [], {}, { data: [] }, { data: [null] }, { data: "x" },
    { data: [{}] }, { data: [{ embedding: "0.1,0.2" }] }]) {
    assert(!parseEmbeddingAntwort(roh).ok, `sollte ungueltig sein: ${JSON.stringify(roh)}`);
  }
});

Deno.test("embedding: nicht-endliche oder falsche Werte im Vektor -> Fehler", () => {
  for (const schlecht of [NaN, Infinity, "0.1", null]) {
    const v: unknown[] = vektor(3);
    v[1] = schlecht;
    assert(!parseEmbeddingAntwort(antwortMit(v), 3).ok, `sollte ungueltig sein: ${String(schlecht)}`);
  }
});

Deno.test("embedding: Vektor als Text in pgvector-Schreibweise", () => {
  assertEquals(vektorAlsText([0.5, -0.25, 1e-7]), "[0.5,-0.25,1e-7]");
});

// --- Suchtreffer und Zuordnung -----------------------------------------------

Deno.test("treffer: leere Liste heisst kein Treffer", () => {
  assertEquals(parseTreffer([]), { ok: true, wert: null });
});

Deno.test("treffer: erste Zeile wird uebernommen", () => {
  assertEquals(parseTreffer([{ geruecht_id: 7, aehnlichkeit: 0.91 }]), {
    ok: true,
    wert: { geruecht_id: 7, aehnlichkeit: 0.91 },
  });
});

Deno.test("treffer: kaputte Formen -> Fehler", () => {
  for (const roh of [null, {}, "x", [null], [{}], [{ geruecht_id: "7", aehnlichkeit: 0.9 }],
    [{ geruecht_id: 0, aehnlichkeit: 0.9 }], [{ geruecht_id: 7 }], [{ geruecht_id: 7, aehnlichkeit: NaN }]]) {
    assert(!parseTreffer(roh).ok, `sollte ungueltig sein: ${JSON.stringify(roh)}`);
  }
});

Deno.test("zuordnung: explizite geruecht_id gewinnt immer, auch gegen einen Treffer", () => {
  assertEquals(entscheideZuordnung(3, { geruecht_id: 9, aehnlichkeit: 0.99 }, 0.8), {
    art: "explizit",
    geruecht_id: 3,
    aehnlichkeit: null,
  });
  assertEquals(entscheideZuordnung(3, null, 0.8).art, "explizit");
});

Deno.test("zuordnung: Treffer ab Schwelle ordnet zu, Grenze selbst zaehlt", () => {
  assertEquals(entscheideZuordnung(null, { geruecht_id: 9, aehnlichkeit: 0.85 }, 0.8), {
    art: "embedding",
    geruecht_id: 9,
    aehnlichkeit: 0.85,
  });
  assertEquals(entscheideZuordnung(null, { geruecht_id: 9, aehnlichkeit: 0.8 }, 0.8).art, "embedding");
});

Deno.test("zuordnung: Treffer unter Schwelle oder kein Treffer -> neues Geruecht", () => {
  const neu = { art: "neu", geruecht_id: null, aehnlichkeit: null } as const;
  assertEquals(entscheideZuordnung(null, { geruecht_id: 9, aehnlichkeit: 0.7999 }, 0.8), neu);
  assertEquals(entscheideZuordnung(null, null, 0.8), neu);
});

Deno.test("zuordnung: Standard ist AEHNLICHKEITS_SCHWELLE, ein sinnvoller Wert", () => {
  assert(AEHNLICHKEITS_SCHWELLE > 0 && AEHNLICHKEITS_SCHWELLE < 1);
  const knapp = entscheideZuordnung(null, { geruecht_id: 1, aehnlichkeit: AEHNLICHKEITS_SCHWELLE });
  assertEquals(knapp.art, "embedding");
  const darunter = entscheideZuordnung(null, { geruecht_id: 1, aehnlichkeit: AEHNLICHKEITS_SCHWELLE - 0.001 });
  assertEquals(darunter.art, "neu");
});

Deno.test("meldungsschema: Antwortbeispiel und Feldbeschreibung passen zueinander", () => {
  assertEquals(Object.keys(MELDUNG_ANTWORT_BEISPIEL).sort(), Object.keys(MELDUNG_ANTWORT_FELDER).sort());
});

// --- pruefeApiKey ------------------------------------------------------------

Deno.test("api-key: korrekter Schluessel", () => {
  assert(pruefeApiKey("geheim123", "geheim123"));
});

Deno.test("api-key: falscher, fehlender oder unkonfigurierter Schluessel", () => {
  assert(!pruefeApiKey("geheim124", "geheim123"));
  assert(!pruefeApiKey("geheim12", "geheim123"));
  assert(!pruefeApiKey(null, "geheim123"));
  assert(!pruefeApiKey("", "geheim123"));
  // ohne gesetztes Secret ist alles zu (fail closed), auch ein leerer Header
  assert(!pruefeApiKey("", undefined));
  assert(!pruefeApiKey("", ""));
});

// --- waehleAdminKey ----------------------------------------------------------

Deno.test("admin-key: Legacy-Service-Role hat Vorrang", () => {
  assertEquals(waehleAdminKey("legacy", '{"default":"neu"}'), "legacy");
});

Deno.test("admin-key: sonst default aus SUPABASE_SECRET_KEYS", () => {
  assertEquals(waehleAdminKey(undefined, '{"default":"neu","andere":"x"}'), "neu");
});

Deno.test("admin-key: ohne default der erste Eintrag", () => {
  assertEquals(waehleAdminKey(undefined, '{"backend":"b"}'), "b");
});

Deno.test("admin-key: nichts gesetzt -> null", () => {
  assertEquals(waehleAdminKey(undefined, undefined), null);
  assertEquals(waehleAdminKey(undefined, "{}"), null);
  assertEquals(waehleAdminKey(undefined, "kein json"), null);
});

// --- ENDPUNKTE (Katalog fuer GET /calls) -------------------------------------

Deno.test("calls: jede Function-Ordner steht genau einmal im Katalog", async () => {
  const ordner: string[] = [];
  for await (const e of Deno.readDir(new URL("..", import.meta.url))) {
    if (e.isDirectory && !e.name.startsWith("_") && e.name !== "tests") ordner.push(e.name);
  }
  const imKatalog = ENDPUNKTE.map((e) => e.name);
  assertEquals([...imKatalog].sort(), ordner.sort());
  assertEquals(new Set(imKatalog).size, imKatalog.length);
});

Deno.test("calls: jeder Eintrag hat Methode, Pfad und Beschreibung", () => {
  for (const e of ENDPUNKTE) {
    assert(["GET", "POST"].includes(e.methode), e.name);
    assertEquals(e.pfad, `/functions/v1/${e.name}`);
    assert(e.beschreibung.length > 0, e.name);
  }
});

// --- baueGeruechtListe -------------------------------------------------------

Deno.test("liste: Anzahl aus count, Beispieltext aus der fruehesten Meldung", () => {
  const liste = baueGeruechtListe([
    {
      geruecht_id: 7,
      status: "offen",
      kernaussage: "Abteilung X wird aufgelöst.",
      kategorien: { name: "Organisation" },
      anzahl: [{ count: 5 }],
      erste: [
        { text: "spaeter", eingegangen_am: "2026-09-25T12:00:00+00:00" },
        { text: "zuerst", eingegangen_am: "2026-09-25T10:00:00+00:00" },
      ],
    },
  ]);
  assertEquals(liste, [{
    geruecht_id: 7,
    kategorie: "Organisation",
    kernaussage: "Abteilung X wird aufgelöst.",
    status: "offen",
    anzahl_meldungen: 5,
    beispieltext: "zuerst",
    erste_meldung_am: "2026-09-25T10:00:00+00:00",
  }]);
});

Deno.test("liste: noch nicht klassifiziertes Geruecht hat Kategorie null", () => {
  const liste = baueGeruechtListe([
    {
      geruecht_id: 2,
      status: "offen",
      kernaussage: null,
      kategorien: null,
      anzahl: [{ count: 1 }],
      erste: [{ text: "a", eingegangen_am: "2026-09-25T10:00:00+00:00" }],
    },
  ]);
  assertEquals(liste[0].kategorie, null);
  assertEquals(liste[0].kernaussage, null);
  assertEquals(liste[0].anzahl_meldungen, 1);
});

Deno.test("liste: Geruecht ohne Meldungen und Kategorie als Array", () => {
  const liste = baueGeruechtListe([
    { geruecht_id: 1, status: "widerlegt", kernaussage: null, kategorien: [{ name: "Standort" }], anzahl: [{ count: 0 }], erste: [] },
  ]);
  assertEquals(liste[0].kategorie, "Standort");
  assertEquals(liste[0].anzahl_meldungen, 0);
  assertEquals(liste[0].beispieltext, null);
  assertEquals(liste[0].erste_meldung_am, null);
});

Deno.test("liste: fehlende Einbettungen (null) ergeben 0 und null statt Absturz", () => {
  const liste = baueGeruechtListe([
    { geruecht_id: 3, status: "offen", kernaussage: null, kategorien: null, anzahl: null, erste: null },
  ]);
  assertEquals(liste[0].anzahl_meldungen, 0);
  assertEquals(liste[0].beispieltext, null);
});

// --- Rate-Limit --------------------------------------------------------------

const LIMITS_TEST = [
  { name: "PRO_MINUTE", fenster_sekunden: 60, max: 3 },
  { name: "PRO_TAG", fenster_sekunden: 86_400, max: 10 },
];

Deno.test("rate-limit: unter allen Grenzen -> ok", () => {
  assertEquals(pruefeRateLimit(LIMITS_TEST, [0, 0]), { ok: true });
  assertEquals(pruefeRateLimit(LIMITS_TEST, [2, 9]), { ok: true });
});

Deno.test("rate-limit: Grenze erreicht -> gesperrt, die Grenze selbst zaehlt schon", () => {
  // 3 gespeicherte Meldungen in der Minute: die vierte wuerde die Grenze ueberschreiten
  const r = pruefeRateLimit(LIMITS_TEST, [3, 3]);
  assert(!r.ok);
  if (!r.ok) {
    assertEquals(r.retry_after, 60);
    assertEquals(r.fehler.length, 1);
    assert(r.fehler[0].includes("3"), r.fehler[0]);
  }
});

Deno.test("rate-limit: mehrere volle Fenster -> alle gemeldet, laengste Wartezeit", () => {
  const r = pruefeRateLimit(LIMITS_TEST, [5, 10]);
  assert(!r.ok);
  if (!r.ok) {
    assertEquals(r.fehler.length, 2);
    assertEquals(r.retry_after, 86_400);
  }
  const nurTag = pruefeRateLimit(LIMITS_TEST, [0, 12]);
  assert(!nurTag.ok);
  if (!nurTag.ok) assertEquals(nurTag.retry_after, 86_400);
});

Deno.test("rate-limit: Standardwerte sind gesetzt und sinnvoll", () => {
  assertEquals(RATE_LIMITS.map((l) => l.fenster_sekunden), [60, 86_400]);
  for (const l of RATE_LIMITS) assert(l.max >= 1, l.name);
  // Eine Minute darf nie mehr erlauben als ein ganzer Tag
  assert(RATE_LIMITS[0].max <= RATE_LIMITS[1].max);
});

Deno.test("rate-limit: Werte aus der Umgebung ueberschreiben den Standard", () => {
  const env: Record<string, string> = { PRO_MINUTE: "5", PRO_TAG: " 200 " };
  assertEquals(leseRateLimits((n) => env[n], LIMITS_TEST).map((l) => l.max), [5, 200]);
});

Deno.test("rate-limit: ungueltige oder fehlende Werte fallen auf den Standard zurueck", () => {
  for (const roh of [undefined, "", "0", "-5", "abc", "1.5", "1e3", "99999999999999999999"]) {
    const limits = leseRateLimits((n) => (n === "PRO_MINUTE" ? roh : undefined), LIMITS_TEST);
    assertEquals(limits.map((l) => l.max), [3, 10], String(roh));
  }
});

// --- Paginierung -------------------------------------------------------------

Deno.test("seite: ohne Angaben Standardwerte", () => {
  assertEquals(parsePaginierung(null, null), { ok: true, wert: { limit: SEITE_STANDARD, offset: 0 } });
  assertEquals(parsePaginierung("", " "), { ok: true, wert: { limit: SEITE_STANDARD, offset: 0 } });
});

Deno.test("seite: gueltige Werte, Grenzen erlaubt", () => {
  assertEquals(parsePaginierung("1", "0"), { ok: true, wert: { limit: 1, offset: 0 } });
  assertEquals(parsePaginierung(String(SEITE_MAX), "400"), { ok: true, wert: { limit: SEITE_MAX, offset: 400 } });
});

Deno.test("seite: ungueltige Werte -> Fehler, beide gesammelt", () => {
  for (const limit of ["0", String(SEITE_MAX + 1), "-1", "abc", "2.5"]) {
    assertEquals(parsePaginierung(limit, null).ok, false, limit);
  }
  for (const offset of ["-1", "x", "1.5"]) {
    assertEquals(parsePaginierung(null, offset).ok, false, offset);
  }
  const beide = parsePaginierung("0", "-1");
  assert(!beide.ok);
  if (!beide.ok) assertEquals(beide.fehler.length, 2);
});
