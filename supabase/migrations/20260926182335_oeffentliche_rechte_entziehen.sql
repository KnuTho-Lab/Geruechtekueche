-- Zweite Sperre neben RLS: die oeffentlichen Rollen bekommen gar keine Rechte mehr.
--   anon           = jeder mit dem oeffentlichen Anon-Key
--   authenticated  = jeder, der sich im Projekt registriert hat
-- Bisher hatten beide volle Tabellenrechte (SELECT bis TRUNCATE), gestoppt hat sie nur
-- RLS ohne Policies. Ein Grant ist der Schluessel zum Gebaeude, RLS der Pfoertner vor
-- jedem Raum: fehlt einmal der Pfoertner (RLS bei einer neuen Tabelle vergessen), war
-- der Raum offen. Ab jetzt haben die beiden Rollen gar keinen Schluessel mehr.
-- Die Edge Functions laufen mit der Service Role und sind davon nicht betroffen.
-- Braucht spaeter das Frontend Lesezugriff, bekommt es ihn gezielt: ein GRANT SELECT
-- auf eine View plus Policy, in einer eigenen Migration.

-- 1. Bestehende Objekte
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Funktionen sind in Postgres standardmaessig fuer PUBLIC (jeden) ausfuehrbar
revoke execute on all functions in schema public from public, anon, authenticated;

-- 2. Kuenftige Objekte: die Default-Privileges von Supabase geben jeder neuen Tabelle,
-- Sequenz und Funktion in public automatisch Rechte fuer anon und authenticated.
-- Das gilt je Eigentuemer-Rolle; unsere Migrationen legen alles als postgres an.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
