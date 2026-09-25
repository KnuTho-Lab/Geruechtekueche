-- Die Kategorie kommt nicht mehr mit der Meldung, sondern aus einem eigenen
-- Klassifizierungs-Workflow, der angestossen wird, sobald ein Geruecht entsteht.
-- Bis dahin ist kategorie_id leer, das heisst "noch nicht klassifiziert".
alter table geruechte alter column kategorie_id drop not null;

comment on column geruechte.kategorie_id is
  'Leer = noch nicht klassifiziert. Wird vom Klassifizierungs-Workflow gesetzt.';
