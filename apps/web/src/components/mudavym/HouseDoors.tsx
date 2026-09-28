/**
 * The phone's four doors (sketch 119 D at 390): Counter · Rooms · Search ·
 * Ask Mudavym. A bottom bar under the page; the house header is the only bar
 * above it (the legacy mobile top bar is not rendered under the shell).
 *
 * The Counter door carries a dot, never a number — the bell's number and the
 * counter's never share one, and a sum of acts across registers is the
 * failure the counter refuses. A hollow dot means a register that could hold
 * an act for this person was not read: "cannot say", not "nothing".
 */

import { Inbox, Menu, MessageCircle, Search } from 'lucide-react';
import { openAskAi } from '../askai/events';

export interface HouseDoorsProps {
  /** true = acts wait on you; null = a register was not read; false = none. */
  waiting: boolean | null;
  counterOpen: boolean;
  roomsOpen: boolean;
  onCounter: () => void;
  onRooms: () => void;
}

function openPalette(): void {
  window.dispatchEvent(new CustomEvent('wineops:command-open'));
}

export function HouseDoors({ waiting, counterOpen, roomsOpen, onCounter, onRooms }: HouseDoorsProps) {
  return (
    <nav className="mdv-doors mudavym" aria-label="The four doors">
      <button
        type="button"
        className="mdv-doors__door"
        aria-pressed={counterOpen}
        aria-label={
          waiting === true
            ? 'The counter — acts wait on you'
            : waiting === null
              ? 'The counter — a register was not read'
              : 'The counter'
        }
        onClick={onCounter}
      >
        <span className="mdv-doors__glyph" aria-hidden>
          <Inbox size={16} strokeWidth={1.75} />
          {waiting === true && <span className="mdv-doors__dot" />}
          {waiting === null && <span className="mdv-doors__dot mdv-doors__dot--hollow" />}
        </span>
        <span>Counter</span>
      </button>
      <button type="button" className="mdv-doors__door" aria-pressed={roomsOpen} onClick={onRooms}>
        <span className="mdv-doors__glyph" aria-hidden>
          <Menu size={16} strokeWidth={1.75} />
        </span>
        <span>Rooms</span>
      </button>
      <button type="button" className="mdv-doors__door" onClick={openPalette}>
        <span className="mdv-doors__glyph" aria-hidden>
          <Search size={16} strokeWidth={1.75} />
        </span>
        <span>Search</span>
      </button>
      <button type="button" className="mdv-doors__door" onClick={openAskAi}>
        <span className="mdv-doors__glyph" aria-hidden>
          <MessageCircle size={16} strokeWidth={1.75} />
        </span>
        <span>Ask</span>
      </button>
    </nav>
  );
}

export default HouseDoors;
