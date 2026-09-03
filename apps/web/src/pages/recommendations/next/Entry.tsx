/**
 * One entry in the standing book.
 *
 * The structural idea, in one row: an entry is not a card of prose — it is a
 * ruled record with THREE stated facts the legacy feed never gave, in the same
 * place on every entry:
 *
 *   WHAT IT WOULD CHANGE (the stake) · WHOSE HAND (and where) · STANDING (how long)
 *
 * Everything else — the rationale, the rule key, the assignment, the feedback,
 * and the sealed "rule off" — lives under "the working", which opens on the
 * house `settle` curve (the founder's named favourite motion).
 *
 * Honesty: `standing` is an em dash whenever the disposition store has never
 * touched the entry, because the feed carries no first-fired timestamp. The
 * house's own hand is rendered DISABLED with the reason, because no autonomous
 * execution exists anywhere in the gateway today.
 *
 * All styling is in `rec-next.css` (imported by the page) — Mudavym tokens only.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import { EM, entryNo, fmtStanding, fmtWakes, urgencyLabel, STAKE_LABEL } from './rec-format';
import type { EntryVM, Leaf, TeamOption } from './useRecommendationsNextData';

const REASONS: Array<{ id: string; label: string }> = [
  { id: 'not_relevant', label: 'Not relevant' },
  { id: 'already_handled', label: 'Already handled' },
  { id: 'disagree', label: 'I disagree' },
  { id: 'not_now', label: 'Not right now' },
];

/**
 * The snooze vocabulary — a dropdown, not a table of rows: `value` is the
 * number of days the label already says out loud, and nothing here describes
 * the tenant. (Kept to descriptor keys deliberately, per
 * `scripts/check_no_seeded_defaults.py` S1's descriptor-vs-row distinction.)
 */
const SNOOZES: Array<{ id: string; label: string; value: number }> = [
  { id: 'tomorrow', label: 'Until tomorrow', value: 1 },
  { id: 'week', label: 'Until next week', value: 7 },
  { id: 'month', label: 'Until next month', value: 30 },
];

