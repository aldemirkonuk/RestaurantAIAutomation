/**
 * The masthead's margin — sketch 122 direction B, "Goals in the Masthead".
 *
 * The founder, 2026-09-19 (ADR 0160 §108, the brief for sketch 122): "show the
 * house's decided goals on top ('whatever the restaurant has decided … on top
 * as the goal')" and "a goals chart where we recommend setting a goal". On
 * 2026-09-25 he picked direction B, *"direction B is better"*: the goals live
 * in the letter's own masthead as a narrow margin column rather than a second
 * rail beside the day strip, which spans below both.
 *
 * Every state is said, never drawn blank (ADR 0020 / 0051): reading, could not
 * be read, none set, a goal whose own figure could not be read, and more goals
 * than the column holds (it names how many more, and where they are).
 */

import { Link } from 'react-router-dom';
import {
  MARGIN_ROWS,
  fillOf,
  inUnit,
  paceOf,
  type GoalBookVM,
  type GoalSuggestion,
} from './rec-masthead';

export default function GoalsMargin({
  book,
  suggestion,
  onSuggest,
}: {
  book: GoalBookVM;
  suggestion: GoalSuggestion | null;
  /** Opens the suggested entry's own goal sheet — the target stays blank. */
  onSuggest: (s: GoalSuggestion) => void;
}) {
  const shown = book ? book.goals.slice(0, MARGIN_ROWS) : [];
  const more = book ? book.total - shown.length : 0;

  return (
    <aside className="rc-mast-goals" aria-label="The house's goals" data-testid="rc-mast-goals">
      <div className="rc-mg-label">
        <span className="rc-micro">The house&rsquo;s goals</span>
        <Link className="rc-mg-link" to="/reports">
          All, in Reports →
        </Link>
      </div>

      {book === undefined && <p className="rc-why">Reading the house&rsquo;s goals…</p>}

      {book === null && (
        <p className="rc-why" role="status" data-testid="rc-mast-goals-unread">
          Your goals could not be read, so none is shown here {'—'} not an empty list, an
          unread one.
        </p>
      )}

      {book && book.goals.length === 0 && (
        <p className="rc-why" data-testid="rc-mast-goals-none">
          No goal is set for this house yet.
        </p>
      )}

      {shown.map((g) => {
        const pace = paceOf(g);
        const fill = fillOf(g);
        return (
          <div
            key={g.id}
            className="rc-mgoal"
            data-pace={pace === 'Behind' ? 'behind' : undefined}
            data-testid="rc-mgoal"
          >
            <div className="rc-mgoal-name">{g.name}</div>
            {g.unreadable ? (
              <p className="rc-why">This goal&rsquo;s figure could not be read ({g.unreadable}).</p>
            ) : (
              <>
                {fill !== null && (
                  <div
                    className="rc-mgoal-bar"
                    role="img"
                    aria-label={`${Math.round(fill * 100)}% of the target`}
                  >
                    <i style={{ width: `${fill * 100}%` }} />
                  </div>
                )}
                <div className="rc-mgoal-foot">
                  <span className="rc-num">
                    {inUnit(g.current, g.unit)} of {inUnit(g.target, g.unit)}
                  </span>
                  <span className="rc-mgoal-pace">{pace}</span>
                </div>
              </>
            )}
          </div>
        );
      })}

      {book && more > 0 && (
        <p className="rc-why">
          {more} more {more === 1 ? 'goal is' : 'goals are'} in Reports
          {book.truncated ? ' (the progress read stops at six)' : ''}.
        </p>
      )}

      {suggestion && (
        <div className="rc-mgoal rc-mgoal-suggest" data-testid="rc-mgoal-suggest">
          <div className="rc-micro rc-micro-seal">Mudavym suggests</div>
          <div className="rc-mgoal-name">{suggestion.plan.name}</div>
          <p className="rc-why">
            No goal watches {suggestion.plan.metricLabel.toLowerCase()} yet. The target is yours to
            type.
          </p>
          <button type="button" className="rc-mini" onClick={() => onSuggest(suggestion)}>
            Set a goal →
          </button>
        </div>
      )}
    </aside>
  );
}
