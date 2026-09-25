-- Status gehoert zum Geruecht (der Akte), nicht zur einzelnen Meldung.
-- Check Constraint statt Nachschlagetabelle: die Werte sind Ablauflogik, auf die
-- Edge Functions, Agenten und Alarme reagieren, kein frei gepflegter Inhalt.
-- Werte wie in Thomas' Plan. Jedes neue Geruecht startet als 'offen'.
alter table geruechte
  add column status text not null default 'offen'
  check (status in ('offen', 'bestätigt', 'widerlegt', 'nicht prüfbar'));

-- VORLAEUFIG: Kennung der meldenden Person, um Mehrfachmeldungen zu erkennen.
-- Widerspricht "ohne User-ID" aus Thomas' Plan und wird spaeter ersetzt
-- (Vorschlag: nur ein Hash pro Geruecht statt einer festen Kennung).
-- Optional, damit Meldungen auch ohne Kennung gespeichert werden koennen.
alter table meldungen
  add column user_id text;

comment on column meldungen.user_id is
  'VORLAEUFIG, wird ersetzt. Feste Kennung pro Person erlaubt Profilbildung.';
