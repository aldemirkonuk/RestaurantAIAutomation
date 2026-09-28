/**
 * The counter — the shell's second organ (sketch 119 direction D, the
 * founder's pick of 2026-09-21).
 *
 * A shell REGION, not an overlay: it does not trap focus, does not scrim, and
 * is never a form. It holds what waits on the person who is signed in,
 * grouped by the verb they would use — Seal · Verify · Reply · Decide ·
 * Mudavym proposes — and each act opens in place (`CounterActSheet`).
 *
 * EVERY CLAIM IS A REGISTER'S OWN ANSWER, DATED
 * ---------------------------------------------
 * - The head counts registers, from the outcomes returned (`counterHead`).
 * - A register that did not answer is a hollow ring with its failure named
 *   and "Read again"; one the role may not read says "refused" in words; one
 *   still being read shows a hairline, never the ring.
 * - A register that answered empty says so in a line — an empty register is a
 *   line, never an absence.
 * - The foot never claims a read that has not landed ("reading…" while
 *   reading; "offline · will read on return" offline).
 *
 * The market / Judge row is not here: the founder's pick is that it appears
 * only once its register exists.
 */

import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  COUNTER_VERBS,
  REGISTER_ROOM,
  REGISTER_WORD,
  VERB_SHORT,
  VERB_WORD,
  clockOf,
  countWord,
  counterHead,
  verbMark,
  type CounterRegister,
  type CounterRegisterAnswered,
  type CounterVerb,
  type HouseCounterRead,
} from '../../lib/mudavym/counterRead';
import { actLine } from '../../lib/mudavym/counterRows';
import { useHouseSaid, type SaidEntry } from '../../lib/mudavym/houseSaid';
import { COUNTER_POLL_MS, type HouseCounterState } from '../../lib/mudavym/useHouseCounter';
import type { CounterActTarget } from './CounterActSheet';

const SAID_WORD: Record<SaidEntry['kind'], string> = {
  sealed: 'Sealed',
  refused: 'Refused',
  not_read: 'Not read',
  kept: 'Kept',
};

function Ring({ label }: { label?: string }) {
  return <span className="mdv-counter__ring" aria-hidden={label ? undefined : true} aria-label={label} />;
}

function RegLine({
  children,
  mark = 'none',
  action,
}: {
  children: ReactNode;
  mark?: 'ring' | 'hair' | 'none';
  action?: ReactNode;
}) {
  return (
    <div className="mdv-counter__regline">
      {mark === 'ring' && <Ring />}
      {mark === 'hair' && <span className="mdv-counter__hair" aria-hidden />}
      <span>{children}</span>
      {action}
    </div>
  );
}

