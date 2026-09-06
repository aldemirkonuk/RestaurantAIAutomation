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
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { DeliverySpineService } from "./canonical/delivery-spine.service";
import { DeliveryService } from "./canonical/delivery.service";
import { DeliveryClockService } from "./canonical/delivery-clock.service";
import {
  AcceptAsBilledDto,
  CreateDeliveryDto,
  LinkDocumentDto,
  ProposeDto,
  RunClocksDto,
} from "./dto/deliveries.dto";

type AuthedUser = { userId: string; restaurantId: string };

/**
 * The delivery — the commercial event of ADR 0103 D1 / ADR 0104 D7.
 *
 *   GET  /procurement/deliveries              what is open here
 *   POST /procurement/deliveries              create the event
 *   GET  /procurement/deliveries/:id          the delivery and its documents
 *   GET  /procurement/deliveries/:id/proposals   the thread, oldest first
 *   POST /procurement/deliveries/:id/documents   attach a document with its role
 *   POST /procurement/deliveries/:id/proposals   put a position on the record
 *   POST /procurement/deliveries/proposals/:pid/counter   answer one
 *   POST /procurement/deliveries/proposals/:pid/accept    accept one (human)
 *   POST /procurement/deliveries/:id/accept-as-billed  A11 — answer a difference
 *   POST /procurement/deliveries/:id/agree     D3 — and it says which rule fired
 *   POST /procurement/deliveries/:id/verify    D6 — a human, and idempotent
 *   POST /procurement/deliveries/clocks/run    the catch-up for D9's ladder
 *
 * `restaurantId` comes from the token on every route, never from the request —
 * the gateway holds the service role, so that filter IS the tenant isolation.
 *
 * NO ROUTE HERE WRITES STOCK OR COST. See `DeliveryService`'s header: the
 * columns ADR 0103 A1 will use have no writer on this build, and `verify` is
 * deliberately not the first one.
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
      "Optionally filtered by state. A read that failed throws; it never comes back as a restaurant with no deliveries.",
  })
  async list(
    @CurrentUser() user: AuthedUser,
    @Query("state") state?: string,
    @Query("limit") limit?: string,
  ) {
    const res = await this.deliveries.list(user.restaurantId, {
      state,
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
  @ApiOperation({
    summary: "Accept one proposal — a human gate (ADR 0103 D6)",
    description:
      "Accepting a substitution, a vintage change or a price move above threshold is never automated. Idempotent: accepting twice returns the first acceptance rather than moving its timestamp.",
  })
  async accept(@Param("pid") pid: string, @CurrentUser() user: AuthedUser) {
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
  @ApiOperation({
    summary: "AGREED — both sides on the record, or a final signed ticket (D3)",
    description:
      "Refuses unless the restaurant's position AND the vendor's position are both recorded with nothing left open, OR this vendor's `signed_ticket_is_final` is true and a signed door document is attached. **And, before either rule (ADR 0103 A11), every recorded difference — door count against paperwork, or invoice against PO — must be answered by an accepted proposal or an explicit accept-as-billed;** a refusal names the unanswered lines. The response names WHICH rule fired. Vendor silence never becomes agreement here, whatever the law deems.",
  })
  async agree(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    const res = await this.deliveries.agree(user.restaurantId, id, user.userId);
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  @Post(":id/verify")
  @ApiOperation({
    summary: "VERIFIED — a person asserts they received the goods (D6)",
    description:
      "Only from AGREED: agreement is about the document, verification is about the goods and the books, and ADR 0103 D1 never collapses them. Idempotent — a second verify returns the first one's stamp. Writes NO stock and NO cost on this build, and the response says so in words.",
  })
  async verify(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    const res = await this.deliveries.verify(
      user.restaurantId,
      id,
      user.userId,
    );
    if (!res.ok) throw new HttpException(res.error, res.status);
    return res.value;
  }

  @Post("clocks/run")
  @ApiOperation({
    summary: "Work the due clocks now (ADR 0103 A10)",
    description:
      "The same idempotent poller the hourly cron runs, exposed so a catch-up after an outage is a deliberate act rather than a wait. `now` runs the ladder as if it were that moment. Returns what it DID per rung, so a caller can assert on the work rather than on the absence of an exception.",
  })
  async runClocks(@Body() body: RunClocksDto) {
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
