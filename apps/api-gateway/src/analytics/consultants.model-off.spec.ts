/**
 * An adviser that cannot answer says so in the house's words.
 *
 * `POST /analytics/consult/:restaurantId` returned the deployment's own words:
 * "ANTHROPIC_API_KEY not configured", "Model API error 401", the model
 * client's raw message, and a route to PUT. Each now reads one sentence a
 * house can act on; the engineering detail goes to the log.
 */
import { ModelClientError } from "../common/model-client/model-client.service";
import {
  CONSULTANTS_OFF_FOR_HOUSE,
  CONSULTANTS_OFF_HERE,
  CONSULTANT_DECLINED,
  CONSULTANT_DOWN,
  ConsultantsService,
} from "./consultants.service";

const ENGINEERING =
  /ANTHROPIC|API[\s_-]?KEY|not configured|Model API error|PUT \/|\/analytics|\b[45]\d\d\b|ECONNRESET|socket/i;

function db(enabled: boolean) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { enabled }, error: null }),
  };
  return { getClient: () => ({ from: () => chain }) } as any;
}

const analytics = {
  getFinancialSummary: async () => ({}),
  getRiskProfile: async () => ({}),
  getInventoryScience: async () => ({ params: {}, reorderList: [], skuCount: 0 }),
} as any;
const insights = { generate: async () => ({ insights: [] }) } as any;
const verdicts = { record: () => undefined } as any;

function service(opts: {
  enabled?: boolean;
  key?: string;
  call?: () => Promise<any>;
}) {
  const call = jest.fn(opts.call ?? (async () => ({ content: [] })));
  const svc = new ConsultantsService(
    db(opts.enabled ?? true),
    { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? opts.key : undefined) } as any,
    { call } as any,
    analytics,
    insights,
    verdicts,
  );
  const logs: string[] = [];
  const logger = (svc as any).logger;
  jest.spyOn(logger, "warn").mockImplementation((m: any) => void logs.push(String(m)));
  jest.spyOn(logger, "error").mockImplementation((m: any) => void logs.push(String(m)));
  return { svc, call, logs };
}

describe("consultants: a refusal reads in the house's words", () => {
  it("no model switched on: says so, logs the variable, asks nothing", async () => {
    const { svc, call, logs } = service({ key: undefined });
    const out: any = await svc.consult("r-1", "finance", "u-1");
    expect(out).toEqual({ enabled: true, error: CONSULTANTS_OFF_HERE });
    expect(out.error).toMatch(/not switched on here yet/);
    expect(out.error).not.toMatch(ENGINEERING);
    expect(logs.join(" ")).toMatch(/ANTHROPIC_API_KEY/);
    expect(call).not.toHaveBeenCalled();
  });

  it("advisers off for the house: no route in the sentence", async () => {
    const { svc } = service({ enabled: false, key: "k" });
    const out: any = await svc.consult("r-1", "finance", "u-1");
    expect(out).toEqual({ enabled: false, message: CONSULTANTS_OFF_FOR_HOUSE });
    expect(out.message).not.toMatch(ENGINEERING);
  });

  it("the model declines: one sentence, no model vocabulary", async () => {
    const { svc } = service({
      key: "k",
      call: async () => ({ stop_reason: "refusal", content: [] }),
    });
    const out: any = await svc.consult("r-1", "finance", "u-1");
    expect(out).toEqual({ enabled: true, error: CONSULTANT_DECLINED });
  });

  it("an HTTP failure: the status goes to the log, not the house", async () => {
    const { svc, logs } = service({
      key: "k",
      call: async () => {
        throw new ModelClientError("Anthropic 401: invalid x-api-key", 401);
      },
    });
    const out: any = await svc.consult("r-1", "finance", "u-1");
    expect(out).toEqual({ enabled: true, error: CONSULTANT_DOWN });
    expect(out.error).not.toMatch(ENGINEERING);
    expect(logs.join(" ")).toMatch(/401/);
  });

  it("any other failure: the raw message goes to the log only", async () => {
    const { svc, logs } = service({
      key: "k",
      call: async () => {
        throw new Error("socket hang up ECONNRESET");
      },
    });
    const out: any = await svc.consult("r-1", "finance", "u-1");
    expect(out).toEqual({ enabled: true, error: CONSULTANT_DOWN });
    expect(logs.join(" ")).toMatch(/ECONNRESET/);
  });
});
