/**
 * One act, opened IN PLACE over the page you are on (sketch 119 D; ADR 0112's
 * `Sheet`, 440, `tuck`). Closing it lands back on the page exactly as it was.
 *
 * THE SEAL LEAVES /orders — AND TAKES NOTHING WEAKER WITH IT
 * ---------------------------------------------------------
 * The founder's answer to fork 3 (2026-09-21): a sealed act may be completed
 * from the counter's sheet on ANY page, carrying the same `HoldToApprove`
 * ceremony and the same server seal as the owning page. So the seal here is
 * `SealedApproveDie` — the one implementation of the order seal for every
 * surface that is not `/orders`'s rebuild (the legacy Orders page and the
 * dashboard use it): the mint happens when the hold BEGINS, one seal per
 * order, a failed mint approves nothing, and the gateway's 403 is printed as
 * the gateway said it. No second copy of the mint lives in the shell.
 *
 * A PROPOSAL IS APPLIED ONLY BY THE SEAL — FROM THE COUNTER
 * --------------------------------------------------------
 * The founder's pick for "Mudavym proposes": applied only by the seal. So a
 * proposal's sheet carries `HoldToApprove` bound to a server seal of its own
 * (`POST /ask-ai/actions/:id/seal-challenge` when the hold begins, then
 * `sealed-confirm` carrying it — ADR 0116's challenge-and-redeem, subject kind
 * `ai_proposed_action`). There is no click-to-apply control here. The copy
 * says "from the counter" on purpose: the Ask Mudavym panel's `ProposalCard`
 * still applies a proposal with the unsealed `POST /ask-ai/actions/:id/confirm`
 * (with edits), so "a proposal is applied only by the seal" is true of this
 * sheet and not yet of the house.
 *
 * WHAT IS NOT COMPLETED HERE, AND SAYS SO
 * ---------------------------------------
 * Verify (a bottle count), Reply (what a vendor is told) and an invitation are
 * completed on their own pages; the sheet shows the record and opens that
 * page. An identity candidate has no page that decides it yet — the sheet says
 * so rather than offering a weaker door.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from './Sheet';
import { HoldToApprove } from './HoldToApprove';
import { SealedApproveDie } from '../orders/SealedApproveDie';
import { applyProposalSealed, mintProposalSeal } from '../../services/api/askAi';
import {
  REGISTER_ROOM,
  REGISTER_WORD,
  VERB_WORD,
  type CounterOrderRow,
  type CounterProposalRow,
  type CounterRegisterAnswered,
  type CounterRowByKey,
  type HouseCounterRead,
} from '../../lib/mudavym/counterRead';
import { actLine, orderMoney } from '../../lib/mudavym/counterRows';
import { houseSaid } from '../../lib/mudavym/houseSaid';

export interface CounterActTarget {
  register: CounterRegisterAnswered;
  row: CounterRowByKey[keyof CounterRowByKey];
}

export interface CounterActSheetProps {
  target: CounterActTarget | null;
  read: HouseCounterRead | null;
  onClose: () => void;
  /** A write landed (a seal) — the counter should read again. */
  onChanged: () => void;
}

function contractFor(target: CounterActTarget): string {
  const { register } = target;
  if (register.key === 'proposals' && register.act === 'yours') {
    return 'This asks one thing: apply this proposal. Holding issues a one-time seal and applies it with that seal. Leaving changes nothing.';
  }
  if (register.key === 'orders') {
    return register.act === 'yours'
      ? 'This asks one thing: seal this order. Holding issues a one-time seal and approves the order with it. Leaving changes nothing.'
      : 'This shows one order waiting on the seal of an owner or a manager. Leaving changes nothing.';
  }
  return `This shows one record from ${REGISTER_WORD[register.key].toLowerCase()}. Nothing here writes; leaving changes nothing.`;
}

function SealFoot({
  order,
  read,
  onDone,
}: {
  order: CounterOrderRow;
  read: HouseCounterRead | null;
  onDone: () => void;
}) {
  const vendor = order.vendor ?? 'the vendor';
  return (
    <SealedApproveDie
      orderIds={[order.id]}
      label={`Hold to seal · ${orderMoney(order.total, read)}`}
      approvedLabel="Sealed"
      onApproved={() => {
        houseSaid(
          'sealed',
          `Order to ${vendor} sealed`,
          `order ${order.orderNumber ?? order.id} · from the counter`,
        );
        onDone();
      }}
      onRefused={(reasons) => {
        houseSaid('refused', `Order to ${vendor} not sealed`, reasons[0] ?? 'The house refused it.');
      }}
    />
  );
}

