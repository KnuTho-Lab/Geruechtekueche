-- Test: anon und authenticated haben in public keinerlei Rechte, auch nicht auf
-- Objekte, die kuenftig neu angelegt werden (Default-Privileges).
-- Laeuft in einer Transaktion mit ROLLBACK, die Probe-Objekte bleiben nicht zurueck.
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/rechte_test.sql
begin;

do $$
declare
  rolle  text;
  objekt record;
begin
  -- Fall 1: bestehende Tabellen, Views und Sequenzen
  foreach rolle in array array['anon', 'authenticated'] loop
    for objekt in
      select c.oid, c.relname, c.relkind from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
    loop
      if objekt.relkind = 'S' then
        assert not has_sequence_privilege(rolle, objekt.oid, 'SELECT, USAGE, UPDATE'),
          format('Fall 1: %s hat Rechte auf Sequenz %s', rolle, objekt.relname);
      else
        assert not has_table_privilege(rolle, objekt.oid,
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
          format('Fall 1: %s hat Rechte auf %s', rolle, objekt.relname);
      end if;
    end loop;
  end loop;

  -- Fall 2: bestehende Funktionen
  foreach rolle in array array['anon', 'authenticated'] loop
    for objekt in
      select p.oid, p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    loop
      assert not has_function_privilege(rolle, objekt.oid, 'EXECUTE'),
        format('Fall 2: %s darf Funktion %s ausfuehren', rolle, objekt.proname);
    end loop;
  end loop;

  -- Fall 3: neu angelegte Objekte, so wie eine kuenftige Migration sie anlegt (als postgres)
  set local role postgres;
  create table public.rechte_probe (probe_id bigint generated always as identity primary key);
  create function public.rechte_probe_fn() returns int language sql as 'select 1';
  reset role;

  foreach rolle in array array['anon', 'authenticated'] loop
    assert not has_table_privilege(rolle, 'public.rechte_probe',
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
      format('Fall 3: %s hat Rechte auf eine neue Tabelle', rolle);
    assert not has_sequence_privilege(rolle, 'public.rechte_probe_probe_id_seq', 'SELECT, USAGE, UPDATE'),
      format('Fall 3: %s hat Rechte auf eine neue Sequenz', rolle);
    assert not has_function_privilege(rolle, 'public.rechte_probe_fn()', 'EXECUTE'),
      format('Fall 3: %s darf eine neue Funktion ausfuehren', rolle);
  end loop;

  -- Fall 4: die Service Role (Edge Functions) behaelt ihre Rechte
  assert has_table_privilege('service_role', 'public.meldungen', 'SELECT, INSERT, UPDATE, DELETE'),
    'Fall 4: service_role hat keine Rechte mehr auf meldungen';
  assert has_function_privilege('service_role',
    'public.aehnlichstes_geruecht(extensions.halfvec, double precision)', 'EXECUTE'),
    'Fall 4: service_role darf aehnlichstes_geruecht nicht mehr ausfuehren';
end;
$$;

rollback;

select 'rechte_test: alle Faelle bestanden' as ergebnis;
