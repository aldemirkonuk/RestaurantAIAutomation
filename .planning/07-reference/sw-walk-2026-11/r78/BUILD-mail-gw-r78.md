# BUILD mail-gw r78 (2026-11-19) - FORK, nothing built

FORK: brief assumed apps/api-gateway/src/conversations/mail.service.ts (and list_mail_people RPC) exist on PR #1917's branch.
Code says: #1917 (feat/mail-reads-every-conversation-gw, head 0de8fce42, base main c459b0a12) has no conversations/mail.* files and no list_mail_people.
Those live only in the #1916 chain (feat/g3-mail-web-all-conversations, 127 commits past main, merge-base 259feea3f; mail.service.ts:151 kind "vendor", :171 storedKinds ["vendor"]; list_mail_people in 20270421143700_the_mail_list_is_read_by_person.sql).
#1917 is NOT an ancestor of the #1916 chain. #1917 owns the kind column, from/to fields, and the p_withhold_house_letters non-vendor withholding; the chain owns the read side. The fix needs both, so it cannot be a stacked PR on either alone, and a merge of both would exceed 30,000 chars of diff.

Finding w3-1: NOT FIXED (fork above). No code, tests, mutants, migration written. No PR opened, nothing pushed.
Decision needed: (a) land #1917 on main first, then rebase the #1916 chain onto main and build the read side as a stacked PR on #1916's tip; or (b) base the read-side PR on #1916's tip with #1917 merged in by the owner.
Recommend (a). Browser checks owed: none yet.
