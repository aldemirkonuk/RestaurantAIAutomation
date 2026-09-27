import { ForbiddenException } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * POST /notifications/send-email used to take `to`/`cc`/`bcc` and `body_html`
 * from the client and hand them to Gmail, so any signed-in user could send
 * arbitrary HTML from the house's domain (ADR 0147 named gap).
 *
 * The handler now refuses. Gmail is never reached. A 200 `{success:false}`
 * would look like a failed send; this is a 403.
 */

describe("POST /notifications/send-email refuses client HTML", () => {
  const sendEmail = jest.fn();
  const controller = new NotificationsController(
    { sendEmail } as unknown as NotificationsService,
    {} as never,
  );

  it("throws 403 and never calls the mailer", async () => {
    await expect(controller.sendEmail()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("names the refusal, not a send failure", async () => {
    const err = await controller.sendEmail().then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String(err.message)).toMatch(/does not send mail/i);
  });
});
