-- r57 D1, SUPERSEDED before it reached main (r109, DD-r108-21/69). Its
-- ml-based return_glass_pour clashed with #1263's sale-keyed one
-- (20270307121700): merged, this file failed its own COMMENT and
-- "exactly one" check (42725). The sale-keyed one stays (BUILD-invoices-fix-r108
-- D3). Kept as a no-op for its version; 20271230100000 drops the old overload
-- wherever it was applied. The old body is in git history.
SELECT 1;
