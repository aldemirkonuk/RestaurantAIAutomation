-- r57 table side, decision D1: a void of a pour returns the poured ml.
--
-- SUPERSEDED BEFORE IT REACHED main (r109, DD-r108-21/69). This version
-- created a second, ml-based public.return_glass_pour (10 arguments: p_pours *
-- p_pour_ml back, capped only per void key) beside #1263's sale-keyed one from
-- 20270307121700, which gives back what the named sale BOOKED, at most once
-- across every void of it (QA 8c). Merged, the two overloads made this file's
-- own COMMENT ON FUNCTION and its "exactly one" check fail (42725), and gave
-- "void" two meanings under one name. The founder-delegated call
-- (BUILD-invoices-fix-r108 D3) keeps the sale-keyed function; r57's
-- whole/fraction split is voided part by part under each part's own sale key
-- in pos-hub.service.ts.
--
-- The version is kept, as a no-op, so a database that applied the old body
-- still finds its file; 20271230100000_one_void_of_a_pour.sql drops the old
-- overload wherever it exists. The old body is in git history
-- (feat/r105-inv-pour-cost-basis).

SELECT 1;
