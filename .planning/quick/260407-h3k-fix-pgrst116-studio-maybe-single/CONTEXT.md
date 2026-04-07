# Quick task: PGRST116 on studio Supabase reads

PostgREST error `PGRST116` / "Cannot coerce the result to a single JSON object" with 0 rows occurs when using `.single()` on a query that matches no rows.

**Change:** Use `.maybe_single()` for optional single-row reads in `studio_routes.py` and `override_service.py`; treat `data is None` as 404 or explicit errors. Updated studio test mocks to chain `maybe_single` instead of `single`.
