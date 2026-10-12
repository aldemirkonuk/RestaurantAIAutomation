/**
 * ProvidersNext — the Mudavym redesign of `/providers` (ADR 0045 §5 wave,
 * MAKEOVER-VERDICTS: MERGE).
 *
 * The verdict, enforced in structure: the founder liked today's page for its
 * "small buckets" (less crowded) and the redesign for its digital twin. The
 * combination is a quiet grid of small, closed vendor cards — each carrying
 * at most THREE real facts (open orders · lead time · last contact) — with
 * everything learned held back for the TwinSheet. Crowding came from putting
 * the twin on the card; the fix is a card that promises less.
 *
 * Motions (documented in 06-pages/providers.md §Motions used):
 * - sheet open = settle (320ms house curve, slide from the right);
 * - card hover = ink (160ms border/urge shift), no lift, no scale.
 *
 * Honesty rules: an unknown open-order count is an em dash (the orders book
 * unreachable ≠ zero open orders); a vendor never contacted says so.
 */

import { useCanChangeVendors } from './useCanChangeVendors';
import { useAuth } from '@/contexts/AuthContext';
import { useHouseCurrency } from '@/hooks/useHouseCurrency';
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Stub, Wordmark } from "@/components/mudavym";
import type { Provider } from "../../../services/api/providers";
import { ink } from "../../../lib/mudavym/motion";
import { EM, MONO, SANS, SERIF, fmtDays, fmtLastContact } from "./pv-format";
import { TwinSheet } from "./TwinSheet";
import { NewVendorSheet, type VendorDraft } from "./NewVendorSheet";
import { VendorCsvImport } from "./VendorCsvImport";
import { businessTypeLabel } from "./VendorRecordEdit";
import { UsualCurrencyCoveragePanel } from "./UsualCurrencyCoveragePanel";
import {
  useProvidersNextData,
  type ProviderCardVM,
} from "./useProvidersNextData";
import { useVendorScopes } from "./useVendorScopes";
import {
  BookSearchBar,
  FindNewVendors,
  ScopeNotice,
  VendorScopeBar,
} from "./VendorScopes";
import { soldTag, supplierTag } from "./vendor-scope";
import { RollCall } from './scorecard/RollCall';
import { SC } from './scorecard/sc-copy';
import { useRollCall } from './scorecard/useVendorScorecard';
import type { VendorScorecard } from './scorecard/scorecard-types';

/**
 * The card's one behavioural fact (ADR 0207, sketch 117 A; MAKEOVER-VERDICTS
 * `/providers` MERGE: "at most three facts plus one behavioural fact"). Read
 * from the Roll Call answer, never computed here: `undefined` while that read
 * is out, `null` when it failed — both drawn as words, never as a zero.
 */
type DidFact = VendorScorecard['fact'] | null | undefined;

/**
 * `?view=scorecard` opens the second view (sketch 117 B, the Roll Call). Read
 * once at mount like `?vendor=`; the toggle writes it back with replaceState
 * so a reload keeps the view without adding a history entry per press.
 */
type ProvidersView = 'book' | 'scorecard';
function viewFromUrl(): ProvidersView {
  if (typeof window === 'undefined') return 'book';
  return new URLSearchParams(window.location.search).get('view') === 'scorecard' ? 'scorecard' : 'book';
}
function writeViewToUrl(view: ProvidersView) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (view === 'scorecard') url.searchParams.set('view', 'scorecard');
    else url.searchParams.delete('view');
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* a URL the page cannot rewrite keeps the view in state only */
  }
}

/**
 * `?vendor=<id>` opens that vendor's sheet — where the currency control lives.
 *
 * Read from the URL once, at mount, rather than held in router state: the two
 * callers are this page's own prompt panel (which opens the sheet directly) and
 * the order sheet's empty currency field on another route, which arrives as a
 * navigation. Since VEN-W36 the page writes it while a sheet is open and removes it
 * on close (`writeVendorToUrl`), so a person who closes the sheet is still
 * not fighting a param to keep it closed.
 */
/**
 * VEN-W36: the open sheet is in the address while it is open (ADR 0160 §6) —
 * written on open, removed on close, so a reload reopens it and closing is
 * never a fight with a param. `history.state.vendorAt` says whether it was
 * opened FOR the currency control; a reload of a sheet opened from a card
 * reopens it at the top, not scrolled to currency.
 */
