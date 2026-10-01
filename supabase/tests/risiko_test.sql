-- Test fuer die Risiko-Spalten (Migration 20261001100000): Standardwerte, Pruef-Regeln, Index
-- und die Uebersicht. Laeuft in einer Transaktion mit ROLLBACK: es bleibt nichts zurueck.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/risiko_test.sql
begin;

do $$
declare
  kat    bigint;
  g      bigint;
  zeile  record;
  anzahl int;
begin
  select kategorie_id into kat from public.kategorien order by kategorie_id limit 1;

  -- Fall 1: ein neues Geruecht hat risiko_status ausstehend und kein Risiko
  insert into public.geruechte default values returning geruecht_id into g;
  select risiko, risiko_status, risiko_berechnet_am, risiko_modell into zeile
    from public.geruechte where geruecht_id = g;
  assert zeile.risiko is null and zeile.risiko_berechnet_am is null and zeile.risiko_modell is null,
    'Fall 1: Risiko nicht leer';
  assert zeile.risiko_status = 'ausstehend', format('Fall 1: Status %s', zeile.risiko_status);

  -- Fall 2: queue und berechnet gibt es nur nach der Klassifizierung
  begin
    update public.geruechte set risiko_status = 'queue' where geruecht_id = g;
    assert false, 'Fall 2: queue ohne Kategorie wurde angenommen';
  exception when check_violation then null;
  end;

  -- Fall 3: klassifiziert, Modell hat nicht geantwortet -> queue, ohne Wert
  update public.geruechte set kategorie_id = kat, risiko_status = 'queue' where geruecht_id = g;
  select risiko_status into zeile from public.geruechte where geruecht_id = g;
  assert zeile.risiko_status = 'queue', 'Fall 3: queue nicht gesetzt';

  -- Fall 4: berechnet braucht Wert, Zeitpunkt und Modell, und nur dann
  begin
    update public.geruechte set risiko_status = 'berechnet' where geruecht_id = g;
    assert false, 'Fall 4a: berechnet ohne Wert wurde angenommen';
  exception when check_violation then null;
  end;
  begin
    update public.geruechte set risiko_status = 'berechnet', risiko = 0.5 where geruecht_id = g;
    assert false, 'Fall 4b: berechnet ohne Zeitpunkt und Modell wurde angenommen';
  exception when check_violation then null;
  end;
  begin
    update public.geruechte
      set risiko = 0.5, risiko_berechnet_am = now(), risiko_modell = 'gbert-large-v2'
      where geruecht_id = g;
    assert false, 'Fall 4c: Wert bei Status queue wurde angenommen';
  exception when check_violation then null;
  end;

  -- Fall 5: Wertebereich 0 bis 1, die Grenzen selbst gelten
  begin
    update public.geruechte
      set risiko_status = 'berechnet', risiko = 1.01, risiko_berechnet_am = now(), risiko_modell = 'x'
      where geruecht_id = g;
    assert false, 'Fall 5a: Risiko 1,01 wurde angenommen';
  exception when check_violation then null;
  end;
  begin
    update public.geruechte
      set risiko_status = 'berechnet', risiko = -0.01, risiko_berechnet_am = now(), risiko_modell = 'x'
      where geruecht_id = g;
    assert false, 'Fall 5b: Risiko -0,01 wurde angenommen';
  exception when check_violation then null;
  end;
  update public.geruechte
    set risiko_status = 'berechnet', risiko = 0, risiko_berechnet_am = now(), risiko_modell = 'gbert-large-v2'
    where geruecht_id = g;
  update public.geruechte set risiko = 1 where geruecht_id = g;

  -- Fall 6: unbekannter Status wird abgelehnt
  begin
    update public.geruechte set risiko_status = 'fertig' where geruecht_id = g;
    assert false, 'Fall 6: unbekannter Status wurde angenommen';
  exception when check_violation then null;
  end;

  -- Fall 7: die Uebersicht zeigt Risiko und Status
  select risiko, risiko_status, risiko_modell into zeile from public.geruechte_uebersicht where geruecht_id = g;
  assert zeile.risiko = 1 and zeile.risiko_status = 'berechnet' and zeile.risiko_modell = 'gbert-large-v2',
    'Fall 7: Uebersicht zeigt das Risiko nicht';

  -- Fall 8: der Teilindex fuer die Queue existiert
  select count(*) into anzahl from pg_indexes
    where schemaname = 'public' and tablename = 'geruechte' and indexname = 'geruechte_risiko_queue';
  assert anzahl = 1, 'Fall 8: Index geruechte_risiko_queue fehlt';
end;
$$;

rollback;
