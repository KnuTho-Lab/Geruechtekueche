-- Kategorien-Umbau: die sechs Themenfelder weichen elf Kategorien.
-- Anlass (2026-09-29): beim Nachlabeln des Testsets liess sich Organisation nicht abgrenzen,
-- 31 von 48 unsicheren Labels betrafen sie. Kategorien und Definitionen aus Knuts Entwurf,
-- die Verweise zwischen den Kategorien stehen als Namen statt als Nummern, weil der
-- Klassifizierer ueber GET /kategorien nur Name und Beschreibung sieht (Knut, 2026-09-30).
-- Kein Rang: welche Kategorie Haupt- und welche Zweitkategorie wird, entscheidet allein die
-- Konfidenz (Knut, 2026-09-30).
-- Sicherung vor dem Umbau: supabase db dump vom 2026-09-30, liegt ausserhalb des Repos.

-- 1. Bestehende Klassifizierungen zuruecksetzen. Die alten Kategorien lassen sich nicht
--    eins zu eins uebertragen, die Geruechte werden danach neu klassifiziert (Knut).
--    klassifiziert_am geht mit zurueck, damit es die neue Klassifizierung stempelt.
--    kernaussage bleibt bis dahin stehen, manuell_pruefen bleibt unangetastet (Knut).
--    Die WHERE-Klausel ist Pflicht: Supabase Cloud blockiert UPDATE ohne WHERE.
update public.geruechte
  set kategorie_id = null,
      kategorie_konfidenz = null,
      kategorie_begruendung = null,
      zweitkategorie_id = null,
      zweitkategorie_konfidenz = null,
      klassifiziert_am = null
  where kategorie_id is not null or zweitkategorie_id is not null;

-- 2. Alte Kategorien entfernen. Scheitert am Fremdschluessel, falls doch noch ein Geruecht
--    auf eine zeigt, dann bricht die ganze Migration ab.
delete from public.kategorien
  where name in ('Standort', 'Personal', 'Vergütung', 'Organisation', 'Produkt', 'Sicherheit');

-- 3. Neue Kategorien. 'Sonstiges' muss genau so heissen: die Sonstiges-Regel in
--    POST /klassifizierung_setzen (logik.ts, SONSTIGES) haengt am Namen.
insert into public.kategorien (name, beschreibung) values
  ('Sicherheit und Gesundheit',
   'Akute oder verschwiegene Gefahr für Leib und Leben (Gefahrstoff, Brandschutz, Unfall, Alarm). '
   'Gilt auch dann, wenn die Ursache ein Produkt- oder Umweltthema ist, sobald Menschen gefährdet sind.'),
  ('Schwere Vorwürfe gegen Personen',
   'Eine konkrete, identifizierbare Person soll sich strafbar oder schwer fehlerhaft verhalten haben '
   '(Unterschlagung, Betrug, Übergriff). Eigene Betroffenheit gehört in den Kummerkasten, nicht hierher.'),
  ('Insolvenz oder Zahlungsunfähigkeit',
   'Das Unternehmen als Ganzes soll zahlungsunfähig sein oder werden (Löhne, Lieferanten, Banken). '
   'Hohe Wirkung nach außen, Gefahr der Selbsterfüllung.'),
  ('Umwelt- oder Compliance-Verstoß',
   'Das Unternehmen soll gegen Gesetze oder Auflagen verstoßen (Abwasser, Emissionen, Korruption, Kartell). '
   'Handelt eine konkrete Person, gilt „Schwere Vorwürfe gegen Personen“; sind Menschen akut gefährdet, '
   'gilt „Sicherheit und Gesundheit“.'),
  ('Standortschließung oder Massenentlassung',
   'Ein Werk, eine Abteilung oder eine große Gruppe soll wegfallen. Liegt die Ursache in der '
   'Zahlungsunfähigkeit, gilt „Insolvenz oder Zahlungsunfähigkeit“.'),
  ('Qualität und Produkt',
   'Fehlerhafte Ware soll ausgeliefert oder ein Rückruf vertuscht worden sein. Bei Gefahr für Personen '
   'gilt „Sicherheit und Gesundheit“.'),
  ('Datenleck oder Cyberangriff',
   'Kunden-, Mitarbeiter- oder Firmendaten sollen abgeflossen oder Systeme kompromittiert worden sein.'),
  ('Übernahme oder Verkauf',
   'Ein Eigentümerwechsel oder Investoreneinstieg soll bevorstehen. Werden dabei Schließungen genannt, '
   'gilt „Standortschließung oder Massenentlassung“.'),
  ('Vergütung',
   'Lohn, Bonus, Zulagen oder Tarif sollen sich ändern. Fallen Löhne ganz aus, gilt '
   '„Insolvenz oder Zahlungsunfähigkeit“.'),
  ('Annehmlichkeiten und Arbeitsumfeld',
   'Kantine, Parkplatz, Betriebsausflug, Homeoffice-Regeln. Ärgerlich, aber geringer Schaden.'),
  ('Sonstiges',
   'Nur wenn das Gerücht zu keiner der anderen Kategorien passt, auch nicht teilweise (etwa '
   'Führungswechsel, neues IT-System, Eröffnung, Großauftrag). Passt eine andere Kategorie auch nur '
   'ansatzweise, gilt diese.');