function writeVendorToUrl(id: string | null, at: 'currency' | 'sheet') {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("vendor", id);
    else url.searchParams.delete("vendor");
    const state = { ...(window.history.state ?? {}), vendorAt: id ? at : undefined };
    window.history.replaceState(state, "", url.toString());
  } catch {
    /* an address the page cannot rewrite keeps the sheet in state only */
  }
}
function openedAtFromHistory(): boolean {
  if (typeof window === "undefined") return true;
  return (window.history.state as { vendorAt?: string } | null)?.vendorAt !== "sheet";
}

function vendorFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const asked = new URLSearchParams(window.location.search).get("vendor");
  return asked && asked.trim() ? asked.trim() : null;
}

/**
 * `?add=1` opens the add-a-vendor sheet — the command palette's "Add vendor"
 * (F-550), which landed on the list with nothing opened while no page read
 * `add`. Read once at mount like `?vendor=`; dropped from the URL straight
 * after, so a reload or Back does not open the sheet again.
 */
function addFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("add") === "1";
}
function dropAddFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("add")) return;
    url.searchParams.delete("add");
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* a URL the page cannot rewrite only means a reload reopens the sheet */
  }
}

function BucketCard({
  vm,
  ordersKnown,
  did,
  onOpen,
  tag,
}: {
  vm: ProviderCardVM;
  ordersKnown: boolean;
  did?: DidFact;
  onOpen: () => void;
  /** On "Supplies my menu": what the evidence is (item 36). Not a fourth fact. */
  tag?: string | null;
}) {
  const p = vm.provider;
  const open =
    !ordersKnown || vm.openOrders === null ? EM : String(vm.openOrders);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pv-card text-left"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid var(--paper-2, #EAE4D8)",
        background: "var(--paper-1, #F3EFE6)",
        cursor: "pointer",
        transition: `border-color ${ink.ms}ms ${ink.easing}, background ${ink.ms}ms ${ink.easing}`,
        fontFamily: SANS,
      }}
    >
      <div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--seal-deep, #14515C)",
          }}
        >
          {/* "Not stated" when nobody stated one (founder answer 12, 2026-09-21) — never blank, never a guessed type. */}
          {(p.primaryBusinessType ?? '').trim() === '' ? 'Type not stated' : businessTypeLabel(p.primaryBusinessType)}
        </span>
        <span
          style={{
            display: "block",
            fontFamily: SERIF,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
            color: "var(--ink-1, #211C16)",
          }}
        >
          {p.name}
        </span>
        {tag && (
          <span
            data-testid="supply-tag"
            style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--ink-4, #665D50)' }}
          >
            {tag}
          </span>
        )}
      </div>
      <dl
        style={{
          margin: 0,
          display: "grid",
          gap: 2,
          fontSize: 11.5,
          color: "var(--ink-2, #4F473C)",
        }}
      >
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--ink-4, #665D50)" }}>Open orders</dt>
          <dd
            style={{
              margin: 0,
              fontFamily: MONO,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {open}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--ink-4, #665D50)" }}>Lead time</dt>
          <dd style={{ margin: 0 }}>{fmtDays(vm.leadTimeDays)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--ink-4, #665D50)" }}>Last contact</dt>
          <dd style={{ margin: 0 }}>{fmtLastContact(vm.lastContact)}</dd>
        </div>
        <div className="flex justify-between gap-3" data-testid="pv-card-did">
          <dt style={{ color: 'var(--ink-4, #665D50)', whiteSpace: 'nowrap' }}>{SC.page.didLabel}</dt>
          <dd
            style={{
              margin: 0,
              textAlign: 'right',
              fontStyle: did && did.outcome === 'answered' ? 'normal' : 'italic',
              color: did === null ? 'var(--alarm, #A33A2B)' : undefined,
            }}
          >
            {did === undefined ? EM : did === null ? SC.page.didFailed : did.text}
          </dd>
        </div>
      </dl>
    </button>
  );
}

/**
 * The route's element (App.tsx). The page reads its address (`?q=`, `?add=`,
 * `?vendor=`, `?scope=`) once, at mount, and keeps it with replaceState, which
 * the router never sees. So a router navigation that carries a query — the
 * palette's "Search vendors for x" or "Add vendor" while already here — mounts
 * the page afresh to read it (F-1354); a bare /vendors link keeps what is on
 * screen.
 */
export function ProvidersNextRoute() {
  const { search, key } = useLocation();
  return <ProvidersNext key={search ? key : "bare"} />;
}

export default function ProvidersNext() {
  const data = useProvidersNextData();
  // F-1458: the vendor import may only sort a file against a book that was
  // read, never against the empty list a loading or failed read leaves.
  const bookKnown = data.hasData && !data.isError;
  // The house's formats tag for the terms' money (F-1137).
  useHouseCurrency();
  // Supplies my menu -> All my vendors -> Find new vendors (founder,
  // 2026-09-26, item 36). The rules are in vendor-scope.ts.
  const scopes = useVendorScopes(data.cards, data.hasData);
  const addedCatalogueIds = useMemo(
    () =>
      new Set(
        data.cards
          .map((vm) => vm.provider.catalogueVendorId)
          .filter((id): id is string => typeof id === 'string' && id !== ''),
      ),
    [data.cards],
  );
  const [openProvider, setOpenProvider] = useState<Provider | null>(null);
  const [adding, setAdding] = useState(addFromUrl);
  useEffect(() => {
    dropAddFromUrl();
  }, []);
  /**
   * VEN-W35: a half-written vendor the person walked away from (Esc or a click
   * outside). The sheet tore; the words wait here, on a stub under the header,
   * until they are resumed or discarded (ADR 0112, sketch 103 · 1b). `n` keys
   * the stub, so a second tear is a fresh stub, not a "gone" one.
   */
  const { activeRestaurantId, user: me } = useAuth();
  const house = activeRestaurantId || me?.restaurantId || '';
  const [heldAt, setHeld] = useState<{ n: number; house: string; draft: VendorDraft; discarded: boolean } | null>(null);
  // A house switch never shows the previous house's half-written vendor.
  const held = heldAt && heldAt.house === house ? heldAt : null;
  const [resumeWith, setResumeWith] = useState<VendorDraft | undefined>(undefined);
  const canChange = useCanChangeVendors();
  // F-685: the spreadsheet import, beside "Add a vendor".
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<ProvidersView>(viewFromUrl);
  const chooseView = (next: ProvidersView) => {
    setView(next);
    writeViewToUrl(next);
  };
  // The Roll Call answer carries each card's one fact; the Book reads it too.
  const roll = useRollCall(90);
  const didById = useMemo(() => {
    const m = new Map<string, VendorScorecard['fact']>();
    for (const v of roll.data?.vendors ?? []) m.set(v.providerId, v.fact);
    return m;
  }, [roll.data]);
  // A vendor missing from a Roll Call that DID answer (added after it was read)
  // has not been read yet — the dash, never "could not be read", which is kept
  // for a read that failed.
  const didFor = (id: string): DidFact => (roll.isError ? null : roll.data ? didById.get(id) : undefined);
  /*
   * A sheet opened FROM THE CURRENCY PROMPT — the panel's link or `?vendor=` —
   * carries the reason it was opened, so `UsualCurrencySection` can put the
   * person at the field rather than at the top of a sheet with four other
   * sections above it. A sheet opened by clicking a card carries nothing and
   * behaves as it always has: the panel exists to bring somebody to the
   * control, and a sheet that lands them anywhere else is a link that only
   * looks like it worked.
   */
  const [openedForCurrency, setOpenedForCurrency] = useState(false);

  const knownIds = useMemo(
    () => new Set(data.cards.map((vm) => vm.provider.id)),
    [data.cards],
  );
  const openById = (id: string) => {
    const found = data.cards.find((vm) => vm.provider.id === id);
    if (!found) return;
    setOpenedForCurrency(true);
    setOpenProvider(found.provider);
  };

  // The deep link is honoured ONCE. Without the latch, closing the sheet on a
  // page reached by `?vendor=` would reopen it on the next render.
  const asked = useRef(vendorFromUrl());
  // A link to a vendor this house's book does not hold (removed since, or one
  // of another house's) used to open nothing, say nothing and keep the latch —
  // so no sheet opened afterwards ever reached the address (F-901). Once the
  // book has answered without it, the link is spent: drop it and say so.
  const [askedMissing, setAskedMissing] = useState(false);
  useEffect(() => {
    if (!asked.current) return;
    const found = data.cards.find((vm) => vm.provider.id === asked.current);
    if (!found) {
      if (!data.hasData || data.isError) return;
      asked.current = null;
      setAskedMissing(true);
      writeVendorToUrl(null, "sheet");
      return;
    }
    asked.current = null;
    setOpenedForCurrency(openedAtFromHistory());
    setOpenProvider(found.provider);
  }, [data.cards, data.hasData, data.isError]);
  // Not while a deep link is still waiting for the cards: clearing it then
  // would lose it to a reload during the read.
  useEffect(() => {
    if (asked.current) return;
    writeVendorToUrl(openProvider?.id ?? null, openedForCurrency ? "currency" : "sheet");
  }, [openProvider, openedForCurrency]);

  return (
    <div
      className="mudavym min-h-screen"
      style={{
        background: "var(--paper-0, #FAF7F1)",
        color: "var(--ink-1, #211C16)",
      }}
    >
      <style>{`
        .pv-card:hover { border-color: var(--seal-ring, rgba(26,94,107,.32)); background: var(--paper-0, #FAF7F1) }
        .pv-card:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        .pv-seg:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: -2px }
        @media (prefers-reduced-motion: reduce) { .pv-card { transition: none !important } }
      `}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Wordmark size={13} />
            <h1
              style={{
                fontFamily: SERIF,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: "-0.015em",
                lineHeight: 1.1,
                margin: "4px 0 0",
              }}
            >
              Vendors
            </h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              role="group"
              aria-label={SC.page.viewGroup}
              data-testid="pv-view-toggle"
              style={{
                display: 'inline-flex',
                border: '1px solid var(--paper-2, #EAE4D8)',
                borderRadius: 8,
                overflow: 'hidden',
                fontFamily: SANS,
              }}
            >
              {(['book', 'scorecard'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => chooseView(v)}
                  className="pv-seg"
                  style={{
                    padding: '5px 14px',
                    fontSize: 12.5,
                    border: 0,
                    cursor: 'pointer',
                    color: view === v ? 'var(--ink-1, #211C16)' : 'var(--ink-4, #665D50)',
                    background: view === v ? 'var(--paper-1, #F3EFE6)' : 'transparent',
                    transition: `color ${ink.ms}ms ${ink.easing}, background ${ink.ms}ms ${ink.easing}`,
                  }}
                >
                  {v === 'book' ? SC.page.book : SC.page.scorecard}
                </button>
              ))}
            </span>
            <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
              {data.hasData
                ? `${data.cards.length} ${data.cards.length === 1 ? 'vendor' : 'vendors'}`
                : data.isError
                  ? 'Vendors not known'
                  : 'Reading your vendors…'}
            </span>
            {canChange && (
              // F-1458: the file is sorted against the vendors already in the
              // book; until the book has been read that list is empty, not
              // known, and every vendor in the file would be added again.
              <button
                type="button"
                onClick={() => setImporting((v) => !v)}
                data-testid="import-vendors"
                aria-expanded={importing && bookKnown}
                disabled={!bookKnown}
                title={bookKnown ? undefined : 'Your vendor list has to be read first, so nobody is added twice.'}
                style={{
                  opacity: bookKnown ? 1 : 0.5,
                  cursor: bookKnown ? 'pointer' : 'not-allowed',
                  fontFamily: SANS,
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "7px 13px",
                  borderRadius: 9,
                  border: "1px solid var(--seal, #1A5E6B)",
                  background: "transparent",
                  color: "var(--seal, #1A5E6B)",
                }}
              >
                Import a list
              </button>
            )}
            {canChange ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              data-testid="add-vendor"
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                padding: "7px 13px",
                borderRadius: 9,
                border: "1px solid var(--seal, #1A5E6B)",
                background: "var(--seal, #1A5E6B)",
                color: "var(--paper-0, #FBF8F1)",
              }}
            >
              Add a vendor
            </button>
            ) : (
              // VEN-W30: staff read the book; the server refuses their writes,
              // so they are told who changes it instead of offered a button.
              <span data-testid="vendors-read-only" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
                A manager or an owner changes this book.
              </span>
            )}
          </div>
        </header>

        {importing && canChange && bookKnown && (
          <VendorCsvImport
            house={house}
            existing={data.cards.map((c) => ({ name: c.provider.name, email: c.provider.email }))}
            onClose={() => setImporting(false)}
          />
        )}

        {held && !adding && canChange && (
          <div data-testid="vendor-draft-held" className="mb-4" style={{ maxWidth: 520 }}>
            <Stub
              key={held.n}
              words={`A new vendor${held.draft.name.trim() ? `: ${held.draft.name.trim()}` : ''} — not in the book yet`}
              resumeLabel="Go on writing it"
              discardLabel="Throw it away"
              onResume={() => {
                setResumeWith(held.draft);
                setHeld(null);
                setAdding(true);
              }}
              onDiscard={() => setHeld((h) => (h ? { ...h, discarded: true } : h))}
              onRestore={() => setHeld((h) => (h ? { ...h, discarded: false } : h))}
              footer="Nothing was written. It is held on this screen only — leaving the page lets it go."
            />
          </div>
        )}

        {data.isError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{
              fontFamily: SANS,
              border: "1px solid var(--paper-2, #EAE4D8)",
              background: "var(--paper-1, #F3EFE6)",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--ink-2, #4F473C)" }}>
              {data.hasData
                ? 'Your vendors could not be refreshed just now. The cards show the last answer, not the present.'
                : 'Your vendors could not be read just now, so nothing below is claimed about them.'}
            </span>
            <button
              type="button"
              onClick={data.refetch}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "5px 12px",
                borderRadius: 8,
                border: "1px solid var(--seal-ring, rgba(26,94,107,.32))",
                background: "transparent",
                color: "var(--seal-deep, #14515C)",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        )}

        {/* Book · Scorecard (ADR 0207). The Book's blocks below keep their old
            indentation on purpose: another lane is rebuilding this page's
            vendor sheet in parallel, and a re-indent would conflict every line. */}
        {view === 'scorecard' ? (
          <RollCall />
        ) : (
        <>
        <VendorScopeBar scopes={scopes} />
        <ScopeNotice scopes={scopes} />
        {scopes.scope === "find" && (
          <FindNewVendors
            find={scopes.find}
            addedCatalogueIds={addedCatalogueIds}
          />
        )}
        {/* Name-only search, any vintage (founder, 2026-09-26, round 7, item
            48). Not on the menu rung: that one is the exact vintage. */}
        {scopes.scope === "all" && data.hasData && data.cards.length > 0 && (
          <BookSearchBar
            book={scopes.book}
            shown={scopes.visible ? scopes.visible.length : null}
          />
        )}

        {scopes.scope !== "find" &&
          data.hasData &&
          data.cards.length === 0 &&
          !data.isError && (
          <p
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              color: "var(--ink-4, #665D50)",
            }}
          >
            No vendors yet — the book is open and empty.
          </p>
        )}

        {askedMissing && !openProvider && (
          <p
            role="status"
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              color: "var(--ink-4, #665D50)",
              margin: "0 0 10px",
            }}
          >
            The vendor that link pointed to isn’t in this house’s book. It may
            have been removed, or it belongs to another of your houses.
          </p>
        )}

        {scopes.scope !== "find" &&
          !data.ordersKnown &&
          data.hasData &&
          data.cards.length > 0 && (
          <p
            style={{
              fontFamily: SANS,
              fontSize: 11,
              color: "var(--ink-4, #665D50)",
              margin: "0 0 10px",
            }}
          >
            The orders book hasn’t answered yet — open-order counts show {EM}{" "}
            until it does.
          </p>
        )}

        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
          }}
        >
          {(scopes.scope === 'find' ? [] : (scopes.visible ?? [])).map((vm) => (
            <BucketCard
              key={vm.provider.id}
              vm={vm}
              tag={
                scopes.scope === 'menu'
                  ? (() => {
                      const s = scopes.supplierOf(vm.provider.id);
                      return s ? supplierTag(s) : null;
                    })()
                  : (() => {
                      const s = scopes.book.sellerOf(vm.provider.id);
                      return s ? soldTag(s) : null;
                    })()
              }
              ordersKnown={data.ordersKnown}
              did={didFor(vm.provider.id)}
              onOpen={() => {
                setOpenedForCurrency(false);
                setOpenProvider(vm.provider);
              }}
            />
          ))}
        </div>
        <div style={{ marginTop: 24 }}>
        {/* The prompt that keeps the order-currency chain alive (founder,
            2026-09-06 batch 66). It counts and links; it pre-fills nothing. */}
        <UsualCurrencyCoveragePanel
          knownIds={knownIds}
          onOpenVendor={openById}
          bookSettled={data.hasData || data.isError}
        />
        </div>
        </>
        )}
      </div>

      {/* `?add=1` (the palette's "Add vendor") opens the sheet only for someone
          the save would not refuse; staff land on the book (F-1352, VEN-W30). */}
      {adding && canChange && (
        <NewVendorSheet
          open
          initialDraft={resumeWith}
          onTear={(draft) => setHeld((h) => ({ n: (h?.n ?? 0) + 1, house, draft, discarded: false }))}
          onClose={() => {
            setAdding(false);
            setResumeWith(undefined);
          }}
          onAdded={data.refetch}
        />
      )}
      {openProvider && (
        <TwinSheet
          provider={openProvider}
          focusUsualCurrency={openedForCurrency}
          onProviderSaved={(updated) => {
            setOpenProvider(updated);
            data.refetch();
          }}
          onClose={() => {
            setOpenedForCurrency(false);
            setOpenProvider(null);
          }}
        />
      )}
    </div>
  );
}
