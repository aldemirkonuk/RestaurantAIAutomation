-- POS-2 replay, QA round 15 on PR #866. Read in a fixed order, 2,100 queued
-- lines whose stock write keeps failing filled every save's 2,000 tries, so a
-- newer sale behind them was never booked. The gateway now reads open rows
-- with replay_tried_at null first, then the oldest stamp, and stamps every
-- row a save looked at and left open: a row that keeps failing goes to the
-- back. Nullable, no default, no backfill (null = no save has looked at it).
-- No index: one house's rows for one item, a few thousand at most.

alter table public.pos_unresolved_lines
  add column if not exists replay_tried_at timestamptz;

comment on column public.pos_unresolved_lines.replay_tried_at is
  'When a mapping save last looked at this open line and left it open. NULL: '
  'no save has. Orders the replay only (NULL first, then oldest); not a '
  'resolution, resolved stays false until the line is booked or cleared.';
