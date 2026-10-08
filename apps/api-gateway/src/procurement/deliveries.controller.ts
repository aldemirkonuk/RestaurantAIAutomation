import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { DeliverySpineService } from "./canonical/delivery-spine.service";
import { DeliveryService } from "./canonical/delivery.service";
import { DeliveryClockService } from "./canonical/delivery-clock.service";
import { assertDeliveryDesk } from "./canonical/delivery-desk-gate";
import { PlatformOperatorGuard } from "../common/orchestrator/platform-operator.service";
import {
  AcceptAsBilledDto,
  CreateDeliveryDto,
  LinkDocumentDto,
  ProposeDto,
  RunClocksDto,
} from "./dto/deliveries.dto";

/** `role` is the role in the token's house, re-derived by `JwtStrategy` on
 * every request; null or absent is no role there. */
type AuthedUser = {
  userId: string;
  restaurantId: string;
  role?: string | null;
};

/**
 * The delivery — the commercial event of ADR 0103 D1 / ADR 0104 D7.
 *
 *   GET  /procurement/deliveries              what is open here
 *   POST /procurement/deliveries              create the event
 *   GET  /procurement/deliveries/:id          the delivery and its documents
 *   GET  /procurement/deliveries/:id/proposals   the thread, oldest first
 *   POST /procurement/deliveries/:id/documents   attach a document with its role
 *   POST /procurement/deliveries/:id/proposals   put a position on the record
 *                                                (owner or manager)
 *   POST /procurement/deliveries/proposals/:pid/counter   answer one
 *                                                (owner or manager)
 *   POST /procurement/deliveries/proposals/:pid/accept    accept one (human;
 *                                                owner or manager)
 *   POST /procurement/deliveries/:id/accept-as-billed  A11 — answer a difference
 *                                                (owner or manager)
 *   POST /procurement/deliveries/:id/agree     D3 — and it says which rule fired
 *                                                (owner or manager)
 *   POST /procurement/deliveries/:id/verify    D6 — a human, and idempotent
 *                                                (owner or manager)
 *   POST /procurement/deliveries/clocks/run    the catch-up for D9's ladder
 *                                              (platform operators only)
 *
 * `restaurantId` comes from the token on every route, never from the request —
 * the gateway holds the service role, so that filter IS the tenant isolation.
 * The one exception is `clocks/run`, which works EVERY house's due clocks and
 * is therefore a platform act, not a house one; see its own comment.
 *
 * WHERE STOCK AND COST MOVE (ADR 0103 A1). The door count
 * (`POST /procurement/documents/door-count`, `DeliveryStockService.bookAtTheDoor`)
 * books the counted lines as stock, provisionally, with no price yet. Here,
 * `verify` posts the agreed price as the final cost of each item an agreed
 * price reaches (`finaliseAtVerified`, rpc `finalise_delivery_cost`); an item
 * no agreed price reaches stays provisional, and a delivery the door count
 * never booked posts nothing. A WRONG_VENUE proposal reverses the door's
 * booking.
 *
 * THE DESK ACTS ARE THE HOUSE-MONEY HOLDERS' (ADR 0312). propose, counter,
 * accept, accept-as-billed, agree and verify call `assertDeliveryDesk` as
 * their first statement: an owner or a manager (ADR 0145's money row) gets
 * through, anyone else gets a 403 with a sentence and nothing is written.
 * Listing, creating and reading a delivery, reading its thread and attaching
 * a document stay open to every member of the house, like the door.
 */
