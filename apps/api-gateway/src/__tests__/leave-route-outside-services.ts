// Imported first by leave-and-delete-account.routes.spec.ts, before AppModule,
// so the pins are in place when AppModule's imports evaluate. That matters for
// one reader: conversations.service.ts takes AGENT_ORCHESTRATOR_URL from
// process.env when the module loads, not when the app boots. ConfigModule's
// .env loading never overrides a variable already set, and ConfigService.get
// reads process.env first, so these values also win over a developer's .env.
//
// Pinned: the outside services this spec's boot was measured to reach with a
// planted .env (ADR 0090 review of #532): the cache, error reporting, the
// orchestrator and the message broker. Other keys a developer's .env may hold
// (model APIs, mail) stay as they are; the two routes under test call none of
// them.
export const LEAVE_ROUTE_ENV: Record<string, string> = {
  SUPABASE_URL: "http://leave-route.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-a-real-secret",
  REDIS_URL: "",
  SENTRY_DSN: "",
  AGENT_ORCHESTRATOR_URL: "http://orchestrator.invalid",
  RABBITMQ_URL: "amqp://rabbitmq.invalid:5672",
};

for (const [k, v] of Object.entries(LEAVE_ROUTE_ENV)) process.env[k] = v;
