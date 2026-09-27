-- Nachtrag zu 20260926182335_oeffentliche_rechte_entziehen.sql, gefunden per
-- supabase/tests/rechte_test.sql (Fall 3): neue Funktionen waren weiter fuer anon
-- ausfuehrbar.
-- Grund: "jede neue Funktion ist fuer PUBLIC ausfuehrbar" ist in Postgres eine GLOBALE
-- Voreinstellung. Default-Privileges pro Schema (IN SCHEMA public) koennen nur etwas
-- hinzufuegen, globale Rechte aber nicht wegnehmen. Das geht nur ohne IN SCHEMA.
-- Wirkung: jede Funktion, die postgres kuenftig anlegt (in jedem Schema), ist zunaechst
-- nur fuer ihren Eigentuemer und explizit berechtigte Rollen ausfuehrbar. Die Service
-- Role bekommt ihr EXECUTE in public weiter ueber die Supabase-Voreinstellung pro Schema.
alter default privileges for role postgres
  revoke execute on functions from public;