@ApiTags("procurement-deliveries")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("procurement/deliveries")
export class DeliveriesController {
  constructor(
    private readonly spine: DeliverySpineService,
    private readonly deliveries: DeliveryService,
    private readonly clocks: DeliveryClockService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "The deliveries at this restaurant, newest first",
    description:
      "Optionally filtered by state, and by `orderId` — the deliveries that fulfil one purchase order, which is how /orders finds an order's receipt. A read that failed throws; it never comes back as a restaurant with no deliveries.",
  })
  async list(
    @CurrentUser() user: AuthedUser,
    @Query("state") state?: string,
    @Query("limit") limit?: string,
    @Query("orderId") orderId?: string,
  ) {
    const res = await this.deliveries.list(user.restaurantId, {
      state,
      orderId,
      limit: limit ? Number(limit) : undefined,
    });
    if (!res.ok)
      throw new HttpException(res.error, HttpStatus.INTERNAL_SERVER_ERROR);
    return { deliveries: res.value };
  }

  @Post()
  @ApiOperation({
    summary: "Create a delivery (ADR 0103 D1, D5)",
    description:
      "The commercial event every document attaches to. With no `orderId` the delivery is permanently `UNORDERED` — reporting has to be able to answer what share of spend was never ordered, and the retroactive purchase order that used to hide it is retired. Returns `differsOnLines`, which is NULL when no comparison could be made and a number when one was: 0 means compared-and-equal, never not-compared.",
  })
  async create(
    @Body() body: CreateDeliveryDto,
    @CurrentUser() user: AuthedUser,
  ) {
    const res = await this.deliveries.create(user.restaurantId, user.userId, {
      orderId: body.orderId ?? null,
      providerId: body.providerId ?? null,
      jurisdiction: body.jurisdiction ?? null,
      deliveredAt: body.deliveredAt ?? null,
      ownerUserId: body.ownerUserId ?? null,
      deputyUserId: body.deputyUserId ?? null,
      documents: body.documents,
    });
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  @Get(":id")
  @ApiOperation({
    summary: "One delivery and the documents on it",
    description:
      "The spine of ADR 0104 D13: state, provenance (an UNORDERED delivery carries a permanent mark), the delivery date, and every document on the event with the role it plays there. A read that failed throws; it never comes back as a delivery with no documents.",
  })
  async byId(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    const [spine, row] = await Promise.all([
      this.spine.byId(user.restaurantId, id),
      this.deliveries.byId(user.restaurantId, id),
    ]);
    if (!spine.ok)
      throw new HttpException(spine.error, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!row.ok)
      throw new HttpException(row.error, HttpStatus.INTERNAL_SERVER_ERROR);
    // Reached only after SUCCESSFUL reads, so this is genuinely "no such
    // delivery for this restaurant" and not a query that broke.
    if (!spine.value || !row.value)
      throw new HttpException("Not found", HttpStatus.NOT_FOUND);
    return { delivery: spine.value, event: row.value };
  }

  @Get(":id/proposals")
  @ApiOperation({
    summary: "The proposal thread on one delivery (ADR 0103 D7)",
    description:
      "Every position either side put on the record, oldest first, each with its reason class, evidence and the proposal it answers. An empty array means nobody has disputed anything; a failed read throws rather than saying so.",
  })
  async proposals(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    const res = await this.deliveries.proposalsFor(user.restaurantId, id);
    if (!res.ok)
      throw new HttpException(
        res.error,
        res.error.includes("not found")
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    return { proposals: res.value };
  }

  @Post(":id/documents")
  @ApiOperation({
    summary: "Attach a document to a delivery with the role it plays (A2, S5)",
    description:
      "Many-to-many in BOTH directions: a consolidated weekly invoice sits on several deliveries, a split shipment carries several invoices. Attaching anything to a LAPSED delivery moves it to LAPSED_AMENDED and leaves what the law deemed on the lapse date exactly as it was (A4).",
  })
  async link(
    @Param("id") id: string,
    @Body() body: LinkDocumentDto,
    @CurrentUser() user: AuthedUser,
  ) {
    const res = await this.deliveries.linkDocument(
      user.restaurantId,
      id,
      body.documentId,
      body.role,
    );
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  @Post(":id/proposals")
  @ApiForbiddenResponse({
    description:
      "The session does not hold this house's money (owner or manager, ADR 0145): a sentence says so, and nothing was written (ADR 0312).",
  })
  @ApiOperation({
    summary: "Put one side's position on the record (ADR 0103 D7)",
    description:
      "Replaces the silent drop in syncOrderState (A5): a vendor reply that contradicts the order becomes a row with a reason class, a side, a number and evidence — never free text in negotiation metadata. WRONG_VENUE moves the delivery to REJECTED rather than into RECONCILING.",
  })
  async propose(
    @Param("id") id: string,
    @Body() body: ProposeDto,
    @CurrentUser() user: AuthedUser,
  ) {
    assertDeliveryDesk(user, "propose");
    const res = await this.deliveries.propose(
      user.restaurantId,
      id,
      user.userId,
      body,
    );
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  @Post("proposals/:pid/counter")
  @ApiForbiddenResponse({
    description:
      "The session does not hold this house's money (owner or manager, ADR 0145): a sentence says so, and nothing was written (ADR 0312).",
  })
  @ApiOperation({
    summary: "Answer one proposal with another",
    description:
      "The answered proposal is marked `countered` and both rows stay. A thread that replaced the original would lose the position a dispute is argued from.",
  })
  async counter(
    @Param("pid") pid: string,
    @Body() body: ProposeDto,
    @CurrentUser() user: AuthedUser,
  ) {
    assertDeliveryDesk(user, "counter");
    const res = await this.deliveries.counter(
      user.restaurantId,
      pid,
      user.userId,
      body,
    );
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  @Post("proposals/:pid/accept")
  @ApiForbiddenResponse({
    description:
      "The session does not hold this house's money (owner or manager, ADR 0145): a sentence says so, and nothing was written (ADR 0312).",
  })
  @ApiOperation({
    summary: "Accept one proposal — a human gate (ADR 0103 D6)",
    description:
      "Accepting a substitution, a vintage change or a price move above threshold is never automated. Idempotent: accepting twice returns the first acceptance rather than moving its timestamp.",
  })
  async accept(@Param("pid") pid: string, @CurrentUser() user: AuthedUser) {
    assertDeliveryDesk(user, "accept");
    const res = await this.deliveries.accept(
      user.restaurantId,
      pid,
      user.userId,
    );
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  /**
   * ACCEPT ONE DIFFERENCE AS BILLED (ADR 0103 A11).
   *
   * WHY THE LINE IS IN THE BODY AND NOT THE PATH. A11's first sketch was
   * `…/deliveries/:id/lines/:line/accept-as-billed`, and a delivery has no
   * "line n": A2 puts N documents on one delivery, so line 3 of the invoice and
   * line 3 of the door count are different lines that can disagree with each
   * other. The path segment would have been ambiguous the moment a second
   * document was attached — which is the modal case, not the edge. The key is
   * the one `delivery_proposals` already uses: (document, line number).
   */
  @Post(":id/accept-as-billed")
  @ApiForbiddenResponse({
    description:
      "The session does not hold this house's money (owner or manager, ADR 0145): a sentence says so, and nothing was written (ADR 0312).",
  })
  @ApiOperation({
    summary:
      "Accept one recorded difference as billed — a human gate (ADR 0103 A11)",
    description:
      "The second of the two answers a difference will take (the first is an accepted proposal). It is NOT a proposal: a proposal is a position one side asks the other to accept, and this is the decision not to raise one. Requires a named user and a reason in their own words. Idempotent — a second acceptance of the same line returns the first one rather than moving its timestamp. **The (document, line) must be one a comparison actually recorded a difference on;** an acceptance keyed anywhere else is refused with 409, and the refusal names the differences that can be answered, with their two quantities, so the caller learns the key (measured live 2026-09-06: it used to answer 201 and answer nothing).",
  })
  async acceptAsBilled(
    @Param("id") id: string,
    @Body() body: AcceptAsBilledDto,
    @CurrentUser() user: AuthedUser,
  ) {
    assertDeliveryDesk(user, "accept_as_billed");
    const res = await this.deliveries.acceptAsBilled(
      user.restaurantId,
      id,
      user.userId,
      { documentId: body.documentId, lineNo: body.lineNo, reason: body.reason },
    );
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  @Post(":id/agree")
  @ApiForbiddenResponse({
    description:
      "The session does not hold this house's money (owner or manager, ADR 0145): a sentence says so, and nothing was written (ADR 0312).",
  })
  @ApiOperation({
    summary: "AGREED — both sides on the record, or a final signed ticket (D3)",
    description:
      "Refuses unless the restaurant's position AND the vendor's position are both recorded with nothing left open, OR this vendor's `signed_ticket_is_final` is true and a signed door document is attached. **And, before either rule (ADR 0103 A11), every recorded difference — door count against paperwork, or invoice against PO — must be answered by an accepted proposal or an explicit accept-as-billed;** a refusal names the unanswered lines. The response names WHICH rule fired. Vendor silence never becomes agreement here, whatever the law deems.",
  })
  async agree(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    assertDeliveryDesk(user, "agree");
    const res = await this.deliveries.agree(user.restaurantId, id, user.userId);
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  @Post(":id/verify")
  @ApiForbiddenResponse({
    description:
      "The session does not hold this house's money (owner or manager, ADR 0145): a sentence says so, and nothing was written (ADR 0312).",
  })
  @ApiOperation({
    summary:
      "VERIFIED — an owner or a manager asserts receipt, and the agreed cost posts (D6, A1)",
    description:
      "Only from AGREED: agreement is about the document, verification is about the goods and the books, and ADR 0103 D1 never collapses them. This is the step that posts cost (ADR 0103 A1, A12): each item the door count booked, provisionally and with no price yet, takes the agreed price as its final cost where an agreed price reaches it; an item no agreed price reaches stays provisional, and a delivery the door count never booked posts nothing. It is an owner's or a manager's act whether or not anything posts (ADR 0312 says why); anyone else gets a 403 with a sentence, and nothing changes. Idempotent: a second verify returns the first one's stamp and posts nothing, so it does not retry a post that failed. The response's `costNote` says in words how many items' cost posted and how many stayed provisional, or why nothing posted.",
  })
  async verify(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    assertDeliveryDesk(user, "verify");
    const res = await this.deliveries.verify(
      user.restaurantId,
      id,
      user.userId,
    );
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  /**
   * PLATFORM OPERATORS ONLY, AND NO `now` IN PRODUCTION (ADR 0243).
   *
   * `runDue` reads up to 500 open, notified_half or escalated
   * `delivery_timers` from every house, with no house filter; it is the
   * hourly poller, not a house's own clock. At c47fd8a01 this route's only
   * controller or route guard was `JwtAuthGuard`, so any signed-in member of
   * any house could POST `{ "now": "<a year ahead>" }`. Each of those timers
   * due before that date would then fire, up to 500 per call: where its
   * delivery was not already settled, the delivery moves to LAPSED with the
   * deeming text in `lapse_deemed`, and a high-priority `delivery_lapsed`
   * notice goes to the house (817-route audit).
   *
   * Callers: `git grep` over apps/, services/, scripts/, .github/, .railway/
   * and vercel.json found no HTTP caller; the hourly runner is
   * `DeliveryClockService.pollHourly`, an in-process `@Cron` that calls
   * `runDue()` directly and is untouched. So the catch-up after an outage this
   * route exists for is an operator's act, and `PlatformOperatorGuard` (the
   * `/health/agent-operations` gate: an enabled `platform_operator_grants` row
   * AND a live `developer` role, read from the database, never the JWT) is the
   * one that fits. It runs after the class's `JwtAuthGuard`.
   *
   * `now` — "run the ladder as if it were that moment" — is refused in
   * production for every caller the guards admit, operators included. A
   * deadline fired early writes `lapse_deemed`, which a later document amends
   * (LAPSED_AMENDED) but does not clear, and no production use of `now` was
   * found. Outside production it stays, for tests and demos.
   */
  @Post("clocks/run")
  @UseGuards(PlatformOperatorGuard)
  @ApiOperation({
    summary: "Work the due clocks now (ADR 0103 A10) — platform operators only",
    description:
      "The same idempotent poller the hourly cron runs, across every house, exposed so a catch-up after an outage is a deliberate act rather than a wait. Platform operators only (403 otherwise). `now` runs the ladder as if it were that moment, and is refused with 400 in production. Returns what it DID per rung, so a caller can assert on the work rather than on the absence of an exception.",
  })
  async runClocks(@Body() body: RunClocksDto) {
    if (body?.now && process.env.NODE_ENV === "production")
      throw new HttpException(
        "`now` is not accepted in production: the ladder runs at the real time. Send no `now` to run the catch-up.",
        HttpStatus.BAD_REQUEST,
      );
    const at = body?.now ? new Date(body.now) : new Date();
    if (!Number.isFinite(at.getTime()))
      throw new HttpException(
        `\`${body.now}\` is not a date this can run the ladder at.`,
        HttpStatus.BAD_REQUEST,
      );
    const res = await this.clocks.runDue(at);
    if (!res.ok)
      throw new HttpException(res.error, HttpStatus.INTERNAL_SERVER_ERROR);
    return res.value;
  }
}
