-- Namenskonvention "sprechend": der Primaerschluessel heisst wie der Fremdschluessel,
-- der auf ihn zeigt. kategorie_id bedeutet damit in jeder Tabelle dasselbe.
-- Der Fremdschluessel geruechte.kategorie_id zieht beim Umbenennen automatisch mit.
alter table kategorien rename column id to kategorie_id;
alter table geruechte  rename column id to geruecht_id;