function ProposalSealFoot({
  proposal,
  onDone,
}: {
  proposal: CounterProposalRow;
  onDone: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const what = proposal.summary ?? proposal.utterance ?? 'the proposal';
  // No `.mudavym` of its own: the Sheet's root already scopes the house
  // tokens (Sheet.tsx), and a second scope here would be a root that paints no
  // ground (mudavym-ground.test.ts).
  return (
    <div className="mdv-actsheet__seal">
      <HoldToApprove
        key={`proposal-${proposal.id}-${attempt}`}
        label="Hold to apply this proposal"
        approvedLabel="Applied"
        boundSummary={what}
        onChallenge={async () => {
          setRefusal(null);
          try {
            return await mintProposalSeal(proposal.id);
          } catch (err) {
            const said = (err as Error)?.message || 'The seal could not be issued.';
            setRefusal(said);
            houseSaid('refused', 'Proposal not applied', said);
            return null;
          }
        }}
        onApprove={async (challenge) => {
          if (!challenge) {
            // Unreachable while HoldToApprove keeps its contract (a null seal
            // never reaches here); kept so a vanished seal cannot apply.
            throw new Error('No seal was carried, so nothing was applied.');
          }
          try {
            const res = await applyProposalSealed(proposal.id, challenge);
            houseSaid('sealed', 'Proposal applied', what);
            onDone();
            return res;
          } catch (err) {
            const said = (err as Error)?.message || 'The house refused it.';
            setRefusal(said);
            houseSaid('refused', 'Proposal not applied', said);
            setAttempt((a) => a + 1);
            throw err;
          }
        }}
      />
      {refusal && (
        <p role="alert" className="mdv-note">
          {refusal}
        </p>
      )}
    </div>
  );
}

export function CounterActSheet({ target, read, onClose, onChanged }: CounterActSheetProps) {
  if (!target) {
    return (
      <Sheet open={false} onClose={onClose} label="An act on the counter">
        {null}
      </Sheet>
    );
  }
  const { register, row } = target;
  const line = actLine(register.key, row, read);
  const room = REGISTER_ROOM[register.key];
  const isOrder = register.key === 'orders';
  const order = isOrder ? (row as CounterOrderRow) : null;

  const openRoom = room ? (
    <Link className="mdv-link" to={room.path} onClick={onClose}>
      Open in {room.name}
    </Link>
  ) : null;

  let foot: JSX.Element;
  if (order && register.act === 'yours') {
    foot = (
      <div className="mdv-actsheet__foot">
        <SealFoot order={order} read={read} onDone={onChanged} />
        <div className="mdv-actsheet__links">{openRoom}</div>
      </div>
    );
  } else if (register.key === 'identities') {
    foot = (
      <p className="mdv-note">
        No page decides identity links yet. The count is the house's; deciding one needs the
        evidence beside it, and that surface is not built.
      </p>
    );
  } else if (register.key === 'proposals') {
    foot =
      register.act === 'yours' ? (
        <div className="mdv-actsheet__foot">
          <p className="mdv-note">From the counter, a proposal is applied only by the seal. Holding applies it as proposed, unedited.</p>
          <ProposalSealFoot proposal={row as CounterProposalRow} onDone={onChanged} />
        </div>
      ) : (
        <p className="mdv-note">This proposal waits on an owner or a manager; from the counter it is applied only by their seal.</p>
      );
  } else {
    foot = (
      <div className="mdv-actsheet__foot">
        {register.act === 'not_yours' && (
          <p className="mdv-note">The house's count, not your act — this waits on an owner or a manager.</p>
        )}
        <div className="mdv-actsheet__links">{openRoom}</div>
      </div>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      label={contractFor(target)}
      contract={
        (isOrder || register.key === 'proposals') && register.act === 'yours' ? contractFor(target) : undefined
      }
      eyebrow={`${VERB_WORD[register.verb]} · ${REGISTER_WORD[register.key]}`}
      title={line.what}
      closeLabel="Back to the page"
      className="mdv-shell__phonesheet"
      footer={foot}
    >
      <dl className="mdv-actsheet__facts">
        <div>
          <dt>What</dt>
          <dd>{line.detail}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{line.at}</dd>
        </div>
        {order && (
          <>
            <div>
              <dt>Order</dt>
              <dd>{order.orderNumber ?? '—'}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{orderMoney(order.total, read)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Read</dt>
          <dd>from the house at {new Date(register.readAt).toLocaleTimeString(undefined, { hour12: false })}</dd>
        </div>
      </dl>
    </Sheet>
  );
}

export default CounterActSheet;
