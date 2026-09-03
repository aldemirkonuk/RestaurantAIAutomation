/**
 * A register that has a table and no way in.
 *
 * The rule this screen exists to honour (ADR 0020 / "absence reported as
 * health"): an empty list reads as "nothing happened". Beer, whiskey and
 * cocktails have not been counted — nobody has asked, because nothing serves
 * them — and the difference between *none* and *unasked* is the whole point
 * here. So: no rows, no zeros, no skeleton pretending a fetch is in flight.
 * Words for what is missing, and the column list so the shape of the register
 * is visible before it holds anything.
 */

import { Link } from 'react-router-dom';
import { EM, REGISTER_TITLE, type RegisterId } from './cellar-format';
import { REGISTER_STATE } from './registerShapes';

export default function UnwiredRegister({ id }: { id: RegisterId }) {
  const state = REGISTER_STATE[id];

  return (
    <div data-testid={`unwired-${id}`}>
      <p className="cl-crumb">
        <Link to="/cellar" className="cl-focus">
          The Cellar
        </Link>{' '}
        · register
      </p>
      <h1 className="cl-h1">{REGISTER_TITLE[id]}</h1>
      <p className="cl-standing">
        This register is not wired yet — so it holds no count, not a count of zero.
      </p>

      <hr className="cl-rule" style={{ margin: '16px 0 18px' }} />

      <div role="status" className="cl-panel" data-unwired="true">
        <p className="cl-said" style={{ color: 'var(--ink-1)', fontSize: 13 }}>
          {state.missing}
        </p>
        <dl style={{ margin: '14px 0 0', display: 'grid', gap: 6, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <dt className="cl-dim" style={{ minWidth: 116 }}>
              Rows would come from
            </dt>
            <dd className="cl-num" style={{ margin: 0, fontSize: 11.5 }}>
              {state.table}
            </dd>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <dt className="cl-dim" style={{ minWidth: 116 }}>
              Rows here today
            </dt>
            <dd style={{ margin: 0 }}>
              <span className="cl-num">{EM}</span> (unread — no endpoint to ask)
            </dd>
          </div>
        </dl>
      </div>

      <h2 className="cl-sec" style={{ margin: '24px 0 10px' }}>
        The shape it would carry
      </h2>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          border: '1px solid var(--paper-2)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {state.fields.map((f, i) => (
          <li
            key={f.id}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '2px 14px',
              padding: '9px 14px',
              fontSize: 12,
              background: i % 2 ? 'transparent' : 'var(--paper-1)',
              borderTop: i === 0 ? 'none' : '1px solid var(--paper-2)',
            }}
          >
            <span style={{ minWidth: 190, fontWeight: 600 }}>{f.label}</span>
            <span className="cl-dim">{f.description}</span>
          </li>
        ))}
      </ul>
      <p className="cl-note">
        These are columns that already exist in the schema, listed so the register’s shape can be
        judged before it holds anything. No line above is a bottle this house owns.
      </p>
    </div>
  );
}
