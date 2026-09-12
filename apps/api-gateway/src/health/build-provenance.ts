/**
 * Build provenance — which revision is this process, and when did it come up?
 *
 * WHY IT IS A MODULE OF ITS OWN
 * -----------------------------
 * These two constants started inside `liveness.controller.ts`. The readiness
 * route added alongside it needs the same answer, and two modules each taking
 * their own `new Date()` would report two different boot times for one process —
 * a difference that means nothing but that someone would eventually try to
 * explain. Read once, here, and shared.
 *
 * WHERE THE SHA COMES FROM, AND WHY NOT FROM GIT
 * ----------------------------------------------
 * It is injected by the build, never derived at runtime. A `git rev-parse` in the
 * running container answers one of three ways, all wrong: there is no `.git` in
 * the image (the Dockerfile copies `apps/api-gateway` and `dist`, not the
 * repository), so it errors; or, in a checkout-based runner, it reports whatever
 * the working tree is at, which is not what was built; or it reports the tip of a
 * branch that has moved on since the image was made. The question being asked is
 * "which revision produced this artifact", and only the thing that produced the
 * artifact can answer it.
 *
 * Two independent paths, so one platform's absence is not total:
 *
 *   1. BAKED AT IMAGE BUILD TIME. `apps/api-gateway/Dockerfile` declares
 *      `ARG GIT_COMMIT_SHA` and freezes it into the runtime layer as
 *      `ENV GIT_COMMIT_SHA`. Railway passes service variables to the Docker
 *      build as build args, so setting `GIT_COMMIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}`
 *      on the service bakes the deployed revision into the image itself. The
 *      value then travels with the artifact and cannot drift from it.
 *   2. SUPPLIED AT RUNTIME. `RAILWAY_GIT_COMMIT_SHA` is set by Railway on
 *      services deployed from GitHub. It is read first because a runtime value
 *      belongs to the deployment that is actually running, and because it works
 *      with no Dockerfile change at all.
 *
 * WHEN NEITHER IS PRESENT IT SAYS "unknown"
 * -----------------------------------------
 * Never a default that looks like an answer, never an omitted field. A plausible
 * value here would be worse than no endpoint: the deploy audit compares this
 * string against the merged SHA, and a check that can be satisfied by a
 * fabricated value is a check that certifies its own blindness. "unknown" fails
 * that comparison loudly, which is the correct outcome for "we cannot tell".
 */
const CANDIDATE_VARS = [
  // Railway, for a service connected to GitHub — the deployment's own revision.
  "RAILWAY_GIT_COMMIT_SHA",
  // Baked into the image by apps/api-gateway/Dockerfile's build ARG.
  "GIT_COMMIT_SHA",
  // Other runners, so the same image reports honestly elsewhere.
  "SOURCE_COMMIT",
  "VERCEL_GIT_COMMIT_SHA",
] as const;

/**
 * The literal reported when no build variable is present. Exported so the
 * checks that depend on this distinction cannot drift from it by retyping it.
 */
export const UNKNOWN_COMMIT = "unknown";

function readCommitSha(): string {
  for (const name of CANDIDATE_VARS) {
    const raw = process.env[name];
    const value = typeof raw === "string" ? raw.trim() : "";
    // A blank or whitespace-only variable is absent, not a build id. Railway
    // sets an empty string for a declared-but-unset variable, and Docker's
    // `ENV X=$ARG_X` with no build arg bakes "" into the image.
    if (value.length > 0) return value;
  }
  return UNKNOWN_COMMIT;
}

/** The deployed revision, read once at module load. */
export const COMMIT_SHA: string = readCommitSha();

/** When this process came up. Set at module load, so it is the boot time. */
export const BOOTED_AT: string = new Date().toISOString();

// Loud in the logs as well as in the payload. A production process that cannot
// name its own build is a deploy audit that cannot verify anything, and the
// symptom otherwise only appears once somebody reads the endpoint.
if (COMMIT_SHA === UNKNOWN_COMMIT && process.env.NODE_ENV === "production") {
  // console, not Logger: this runs at module load, before Nest's logger exists.
  console.warn(
    `[build-provenance] No build revision injected — /api/v1/health/live will ` +
      `report commit="${UNKNOWN_COMMIT}" and the deploy audit cannot verify ` +
      `which build is running. Set one of: ${CANDIDATE_VARS.join(", ")}.`,
  );
}