export interface EntryProps {
  entry: EntryVM;
  index: number;
  leaf: Leaf;
  focused: boolean;
  selected: boolean;
  expanded: boolean;
  team: TeamOption[] | null | undefined;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onAct: () => void;
  onDismiss: (reasonCode: string) => void;
  onSnooze: (days: number, label: string) => void;
  onPin: () => void;
  onRate: (value: 'helpful' | 'not_helpful') => void;
  onDone: () => void;
  onRestore: () => void;
  onAssign: (member: TeamOption | null) => void;
  onWantTeam: () => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rc-fact">
      <div className="rc-micro">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Quiet({
  children,
  onClick,
  pressed,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button type="button" className="rc-quiet" onClick={onClick} aria-pressed={pressed}>
      {children}
    </button>
  );
}

export default function Entry(props: EntryProps) {
  const { entry: e, leaf, focused, selected, expanded, team } = props;
  const [menu, setMenu] = useState<'dismiss' | 'snooze' | 'assign' | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    // jsdom (and any engine without the CSSOM view module) has no
    // scrollIntoView — keyboard navigation must still work there.
    if (focused && typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const standing = leaf === 'snoozed' ? fmtWakes(e.snoozeUntil) : fmtStanding(e.updatedAt);
  const live = leaf === 'standing';

  return (
    <article
      ref={rootRef}
      id={`rc-entry-${e.ruleKey}`}
      data-testid="rc-entry"
      className="rc-entry"
      data-focused={focused ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
    >
      {/* gutter — the entry's number in the book, and its pin */}
      <div className="rc-gutter">
        <div className="rc-num">{entryNo(props.index)}</div>
        {e.pinned && <div className="rc-micro rc-micro-seal">PIN</div>}
      </div>

      <div className="rc-body">
        {/* the register line — urgency and rule category, the engine's own words */}
        <div className="rc-stamps">
          <span className="rc-micro">{urgencyLabel(e.urgency)}</span>
          <span className="rc-micro rc-micro-dim">{e.category || 'uncategorised'}</span>
          {e.acted && <span className="rc-micro">acted</span>}
          {e.assignedName && <span className="rc-micro rc-micro-seal">{e.assignedName}</span>}
        </div>

        {/* the product speaking: the observed number, restated */}
        <p className="rc-serif rc-obs">
          {e.observation || 'This entry carries no stored observation.'}
        </p>

        {e.recommendation ? (
          <p className="rc-do">{e.recommendation}</p>
        ) : (
          <p className="rc-do-none">
            No action was stored with this entry {EM} it was filed from a snapshot.
          </p>
        )}

        {/* ── the three facts, in the same place on every entry ─────────── */}
        <div className="rc-facts">
          <Fact label="Would change">{STAKE_LABEL[e.stake]}</Fact>
          <Fact label="Whose hand">Yours, in {e.hand.where}</Fact>
          <Fact label={leaf === 'snoozed' ? 'Wakes' : 'Standing'}>
            <span className="rc-num">{standing}</span>
          </Fact>
        </div>

        {/* ── controls ──────────────────────────────────────────────────── */}
        <div className="rc-controls">
          {live ? (
            <>
              <button type="button" className="rc-act" onClick={props.onAct}>
                {e.hand.label} →
              </button>
              <Quiet onClick={props.onToggleExpand}>
                {expanded ? 'Hide the working' : 'The working'}
              </Quiet>
              <Quiet onClick={() => setMenu(menu === 'snooze' ? null : 'snooze')}>Snooze</Quiet>
              <Quiet onClick={() => setMenu(menu === 'dismiss' ? null : 'dismiss')}>Dismiss</Quiet>
              <Quiet onClick={props.onPin} pressed={e.pinned}>
                {e.pinned ? 'Pinned' : 'Pin'}
              </Quiet>
              <Quiet onClick={props.onToggleSelect} pressed={selected}>
                {selected ? 'Selected' : 'Select'}
              </Quiet>
            </>
          ) : (
            <>
              <Quiet onClick={props.onToggleExpand}>
                {expanded ? 'Hide the working' : 'The working'}
              </Quiet>
              <Quiet onClick={props.onRestore}>Return it to the book</Quiet>
            </>
          )}
        </div>

        {menu === 'dismiss' && (
          <div className="rc-menu" role="group" aria-label="Dismiss with a reason">
            <span className="rc-micro">Why are you dismissing it?</span>
            <div className="rc-row">
              {REASONS.map((r) => (
                <Quiet
                  key={r.id}
                  onClick={() => {
                    setMenu(null);
                    props.onDismiss(r.id);
                  }}
                >
                  {r.label}
                </Quiet>
              ))}
            </div>
          </div>
        )}

        {menu === 'snooze' && (
          <div className="rc-menu" role="group" aria-label="Snooze this entry">
            <span className="rc-micro">Put it back on the shelf until…</span>
            <div className="rc-row">
              {SNOOZES.map((s) => (
                <Quiet
                  key={s.id}
                  onClick={() => {
                    setMenu(null);
                    props.onSnooze(s.value, s.label.toLowerCase());
                  }}
                >
                  {s.label}
                </Quiet>
              ))}
            </div>
          </div>
        )}

        {/* ── the working — settle, 0fr → 1fr ───────────────────────────── */}
        {/*
          The working stays in the DOM so the grid-rows settle has something to
          animate — but a collapsed panel must not be readable or tabbable, so
          it is aria-hidden here and `visibility: hidden` in the CSS. Both flip
          with `expanded`; nothing is announced or focusable behind a closed
          row.
        */}
        <div className="rc-work" data-open={expanded ? 'true' : 'false'}>
          <div aria-hidden={!expanded}>
            <div className="rc-workbox">
              <span className="rc-micro">Why this follows</span>
              <p className="rc-prose">
                {e.rationale ??
                  `No rationale was stored with this entry ${EM} the snapshot in the actions table keeps the observation and the action only.`}
              </p>

              <div className="rc-workblock">
                <span className="rc-micro">The rule that fired</span>
                <p className="rc-num rc-rulekey">{e.ruleKey}</p>
                <p className="rc-said">
                  A deterministic rule, evaluated against your own numbers. No model wrote this
                  sentence.
                </p>
              </div>

              {/* the house's own hand — honestly dark */}
              <div className="rc-workblock">
                <span className="rc-micro">The house’s hand</span>
                <div className="rc-row">
                  <button type="button" className="rc-dark rc-dark-inline" disabled>
                    Let Mudavym do it
                  </button>
                  <span className="rc-said">
                    Not built: nothing in the gateway can carry out a recommendation on your
                    behalf, with or without permission.
                  </span>
                </div>
              </div>

              {/* assignment — real */}
              <div className="rc-workblock">
                <span className="rc-micro">Assigned to</span>
                <div className="rc-row">
                  <span className="rc-plain">
                    {e.assignedName ?? `nobody ${EM} this entry has no owner`}
                  </span>
                  <Quiet
                    onClick={() => {
                      props.onWantTeam();
                      setMenu(menu === 'assign' ? null : 'assign');
                    }}
                  >
                    {e.assignedName ? 'Reassign' : 'Assign'}
                  </Quiet>
                  {e.assignedName && <Quiet onClick={() => props.onAssign(null)}>Clear</Quiet>}
                </div>
                {menu === 'assign' && (
                  <div className="rc-row">
                    {team === undefined && <span className="rc-said">Reading the roster…</span>}
                    {team === null && (
                      <span className="rc-said">
                        The roster could not be read — nobody can be picked here right now.
                      </span>
                    )}
                    {Array.isArray(team) && team.length === 0 && (
                      <span className="rc-said">
                        The roster is empty — add a teammate on /team first.
                      </span>
                    )}
                    {Array.isArray(team) &&
                      team.map((m) => (
                        <Quiet
                          key={m.id}
                          onClick={() => {
                            setMenu(null);
                            props.onAssign(m);
                          }}
                        >
                          {m.name}
                        </Quiet>
                      ))}
                  </div>
                )}
              </div>

              {/* feedback — real */}
              <div className="rc-workblock rc-row">
                <span className="rc-micro">Was it worth reading?</span>
                <Quiet onClick={() => props.onRate('helpful')} pressed={e.feedback === 'helpful'}>
                  Worth it
                </Quiet>
                <Quiet
                  onClick={() => props.onRate('not_helpful')}
                  pressed={e.feedback === 'not_helpful'}
                >
                  Not worth it
                </Quiet>
              </div>

              {e.reason && <p className="rc-said rc-workblock">Filed with the reason “{e.reason}”.</p>}

              {/* the seal — the one ceremony on this page */}
              {live && (
                <div className="rc-seal-block">
                  <span className="rc-micro">Rule it off</span>
                  <p className="rc-said">
                    Hold to close the entry: you are asserting the work was done, and the book
                    rules it off.
                  </p>
                  <HoldToApprove
                    onApprove={props.onDone}
                    label="Hold to rule off"
                    approvedLabel="Ruled off"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
