-- Eine Meldung ist eine "Aussage" in der Akte eines Geruechts (1:n).
-- geruecht_id ist Pflicht: die Zuordnung passiert vor dem Speichern, gibt es noch
-- kein passendes Geruecht, wird zuerst eines angelegt.
-- Die Vektor-Spalte fuer das Embedding folgt in einer eigenen Migration, sobald
-- das Embedding-Modell und damit die Vektorlaenge feststeht.
create table meldungen (
  meldung_id     bigint generated always as identity primary key,
  geruecht_id    bigint not null references geruechte (geruecht_id),
  eingegangen_am timestamptz not null default now(),
  text           text not null
);

alter table meldungen enable row level security;
