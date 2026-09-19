INSERT INTO mcp_seal_challenges VALUES('33333333-3333-4333-8333-333333333333','integration_grant');
SET ROLE service_role;
INSERT INTO integration_consent_receipts(seal_id,user_id,restaurant_id,integration_id,disclosure_digest,disclosure_snapshot)
VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','gmail_send',repeat('a',64),'{"words":"What the person saw"}');
DO $$ BEGIN
 BEGIN UPDATE integration_consent_receipts SET integration_id='excel'; RAISE EXCEPTION 'update unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM integration_consent_receipts; RAISE EXCEPTION 'delete unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO integration_consent_receipts SELECT * FROM integration_consent_receipts; RAISE EXCEPTION 'duplicate seal allowed'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM * FROM integration_consent_receipts; RAISE EXCEPTION 'client read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO integration_oauth_states(state,expires_at,consent_receipt_id,browser_proof_hash,browser_request_id,frontend_origin,pkce_verifier_encrypted,callback_payload_encrypted)
VALUES('state',now()+interval '10 min','33333333-3333-4333-8333-333333333333',repeat('b',64),'44444444-4444-4444-8444-444444444444','https://example.test','encrypted verifier','encrypted code');
INSERT INTO integration_oauth_connections(id,consent_receipt_id) VALUES('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333');
DO $$ DECLARE count_rows integer; BEGIN
 UPDATE integration_oauth_states SET consumed_at=now(),callback_payload_encrypted=null,pkce_verifier_encrypted=null WHERE state='state' AND browser_proof_hash=repeat('b',64) AND consumed_at IS NULL AND expires_at>now();
 GET DIAGNOSTICS count_rows=ROW_COUNT; IF count_rows<>1 THEN RAISE EXCEPTION 'first claim missing'; END IF;
 UPDATE integration_oauth_states SET consumed_at=now() WHERE state='state' AND consumed_at IS NULL; GET DIAGNOSTICS count_rows=ROW_COUNT;
 IF count_rows<>0 THEN RAISE EXCEPTION 'state replay allowed'; END IF;
END $$;
-- Retaining a consent record must not block the existing account-deletion flow.
DELETE FROM users WHERE user_id='11111111-1111-4111-8111-111111111111';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM integration_consent_receipts) THEN RAISE EXCEPTION 'deleted person receipt retained'; END IF;
 IF EXISTS(SELECT 1 FROM integration_oauth_connections WHERE consent_receipt_id IS NOT NULL) THEN RAISE EXCEPTION 'dangling consent link'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='restaurant_feature_flags' AND column_name='mudavym_design_authorize_integration' AND column_default='false') THEN RAISE EXCEPTION 'flag default not dark'; END IF;
END $$;
SELECT 'PASS: append-only receipts, private ACL, one-use claims, account deletion and dark flag';
