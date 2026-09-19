/**
 * Cellar registers — which drinks registers this house actually carries.
 *
 * The eleventh register, added 2026-09-03 on the founder's answer that a fixed
 * four-register cellar makes two false statements at once to a house that
 * carries none of them: it asserts the programme exists, and then asserts it is
 * empty.
 *
 * THE CONTROL IS NOT THIS PAGE'S, DELIBERATELY.
 * `CellarRegistersControl` lives in `pages/cellar/next/` and is mounted here.
 * It owns the inference, the evidence line and the "you are switching on a
 * register with no rows" ask; a second implementation in this directory would
 * give the product two answers to one question, and the answer this page could
 * give would be the worse one — it has no access to the books the inference
 * reads. So this register supplies what Settings is for (where the value is
 * kept, who may change it, what changing it does) and mounts the control whole.
 *
 * The same reasoning governs the data: `useCellarRegisters` is the cellar's own
 * hook, tenant-keyed by `activeRestaurantId`, and it is called HERE rather than
 * in `useSettingsNextData` so it fetches only when this register is open —
 * matching the lazy-by-register rule the rest of the page follows.
 */

import { useAuth } from '@/contexts/AuthContext';
import CellarRegistersControl from '@/pages/cellar/next/CellarRegistersControl';
import {
  GAZETTEER_MEASURE_IDS,
  HOLD_CEREMONIES,
  useCellarRegisters,
  useCellarSettings,
  type GazetteerMeasureId,
  type HoldCeremony,
} from '@/pages/cellar/next/useCellarNextData';
import '@/pages/cellar/next/cellar-next.css';
import { Choice, Note, Rule, SaveFailure, Toggle } from './SectionKit';
import { MONO, SANS } from './st-format';

// FIXED 2026-09-19 (cellar re-verification, blocking): `auto` used to read
// "Click sends it" — the exact no-hold design ADR 0160 sec110 item 6's
// correction rules out ("the hold stays the one deliberate act in both
// modes"). Both options hold; they differ only in the question after it.
const CEREMONY_LABEL: Record<HoldCeremony, string> = {
  hold: 'Hold, then "are you sure?"',
  auto: 'Hold, sends immediately',
};

const MEASURE_LABEL: Record<GazetteerMeasureId, string> = {
  bottles: 'Bottles on hand',
  titles: 'Titles carried',
  par: 'At or under their own par',
  offbook: 'Carried but off this read',
  parUnset: 'No par recorded',
  registers: 'Registers carried',
};

/**
 * The order-hold ceremony and the "in the building tonight" measures — ADR
 * 0160 sec110 items 6 and 2. Both live on `restaurant_cellar_settings`
 * (migration 20260917150000) behind one hook, `useCellarSettings`, for the
 * same reason `CellarRegistersControl` is mounted rather than reimplemented
 * above: the cellar page owns this data and this read model, Settings owns
 * where it is changed.
 */
