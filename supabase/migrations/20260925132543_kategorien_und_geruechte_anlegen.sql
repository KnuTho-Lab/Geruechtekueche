-- Kategorien als eigene Tabelle (Nachschlagetabelle), nicht als Freitext in geruechte.
-- Grund: der Agent waehlt aus einer geschlossenen Liste, und ein Tippfehler wie
-- "Verguetung" statt "Vergütung" wuerde sonst still eine zweite Kategorie erzeugen.
create table kategorien (
  id   bigint generated always as identity primary key,
  name text not null unique
);

-- Vorlaeufige Themenfelder aus Thomas' Plan, die Taxonomie ist noch nicht final.
-- Aenderungen spaeter ueber eine neue Migration, nicht hier nachtraeglich.
insert into kategorien (name) values
  ('Standort'),
  ('Personal'),
  ('Vergütung'),
  ('Organisation'),
  ('Produkt'),
  ('Sicherheit');

-- Ein Geruecht ist die "Akte", seine Meldungen kommen spaeter in eine eigene Tabelle.
create table geruechte (
  id           bigint generated always as identity primary key,
  kategorie_id bigint not null references kategorien (id)
);

-- Row Level Security: ohne Policies ist ueber die oeffentliche API nichts lesbar oder
-- schreibbar. Serverseitige Zugriffe mit dem Service-Role-Key umgehen RLS.
alter table kategorien enable row level security;
alter table geruechte  enable row level security;
