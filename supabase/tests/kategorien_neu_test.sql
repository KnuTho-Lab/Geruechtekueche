-- Test fuer den Kategorien-Umbau (Migration 20260930080000_neue_kategorien).
-- Laeuft in einer Transaktion mit ROLLBACK: es bleibt nichts zurueck.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/kategorien_neu_test.sql
begin;

do $$
declare
  erwartet text[] := array[
    'Sicherheit und Gesundheit',
    'Schwere Vorwürfe gegen Personen',
    'Insolvenz oder Zahlungsunfähigkeit',
    'Umwelt- oder Compliance-Verstoß',
    'Standortschließung oder Massenentlassung',
    'Qualität und Produkt',
    'Datenleck oder Cyberangriff',
    'Übernahme oder Verkauf',
    'Vergütung',
    'Annehmlichkeiten und Arbeitsumfeld',
    'Sonstiges'
  ];
  vorhanden text[];
  anzahl    int;
begin
  -- Fall 1: genau die elf neuen Kategorien, keine alte mehr
  select array_agg(name order by name) into vorhanden from public.kategorien;
  assert vorhanden = (select array_agg(n order by n) from unnest(erwartet) n),
    format('Fall 1: Kategorien sind %s', vorhanden);

  -- Fall 2: 'Sonstiges' existiert unter genau diesem Namen, die Sonstiges-Regel in
  -- POST /klassifizierung_setzen (logik.ts, SONSTIGES) haengt am Namen
  assert exists (select 1 from public.kategorien where name = 'Sonstiges'),
    'Fall 2: Sonstiges fehlt';

  -- Fall 3: keine Beschreibung verweist auf eine Nummer, der Klassifizierer sieht nur Namen
  select count(*) into anzahl from public.kategorien where beschreibung ~ 'Nr\.\s*\d';
  assert anzahl = 0, format('Fall 3: %s Beschreibungen verweisen auf Nummern', anzahl);

  -- Fall 4: jeder Verweis in Anfuehrungszeichen nennt eine existierende Kategorie
  select count(*) into anzahl
    from public.kategorien k,
         regexp_matches(k.beschreibung, '„([^“]+)“', 'g') as m
    where not exists (select 1 from public.kategorien z where z.name = m[1]);
  assert anzahl = 0, format('Fall 4: %s Verweise auf unbekannte Kategorien', anzahl);

  -- Fall 5: kein Geruecht zeigt auf eine Kategorie, die es nicht mehr gibt
  -- (die Fremdschluessel erzwingen das ohnehin, der Fall sichert die Reihenfolge der Migration)
  select count(*) into anzahl from public.geruechte g
    where (g.kategorie_id is not null and not exists (select 1 from public.kategorien k where k.kategorie_id = g.kategorie_id))
       or (g.zweitkategorie_id is not null and not exists (select 1 from public.kategorien k where k.kategorie_id = g.zweitkategorie_id));
  assert anzahl = 0, format('Fall 5: %s Geruechte mit verwaister Kategorie', anzahl);
end;
$$;

select 'kategorien_neu_test: alle Faelle bestanden' as ergebnis;

rollback;
