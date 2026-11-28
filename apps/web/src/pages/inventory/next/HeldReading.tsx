/**
 * A read that has not answered yet holds the room its answer will take, so the
 * answer arriving moves nothing (r105 walk: 0.0396 CLS on the reduced-motion
 * evidence open). The words stay for a screen reader; sighted people see grey
 * bars on iv-skel-pulse, which stops under reduced motion (item-drawer.css).
 * Heights are item-drawer.css `.ivd-hold[data-hold]`.
 */
export type Hold = 'used' | 'dishes' | 'nutrition';

export default function HeldReading({ say, hold }: { say: string; hold: Hold }) {
  return (
    <div className="ivd-hold" data-hold={hold} role="status" aria-busy="true">
      <span className="ivd-hold-say">{say}</span>
      <span className="iv-skel-bar iv-skel-mid" aria-hidden="true" />
      <span className="iv-skel-bar iv-skel-short" aria-hidden="true" />
      {hold === 'nutrition' ? <span className="iv-skel-bar iv-skel-mid" aria-hidden="true" /> : null}
    </div>
  );
}
