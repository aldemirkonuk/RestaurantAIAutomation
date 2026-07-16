import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const RestaurantAIAutomation = github("aldemirkonuk/RestaurantAIAutomation");

  const _wineopsmobile = service("@wineops/mobile", {
    source: RestaurantAIAutomation,
    // Root-level shared files added on top of the app's own directory: a workspace
    // dependency fix (e.g. pnpm-lock.yaml) previously skipped this service's build
    // entirely because none of those paths matched "/apps/mobile/**".
    build: {
      builder: "RAILPACK",
      watchPatterns: ["/apps/mobile/**", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/package.json"],
    },
    start: "pnpm --filter @wineops/mobile start",
    replicas: { "us-west2": 1 },
    networking: { privateNetworkEndpoint: "wineopsmobile" },
    env: {
      API_GATEWAY_URL: preserve(),
      CORS_ORIGINS: preserve(),
    },
  });
  const servicesagentOrchestrator = service("services/agent-orchestrator", {
    source: RestaurantAIAutomation,
    root: "/services/agent-orchestrator",
    replicas: { "us-west2": 1 },
    networking: { privateNetworkEndpoint: "servicesagent-orchestrator" },
    env: {
      ADMIN_API_KEY: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      API_GATEWAY_URL: preserve(),
      BUFFER_WINDOW_MINUTES: preserve(),
      CORS_ORIGINS: preserve(),
      DATABASE_URL: preserve(),
      DEBUG: preserve(),
      DEFAULT_THRESHOLD_MIN: preserve(),
      EMAIL_BACKEND: preserve(),
      EMERGENCY_OVERRIDE_ENABLED: preserve(),
      ENVIRONMENT: preserve(),
      FROM_EMAIL: preserve(),
      FRONTEND_URL: preserve(),
      GEMINI_API_KEY: preserve(),
      GMAIL_APP_PASSWORD: preserve(),
      GMAIL_CLIENT_ID: preserve(),
      GMAIL_CLIENT_SECRET: preserve(),
      GMAIL_PASSWORD: preserve(),
      GMAIL_PUBSUB_TOPIC: preserve(),
      GMAIL_REFRESH_TOKEN: preserve(),
      GMAIL_SENDER_EMAIL: preserve(),
      GMAIL_USER: preserve(),
      HOST: preserve(),
      JWT_SECRET: preserve(),
      LLM_MAX_TOKENS: preserve(),
      LLM_PRIMARY_MODEL: preserve(),
      LLM_TEMPERATURE: preserve(),
      LOG_LEVEL: preserve(),
      MANAGER_EMAIL: preserve(),
      MOCK_EMAIL: preserve(),
      MOCK_NOTIFICATIONS: preserve(),
      MOCK_POS: preserve(),
      PORT: preserve(),
      RABBITMQ_URL: preserve(),
      REDIS_URL: preserve(),
      RELOAD: preserve(),
      SENTRY_DSN: preserve(),
      SENTRY_ENVIRONMENT: preserve(),
      SENTRY_TRACES_SAMPLE_RATE: preserve(),
      SERPER_API_KEY: preserve(),
      SUPABASE_ANON_KEY: preserve(),
      SUPABASE_DB_URL: preserve(),
      SUPABASE_DIRECT_CONNECTION_STRING: preserve(),
      SUPABASE_JWT_SECRET: preserve(),
      SUPABASE_POOLER_URL: preserve(),
      SUPABASE_PROJECT_ID: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
      TOAST_API_URL: preserve(),
      TOAST_CLIENT_ID: preserve(),
      TOAST_CLIENT_SECRET: preserve(),
      TOAST_RESTAURANT_GUID: preserve(),
    },
  });
  const _wineopsapiGateway = service("@wineops/api-gateway", {
    source: RestaurantAIAutomation,
    root: "/",
    // Same latent gap as @wineops/mobile: this service only auto-rebuilt for the
    // procurement DI fix because that commit also happened to touch files under
    // /apps/api-gateway/**. A root-lockfile-only fix would have silently skipped it too.
    build: {
      buildCommand: "pnpm --filter @wineops/api-gateway build",
      builder: "DOCKERFILE",
      dockerfilePath: "apps/api-gateway/Dockerfile",
      watchPatterns: ["/apps/api-gateway/**", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/package.json"],
    },
    start: "pnpm --filter @wineops/api-gateway start",
    replicas: { "us-west2": 1 },
    networking: { privateNetworkEndpoint: "wineopsapi-gateway" },
    env: {
      ADMIN_API_KEY: preserve(),
      AGENT_ORCHESTRATOR_URL: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      API_GATEWAY_URL: preserve(),
      CALENDAR_REMINDER_DAYS: preserve(),
      CORS_ORIGINS: preserve(),
      DEFAULT_RESTAURANT_ID: preserve(),
      ENVIRONMENT: preserve(),
      FRONTEND_URL: preserve(),
      GEMINI_API_KEY: preserve(),
      GMAIL_APP_PASSWORD: preserve(),
      GMAIL_CLIENT_ID: preserve(),
      GMAIL_CLIENT_SECRET: preserve(),
      GMAIL_PUBSUB_TOPIC: preserve(),
      GMAIL_REFRESH_TOKEN: preserve(),
      GMAIL_SENDER_EMAIL: preserve(),
      GMAIL_WATCH_LABEL_IDS: preserve(),
      INBOUND_EMAIL_DOMAIN: preserve(),
      INBOUND_EMAIL_PROVIDER: preserve(),
      INBOUND_WEBHOOK_SECRET: preserve(),
      JWT_SECRET: preserve(),
      MANAGER_EMAIL: preserve(),
      NODE_ENV: preserve(),
      PORT: preserve(),
      RABBITMQ_URL: preserve(),
      REDIS_URL: preserve(),
      SUPABASE_ANON_KEY: preserve(),
      SUPABASE_JWT_SECRET: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
    },
  });
  const _wineopsweb = service("@wineops/web", {
    source: RestaurantAIAutomation,
    build: { buildCommand: "pnpm --filter @wineops/web build", builder: "RAILPACK", watchPatterns: ["/apps/web/**"] },
    start: "pnpm --filter @wineops/web dev",
    replicas: { "us-west2": 1 },
    deploy: { limitOverride: { containers: { memoryBytes: 8000000000 } } },
    networking: { privateNetworkEndpoint: "wineopsweb" },
    env: {
      API_GATEWAY_URL: preserve(),
      CORS_ORIGINS: preserve(),
    },
  });

  return project("virtuous-delight", {
    resources: [_wineopsmobile, servicesagentOrchestrator, _wineopsapiGateway, _wineopsweb],
  });
});
