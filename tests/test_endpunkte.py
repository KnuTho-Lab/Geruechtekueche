"""Integrationstest gegen die deployten Edge Functions.

Legt Testdaten an (Text beginnt mit [TEST]) und loescht genau diese am Ende wieder
per Supabase-CLI. Braucht die Umgebungsvariablen:
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

    @classmethod
    def tearDownClass(cls):
        if not cls.meldungen and not cls.neue_geruechte:
            return
        ids_m = ",".join(str(i) for i in cls.meldungen) or "0"
        ids_g = ",".join(str(i) for i in cls.neue_geruechte) or "0"
        sql = (
            f"delete from meldungen where meldung_id in ({ids_m}) and text like '[TEST]%';\n"
            f"delete from geruechte g where geruecht_id in ({ids_g}) "
            f"and not exists (select 1 from meldungen m where m.geruecht_id = g.geruecht_id);\n"
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
        body = {"kategorie": "Personal", **felder}
        body["text"] = "[TEST] " + body.get("text", "Integrationstest")
        status, antwort = aufruf("POST", "meldung", body)
        self.assertEqual(status, 201, antwort)
        type(self).meldungen.append(antwort["meldung_id"])
        if antwort["neues_geruecht"]:
            type(self).neue_geruechte.append(antwort["geruecht_id"])
        return antwort

    # --- Zugang und Methode ---------------------------------------------------

    def test_ohne_oder_mit_falschem_schluessel_401(self):
        for name, methode in [("calls", "GET"), ("kategorien", "GET"), ("geruechte", "GET"),
                              ("status", "GET"), ("meldungsschema", "GET"), ("meldung", "POST")]:
            with self.subTest(name=name):
                self.assertEqual(aufruf(methode, name, key=None)[0], 401)
                self.assertEqual(aufruf(methode, name, key="falsch")[0], 401)

    def test_falsche_methode_405(self):
        self.assertEqual(aufruf("POST", "kategorien", {})[0], 405)
        self.assertEqual(aufruf("GET", "meldung")[0], 405)

    # --- Lesende Endpunkte ----------------------------------------------------

    def test_calls_listet_alle_sechs(self):
        status, a = aufruf("GET", "calls")
        self.assertEqual(status, 200)
        self.assertEqual(sorted(e["name"] for e in a["endpunkte"]),
                         ["calls", "geruechte", "kategorien", "meldung", "meldungsschema", "status"])

    def test_kategorien(self):
        status, a = aufruf("GET", "kategorien")
        self.assertEqual(status, 200)
        self.assertIn("Personal", a["kategorien"])

    def test_meldungsschema(self):
        status, a = aufruf("GET", "meldungsschema")
        self.assertEqual(status, 200)
        self.assertEqual(a["schema"]["required"], ["text", "kategorie"])

    def test_geruechte_status_pflicht_und_geprueft(self):
        self.assertEqual(aufruf("GET", "geruechte")[0], 400)
        self.assertEqual(aufruf("GET", "geruechte", query={"status": "unsinn"})[0], 400)
        status, a = aufruf("GET", "geruechte", query={"status": "all"})
        self.assertEqual(status, 200)
        self.assertEqual(a["anzahl"], len(a["geruechte"]))

    def test_status_fehlerfaelle(self):
        self.assertEqual(aufruf("GET", "status")[0], 400)
        self.assertEqual(aufruf("GET", "status", query={"geruecht_id": "abc"})[0], 400)
        self.assertEqual(aufruf("GET", "status", query={"geruecht_id": "999999999"})[0], 404)

    # --- POST meldung ---------------------------------------------------------

    def test_meldung_ungueltige_eingaben_400(self):
        self.assertEqual(aufruf("POST", "meldung", roh=b"{kein json")[0], 400)
        status, a = aufruf("POST", "meldung", {"text": "[TEST] x", "kategorie": "Gibtsnicht"})
        self.assertEqual(status, 400)
        self.assertIn("Personal", a["gueltige_kategorien"])
        status, a = aufruf("POST", "meldung", {"text": "[TEST] x", "kategorie": "Personal", "geruechte_id": 1})
        self.assertEqual(status, 400)
        self.assertIn("geruechte_id", a["fehler"][0])

    def test_meldung_unbekanntes_geruecht_404(self):
        status, _ = aufruf("POST", "meldung",
                           {"text": "[TEST] x", "kategorie": "Personal", "geruecht_id": 999999999})
        self.assertEqual(status, 404)

    def test_durchstich_neues_geruecht_dann_zuordnen(self):
        erste = self.neue_meldung(text="Abteilung X wird aufgelöst", user_id="test-user")
        self.assertTrue(erste["neues_geruecht"])
        gid = erste["geruecht_id"]

        status, a = aufruf("GET", "status", query={"geruecht_id": gid})
        self.assertEqual((status, a["status"]), (200, "offen"))

        zweite = self.neue_meldung(text="X wird dichtgemacht", geruecht_id=gid)
        self.assertFalse(zweite["neues_geruecht"])
        self.assertEqual(zweite["geruecht_id"], gid)

        status, a = aufruf("GET", "geruechte", query={"status": "offen"})
        self.assertEqual(status, 200)
        eintrag = next(g for g in a["geruechte"] if g["geruecht_id"] == gid)
        self.assertEqual(eintrag["anzahl_meldungen"], 2)
        self.assertEqual(eintrag["kategorie"], "Personal")
        self.assertEqual(eintrag["beispieltext"], "[TEST] Abteilung X wird aufgelöst")


if __name__ == "__main__":
    unittest.main()
