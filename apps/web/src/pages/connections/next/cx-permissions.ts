/**
 * The permission bullets on an integration row, drawn from THAT integration.
 *
 * Until 2026-09-04 Register III printed the same two lines under every
 * unconnected integration — "Create and edit files it made" and "Never mail,
 * never other documents" — and a third fixed trio under every connected one.
 * They were written for Drive and were simply wrong for `gmail_send`, which
 * asks for `gmail.send` and nothing else: it creates no files, and "never mail"
 * is the exact opposite of what it does. A row was promising, in the page's own
 * voice, something the grant behind it had never said.
 *
 * So no bullet on this page is written here any more. Every one comes from the
 * gateway's `INTEGRATION_DEFINITIONS` (`integrations/integrations-oauth.constants.ts`)
 * by way of `GET /integrations/oauth/catalog`, which already returns each
 * definition's `scopes[*].label` and its `notRequested` list — the same source
 * the consent screen reads, so what a manager is shown here and what a person
 * is asked to approve cannot drift apart.
 *
 * WHAT AN UNREADABLE DEFINITION LOOKS LIKE. It looks like nothing: an empty
 * list, which `AttachmentRow` renders as the em dash. It never falls back to a
 * plausible sentence. A permission the page cannot read is an unknown, and a
 * guessed permission is worse than no permission at all — it is the fault this
 * whole page exists to prevent, printed inside a row about permissions.
 */

import type { RowPermission } from './AttachmentRow';

/** One scope as the catalogue publishes it. */
export interface CatalogScope {
  scope: string;
  label: string;
  reason?: string;
}

/** The half of a catalogue entry these bullets are made of. */
export interface PermissionSource {
  id: string;
  scopes?: CatalogScope[] | null;
  notRequested?: string[] | null;
}

const asScopes = (s: PermissionSource | null | undefined): CatalogScope[] =>
  Array.isArray(s?.scopes) ? s!.scopes!.filter((x) => x && x.label) : [];

const asNotRequested = (s: PermissionSource | null | undefined): string[] =>
  Array.isArray(s?.notRequested) ? s!.notRequested!.filter(Boolean) : [];

/**
 * What this integration WOULD ask for, if somebody connected it.
 *
 * Used on the unconnected rows, where there is no grant yet and the definition
 * is the only truth there is.
 */
export function wouldAskFor(entry: PermissionSource | null | undefined): RowPermission[] {
  const scopes = asScopes(entry);
  if (scopes.length === 0) return [];
  return [
    ...scopes.map((s) => ({ text: s.label, can: true })),
    ...asNotRequested(entry).map((text) => ({ text, can: false })),
  ];
}

/**
 * What ONE EXISTING GRANT holds — its own recorded scopes, not the catalogue's
 * wish list.
 *
 * A grant records the scope strings it was actually given (`mcp`-style raw
 * strings, e.g. `https://www.googleapis.com/auth/drive.file`), and a person may
 * hold a grant made before a definition changed. So the "may do" lines are the
 * grant's own scopes, rendered through the definition's plain-language label
 * where one exists and printed verbatim where none does — an unrecognised scope
 * is shown as itself rather than dropped, because a permission this page cannot
 * name is still a permission.
 *
 * The "may NOT do" lines are the definition's `notRequested`, and they are
 * printed ONLY when every scope this grant holds is one the definition declares.
 * If the grant is wider than the definition, the definition's promises are not
 * this grant's promises, and the row says nothing rather than something false.
 */
export function grantHolds(
  rawScopes: string[] | null | undefined,
  definition: PermissionSource | null | undefined,
): RowPermission[] {
  const held = Array.isArray(rawScopes) ? rawScopes.filter(Boolean) : [];
  const declared = asScopes(definition);
  if (held.length === 0) return [];

  const label = new Map(declared.map((s) => [s.scope, s.label]));
  // A grant row may store the bare tail of a scope URL (`drive.file`) where the
  // definition holds the full one; match on either, never guess past that.
  const tail = new Map(declared.map((s) => [s.scope.split('/').pop() ?? s.scope, s.label]));

  const may = held.map((raw) => ({
    text: label.get(raw) ?? tail.get(raw.split('/').pop() ?? raw) ?? raw,
    can: true,
  }));
  const allDeclared = held.every(
    (raw) => label.has(raw) || tail.has(raw.split('/').pop() ?? raw),
  );
  if (!allDeclared || declared.length === 0) return may;

  return [...may, ...asNotRequested(definition).map((text) => ({ text, can: false }))];
}
