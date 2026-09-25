-- Embedding je Meldung, damit POST /meldung eine neue Meldung dem aehnlichsten
-- bestehenden Geruecht zuordnen kann, statt jedes Mal ein neues anzulegen.
-- Modell: google/gemini-embedding-001 ueber OpenRouter, gemessen 3072 Dimensionen.
-- pgvector indiziert den Typ vector nur bis 2000 Dimensionen, halfvec bis 4000.
-- Deshalb halfvec (16 Bit je Wert): fuer Kosinus-Aehnlichkeit reicht die Genauigkeit,
-- und der Speicher halbiert sich gegenueber vector.
create extension if not exists vector with schema extensions;

-- Leer erlaubt: faellt der Embedding-Dienst aus, wird die Meldung trotzdem gespeichert.
-- Solche Meldungen tauchen dann nur in der Aehnlichkeitssuche nicht auf.
alter table public.meldungen
  add column embedding extensions.halfvec(3072);

comment on column public.meldungen.embedding is
  'Embedding des Meldungstexts (google/gemini-embedding-001, 3072 Dim.). Leer, wenn der Dienst ausgefallen war.';

-- HNSW-Index fuer die Naechster-Nachbar-Suche ueber Kosinus-Distanz (<=>)
create index meldungen_embedding_hnsw
  on public.meldungen
  using hnsw (embedding extensions.halfvec_cosine_ops);

-- Sucht die aehnlichste Meldung mit Embedding und liefert deren geruecht_id samt
-- Kosinus-Aehnlichkeit (1 - Distanz), aber nur wenn die Aehnlichkeit die Schwelle
-- erreicht. Sonst keine Zeile, das heisst: neues Geruecht anlegen.
-- Erst die naechste Meldung per Index holen, dann die Schwelle pruefen: eine
-- Schwelle im WHERE der inneren Abfrage wuerde den Index aushebeln.
create or replace function public.aehnlichstes_geruecht(
  p_embedding extensions.halfvec,
  p_schwelle  double precision
)
returns table (geruecht_id bigint, aehnlichkeit double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select naechste.geruecht_id, naechste.aehnlichkeit
  from (
    select m.geruecht_id,
           1 - (m.embedding operator(extensions.<=>) p_embedding) as aehnlichkeit
    from public.meldungen m
    where m.embedding is not null
    order by m.embedding operator(extensions.<=>) p_embedding
    limit 1
  ) naechste
  where naechste.aehnlichkeit >= p_schwelle;
$$;

-- Nur die Edge Function ruft die Suche auf (Admin-Client), niemand ueber die oeffentliche API
revoke execute on function public.aehnlichstes_geruecht(extensions.halfvec, double precision)
  from public, anon, authenticated;
