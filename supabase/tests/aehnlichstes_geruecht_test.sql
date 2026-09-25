-- Test fuer public.aehnlichstes_geruecht (Embedding-Suche fuer POST /meldung).
-- Laeuft komplett in einer Transaktion und endet mit ROLLBACK: es bleibt nichts in
-- der Datenbank. Die Vektoren sind kuenstlich (Einheitsvektoren in einer Ebene),
-- damit die Kosinus-Aehnlichkeit exakt bekannt ist: cos(Winkel).
-- Ausfuehren: npx supabase db query --linked --file supabase/tests/aehnlichstes_geruecht_test.sql
begin;

do $$
declare
  g_a      bigint;
  g_b      bigint;
  g_leer   bigint;
  treffer  record;
  anzahl   int;
  v_basis  extensions.halfvec;
  v_nah    extensions.halfvec;
  v_fern   extensions.halfvec;
  v_frage  extensions.halfvec;
begin
  -- Die Suche sieht alle Meldungen, im Test sollen nur die eigenen zaehlen
  select count(*) into anzahl from public.meldungen where embedding is not null;
  if anzahl <> 0 then
    raise exception 'Test braucht eine Datenbank ohne Meldungen mit Embedding (gefunden: %)', anzahl;
  end if;

  -- Vektoren bauen: 3072 Nullen, nur die ersten beiden Stellen belegt
  select ('[' || cos(radians(0))  || ',' || sin(radians(0))  || repeat(',0', 3070) || ']')::extensions.halfvec into v_basis;
  select ('[' || cos(radians(90)) || ',' || sin(radians(90)) || repeat(',0', 3070) || ']')::extensions.halfvec into v_fern;
  select ('[' || cos(radians(20)) || ',' || sin(radians(20)) || repeat(',0', 3070) || ']')::extensions.halfvec into v_nah;

  insert into public.geruechte default values returning geruecht_id into g_a;
  insert into public.geruechte default values returning geruecht_id into g_b;
  insert into public.geruechte default values returning geruecht_id into g_leer;
  insert into public.meldungen (geruecht_id, text, embedding) values (g_a, '[TEST] basis', v_basis);
  insert into public.meldungen (geruecht_id, text, embedding) values (g_b, '[TEST] fern', v_fern);
  -- Meldung ohne Embedding (Dienst war ausgefallen) darf nie Treffer sein
  insert into public.meldungen (geruecht_id, text) values (g_leer, '[TEST] ohne embedding');

  -- Fall 1: Frage bei 20 Grad, naechste Meldung ist basis (cos 20 = 0.9397)
  v_frage := v_nah;
  select * into treffer from public.aehnlichstes_geruecht(v_frage, 0.9);
  assert treffer.geruecht_id = g_a, format('Fall 1: erwartet Geruecht %s, gefunden %s', g_a, treffer.geruecht_id);
  assert abs(treffer.aehnlichkeit - cos(radians(20))) < 0.001,
    format('Fall 1: Aehnlichkeit %s statt %s', treffer.aehnlichkeit, cos(radians(20)));

  -- Fall 2: gleiche Frage, Schwelle ueber der Aehnlichkeit -> keine Zeile
  select count(*) into anzahl from public.aehnlichstes_geruecht(v_frage, 0.95);
  assert anzahl = 0, format('Fall 2: erwartet keine Zeile, gefunden %s', anzahl);

  -- Fall 3: Schwelle genau auf der Aehnlichkeit gilt als Treffer (>=)
  select * into treffer from public.aehnlichstes_geruecht(v_basis, 1.0 - 1e-6);
  assert treffer.geruecht_id = g_a, 'Fall 3: identischer Vektor muss bei Schwelle ~1 treffen';

  -- Fall 4: Frage bei 80 Grad liegt naeher an fern (cos 10) als an basis (cos 80)
  select * into treffer from public.aehnlichstes_geruecht(
    ('[' || cos(radians(80)) || ',' || sin(radians(80)) || repeat(',0', 3070) || ']')::extensions.halfvec, 0.5);
  assert treffer.geruecht_id = g_b, format('Fall 4: erwartet Geruecht %s, gefunden %s', g_b, treffer.geruecht_id);

  -- Fall 5: nur die naechste Meldung zaehlt, nicht irgendeine ueber der Schwelle
  select count(*) into anzahl from public.aehnlichstes_geruecht(v_frage, 0.0);
  assert anzahl = 1, format('Fall 5: erwartet genau 1 Zeile, gefunden %s', anzahl);

  -- Fall 6: ueber die oeffentliche API nicht aufrufbar, nur fuer den Admin-Client
  assert not has_function_privilege('anon', 'public.aehnlichstes_geruecht(extensions.halfvec, double precision)', 'execute'),
    'Fall 6: anon darf die Suche nicht ausfuehren';
  assert not has_function_privilege('authenticated', 'public.aehnlichstes_geruecht(extensions.halfvec, double precision)', 'execute'),
    'Fall 6: authenticated darf die Suche nicht ausfuehren';
  assert has_function_privilege('service_role', 'public.aehnlichstes_geruecht(extensions.halfvec, double precision)', 'execute'),
    'Fall 6: service_role muss die Suche ausfuehren duerfen';

  raise notice 'aehnlichstes_geruecht_test: alle 6 Faelle OK';
end;
$$;

rollback;
