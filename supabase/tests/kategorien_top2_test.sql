-- Test fuer Kategorie-Beschreibungen und Top-2 (Migrationen 20260928080000 und 20260928080100).
-- Laeuft in einer Transaktion mit ROLLBACK: es bleibt nichts zurueck.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/kategorien_top2_test.sql
begin;

do $$
declare
  standort bigint;
  personal bigint;
  g        bigint;
  anzahl   int;
begin
  -- Fall 1: jede Kategorie hat eine nicht leere Beschreibung, eine leere wird abgelehnt
  select count(*) into anzahl from public.kategorien where beschreibung is null or btrim(beschreibung) = '';
  assert anzahl = 0, format('Fall 1: %s Kategorien ohne Beschreibung', anzahl);
  begin
    insert into public.kategorien (name, beschreibung) values ('[TEST] leer', '  ');
    assert false, 'Fall 1: leere Beschreibung wurde angenommen';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.kategorien (name) values ('[TEST] ohne');
    assert false, 'Fall 1: Kategorie ohne Beschreibung wurde angenommen';
  exception when not_null_violation then
    null;
  end;

  select kategorie_id into standort from public.kategorien where name = 'Standort';
  select kategorie_id into personal from public.kategorien where name = 'Personal';

  -- Fall 2: gueltige Top-2 wird gespeichert, auch mit gleicher Konfidenz
  insert into public.geruechte default values returning geruecht_id into g;
  update public.geruechte
    set kategorie_id = standort, kategorie_konfidenz = 0.7,
        zweitkategorie_id = personal, zweitkategorie_konfidenz = 0.7
    where geruecht_id = g;
  assert (select zweitkategorie_id from public.geruechte where geruecht_id = g) = personal,
    'Fall 2: Zweitkategorie nicht gespeichert';

  -- Fall 3: ohne Zweitkategorie bleibt alles wie bisher
  update public.geruechte set zweitkategorie_id = null, zweitkategorie_konfidenz = null where geruecht_id = g;

  -- Fall 4: jede Regelverletzung wird von der Datenbank abgelehnt
  begin
    update public.geruechte set zweitkategorie_id = personal where geruecht_id = g;
    assert false, 'Fall 4a: Zweitkategorie ohne Konfidenz angenommen';
  exception when check_violation then null;
  end;
  begin
    update public.geruechte set zweitkategorie_konfidenz = 0.3 where geruecht_id = g;
    assert false, 'Fall 4b: Zweitkonfidenz ohne Kategorie angenommen';
  exception when check_violation then null;
  end;
  begin
    update public.geruechte set zweitkategorie_id = standort, zweitkategorie_konfidenz = 0.3 where geruecht_id = g;
    assert false, 'Fall 4c: Zweitkategorie gleich Hauptkategorie angenommen';
  exception when check_violation then null;
  end;
  begin
    update public.geruechte set zweitkategorie_id = personal, zweitkategorie_konfidenz = 0.71 where geruecht_id = g;
    assert false, 'Fall 4d: Zweitkonfidenz ueber der Hauptkonfidenz angenommen';
  exception when check_violation then null;
  end;
  begin
    update public.geruechte set zweitkategorie_id = personal, zweitkategorie_konfidenz = 1.5 where geruecht_id = g;
    assert false, 'Fall 4e: Zweitkonfidenz ueber 1 angenommen';
  exception when check_violation then null;
  end;
  begin
    update public.geruechte set kategorie_konfidenz = null, zweitkategorie_id = personal, zweitkategorie_konfidenz = 0.3
      where geruecht_id = g;
    assert false, 'Fall 4f: Zweitkategorie ohne Hauptkonfidenz angenommen';
  exception when check_violation then null;
  end;

  -- Fall 5: Zweitkategorie an einem noch nicht klassifizierten Geruecht wird abgelehnt
  insert into public.geruechte default values returning geruecht_id into g;
  begin
    update public.geruechte set zweitkategorie_id = personal, zweitkategorie_konfidenz = 0.3 where geruecht_id = g;
    assert false, 'Fall 5: Zweitkategorie ohne Hauptkategorie angenommen';
  exception when check_violation then null;
  end;
end;
$$;

rollback;

select 'kategorien_top2_test: alle Faelle bestanden' as ergebnis;