function RegisterBlock({
  register,
  read,
  onOpen,
  onReadAgain,
}: {
  register: CounterRegister;
  read: HouseCounterRead | null;
  onOpen: (t: CounterActTarget) => void;
  onReadAgain: () => void;
}) {
  const word = REGISTER_WORD[register.key];
  if (register.state === 'refused') {
    return (
      <div data-register={register.key} data-state="refused">
        <RegLine>
          <span title={register.sentence}>{word} · refused for your role</span>
        </RegLine>
      </div>
    );
  }
  if (register.state === 'unreadable') {
    return (
      <div data-register={register.key} data-state="unreadable">
        <RegLine
          mark="ring"
          action={
            <button type="button" className="mdv-link mdv-counter__again" onClick={onReadAgain}>
              Read again
            </button>
          }
        >
          {word} · not read · {register.status ?? 'no answer'} at {clockOf(register.readAt)}
        </RegLine>
      </div>
    );
  }
  const r: CounterRegisterAnswered = register;
  if (r.count === 0) {
    return (
      <div data-register={r.key} data-state="answered">
        <RegLine>{word} · none waiting</RegLine>
      </div>
    );
  }
  const room = REGISTER_ROOM[r.key];
  const more = r.count - r.rows.length;
  return (
    <div data-register={r.key} data-state="answered">
      {r.act === 'not_yours' && (
        <RegLine>
          {word} · {countWord(r)} · the house's count, not your act
        </RegLine>
      )}
      <ul className="mdv-counter__acts">
        {r.rows.map((row) => {
          const line = actLine(r.key, row, read);
          return (
            <li key={line.id}>
              <button
                type="button"
                className="mdv-counter__act"
                data-yours={r.act === 'yours' ? 'true' : 'false'}
                onClick={() => onOpen({ register: r, row })}
              >
                <span className="mdv-counter__verb">{VERB_SHORT[r.verb]}</span>
                <span className="mdv-counter__main">
                  <span className="mdv-counter__what">{line.what}</span>
                  <span className="mdv-counter__detail">{line.detail}</span>
                </span>
                <span className="mdv-counter__at">{line.at}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <RegLine>
          {room ? (
            <Link className="mdv-link" to={room.path}>
              {r.complete ? `${more} more` : `${more}+ more`} on {room.name}
            </Link>
          ) : (
            <>{r.complete ? `${more} more` : `${more}+ more`} not shown</>
          )}
        </RegLine>
      )}
    </div>
  );
}

export interface CounterBodyProps {
  state: HouseCounterState;
  onOpen: (t: CounterActTarget) => void;
}

/** The counter's content — the desktop column and the phone sheet share it. */
export function CounterBody({ state, onOpen }: CounterBodyProps) {
  const { last, reading, failure, offline, readNow } = state;
  const said = useHouseSaid();

  const byVerb = useMemo(() => {
    const m = new Map<CounterVerb, CounterRegister[]>();
    for (const v of COUNTER_VERBS) m.set(v, []);
    for (const r of last?.registers ?? []) m.get(r.verb)?.push(r);
    return m;
  }, [last]);

  let head: string;
  if (!last) head = reading ? 'reading the registers…' : failure ? 'not read' : '—';
  else if (offline) head = `${last.registers.length} registers · from ${clockOf(last.readAt)}`;
  else head = counterHead(last.registers);

  let foot: ReactNode;
  if (offline) {
    foot = <span>{last ? `read ${clockOf(last.readAt)} · ` : ''}offline · will read on return</span>;
  } else if (reading) {
    foot = <span>reading the registers…</span>;
  } else if (last && !failure) {
    foot = (
      <>
        <span>
          read {clockOf(last.readAt)} · again in {COUNTER_POLL_MS / 1000} s · on focus
        </span>
        <button type="button" className="mdv-link" onClick={readNow}>
          Read now
        </button>
      </>
    );
  } else {
    foot = (
      <>
        <span>{last ? `from ${clockOf(last.readAt)} · ` : ''}the last read failed</span>
        <button type="button" className="mdv-link" onClick={readNow}>
          Read now
        </button>
      </>
    );
  }

  return (
    <div className="mdv-counter__inner">
      <div className="mdv-counter__head">
        <span className="mdv-counter__title">On the counter</span>
        <span className="mdv-counter__read" data-testid="counter-head">
          {head}
        </span>
      </div>
      <div className="mdv-counter__body">
        {failure && (
          <RegLine
            mark="ring"
            action={
              <button type="button" className="mdv-link mdv-counter__again" onClick={readNow}>
                Read again
              </button>
            }
          >
            {failure.sentence} {clockOf(failure.at)}
            {last ? ` · what shows is from ${clockOf(last.readAt)}` : ''}
          </RegLine>
        )}
        {!last && reading && (
          <div className="mdv-counter__sec">
            <RegLine mark="hair">Reading the registers</RegLine>
          </div>
        )}
        {last &&
          COUNTER_VERBS.map((verb) => {
            const regs = byVerb.get(verb) ?? [];
            if (regs.length === 0) return null;
            return (
              <section key={verb} className="mdv-counter__sec" aria-label={VERB_WORD[verb]}>
                <h3 className="mdv-counter__eyebrow">{VERB_WORD[verb]}</h3>
                {regs.map((r) => (
                  <RegisterBlock key={r.key} register={r} read={last} onOpen={onOpen} onReadAgain={readNow} />
                ))}
              </section>
            );
          })}
      </div>
      <section className="mdv-counter__said" aria-label="The house said">
        <h3 className="mdv-counter__eyebrow">
          The house said <span className="mdv-counter__n">this sitting · {said.length}</span>
        </h3>
        {said.length === 0 ? (
          <p className="mdv-counter__quiet">Nothing yet this sitting. This log clears when the page reloads.</p>
        ) : (
          <ul className="mdv-counter__saidlist">
            {said.slice(0, 5).map((e) => (
              <li key={e.id} data-kind={e.kind}>
                <span className="mdv-counter__saideb">
                  {SAID_WORD[e.kind]} · {clockOf(e.at)}
                </span>
                <span className="mdv-counter__saidtxt">{e.text}</span>
                {e.sub && <span className="mdv-counter__saidsub">{e.sub}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="mdv-counter__foot">{foot}</div>
    </div>
  );
}

export interface HouseCounterProps extends CounterBodyProps {
  width: 'open' | 'tucked';
  onToggle: () => void;
}

/**
 * The column at desktop widths. Tucked, it is a ~52 px strip that still shows
 * each verb with its mark — a count, a hollow ring for a register not read, or
 * a dash for one refused — never a blank edge.
 */
export function HouseCounter({ state, onOpen, width, onToggle }: HouseCounterProps) {
  const regs = state.last?.registers ?? [];
  if (width === 'tucked') {
    return (
      <aside className="mdv-counter mudavym mdv-counter--strip" aria-label="The counter, tucked">
        <button type="button" className="mdv-counter__stripopen" onClick={onToggle} aria-label="Open the counter">
          <span className="mdv-counter__chev" aria-hidden>
            ‹
          </span>
        </button>
        <ul className="mdv-counter__strip">
          {COUNTER_VERBS.map((verb) => {
            const m = state.last ? verbMark(regs, verb) : null;
            let mark: ReactNode;
            let label: string;
            if (!m && state.failure) {
              // No read has landed and the last attempt failed: that is a
              // register not read, drawn as the ring — a hairline here would
              // claim a read is still under way when it already failed.
              mark = <Ring />;
              label = `${VERB_WORD[verb]}: not read`;
            } else if (!m && state.offline) {
              mark = <span className="mdv-counter__stripn">·</span>;
              label = `${VERB_WORD[verb]}: offline, not read yet`;
            } else if (!m) {
              mark = <span className="mdv-counter__hair" aria-hidden />;
              label = `${VERB_WORD[verb]}: reading`;
            } else if (m.kind === 'count') {
              mark = <span className="mdv-counter__stripn">{m.floor ? `${m.count}+` : m.count}</span>;
              label = `${VERB_WORD[verb]}: ${m.count}${m.floor ? ' or more' : ''}`;
            } else if (m.kind === 'unread') {
              mark = <Ring />;
              label = `${VERB_WORD[verb]}: not read`;
            } else if (m.kind === 'refused') {
              mark = <span className="mdv-counter__stripn">—</span>;
              label = `${VERB_WORD[verb]}: refused for your role`;
            } else {
              return null;
            }
            return (
              <li key={verb}>
                <button type="button" className="mdv-counter__stripverb" onClick={onToggle} aria-label={label} title={label}>
                  <span className="mdv-counter__stripword">{VERB_SHORT[verb]}</span>
                  {mark}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    );
  }
  return (
    <aside className="mdv-counter mudavym" aria-label="The counter">
      <CounterBody state={state} onOpen={onOpen} />
      <button type="button" className="mdv-counter__tuck" onClick={onToggle}>
        Tuck the counter
      </button>
    </aside>
  );
}

export default HouseCounter;
