/**
 * RecommendationsNext — the Mudavym redesign of `/recommendations`
 * (ADR 0044 p4 wave), behind `mudavym_design_recommendations`.
 *
 * The founder's verdict, verbatim (MAKEOVER-VERDICTS.md:183-185):
 *
 *   "### `/recommendations` — REWORK / find another way
 *    Likes the new version but wants more structure and more uniqueness.
 *    'Maybe we should find another way.'"
 *
 * The other way: THE STANDING BOOK. The legacy page is a flat feed of cards
 * ranked by a hidden score and filtered by coloured chips. This page is ruled
 * by CONSEQUENCE instead — every entry is filed under what acting on it would
 * change (money · stock · vendors · the floor), and every entry states the
 * same three facts in the same place: what it would change, whose hand does it
 * and where the work lands, and how long it has stood. Urgency stays the
 * engine's own word; the score stops being the page's organising principle.
 *
 * Two things the feed never did, kept here because they are the honest ones:
 *  - the head prints the DENOMINATOR — "17 rules were read, 4 stand" — so an
 *    empty book is a proven absence, not a silence (ADR 0020), and since
 *    2026-09-03 it also prints how many were withheld BY A DISMISSAL, so the
 *    two kinds of absence are not read as one;
 *  - "standing" is the real first-fired date, from `recommendation_impressions`
 *    (gateway `attachFirstSeen`), and an em dash only where nothing recorded it.
 *
 * Second pass, 2026-09-03 — dismissal that holds. The founder: "if the person
 * says dismiss, then it should be avoided at all costs — and then we are going
 * to let them know about this as well; or they have the opportunity to either
 * cancel it and discard it from the analysis or not." Dismiss now writes a
 * SCOPED suppression key (rule # subject # period — see the gateway's
 * `analytics/insights/suppression.ts`) that the insight generator honours on
 * every subsequent run, offers separately to take the day out of the analysis,
 * and says in words what will never be shown and where to undo it.
 *
 * Fourth pass, 2026-09-03 — the two forward doors. The founder: "maybe add
 * couple buttons — that will let them set the recommendations as goals, or have
 * them see this changes in reports (research the possible endpoints it can
 * reach to give them better insight)." Every entry now carries **Make this a
 * goal** (a real `POST /analytics/goals/:rid`, with the metric, direction and
 * period derived from the rule and only the target asked of the manager) and
 * **See it in reports** (a deep link to the one cutting of the reports sheet's
 * eleven whose register answers this rule). Both mappings, their bases and
 * their refusals live in `rec-forward.ts`; a rule that maps to neither renders
 * the control dark with the reason rather than sending anyone to a drawing
 * that is not about it. The controls are also now classified in two labelled
 * rows — **Carry it out** / **File it** — which is the control-side half of
 * "everything in a categorized classified section".
 *
 * Transport: everything goes through `apiClient`. The page note's §10 "broken"
 * verdict (six raw `fetch` calls, no bearer, 401 on every request) was written
 * on 2026-08-26 and repaired the same day by `58113e26` on the LEGACY file —
 * with no test. This build is the one whose transport is asserted: see
 * `useRecommendationsNextData.test.tsx`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import Entry from './Entry';
import {
  EM,
  STAKE_BLURB,
  STAKE_LABEL,
  STAKE_ORDER,
  URGENCY_RANK,
  ensureFraunces,
  failureSentence,
  fmtDay,
  fmtReadAt,
  type StakeId,
} from './rec-format';
import {
  useRecommendationsNextData,
  type DismissChoice,
  type EntryVM,
  type Leaf,
  type TeamOption,
} from './useRecommendationsNextData';
import './rec-next.css';

const LEAVES: Array<{ id: Leaf; label: string }> = [
  { id: 'standing', label: 'Standing' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'done', label: 'Ruled off' },
  { id: 'history', label: 'History' },
];

const REGISTER_NAME: Record<Leaf, string> = {
  standing: 'the standing book',
  snoozed: 'the snoozed leaf',
  dismissed: 'the dismissed leaf',
  done: 'the ruled-off leaf',
  history: 'the history leaf',
};

/** The house's double rule — "the account is ruled off" (057, kept). */
function DoubleRule() {
  return (
    <div className="rc-double">
      <i />
      <i />
    </div>
  );
}

export interface RecommendationsNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

