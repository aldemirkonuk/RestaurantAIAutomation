import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * A price someone was told, typed in by hand.
 *
 * This is not a convenience for testing. It is the most common way a
 * restaurant actually learns a price: a rep says a number on the phone, or
 * sends it in a WhatsApp message, and that number is real, actionable and
 * currently unrecordable anywhere in the system. The observations table has
 * carried a 'manual' source type and trust tier 7 since it was created and
 * nothing has ever written one — the only writer was the scraper. This closes
 * that gap, and as a side effect makes the comparison page reachable before
 * any scrape has ever run.
 *
 * Trust tier is NOT a parameter. It is a property of how the price was
 * learned, and letting a caller assert its own trustworthiness is how a typed
 * guess ends up outranking an invoice in the consensus.
 */
export class ManualObservationDto {
  /** The wine this price is for. One of these two is required. */
  @IsOptional()
  @IsUUID()
  masterWineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  /**
   * Free text is allowed: the vendor who quoted a price is frequently one we
   * have no row for yet, and refusing the observation until the vendor is
   * onboarded loses the information entirely.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  producer?: string;

  @IsOptional()
  @IsInt()
  // 1900 rather than "any number": a 3-digit vintage is a typo, and a future
  // vintage is a wine that does not exist yet. Both would silently become
  // their own identity key and never match anything again.
  @Min(1900)
  @Max(new Date().getFullYear() + 2)
  vintage?: number;

  /** As quoted, for the pack as quoted. Normalisation happens at read time. */
  @IsNumber()
  @Min(0)
  price!: number;

  /**
   * Bottles in the quoted pack. The single most common source of a wrong
   * comparison — a $240 case ranked against a $22 bottle — so it is explicit
   * and defaults to 1 rather than being inferred.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  packSize?: number;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(30000)
  unitVolumeMl?: number;

  /**
   * How the price was learned. Restricted to the informal sources a human can
   * legitimately attest to: 'invoice' and 'api_catalog' are written by the
   * systems that own them, and letting someone hand-assert an invoice price
   * would put an unverifiable number at the top of the trust ladder.
   */
  @IsOptional()
  @IsIn(["quote", "chat", "social", "manual"])
  sourceType?: "quote" | "chat" | "social" | "manual";

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  sourceUrl?: string;

  /**
   * When the price was quoted, if not now. A rep's message from three weeks
   * ago is weaker evidence than one from this morning and the recency
   * weighting can only know that if the caller says so.
   */
  @IsOptional()
  @IsString()
  observedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
