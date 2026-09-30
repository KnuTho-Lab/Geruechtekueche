"""Integrationstest gegen die deployten Edge Functions.

Legt Testdaten an (Meldungen mit user_id 'integrationstest') und loescht genau diese
samt ihrer Geruechte am Ende wieder per Supabase-CLI.
Die Texte tragen bewusst KEIN gemeinsames Praefix wie "[TEST]": ein gemeinsames Praefix hebt
die Embedding-Aehnlichkeit unverwandter kurzer Texte auf 0,75 bis 0,82, also in den
Graubereich der Zuordnung. Alle Texte sind gegeneinander und gegen den Live-Bestand vom
2026-09-30 gemessen: ungewollte Paare hoechstens 0,70, die gewollten stehen am Test. Braucht die Umgebungsvariablen:
  GERUECHTE_BASE_URL  z.B. https://<ref>.supabase.co/functions/v1
  GERUECHTE_API_KEY   derselbe Schluessel wie das Supabase-Secret
Ausfuehren im Repo-Root:  python -m unittest tests/test_endpunkte.py -v
"""
import json
import os
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("GERUECHTE_BASE_URL", "").rstrip("/")
KEY = os.environ.get("GERUECHTE_API_KEY", "")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_NUTZER = "integrationstest"


def sql(abfrage):
    """Fuehrt eine Abfrage per Supabase-CLI auf der verknuepften DB aus, liefert die Zeilen."""
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(abfrage)
        pfad = f.name
    try:
        r = subprocess.run(
            ["npx", "supabase", "db", "query", "--linked", "--file", pfad],
            cwd=REPO, check=True, capture_output=True, text=True, encoding="utf-8",
            shell=os.name == "nt", timeout=180,
        )
    finally:
        os.unlink(pfad)
    return json.loads(r.stdout[r.stdout.index("{"):])["rows"]


def aufruf(methode, pfad, body=None, key=KEY, roh=None, query=None):
    url = f"{BASE}/{pfad}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    daten = roh if roh is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=daten, method=methode)
    req.add_header("Content-Type", "application/json")
    if key is not None:
        req.add_header("x-api-key", key)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


