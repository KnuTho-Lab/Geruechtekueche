// Tests fuer die reine Logik der Edge Functions (ohne Netzwerk und ohne Datenbank).
// Ausfuehren: deno test supabase/functions/tests/
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  baueGeruechtListe,
  ENDPUNKTE,
  KERNAUSSAGE_MAX,
  MELDUNG_BEISPIEL,
  parseGeruechtId,
  parseStatusFilter,
  pruefeApiKey,
  STATUS_WERTE,
  TEXT_MAX,
  validiereKlassifizierung,
  validiereMeldung,
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

Deno.test("klassifizierung: gueltig, Texte werden getrimmt", () => {
  assertEquals(
    validiereKlassifizierung({ geruecht_id: 7, kategorie: " Organisation ", kernaussage: " Abteilung X wird aufgelöst. " }),
    { ok: true, wert: { geruecht_id: 7, kategorie: "Organisation", kernaussage: "Abteilung X wird aufgelöst." } },
  );
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
  const e = validiereKlassifizierung({ geruecht_id: 7, kategorie: "Organisation", kernaussage: "X", konfidenz: 0.9 });
  assert(!e.ok);
  assert(e.fehler[0].includes("konfidenz"));
});

Deno.test("klassifizierung: kein Objekt -> Fehler", () => {
  for (const body of [null, "x", 3, []]) assert(!validiereKlassifizierung(body).ok);
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

Deno.test("liste: Anzahl und Beispieltext aus der fruehesten Meldung", () => {
  const liste = baueGeruechtListe([
    {
      geruecht_id: 7,
      status: "offen",
      kernaussage: "Abteilung X wird aufgelöst.",
      kategorien: { name: "Organisation" },
      meldungen: [
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
    anzahl_meldungen: 2,
    beispieltext: "zuerst",
    erste_meldung_am: "2026-09-25T10:00:00+00:00",
  }]);
});

Deno.test("liste: noch nicht klassifiziertes Geruecht hat Kategorie null", () => {
  const liste = baueGeruechtListe([
    { geruecht_id: 2, status: "offen", kernaussage: null, kategorien: null, meldungen: [{ text: "a", eingegangen_am: "2026-09-25T10:00:00+00:00" }] },
  ]);
  assertEquals(liste[0].kategorie, null);
  assertEquals(liste[0].kernaussage, null);
  assertEquals(liste[0].anzahl_meldungen, 1);
});

Deno.test("liste: Geruecht ohne Meldungen und Kategorie als Array", () => {
  const liste = baueGeruechtListe([
    { geruecht_id: 1, status: "widerlegt", kernaussage: null, kategorien: [{ name: "Standort" }], meldungen: [] },
  ]);
  assertEquals(liste[0].kategorie, "Standort");
  assertEquals(liste[0].anzahl_meldungen, 0);
  assertEquals(liste[0].beispieltext, null);
  assertEquals(liste[0].erste_meldung_am, null);
});
