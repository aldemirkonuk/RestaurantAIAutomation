# G — the parent's adversarial pass over F-security-ceremonies.md (2026-09-05)

Not an agent: the session lead judged F's 24 rows against the house rules (the seal is wax for a
real commitment, plain for bulk; AI proposes and a person applies; absence is never health;
ceremony is rationed; F10's undo-after list is closed) and spot-checked three load-bearing URLs.

**Spot checks.** GitHub sudo mode — fetched, holds: "a two-hour session timeout period before
prompting you for authentication again"; password, passkey, security key, GitHub Mobile or a 2FA
code all satisfy it. FIDO Secure Payment Confirmation — fetched, holds: the merchant identifier and
amount "are sent securely to the FIDO authenticator and signed by the same authenticator", which the
paper itself ties to PSD2 dynamic linking. Mercury scheduling/cancelling payments — **403 on
fetch**, as it was for the earlier B file; F's row 8 rests on a snippet. Treat as unverified.

| # | Ceremony | Verdict | Reason |
|---|---|---|---|
| 1–2 | Step-up re-auth (sudo mode) | ADAPT | Only when the session is older than a window (two hours, GitHub's number) and only before money or a config apply; the seal stays the gesture — step-up is who, the hold is intent. |
| 3 | MFA-gated temporary credential | KEEP (exists) | The ancestor of the house's challenge-and-redeem seal (ADR 0107/0112); nothing new to build. |
| 4, 23 | Passkey user verification backing the seal | ADAPT | For owners and managers on their own devices; a shared door tablet has no per-person passkey — there the manager's passcode is the binding. |
| 5–7 | Transaction binding / dynamic linking / 3-D Secure | KEEP | The meaning of the house's provable seal made explicit: the challenge binds amount, payee and line; the receipt shows what was bound. |
| 8 | Scheduled release, cancellable | UNVERIFIED | Source 403s twice; the idea is sound (a cooling-off on a payment) but do not cite Mercury. |
| 9 | New-payee cooling-off / name check | ADAPT | Not a blanket delay on every new vendor (they are known distributors); a first-payment hold only when a bank detail is new or changed. |
| 10 | First-payment hold / allowlisted payees | ADAPT | Same scope as 9; the allowlist is the book of vendors. |
| 11 | Limits per role / day / payee | KEEP | ADR 0116 thresholds and ADR 0128 tiers already exist; extend to a per-day and per-payee bound. |
| 12 | Break-glass with a written reason | ADAPT | Owner-only, rare, reason required, every owner told at once, the trail marks it; never a routine path. |
| 13 | Recall / undo window | ADAPT | Already F10 for its closed list; the door's count correction within minutes is a candidate addition the founder must add explicitly — publishing a week stays sealed. |
| 14 | Tamper-evident hash-chained audit | KEEP | Background; the seal receipt carries the chain link. Makes "verifiable after the fact" true. |
| 15 | QLDB-style ledger | REJECT | Retired product; hash-chained digests on the store in use instead (F agrees). |
| 16 | Device trust / kiosk lock / idle timeout | KEEP | The precondition for the manager's passcode to mean anything on a shared tablet. |
| 17 | Notify on every money move | KEEP | A producer: every owner is told when money leaves; passive, no ceremony. |
| 18 | Velocity / anomaly hold | KEEP | Silent on the common case; when tripped, a held row that names why (Ramp's rule on the row). |
| 19 | Separation of duties | KEEP (small) | One line: whoever adds or changes a vendor's bank detail cannot release the first payment to it. |
| 20 | Four-eyes with a comment | ADAPT | The two-person rule exists; the comment is optional and logged, never a field that makes the button work. |
| 21 | Time-boxed elevated session | REJECT for staff | Fits break-glass only. |
| 22 | Manager PIN at point of action | KEEP (adopted) | F11. |
| 24 | Out-of-band confirmation | ADAPT | For a vendor's bank-detail change only: a call to the number on file. Never per payment. |

**Fights I keep from F, in F's words:** a blanket 24-hour delay on every new vendor; a mandatory
comment on every second approval; a retired ledger product; JIT activation for staff-tier acts;
an out-of-band call before every payment.

**What F missed:** nothing structural for this house; two things are already built and F could
not see them — the sealed config batch revocable for seven days (2026-09-04) and the challenge
minted when the hold begins (ADR 0112's provable seal). Both are cited in the fit-per-act table.
