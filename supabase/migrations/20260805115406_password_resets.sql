-- Password reset tokens.
--
-- Modeled directly on email_verifications (baseline migration, table defined
-- above): opaque uuid token, expiry column with a DB-side default, one row per
-- request rather than one row per user, and no separate rate-limit table — the
-- request endpoint checks the most recent unconsumed row's created_at the same
-- way resendVerification() already checks last_resent_at.
--
-- 1 hour TTL: long enough that "check your email" doesn't create a support
-- ticket, short enough that a token sitting in an old inbox or a forwarded
-- message is unlikely to still be live if it leaks.
CREATE TABLE public.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
    used_at timestamp with time zone,
    requested_ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT password_resets_pkey PRIMARY KEY (id),
    CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- token is looked up on every /auth/reset-password call; must be unique so a
-- lookup can never return two rows for one presented token.
CREATE UNIQUE INDEX idx_password_resets_token ON public.password_resets (token);

-- "any unconsumed reset for this email in the last N minutes" is the per-email
-- throttle query and the "already have a pending reset" check on request.
CREATE INDEX idx_password_resets_email_created
    ON public.password_resets (email, created_at DESC)
    WHERE used_at IS NULL;

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

-- Same posture as email_verifications: no anon/authenticated policies. Every
-- access goes through the NestJS service role, which is unauthenticated by
-- design here — you cannot require a JWT from someone who is locked out
-- precisely because they cannot log in.