function CellarSettingsControls() {
  const settings = useCellarSettings();
  const s = settings.data;

  // ADR 0160 sec110 item 6, answered 2026-09-18: "owners and managers" may
  // change the order-hold ceremony; staff see the current choice but cannot
  // change it — same idiom as `UsualCurrencySection.tsx`'s `canManage`. The
  // gateway enforces this independently (`cellar-settings.service.ts`); this
  // is the honest UI for that rule, not a substitute for it — a staff
  // member who somehow submitted anyway would still be refused server-side.
  // FIXED 2026-09-19 (cellar re-verification, minor): the server
  // (`cellar-settings.service.ts`'s `write()`) has always also accepted
  // `admin`, matching `RolesGuard`'s own owner/manager/admin vocabulary —
  // this client gate omitted it, so an admin saw a disabled control they
  // could still change via a direct API call. Cosmetic-only (the server was
  // always the real gate, and was never more permissive than intended), but
  // the client should say the same thing the server enforces.
  const { activeRole, user } = useAuth();
  const role = activeRole ?? user?.role ?? null;
  // `admin` is a real role the gateway accepts here (and elsewhere —
  // `ReceivingHome.tsx`/`ReceivingNext.tsx` gate on it too) but is not one of
  // the three values `AuthContext`'s own `Role` type declares
  // (`"owner" | "manager" | "staff"`, `AuthContext.tsx`); `.toLowerCase()`
  // widens the comparison's type to `string` rather than assert around a
  // stale type, the same idiom those two pages already use for this exact
  // mismatch. `role` itself stays as given for the "Signed in as" line below.
  const roleForGate = (role ?? '').toLowerCase();
  const canChangeCeremony = roleForGate === 'owner' || roleForGate === 'manager' || roleForGate === 'admin';

  const toggleMeasure = (id: GazetteerMeasureId, on: boolean) => {
    const next = on
      ? [...s.gazetteerMeasures, id]
      : s.gazetteerMeasures.filter((m) => m !== id);
    settings.save.mutate({ gazetteerMeasures: next });
  };

  // A FAILED read is a third state, distinct from "never configured" (which
  // is a real, readable answer: nobody has saved a choice yet) — collapsing
  // them said "Never configured" over an outage and drew the default tiles
  // as if that were the house's own choice. `readable` comes from the same
  // hook's unread-default fallback, so this is true exactly when the GET
  // actually answered.
  const readFailed = !settings.loading && !s.readable;

  return (
    <>
      <Rule />
      <p style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)', margin: '14px 0 4px' }}>
        Sending an order
      </p>
      {readFailed ? (
        <p role="alert" style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 10px' }}>
          This house's cellar settings could not be read{s.readError ? ` — ${s.readError}` : ''}. The
          controls below are disabled rather than showing a guessed value.
        </p>
      ) : (
        <Note>
          Hold-to-order stays the default — a real commitment gets a real gesture. Pick a lighter
          ceremony here if this house wants one; every order still goes to the vendor either way.
        </Note>
      )}
      {readFailed || !canChangeCeremony ? null : (
        <Note>
          Only an owner, a manager, or an admin of this house can change this — "auto" still holds
          before it sends, but is a standing decision to skip the are-you-sure on every order from
          now on.
        </Note>
      )}
      <Choice<HoldCeremony>
        label="Order-hold ceremony"
        value={s.holdCeremony}
        disabled={settings.loading || readFailed || !canChangeCeremony}
        options={HOLD_CEREMONIES.map((v) => ({ value: v, label: CEREMONY_LABEL[v] }))}
        onChange={(v) => settings.save.mutate({ holdCeremony: v })}
      />
      {!settings.loading && !readFailed && !canChangeCeremony ? (
        <p
          style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4)', margin: '4px 0 0' }}
          data-testid="cellar-ceremony-readonly"
        >
          {role ? `Signed in as ${role} at this house — ` : 'This session holds no role at this house — '}
          only an owner, a manager, or an admin may change it.
        </p>
      ) : null}
      <SaveFailure
        failed={settings.save.isError ? { message: settings.save.error instanceof Error ? settings.save.error.message : 'no reason given' } : null}
        what="The ceremony on the cellar page did not change."
      />

      <Rule />
      <p style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)', margin: '14px 0 4px' }}>
        "In the building tonight"
      </p>
      <Note>
        Which measures the cellar overview shows, and in what order they were turned on. Unchecked
        means not drawn — never drawn as zero.
      </Note>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {GAZETTEER_MEASURE_IDS.map((id) => (
          <label
            key={id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2)' }}
          >
            <Toggle
              checked={s.gazetteerMeasures.includes(id)}
              disabled={settings.loading || readFailed || settings.save.isPending}
              label={MEASURE_LABEL[id]}
              onChange={(next) => toggleMeasure(id, next)}
            />
            {MEASURE_LABEL[id]}
          </label>
        ))}
      </div>
      {readFailed ? null : !settings.loading && !s.gazetteerMeasuresConfigured ? (
        <p style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4)', margin: '8px 0 0' }}>
          Never configured — the cellar page is showing its own default four.
        </p>
      ) : null}
    </>
  );
}

export function CellarSection() {
  const registers = useCellarRegisters();

  return (
    <>
      <Note>
        A house that pours no spirits should not be shown a spirits register — drawing one says the programme exists,
        and then says it is empty. This is where the house says which of the seven it carries; the cellar reads the
        answer and draws only those.
      </Note>

      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '0 0 4px' }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          kept · this restaurant — changed · — the readout carries no date for each answer
        </span>
      </p>

      <CellarRegistersControl
        readout={registers.data}
        loading={registers.loading}
        error={registers.error}
        saving={registers.save.isPending}
        saveError={registers.save.error instanceof Error ? registers.save.error.message : null}
        onChange={(rows, source) => registers.save.mutateAsync({ registers: rows, source })}
      />

      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '14px 0 0' }}>
        Whiskey is kept separate from spirits, and soft drinks from non-alcoholic, because a whiskey bar is a different
        house from a cocktail bar that stocks bourbon. An <em>inferred</em> register is never written down: a guess that
        is stored is indistinguishable from an answer a week later, so only a person’s own statement becomes a row —
        which is why a line can read “the books suggest this” and still have no answer behind it.
      </p>

      <CellarSettingsControls />
    </>
  );
}

export default CellarSection;