@unittest.skipUnless(BASE and KEY, "GERUECHTE_BASE_URL und GERUECHTE_API_KEY setzen")
class EndpunkteTest(unittest.TestCase):
    meldungen = []
    neue_geruechte = []
    start = None

    @classmethod
    def setUpClass(cls):
        # Ab hier stammen die Eintraege in api_aufrufe von diesem Testlauf
        cls.start = sql("select now()::text as t;")[0]["t"]

    @classmethod
    def tearDownClass(cls):
        ids_m = ",".join(str(i) for i in cls.meldungen) or "0"
        ids_g = ",".join(str(i) for i in cls.neue_geruechte) or "0"
        # Auch Geruechte, die erst beim Nachholen fuer eine offene Testmeldung entstanden
        # sind, werden erfasst. Geloescht wird ein Geruecht nur, wenn danach keine Meldung
        # mehr darin liegt, echte Geruechte bleiben also unangetastet.
        # Anstoss- und Pruefprotokoll verschwinden per ON DELETE CASCADE mit.
        # Aufrufe echter Nutzer im selben Zeitfenster wuerden mitgeloescht, das ist bei
        # Testlaeufen in Kauf genommen.
        sql = (
            f"create temp table test_geruechte as select distinct geruecht_id from meldungen "
            f"where meldung_id in ({ids_m}) and user_id = '{TEST_NUTZER}' and geruecht_id is not null;\n"
            f"delete from meldungen where meldung_id in ({ids_m}) and user_id = '{TEST_NUTZER}';\n"
            f"delete from geruechte g where (geruecht_id in ({ids_g}) "
            f"or geruecht_id in (select geruecht_id from test_geruechte)) "
            f"and not exists (select 1 from meldungen m where m.geruecht_id = g.geruecht_id);\n"
            f"delete from api_aufrufe where zeitpunkt >= '{cls.start}';\n"
            f"delete from abweisungen where zeitpunkt >= '{cls.start}';\n"
        )
        with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
            f.write(sql)
            pfad = f.name
        try:
            subprocess.run(
                ["npx", "supabase", "db", "query", "--linked", "--file", pfad],
                cwd=REPO, check=True, capture_output=True, shell=os.name == "nt", timeout=180,
            )
        finally:
            os.unlink(pfad)

    def neue_meldung(self, **felder):
        body = {"user_id": TEST_NUTZER, **felder}
        status, antwort = aufruf("POST", "meldung", body)
        self.assertEqual(status, 201, antwort)
        type(self).meldungen.append(antwort["meldung_id"])
        if antwort["neues_geruecht"]:
            type(self).neue_geruechte.append(antwort["geruecht_id"])
        return antwort

    # --- Zugang und Methode ---------------------------------------------------

    def test_ohne_oder_mit_falschem_schluessel_401(self):
        for name, methode in [("calls", "GET"), ("kategorien", "GET"), ("geruechte", "GET"),
                              ("status", "GET"), ("meldungsschema", "GET"), ("meldung", "POST"),
                              ("klassifizierung_setzen", "POST"), ("abweisung", "POST"),
                              ("zuordnung_nachholen", "POST")]:
            with self.subTest(name=name):
                self.assertEqual(aufruf(methode, name, key=None)[0], 401)
                self.assertEqual(aufruf(methode, name, key="falsch")[0], 401)

    def test_falsche_methode_405(self):
        self.assertEqual(aufruf("POST", "kategorien", {})[0], 405)
        self.assertEqual(aufruf("GET", "meldung")[0], 405)

    # --- Lesende Endpunkte ----------------------------------------------------

    def test_calls_listet_alle_endpunkte(self):
        status, a = aufruf("GET", "calls")
        self.assertEqual(status, 200)
        self.assertEqual(sorted(e["name"] for e in a["endpunkte"]),
                         ["abweisung", "calls", "geruechte", "kategorien", "klassifizierung_setzen",
                          "meldung", "meldungsschema", "status", "zuordnung_nachholen"])
        self.assertEqual([x["name"] for x in a["ausgehende_aufrufe"]],
                         ["klassifizierung_anstossen", "zuordnung_pruefen"])
        self.assertEqual(sorted(a["allgemeine_fehler"]), ["401", "405", "500"])
        self.assertEqual(sorted(a), ["ablauf_fuer_agenten", "allgemeine_fehler", "ausgehende_aufrufe",
                                     "authentifizierung", "basis_url", "endpunkte", "protokollierung"])
        self.assertGreaterEqual(len(a["ablauf_fuer_agenten"]), 4)
        for e in a["endpunkte"]:
            self.assertIn(e["erfolg"], (200, 201), e["name"])
            self.assertTrue(e["antwort"], e["name"])
            self.assertTrue(e["wann_nutzen"], e["name"])
            for p in e["parameter"]:
                self.assertIn(p["typ"], ("string", "integer", "number", "boolean"), p["name"])
                self.assertIn("beispiel", p)
        # Das Beispiel aus dem Katalog wird vom echten Endpunkt angenommen (hier: abweisung,
        # weil es nichts ausser einer Zeile ohne Inhalt anlegt)
        abw = next(e for e in a["endpunkte"] if e["name"] == "abweisung")
        status, _ = aufruf("POST", "abweisung", abw["beispiel_aufruf"]["body"])
        self.assertEqual(status, 201)
        # Der Katalog beschreibt sich selbst richtig
        calls = next(e for e in a["endpunkte"] if e["name"] == "calls")
        self.assertEqual(sorted(calls["antwort"]), sorted(a))

    # --- Protokolle -----------------------------------------------------------

    def test_aufrufe_werden_ohne_inhalt_protokolliert(self):
        vorher = sql("select coalesce(max(aufruf_id), 0) as id from api_aufrufe;")[0]["id"]
        self.assertEqual(aufruf("GET", "status", query={"geruecht_id": 999999999})[0], 404)
        self.assertEqual(aufruf("GET", "kategorien", key="falsch")[0], 401)
        # Gezielt gefiltert: echter Verkehr im selben Moment soll den Test nicht stoeren
        zeilen = sql(f"select endpunkt, methode, status, dauer_ms from api_aufrufe "
                     f"where aufruf_id > {int(vorher)} and endpunkt = 'status' and status = 404;")
        self.assertEqual([(z["endpunkt"], z["methode"], z["status"]) for z in zeilen], [("status", "GET", 404)])
        self.assertGreaterEqual(zeilen[0]["dauer_ms"], 0)
        # Abgelehnte Aufrufe stehen nie in der Tabelle, nur im Function-Log
        self.assertEqual(sql("select count(*) as n from api_aufrufe where status in (401, 405);")[0]["n"], 0)

    def test_abweisung_nur_mit_grund(self):
        status, a = aufruf("POST", "abweisung", {"grund": "prompt_injection"})
        self.assertEqual(status, 201, a)
        self.assertEqual(a["grund"], "prompt_injection")
        zeile = sql(f"select grund from abweisungen where abweisung_id = {int(a['abweisung_id'])};")
        self.assertEqual(zeile, [{"grund": "prompt_injection"}])
        # Text wird nie angenommen, unbekannte Gruende auch nicht
        self.assertEqual(aufruf("POST", "abweisung", {"grund": "beleidigung", "text": "[TEST] x"})[0], 400)
        self.assertEqual(aufruf("POST", "abweisung", {"grund": "egal"})[0], 400)

    def test_meldung_mit_zusatzfeldern(self):
        # Themenfremder Text, damit er nicht per Embedding in ein echtes Geruecht rutscht
        a = self.neue_meldung(text="Der Fuhrpark bekommt ab Herbst nur noch Lastenräder",
                              standort="Verwaltungsbau", emotion="verärgert",
                              quellenkette="von Beteiligten gehört", geschwaerzte_namen=1)
        z = sql(f"select standort, emotion, quellenkette, geschwaerzte_namen from meldungen "
                f"where meldung_id = {int(a['meldung_id'])};")[0]
        self.assertEqual(z, {"standort": "Verwaltungsbau", "emotion": "verärgert",
                             "quellenkette": "von Beteiligten gehört", "geschwaerzte_namen": 1})
        status, f = aufruf("POST", "meldung", {"text": "[TEST] x", "emotion": "wütend"})
        self.assertEqual(status, 400)
        self.assertIn("emotion", f["fehler"][0])

    def test_kategorien(self):
        status, a = aufruf("GET", "kategorien")
        self.assertEqual(status, 200)
        namen = [k["name"] for k in a["kategorien"]]
        # Kategorien-Umbau vom 2026-09-30: elf Kategorien, Sonstiges als Auffangbecken
        self.assertEqual(sorted(namen), sorted([
            "Sicherheit und Gesundheit", "Schwere Vorwürfe gegen Personen", "Insolvenz oder Zahlungsunfähigkeit",
            "Umwelt- oder Compliance-Verstoß", "Standortschließung oder Massenentlassung", "Qualität und Produkt",
            "Datenleck oder Cyberangriff", "Übernahme oder Verkauf", "Vergütung", "Annehmlichkeiten und Arbeitsumfeld",
            "Sonstiges"]))
        for k in a["kategorien"]:
            self.assertEqual(sorted(k), ["beschreibung", "name"])
            self.assertTrue(k["beschreibung"].strip(), k["name"])
            self.assertNotRegex(k["beschreibung"], r"Nr\.\s*\d", k["name"])
        umfeld = next(k for k in a["kategorien"] if k["name"] == "Annehmlichkeiten und Arbeitsumfeld")
        self.assertIn("Kantine", umfeld["beschreibung"])

    def test_meldungsschema(self):
        status, a = aufruf("GET", "meldungsschema")
        self.assertEqual(status, 200)
        self.assertEqual(a["schema"]["required"], ["text"])
        self.assertEqual(sorted(a["antwort_felder"]),
                         ["aehnlichkeit", "embedding_fehler", "geruecht_id", "meldung_id",
                          "neues_geruecht", "per_embedding_zugeordnet", "zuordnung", "zuordnung_offen"])
        self.assertEqual(sorted(a["fehler"]), ["400", "401", "404", "405", "429", "500"])

    def test_geruechte_status_pflicht_und_geprueft(self):
        self.assertEqual(aufruf("GET", "geruechte")[0], 400)
        self.assertEqual(aufruf("GET", "geruechte", query={"status": "unsinn"})[0], 400)
        status, a = aufruf("GET", "geruechte", query={"status": "all"})
        self.assertEqual(status, 200)
        self.assertEqual(a["anzahl"], len(a["geruechte"]))
        self.assertEqual((a["limit"], a["offset"]), (50, 0))
        self.assertGreaterEqual(a["gesamt"], a["anzahl"])

    def test_geruechte_paginierung(self):
        # Zwei eigene Geruechte sicherstellen, damit es mindestens zwei Seiten gibt
        for text in ("Der Pförtner trägt ab Montag einen Zylinder",
                     "Die Kaffeemaschine in Etage 4 spielt beim Brühen Opernarien"):
            self.neue_meldung(text=text)
        status, alle = aufruf("GET", "geruechte", query={"status": "all", "limit": 200})
        self.assertEqual(status, 200)
        self.assertGreaterEqual(alle["gesamt"], 2)

        status, s1 = aufruf("GET", "geruechte", query={"status": "all", "limit": 1})
        status2, s2 = aufruf("GET", "geruechte", query={"status": "all", "limit": 1, "offset": 1})
        self.assertEqual((status, status2), (200, 200))
        self.assertEqual((s1["anzahl"], s2["anzahl"]), (1, 1))
        self.assertEqual(s1["gesamt"], alle["gesamt"])
        # Seiten folgen der Sortierung nach geruecht_id und ueberlappen nicht
        self.assertEqual([s1["geruechte"][0]["geruecht_id"], s2["geruechte"][0]["geruecht_id"]],
                         [g["geruecht_id"] for g in alle["geruechte"][:2]])

        # offset hinter dem letzten Treffer: leere Seite statt Fehler
        status, leer = aufruf("GET", "geruechte", query={"status": "all", "offset": alle["gesamt"] + 5})
        self.assertEqual(status, 200, leer)
        self.assertEqual((leer["anzahl"], leer["geruechte"], leer["gesamt"]), (0, [], alle["gesamt"]))

        for kaputt in ({"limit": 0}, {"limit": 201}, {"limit": "abc"}, {"offset": -1}):
            with self.subTest(kaputt=kaputt):
                self.assertEqual(aufruf("GET", "geruechte", query={"status": "all", **kaputt})[0], 400)

    def test_status_fehlerfaelle(self):
        self.assertEqual(aufruf("GET", "status")[0], 400)
        self.assertEqual(aufruf("GET", "status", query={"geruecht_id": "abc"})[0], 400)
        self.assertEqual(aufruf("GET", "status", query={"geruecht_id": "999999999"})[0], 404)

    # --- POST meldung ---------------------------------------------------------

    def test_meldung_ungueltige_eingaben_400(self):
        self.assertEqual(aufruf("POST", "meldung", roh=b"{kein json")[0], 400)
        # Kategorie gehoert nicht mehr in die Meldung, die vergibt der Klassifizierungs-Workflow
        status, a = aufruf("POST", "meldung", {"text": "[TEST] x", "kategorie": "Vergütung"})
        self.assertEqual(status, 400)
        self.assertIn("kategorie", a["fehler"][0])
        status, a = aufruf("POST", "meldung", {"text": "[TEST] x", "geruechte_id": 1})
        self.assertEqual(status, 400)
        self.assertIn("geruechte_id", a["fehler"][0])

    def test_meldung_unbekanntes_geruecht_404(self):
        status, _ = aufruf("POST", "meldung",
                           {"text": "[TEST] x", "geruecht_id": 999999999})
        self.assertEqual(status, 404)

    def test_durchstich_neues_geruecht_dann_zuordnen(self):
        erste = self.neue_meldung(text="Abteilung X wird aufgelöst")
        self.assertTrue(erste["neues_geruecht"], erste)
        self.assertEqual(erste["zuordnung"], "neu")
        gid = erste["geruecht_id"]

        status, a = aufruf("GET", "status", query={"geruecht_id": gid})
        self.assertEqual((status, a["status"]), (200, "offen"))

        zweite = self.neue_meldung(text="X wird dichtgemacht", geruecht_id=gid)
        self.assertFalse(zweite["neues_geruecht"])
        self.assertEqual(zweite["geruecht_id"], gid)
        # Explizite Zuordnung: keine Suche, aber das Embedding wird trotzdem gespeichert
        self.assertFalse(zweite["per_embedding_zugeordnet"])
        self.assertEqual(zweite["zuordnung"], "explizit")
        self.assertIsNone(zweite["aehnlichkeit"])
        self.assertIsNone(zweite["embedding_fehler"])
        zeile = sql(f"select embedding is not null as hat_embedding from meldungen "
                    f"where meldung_id = {int(zweite['meldung_id'])};")[0]
        self.assertIs(zeile["hat_embedding"], True)

        # Zuordnung steht an der Meldung, das Geruecht hat Anlagezeit und einen Anstoss
        zeilen = sql(f"select meldung_id, zuordnung_art, beste_aehnlichkeit, embedding_fehler "
                     f"from meldungen where geruecht_id = {int(gid)} order by meldung_id;")
        self.assertEqual([z["zuordnung_art"] for z in zeilen], ["neu", "explizit"])
        self.assertIsNone(zeilen[1]["beste_aehnlichkeit"])  # explizit: nicht gesucht
        self.assertEqual([z["embedding_fehler"] for z in zeilen], [None, None])
        g = sql(f"select angelegt_am is not null as hat_zeit, "
                f"(select count(*) from klassifizierung_anstoesse a where a.geruecht_id = g.geruecht_id) as anstoesse, "
                f"(select count(*) from klassifizierung_anstoesse a where a.geruecht_id = g.geruecht_id "
                f"and a.request_id is not null) as verschickt "
                f"from geruechte g where geruecht_id = {int(gid)};")[0]
        self.assertIs(g["hat_zeit"], True)
        self.assertEqual((g["anstoesse"], g["verschickt"]), (1, 1))

        status, a = aufruf("GET", "geruechte", query={"status": "offen"})
        self.assertEqual(status, 200)
        eintrag = next(g for g in a["geruechte"] if g["geruecht_id"] == gid)
        self.assertEqual(eintrag["anzahl_meldungen"], 2)
        # Der echte n8n-Klassifizierer laeuft mit und ist manchmal schneller als der Test:
        # entweder noch leer oder eine gueltige Kategorie
        kategorien = [k["name"] for k in aufruf("GET", "kategorien")[1]["kategorien"]]
        self.assertIn(eintrag["kategorie"], [None, *kategorien])
        self.assertEqual(eintrag["beispieltext"], "Abteilung X wird aufgelöst")

    def test_zonen_sicher_graubereich_neu(self):
        # Gemessen 2026-09-30 (gemini-embedding-001): Bienen-Paraphrase 0,978 (sicher),
        # "keine Bienenstoecke" im Mittel 0,906 zum Bienen-Geruecht (Graubereich),
        # Firmenhund zu allem hoechstens 0,69 (neu). Kein Text aehnelt dem Live-Bestand ueber 0,70.
        erste = self.neue_meldung(text="Auf dem Dach von Gebäude 9 sollen Bienenstöcke aufgestellt werden")
        self.assertIsNone(erste["embedding_fehler"])
        self.assertEqual((erste["zuordnung"], erste["neues_geruecht"], erste["zuordnung_offen"]), ("neu", True, False))
        self.assertFalse(erste["per_embedding_zugeordnet"])
        self.assertIsNone(erste["aehnlichkeit"])
        gid = erste["geruecht_id"]

        # Sicher: ab 0,95 ohne Pruefung ins selbe Geruecht
        zweite = self.neue_meldung(text="Auf dem Dach von Gebäude 9 werden Bienenstöcke aufgestellt")
        self.assertEqual((zweite["zuordnung"], zweite["geruecht_id"], zweite["neues_geruecht"]), ("embedding", gid, False))
        self.assertTrue(zweite["per_embedding_zugeordnet"])
        self.assertGreaterEqual(zweite["aehnlichkeit"], 0.95)

        # Graubereich: das Gegenteil darf nie ungeprueft ins Bienen-Geruecht. Ohne
        # konfigurierten Pruef-Workflow bleibt die Meldung offen, mit ihm entscheidet das LLM
        # (erwartet: keiner passt, also neu)
        dritte = self.neue_meldung(text="Auf dem Dach von Gebäude 9 sollen keine Bienenstöcke aufgestellt werden")
        self.assertIn(dritte["zuordnung"], ("offen", "neu"), dritte)
        self.assertNotEqual(dritte["geruecht_id"], gid)
        pruefung = sql(f"select ergebnis, fehler, kandidaten from zuordnung_pruefungen "
                       f"where meldung_id = {int(dritte['meldung_id'])} order by pruefung_id;")
        self.assertGreaterEqual(len(pruefung), 1)
        self.assertEqual(pruefung[0]["kandidaten"][0]["geruecht_id"], gid)
        self.assertTrue(0.75 <= pruefung[0]["kandidaten"][0]["aehnlichkeit"] < 0.95, pruefung[0])
        if dritte["zuordnung"] == "offen":
            self.assertIsNone(dritte["geruecht_id"])
            self.assertTrue(dritte["zuordnung_offen"])
            self.assertEqual(pruefung[0]["ergebnis"], "fehler")
            offen = sql(f"select versuche from offene_zuordnungen where meldung_id = {int(dritte['meldung_id'])};")
            self.assertEqual(len(offen), 1)
        else:
            self.assertEqual(pruefung[0]["ergebnis"], "keiner")

        # Neu: unter 0,75
        vierte = self.neue_meldung(text="Der Firmenhund soll einen eigenen Ausweis bekommen")
        self.assertEqual((vierte["zuordnung"], vierte["neues_geruecht"]), ("neu", True))

        # An den Meldungen: Art, Einzel- und Geruecht-Aehnlichkeit, volle Embeddings
        ids = ",".join(str(int(x["meldung_id"])) for x in (erste, zweite, dritte, vierte))
        zeilen = {z["meldung_id"]: z for z in sql(
            f"select meldung_id, zuordnung_art, beste_aehnlichkeit, geruecht_aehnlichkeit, "
            f"extensions.vector_dims(embedding) as dim from meldungen where meldung_id in ({ids});")}
        self.assertEqual([zeilen[x["meldung_id"]]["dim"] for x in (erste, zweite, dritte, vierte)], [3072] * 4)
        z2 = zeilen[zweite["meldung_id"]]
        self.assertEqual(z2["zuordnung_art"], "embedding")
        self.assertAlmostEqual(z2["geruecht_aehnlichkeit"], zweite["aehnlichkeit"], places=6)
        self.assertGreaterEqual(z2["beste_aehnlichkeit"], z2["geruecht_aehnlichkeit"])
        z4 = zeilen[vierte["meldung_id"]]
        self.assertEqual(z4["zuordnung_art"], "neu")
        if z4["geruecht_aehnlichkeit"] is not None:
            self.assertLess(z4["geruecht_aehnlichkeit"], 0.75)

        status, a = aufruf("GET", "geruechte", query={"status": "all", "limit": 200})
        self.assertEqual(status, 200)
        eintrag = next(g for g in a["geruechte"] if g["geruecht_id"] == gid)
        self.assertEqual(eintrag["anzahl_meldungen"], 2)

    def test_zuordnung_nachholen(self):
        status, a = aufruf("POST", "zuordnung_nachholen", {"anzahl": 1})
        self.assertEqual(status, 200, a)
        self.assertEqual(sorted(a), ["bearbeitet", "ergebnisse", "noch_offen"])
        self.assertLessEqual(a["bearbeitet"], 1)
        self.assertEqual(a["bearbeitet"], len(a["ergebnisse"]))
        for e in a["ergebnisse"]:
            self.assertEqual(sorted(e), ["fehler", "geruecht_id", "meldung_id", "neues_geruecht", "zuordnung"])
            self.assertIn(e["zuordnung"], ("embedding", "geprueft", "neu", "offen"))
        self.assertIsInstance(a["noch_offen"], int)
        # Ohne Body gilt der Standard
        status, a = aufruf("POST", "zuordnung_nachholen", roh=b"")
        self.assertEqual(status, 200, a)
        for body in ({"anzahl": 0}, {"anzahl": 21}, {"anzahl": "3"}, {"x": 1}, [1]):
            with self.subTest(body=body):
                self.assertEqual(aufruf("POST", "zuordnung_nachholen", body)[0], 400)
        self.assertEqual(aufruf("POST", "zuordnung_nachholen", roh=b"{kaputt")[0], 400)

    # --- POST klassifizierung_setzen -----------------------------------------

    def test_klassifizierung_setzen_einmalig(self):
        antwort = self.neue_meldung(text="Im Serverraum wird ein Aquarium mit Kugelfischen aufgestellt")
        # Muss ein eigenes Geruecht sein, sonst klassifiziert der Test ein fremdes
        self.assertTrue(antwort["neues_geruecht"], antwort)
        gid = antwort["geruecht_id"]
        body = {"geruecht_id": gid, "kategorie": "Annehmlichkeiten und Arbeitsumfeld", "kernaussage": "[TEST] Im Serverraum kommt ein Aquarium.",
                "konfidenz": 0.83, "begruendung": "Betrifft den Serverraum am Standort.", "manuell_pruefen": True,
                "zweitkategorie": "Sicherheit und Gesundheit", "zweitkonfidenz": 0.35}

        status, a = aufruf("POST", "klassifizierung_setzen", body)
        self.assertEqual(status, 200, a)
        self.assertEqual(a["kategorie"], "Annehmlichkeiten und Arbeitsumfeld")
        self.assertEqual((a["zweitkategorie"], a["zweitkonfidenz"]), ("Sicherheit und Gesundheit", 0.35))
        self.assertEqual(a["umgedeutet"], [])

        status, a = aufruf("GET", "geruechte", query={"status": "all"})
        eintrag = next(g for g in a["geruechte"] if g["geruecht_id"] == gid)
        self.assertEqual(eintrag["kategorie"], "Annehmlichkeiten und Arbeitsumfeld")
        self.assertEqual(eintrag["kernaussage"], "[TEST] Im Serverraum kommt ein Aquarium.")
        # 0.35 liegt ueber ZWEITKATEGORIE_AB (0.3): uneindeutig, Zweitkategorie sichtbar
        self.assertEqual(eintrag["zweitkategorie"], "Sicherheit und Gesundheit")

        # Protokollfelder liegen in der Datenbank (ueber die API nicht sichtbar)
        zeile = sql(f"select kategorie_konfidenz, kategorie_begruendung, manuell_pruefen, "
                    f"(select name from kategorien where kategorie_id = zweitkategorie_id) as zweit, "
                    f"zweitkategorie_konfidenz from geruechte where geruecht_id = {int(gid)};")[0]
        self.assertEqual((zeile["zweit"], float(zeile["zweitkategorie_konfidenz"])), ("Sicherheit und Gesundheit", 0.35))
        self.assertEqual(float(zeile["kategorie_konfidenz"]), 0.83)
        self.assertEqual(zeile["kategorie_begruendung"], "Betrifft den Serverraum am Standort.")
        self.assertIs(zeile["manuell_pruefen"], True)

        # Zweites Setzen wird abgelehnt, nichts wird ueberschrieben
        status, _ = aufruf("POST", "klassifizierung_setzen", {**body, "kategorie": "Vergütung"})
        self.assertEqual(status, 409)
        status, a = aufruf("GET", "geruechte", query={"status": "all"})
        eintrag = next(g for g in a["geruechte"] if g["geruecht_id"] == gid)
        self.assertEqual(eintrag["kategorie"], "Annehmlichkeiten und Arbeitsumfeld")

    def test_klassifizierung_setzen_sonstiges(self):
        # Harte Bedingung (Knut, 2026-09-30): Sonstiges nur ohne echte Kategorie ab 0.3,
        # nie als Zweitkategorie. Das Backend deutet um und meldet es in 'umgedeutet'.
        antwort = self.neue_meldung(text="Im Treppenhaus soll eine Kletterwand für Bergziegen entstehen")
        self.assertTrue(antwort["neues_geruecht"], antwort)
        gid = antwort["geruecht_id"]
        status, a = aufruf("POST", "klassifizierung_setzen", {
            "geruecht_id": gid, "kategorie": "Sonstiges", "kernaussage": "[TEST] Kletterwand für Bergziegen.",
            "konfidenz": 0.6, "zweitkategorie": "Annehmlichkeiten und Arbeitsumfeld", "zweitkonfidenz": 0.5})
        self.assertEqual(status, 200, a)
        self.assertEqual((a["kategorie"], a["konfidenz"]), ("Annehmlichkeiten und Arbeitsumfeld", 0.5))
        self.assertEqual((a["zweitkategorie"], a["zweitkonfidenz"]), (None, None))
        self.assertEqual(len(a["umgedeutet"]), 1)
        zeile = sql(f"select (select name from kategorien where kategorie_id = g.kategorie_id) as haupt, "
                    f"kategorie_konfidenz, zweitkategorie_id, manuell_pruefen "
                    f"from geruechte g where geruecht_id = {int(gid)};")[0]
        self.assertEqual((zeile["haupt"], float(zeile["kategorie_konfidenz"])), ("Annehmlichkeiten und Arbeitsumfeld", 0.5))
        self.assertIsNone(zeile["zweitkategorie_id"])
        self.assertIs(zeile["manuell_pruefen"], False)

        antwort = self.neue_meldung(text="Der Hausmeister züchtet angeblich Orchideen im Heizungskeller")
        self.assertTrue(antwort["neues_geruecht"], antwort)
        gid = antwort["geruecht_id"]
        status, a = aufruf("POST", "klassifizierung_setzen", {
            "geruecht_id": gid, "kategorie": "Annehmlichkeiten und Arbeitsumfeld", "kernaussage": "[TEST] Orchideen.",
            "konfidenz": 0.7, "zweitkategorie": "Sonstiges", "zweitkonfidenz": 0.6})
        self.assertEqual(status, 200, a)
        self.assertEqual((a["kategorie"], a["zweitkategorie"]), ("Annehmlichkeiten und Arbeitsumfeld", None))
        self.assertEqual(len(a["umgedeutet"]), 1)

    def test_klassifizierung_setzen_fehlerfaelle(self):
        status, a = aufruf("POST", "klassifizierung_setzen",
                           {"geruecht_id": 999999999, "kategorie": "Gibtsnicht", "kernaussage": "x"})
        self.assertEqual(status, 400)
        self.assertIn("Annehmlichkeiten und Arbeitsumfeld", a["gueltige_kategorien"])
        status, _ = aufruf("POST", "klassifizierung_setzen",
                           {"geruecht_id": 999999999, "kategorie": "Annehmlichkeiten und Arbeitsumfeld", "kernaussage": "x"})
        self.assertEqual(status, 404)
        status, a = aufruf("POST", "klassifizierung_setzen",
                           {"geruecht_id": 1, "kategorie": "Annehmlichkeiten und Arbeitsumfeld", "kernaussage": "x", "sicherheit": 0.9})
        self.assertEqual(status, 400)
        self.assertIn("sicherheit", a["fehler"][0])
        status, _ = aufruf("POST", "klassifizierung_setzen",
                           {"geruecht_id": 1, "kategorie": "Annehmlichkeiten und Arbeitsumfeld", "kernaussage": "x", "konfidenz": 1.5})
        self.assertEqual(status, 400)
        # Zweitkategorie: unbekannt (mit Liste), gleich der Hauptkategorie, sicherer als die erste
        basis = {"geruecht_id": 999999999, "kategorie": "Annehmlichkeiten und Arbeitsumfeld", "kernaussage": "x", "konfidenz": 0.6}
        status, a = aufruf("POST", "klassifizierung_setzen", {**basis, "zweitkategorie": "Gibtsnicht", "zweitkonfidenz": 0.3})
        self.assertEqual(status, 400)
        self.assertIn("Gibtsnicht", a["fehler"][0])
        self.assertIn("Vergütung", a["gueltige_kategorien"])
        status, _ = aufruf("POST", "klassifizierung_setzen", {**basis, "zweitkategorie": "Annehmlichkeiten und Arbeitsumfeld", "zweitkonfidenz": 0.3})
        self.assertEqual(status, 400)
        status, _ = aufruf("POST", "klassifizierung_setzen", {**basis, "zweitkategorie": "Vergütung", "zweitkonfidenz": 0.7})
        self.assertEqual(status, 400)

if __name__ == "__main__":
    unittest.main()
