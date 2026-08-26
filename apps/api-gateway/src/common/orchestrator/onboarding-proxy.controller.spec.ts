/**
 * OnboardingProxyController (ADR 0021) — keeps studio ingestion alive now that studio
 * calls resolve relatively and therefore land on the gateway.
 */
import { OnboardingProxyController } from "./onboarding-proxy.controller";
import { OrchestratorService } from "./orchestrator.service";

describe("OnboardingProxyController", () => {
  let controller: OnboardingProxyController;
  let proxyOnboardingExtract: jest.Mock;

  beforeEach(() => {
    proxyOnboardingExtract = jest.fn();
    controller = new OnboardingProxyController({
      proxyOnboardingExtract,
    } as unknown as OrchestratorService);
  });

  it("forwards the body and the caller's own token, not a service credential", async () => {
    proxyOnboardingExtract.mockResolvedValue({
      status: 200,
      data: { records: [] },
    });

    await controller.extract({ pdf_base64: "JVBERi0x" }, "Bearer caller-token");

    // Spend accounting on the orchestrator keys on the JWT subject (api/auth.py:56-57),
    // so swapping in X-Admin-Key would bill every extraction to "admin-key".
    expect(proxyOnboardingExtract).toHaveBeenCalledWith("Bearer caller-token", {
      pdf_base64: "JVBERi0x",
    });
  });

  it("returns the extraction payload unwrapped", async () => {
    proxyOnboardingExtract.mockResolvedValue({
      status: 200,
      data: { records: [{ wine_name: "Opus One" }] },
    });

    const result = await controller.extract({}, "Bearer t");

    expect(result).toEqual({ records: [{ wine_name: "Opus One" }] });
  });

  it.each([401, 403, 413, 503])(
    "preserves the orchestrator's %i rather than collapsing it",
    async (status) => {
      proxyOnboardingExtract.mockResolvedValue({ status, data: { detail: "nope" } });

      await expect(controller.extract({}, "Bearer t")).rejects.toMatchObject({
        status,
      });
    },
  );
});
