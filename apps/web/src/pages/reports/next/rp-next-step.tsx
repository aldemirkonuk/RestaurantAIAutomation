/**
 * Where an empty register's figures come from, as a way to go and give it
 * some (r36 reports audit, gap 5: "day 1 is a wall of true sentences with no
 * next step").
 *
 * A new house opened /reports to a page of empty sentences that explained
 * themselves and led nowhere: the till and the time zone linked to Settings,
 * and nothing else did. Each empty register now ends with the one place its
 * figures are written from, named as the act ("Record a delivery on Orders"),
 * not as the table.
 *
 * The call (r38, under the 2026-11-07 /goal "new customer onboarding must feel
 * effortless"):
 * - One step per source, appended after the register's own sentence; the
 *   sentence is unchanged, so what it says stays true and stays tested.
 * - The step names the act and the page, and the page decides who may do it
 *   (each page gates its own writes). The step is not hidden by role here: a
 *   member who cannot act still learns where the figures come from.
 * - Consumption has two sources, both needed: the till's sales, and each till
 *   item matched to a good (the match is made on Inventory, PosMappingPanel),
 *   so the consumption step names both.
 * - No day count is promised ("after 14 days"): the gateway's thresholds move
 *   per lens and per train, and a promise the page cannot keep is worse than
 *   none.
 *
 * Rejected: a separate "getting started" panel on /reports (a second page of
 * instructions beside the registers, and it says nothing about WHICH register
 * waits on what); linking from every sentence (a non-empty register needs no
 * way in).
 */
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

const LINK = 'rp-link rp-ink rp-focus rp-no-drag';

export type StepSource = 'orders' | 'consumption' | 'start';

/** The links, by the source an empty register waits on. */
export function NextStep({ source }: { source: StepSource }): ReactNode {
  if (source === 'orders')
    return (
      <>
        Spend is read from delivered purchase orders.{' '}
        <Link to="/orders" className={LINK}>
          Record a delivery on Orders
        </Link>
      </>
    );
  if (source === 'consumption')
    return (
      <>
        Consumption is written when a till sale is matched to a good.{' '}
        <Link to="/settings?tab=pos" className={LINK}>
          Connect the till in Settings
        </Link>
        , then{' '}
        <Link to="/inventory" className={LINK}>
          match its items to goods on Inventory
        </Link>
        .
      </>
    );
  return (
    <>
      The engine reads the till, the orders and the stock, and speaks once one of them holds
      something.{' '}
      <Link to="/get-started" className={LINK}>
        Start with Get started
      </Link>
    </>
  );
}

/** A register's own empty sentence, then where its figures come from. */
export function withStep(sentence: ReactNode, source: StepSource): ReactNode {
  return (
    <>
      {sentence} <NextStep source={source} />
    </>
  );
}
