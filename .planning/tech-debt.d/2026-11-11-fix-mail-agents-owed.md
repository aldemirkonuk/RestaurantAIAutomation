## EmailParsingAgent files nothing; its unreachable pipeline is still in the tree — OPEN — 2026-11-11

`fix/mail-agents-owed` keeps it subscribed so its durable queue drains. After #986, #987, #997 and it merge: delete `_process_inbound_email` and what only it calls, plus their tests (keep `like_exactly`, `sender_address`, `sender_unconfirmed`); repoint QA-R25-AGENT-FILES-IN-THE-EVENT-HOUSE, MAIL-SENDER-UNCONFIRMED-HELD-AGENT and the Python halves of QA-R24-SENDER-LOOKUP-NOT-A-PATTERN and MAIL-ATTRIBUTION-IGNORES-AUTHENTICATION; unregister the agent AND delete its durable queue (no TTL, no cap).

## EmailIntelAgent re-publishes OPERATIONAL mail that the gateway bridge files again — OPEN — 2026-11-11

The bridge ignores `__intel_bypass` and dedupes only on `gmail_message_id` (null from the dedicated domain). Not proven on a running bus.

## EmailIntelAgent's promotion dedupe hashes an empty vendor — OPEN — 2026-11-11

`_handle_promo` reads `from_email`, which no publisher sets. Fix: `sender_address(payload.get("from"))`.
