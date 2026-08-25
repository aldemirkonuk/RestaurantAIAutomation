-- Get Started Overhaul (menu import fix): link menu_items to the
-- master_wine_library_submissions row created for it, so the review/edit
-- screen can log manager corrections as override_events (which requires a
-- NOT NULL submission_id) without a fragile name-based lookup.

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS submission_id UUID
    REFERENCES master_wine_library_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_menu_items_submission_id
  ON menu_items(submission_id)
  WHERE submission_id IS NOT NULL;

COMMENT ON COLUMN menu_items.submission_id IS
  'The master_wine_library_submissions row created for this item during import. Used to attach override_events when a manager edits the row during review.';