export default function RecommendationsNext({ ground }: RecommendationsNextProps) {
  const data = useRecommendationsNextData();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linked = searchParams.get('insight');
  const [stake, setStake] = useState<StakeId | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState(-1);
  /** The entry whose dismissal sheet the `d` key asked to open. */
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const { leaf, setLeaf } = data;

  useEffect(() => {
    ensureFraunces();
  }, []);

  // Changing leaf clears what belonged to the old one: no selection survives
  // into rows it was never made against.
  useEffect(() => {
    setSelected(new Set());
    setExpanded(new Set());
    setFocusedIdx(-1);
    setSheetFor(null);
  }, [leaf]);

  /**
   * The register decides the order of the page, so it decides the order of
   * everything keyed to it: `byStake` is built first and `shown` is that
   * grouping flattened, so entry numbers and j/k run straight down the page —
   * a pinned entry in a lower section is not silently entry 01.
   */
  const byStake = useMemo(() => {
    const list = stake === 'all' ? data.entries : data.entries.filter((e) => e.stake === stake);
    const ranked = [...list].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ur = (URGENCY_RANK[a.urgency] ?? 3) - (URGENCY_RANK[b.urgency] ?? 3);
      return ur !== 0 ? ur : (b.score ?? 0) - (a.score ?? 0);
    });
    const m = new Map<StakeId, EntryVM[]>();
    for (const e of ranked) {
      const bucket = m.get(e.stake);
      if (bucket) bucket.push(e);
      else m.set(e.stake, [e]);
    }
    return m;
  }, [data.entries, stake]);

  const shown = useMemo(() => STAKE_ORDER.flatMap((s) => byStake.get(s) ?? []), [byStake]);

  /**
   * NEW-759: `?insight=<ruleKey>` opens and focuses that entry (the focus
   * mechanism is what scrolls it into view, so there is one scroll path, not
   * two). If the rule is not standing, the page says so rather than landing
   * silently on a book that does not contain what the link promised.
   */
  useEffect(() => {
    if (!linked || leaf !== 'standing' || shown.length === 0) return;
    const idx = shown.findIndex((e) => e.ruleKey === linked);
    if (idx < 0) return;
    setExpanded((p) => new Set(p).add(linked));
    setFocusedIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, leaf, shown.length]);

  const stakeCounts = useMemo(() => {
    const m = new Map<StakeId, number>();
    for (const e of data.entries) m.set(e.stake, (m.get(e.stake) ?? 0) + 1);
    return m;
  }, [data.entries]);

  /* ── the writes ──────────────────────────────────────────────────────── */

  /**
   * Act = record that this entry was followed, THEN go do the work.
   *
   * The write is awaited rather than fired and forgotten. `navigate()` unmounts
   * this page synchronously, so the earlier fire-and-forget version raced: a
   * failed POST rolled the entry back and said so on a component that no longer
   * existed, and nobody ever saw it — while §1b of the page note claimed, with
   * no carve-out, that "a write that did not land puts the entry back and says
   * so". Now a write that does not land keeps you here, with the sentence and
   * the control still on screen; `acted_at` is the audit trail of "I followed
   * this", and leaving with it silently unrecorded is the failure this page
   * exists to refuse.
   */
  const act = useCallback(
    async (e: EntryVM) => {
      const landed = await data.setDisposition(
        e,
        { acted: true },
        `Followed “${e.hand.label}” to ${e.hand.where}.`,
        false,
      );
      if (landed) navigate(e.hand.href);
    },
    [data, navigate],
  );

  /**
   * Dismiss is the only write on this page that is a STANDING INSTRUCTION
   * rather than a note about a card, so it does not go through
   * `setDisposition`: the sheet resolves a scope, the gateway's key for that
   * scope, and an optional day exclusion, and the hook says in words what will
   * never be shown again.
   */
  const dismiss = (e: EntryVM, choice: DismissChoice) => void data.dismiss(e, choice);

  const snooze = (e: EntryVM, days: number, label: string) =>
    void data.setDisposition(
      e,
      {
        status: 'snoozed',
        snoozeUntil: new Date(Date.now() + days * 86_400_000).toISOString(),
        reason: label,
      },
      `Snoozed ${label}.`,
      true,
    );

  const done = (e: EntryVM) =>
    void data.setDisposition(e, { status: 'done' }, 'Ruled off, and sealed.', true);

  const pin = (e: EntryVM) =>
    void data.setDisposition(
      e,
      { pinned: !e.pinned },
      e.pinned ? 'Unpinned.' : 'Pinned to the top of the book.',
      false,
    );

  const rate = (e: EntryVM, value: 'helpful' | 'not_helpful') =>
    void data.setDisposition(e, { feedback: e.feedback === value ? null : value }, 'Noted.', false);

  const assign = (e: EntryVM, member: TeamOption | null) =>
    void data.setDisposition(
      e,
      { assignedTo: member?.id ?? null, assignedName: member?.name ?? null },
      member ? `Assigned to ${member.name}.` : 'Assignment cleared.',
      false,
    );

  const toggle = (set: Set<string>, key: string) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  };

  /* ── keyboard (NEW-294), kept from the legacy page ────────────────────── */

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (shown.length === 0) return;
      const e = shown[Math.max(0, Math.min(focusedIdx, shown.length - 1))];
      switch (ev.key) {
        case 'j':
          ev.preventDefault();
          setFocusedIdx((i) => Math.min(shown.length - 1, (i < 0 ? -1 : i) + 1));
          break;
        case 'k':
          ev.preventDefault();
          setFocusedIdx((i) => Math.max(0, (i < 0 ? 0 : i) - 1));
          break;
        case 'e':
          if (e) setExpanded((prev) => toggle(prev, e.ruleKey));
          break;
        case 'x':
          if (e && leaf === 'standing') setSelected((prev) => toggle(prev, e.ruleKey));
          break;
        case 'a':
          if (e && leaf === 'standing') void act(e);
          break;
        case 'd':
          // The key opens the sheet rather than dismissing: a dismissal now
          // carries a SCOPE, and a keystroke cannot choose one on the
          // manager's behalf. `e` expands the working; `d` asks the question.
          if (e && leaf === 'standing') setSheetFor(e.ruleKey);
          break;
        case 's':
          if (e && leaf === 'standing') snooze(e, 1, 'until tomorrow');
          break;
        case 'p':
          if (e && leaf === 'standing') pin(e);
          break;
        case 'Escape':
          setSelected(new Set());
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, focusedIdx, leaf]);

  /* ── the opening voice — it only says what it knows ───────────────────── */

  const n = data.entries.length;
  let voice: string;
  if (data.phase === 'loading') {
    voice = 'Reading the rule engine…';
  } else if (data.phase === 'failed' && data.failure) {
    voice = failureSentence(data.failure, REGISTER_NAME[leaf]);
  } else if (leaf !== 'standing') {
    voice =
      n === 0
        ? `Nothing on ${REGISTER_NAME[leaf]}.`
        : `${n} ${n === 1 ? 'entry' : 'entries'} on ${REGISTER_NAME[leaf]}.`;
  } else {
    const read = data.rulesEvaluated === null ? `An unknown number of rules (${EM})` : `${data.rulesEvaluated} rules`;
    voice =
      n === 0
        ? `${read} were read, and none of them stands. The book is clear.`
        : `${read} were read. ${n} ${n === 1 ? 'entry stands' : 'entries stand'} — the rest did not fire, or you have already ruled them off.`;
  }

  const picked = shown.filter((e) => selected.has(e.ruleKey));

  return (
    <div className="mudavym rc-page" data-ground={ground}>
      <div className="rc-wrap">
        {/* ── the head ─────────────────────────────────────────────────── */}
        <header className="rc-head">
          <Wordmark size={13} />
          <h1 className="rc-serif rc-title">Recommendations</h1>
          <p className="rc-serif rc-voice">{voice}</p>
          <p className="rc-micro rc-readat">
            Read at {fmtReadAt(data.generatedAt)} · one entry = one deterministic rule that fired
          </p>
          <DoubleRule />
          {/*
            The denominator's second half. "17 rules were read, 4 stand" is only
            true if the other 13 are accounted for, and the ones you dismissed
            are a different kind of absence from the ones that did not fire.
          */}
          {data.phase === 'ready' && leaf === 'standing' && (
            <p className="rc-said rc-suppressed" data-testid="rc-suppressed">
              {!data.suppressionsReadable
                ? `Your dismissals could not be read, so entries you have already dismissed may be standing below ${EM} this book is not proof they are gone.`
                : data.suppressed && data.suppressed > 0
                  ? `${data.suppressed} ${data.suppressed === 1 ? 'entry was' : 'entries were'} withheld because you dismissed ${data.suppressed === 1 ? 'it' : 'them'}. They are on the Dismissed leaf, and every one can be returned.`
                  : 'Nothing was withheld by a dismissal.'}
            </p>
          )}
          {linked && data.phase === 'ready' && !data.entries.some((e) => e.ruleKey === linked) && (
            <p className="rc-said" role="status">
              The link asked for <span className="rc-num">{linked}</span>, which is not standing —
              it was ruled off, dismissed, snoozed, or has stopped firing. Try the other leaves.
            </p>
          )}
        </header>

        {/* ── the leaves ───────────────────────────────────────────────── */}
        <nav className="rc-leaves" aria-label="Leaves of the book">
          {LEAVES.map((l) => {
            const count =
              l.id === 'standing'
                ? (data.counts?.active ?? null)
                : l.id === 'history'
                  ? null
                  : (data.counts?.[l.id] ?? null);
            return (
              <button
                key={l.id}
                type="button"
                className="rc-leaf"
                onClick={() => setLeaf(l.id)}
                aria-current={leaf === l.id ? 'page' : undefined}
              >
                {l.label}
                <span className="rc-num">{count === null ? EM : count}</span>
              </button>
            );
          })}
        </nav>

        {data.phase === 'failed' && data.failure && (
          <div className="rc-alert" role="alert">
            <span>{failureSentence(data.failure, REGISTER_NAME[leaf])}</span>
            <button type="button" className="rc-retry" onClick={data.refetch}>
              {data.failure.expired ? 'Try again' : 'Read it again'}
            </button>
          </div>
        )}

        <div className="rc-shell">
          {/* ── the register — the page's organising axis ──────────────── */}
          <aside>
            <div className="rc-micro">The register</div>
            <p className="rc-reg-note">
              What acting on an entry would change. Filed from the rule’s own category.
            </p>
            <div className="rc-reg-list">
              <RegisterRow
                label="All"
                blurb="every entry on this leaf"
                count={data.entries.length}
                on={stake === 'all'}
                onClick={() => setStake('all')}
              />
              {STAKE_ORDER.filter((s) => (stakeCounts.get(s) ?? 0) > 0 || s !== 'unfiled').map((s) => (
                <RegisterRow
                  key={s}
                  label={STAKE_LABEL[s]}
                  blurb={STAKE_BLURB[s]}
                  count={stakeCounts.get(s) ?? 0}
                  on={stake === s}
                  onClick={() => setStake(stake === s ? 'all' : s)}
                />
              ))}
            </div>

            {/* days the engine was told not to count — the exclusion store */}
            <div className="rc-aside-block">
              <div className="rc-micro">Out of the analysis</div>
              {data.exclusions === undefined ? (
                <p className="rc-why">Reading the excluded days…</p>
              ) : !data.exclusions.readable ? (
                <p className="rc-why" role="status">
                  The excluded-day store could not be read (
                  {data.exclusions.problem ?? 'no reason given'}), so every average below
                  may still be counting days you ruled out. Not an empty list {EM} an
                  unreadable one.
                </p>
              ) : data.exclusions.items.length === 0 ? (
                <p className="rc-why">
                  No day has been ruled out. Every day with records counts toward the
                  averages; days with no records were never counted as zero.
                </p>
              ) : (
                <ul className="rc-excl">
                  {data.exclusions.items.map((x) => (
                    <li key={x.businessDate}>
                      <span className="rc-num">{fmtDay(x.businessDate)}</span>
                      <span className="rc-why">{x.reason ?? 'no reason given'}</span>
                      <button
                        type="button"
                        className="rc-quiet"
                        onClick={() => void data.includeDay(x.businessDate)}
                      >
                        Count it again
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* the digest — a control whose sender does not exist */}
            <div className="rc-aside-block">
              <div className="rc-micro">Daily digest</div>
              <button type="button" className="rc-dark rc-dark-wide" disabled>
                {data.digest === undefined
                  ? 'Reading the preference…'
                  : data.digest === null
                    ? `Preference unreadable ${EM}`
                    : `Stored: ${data.digest.digestEnabled ? 'on' : 'off'}, ${data.digest.digestHour}:00`}
              </button>
              <p className="rc-why">
                Disabled on purpose: the preference stores, but nothing sends it — no scheduler
                reads <span className="rc-num">recommendation_digest_prefs</span>.
              </p>
            </div>

            {/* the margin — the keys */}
            <div className="rc-aside-block">
              <div className="rc-micro">Keys</div>
              <p className="rc-keys">
                j / k move · e the working · a act
                <br />d the dismissal sheet · s snooze · p pin · x select
              </p>
            </div>
          </aside>

          {/* ── the book ───────────────────────────────────────────────── */}
          <section key={leaf} className="rc-leaf-body">
            {data.phase === 'loading' && (
              <div>
                <p className="rc-loading">Reading {REGISTER_NAME[leaf]}…</p>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rc-ghost" />
                ))}
              </div>
            )}

            {data.phase === 'ready' && shown.length === 0 && (
              <div className="rc-empty">
                <p className="rc-serif">
                  {leaf === 'standing'
                    ? stake === 'all'
                      ? 'Nothing stands against tonight’s numbers.'
                      : `Nothing on this leaf would change ${STAKE_BLURB[stake as StakeId]}.`
                    : `Nothing on ${REGISTER_NAME[leaf]}.`}
                </p>
                {leaf === 'standing' && (
                  <p className="rc-empty-why">
                    Rules that need till data stay silent without a POS, so a short book can mean a
                    quiet week or a thin feed.{' '}
                    <a href="/recommendations/catalog">Browse every insight type →</a>
                  </p>
                )}
              </div>
            )}

            {data.phase === 'ready' &&
              shown.length > 0 &&
              STAKE_ORDER.filter((s) => (byStake.get(s)?.length ?? 0) > 0).map((s) => {
                const list = byStake.get(s) ?? [];
                return (
                  <div key={s} className="rc-section">
                    <div className="rc-section-head">
                      <h2 className="rc-serif">{STAKE_LABEL[s]}</h2>
                      <span className="rc-blurb">{STAKE_BLURB[s]}</span>
                      <span className="rc-num">{list.length}</span>
                    </div>
                    <DoubleRule />
                    {list.map((e) => (
                      <Entry
                        key={e.ruleKey}
                        entry={e}
                        index={shown.indexOf(e)}
                        leaf={leaf}
                        focused={shown[focusedIdx]?.ruleKey === e.ruleKey}
                        selected={selected.has(e.ruleKey)}
                        expanded={expanded.has(e.ruleKey)}
                        team={data.team}
                        onToggleExpand={() => setExpanded((p) => toggle(p, e.ruleKey))}
                        onToggleSelect={() => setSelected((p) => toggle(p, e.ruleKey))}
                        exclusions={data.exclusions}
                        openDismiss={sheetFor === e.ruleKey}
                        onDismissOpened={() => setSheetFor(null)}
                        onAct={() => void act(e)}
                        onDismiss={(choice) => dismiss(e, choice)}
                        onSnooze={(days, label) => snooze(e, days, label)}
                        onPin={() => pin(e)}
                        onRate={(v) => rate(e, v)}
                        onDone={() => done(e)}
                        onRestore={() => void data.restore(e.ruleKey)}
                        onAssign={(m) => assign(e, m)}
                        onWantTeam={data.loadTeam}
                        goals={data.goals}
                        onWantGoals={data.loadGoals}
                        onMakeGoal={data.createGoal}
                        onSeeInReports={(href) => navigate(href)}
                      />
                    ))}
                  </div>
                );
              })}
          </section>
        </div>

        {/* ── what the page just wrote, in words ───────────────────────── */}
        <div className="rc-note" role="status" aria-live="polite">
          {data.note}
          {data.undo && (
            <button
              type="button"
              className="rc-undo"
              onClick={() => void data.restore(data.undo!.ruleKey)}
            >
              Undo
            </button>
          )}
        </div>

        {/* ── the bulk bar — the die pressed dry, no wax ────────────────── */}
        {picked.length > 0 && (
          <div className="rc-bulk">
            <span>{picked.length} selected</span>
            <button
              type="button"
              className="rc-quiet"
              onClick={() => {
                void data.bulk(
                  picked,
                  { status: 'dismissed', reason: 'not_now' },
                  `Dismissed ${picked.length} entries — each rule entirely, on every subject and every day. Return any of them from the Dismissed leaf.`,
                );
                setSelected(new Set());
              }}
              // Bulk cannot ask a scope question per entry, so it takes the
              // widest one and SAYS so on the control — never silently.
              title="Silences each selected rule entirely, on every subject and every day"
            >
              Dismiss them — whole rules
            </button>
            <button
              type="button"
              className="rc-quiet"
              onClick={() => {
                void data.bulk(
                  picked,
                  { status: 'snoozed', snoozeUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() },
                  `Snoozed ${picked.length} entries for a week.`,
                );
                setSelected(new Set());
              }}
            >
              Snooze a week
            </button>
            <button type="button" className="rc-quiet" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {/* ── the signature ────────────────────────────────────────────── */}
        <footer className="rc-foot">
          <Wordmark size={14} />
          <p>Every entry is one deterministic rule against your own numbers. No model wrote them.</p>
        </footer>
      </div>
    </div>
  );
}

function RegisterRow({
  label,
  blurb,
  count,
  on,
  onClick,
}: {
  label: string;
  blurb: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="rc-reg" onClick={onClick} aria-pressed={on} title={blurb}>
      <span>{label}</span>
      <span className="rc-num">{count}</span>
    </button>
  );
}
