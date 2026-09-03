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

import CellarRegistersControl from '@/pages/cellar/next/CellarRegistersControl';
import { useCellarRegisters } from '@/pages/cellar/next/useCellarNextData';
import '@/pages/cellar/next/cellar-next.css';
import { Note } from './SectionKit';
import { MONO, SANS } from './st-format';

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
    </>
  );
}

export default CellarSection;
