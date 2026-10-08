/**
 * Reading the distributor-connection catalogue — what this house could declare,
 * and what is actually true about each one.
 *
 * READ-ONLY, AND IT WRITES NOTHING ANYWHERE. There is no declare route, no
 * credential store, no fetch and no schedule. `DISTRIBUTOR_FEED_CONNECTION`
 * carries `offerable: false` and the reason, and this service's whole job is to
 * hand the page the sentence rather than a control that would fail.
 *
 * The house's jurisdiction is resolved the same way the price index resolves
 * it — `resolveHouseJurisdiction`, the country first and the state read only
 * inside it (ADR 0305) — because a house being told two different things about
 * its own state by two panels on the same page is a defect, and the second copy
 * is where it would start. A jurisdiction named in the URL is still read by
 * `normalizeJurisdiction`: it is a question about a place, not about a house.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  COUNTRY_NOT_RECORDED_SENTENCE,
  resolveHouseJurisdiction,
} from "../price-index/house-jurisdiction";
import { normalizeJurisdiction } from "../price-index/price-index.registry";
import {
  DISTRIBUTOR_FEED_CONNECTION,
  DISTRIBUTORS,
  DistributorEntry,
  distributorSilenceFor,
  distributorsFor,
} from "./distributor-feed.registry";

export interface DistributorCatalogueRow {
  key: string;
  distributor: string;
  jurisdictions: string[];
  portal: { name: string; url: string } | null;
  mechanism: string;
  automatedAccess: DistributorEntry["automatedAccess"];
  availability: string;
  unbuilt: { reason: string; measuredOn: string } | null;
  /** True only when something could actually be connected. Never true today. */
  connectable: boolean;
}

export interface DistributorCatalogue {
  connection: typeof DISTRIBUTOR_FEED_CONNECTION;
  /** The jurisdiction asked for, verbatim, and the key it normalised to. */
  requested: string;
  jurisdiction: string | null;
  distributors: DistributorCatalogueRow[];
  /** Words, never an empty list left to be read as "there is nothing here". */
  silence: string | null;
  /**
   * True only when the caller's own house records no country (ADR 0305): its
   * state is not read, and the page is asked to send the owner to Settings.
   */
  countryNotRecorded: boolean;
}

@Injectable()
export class DistributorFeedService {
  private readonly logger = new Logger(DistributorFeedService.name);

  constructor(private readonly db: DatabaseService) {}

  /** The catalogue for one jurisdiction, or every entry when none is given. */
  forJurisdiction(rawJurisdiction: string | null): DistributorCatalogue {
    if (!rawJurisdiction || !rawJurisdiction.trim()) {
      return {
        connection: DISTRIBUTOR_FEED_CONNECTION,
        requested: "",
        jurisdiction: null,
        distributors: Object.values(DISTRIBUTORS).map(toRow),
        silence:
          "No jurisdiction was named, so this is every distributor this register has measured — not the ones near any one house.",
        countryNotRecorded: false,
      };
    }
    return this.catalogueFor(
      rawJurisdiction,
      normalizeJurisdiction(rawJurisdiction),
    );
  }

  /** One jurisdiction, already resolved: `requested` is the text it came from. */
  private catalogueFor(
    requested: string,
    jurisdiction: string | null,
  ): DistributorCatalogue {
    if (!jurisdiction) {
      return {
        connection: DISTRIBUTOR_FEED_CONNECTION,
        requested,
        jurisdiction: null,
        distributors: [],
        silence: `"${requested}" is not a jurisdiction this register recognises. No distributor list is drawn rather than guessing a state.`,
        countryNotRecorded: false,
      };
    }
    const entries = distributorsFor(jurisdiction);
    return {
      connection: DISTRIBUTOR_FEED_CONNECTION,
      requested,
      jurisdiction,
      distributors: entries.map(toRow),
      silence:
        entries.length === 0
          ? `No distributor has been measured for ${jurisdiction}. This register is silent because nobody has looked, not because it is known that nothing is connectable there.`
          : distributorSilenceFor(jurisdiction),
      countryNotRecorded: false,
    };
  }

  /**
   * The catalogue for the CALLER's own house.
   *
   * A read failure is reported as a failure. `restaurants` returning an error is
   * not the same fact as a house with no address, and the two must not render as
   * one empty box (ADR 0020 / ADR 0051).
   */
  async forHouse(restaurantId: string | null): Promise<DistributorCatalogue> {
    if (!restaurantId) {
      return {
        connection: DISTRIBUTOR_FEED_CONNECTION,
        requested: "me",
        jurisdiction: null,
        distributors: [],
        silence:
          "No active restaurant on this session, so there is no jurisdiction to scope a distributor list to.",
        countryNotRecorded: false,
      };
    }
    let rawState: string | null = null;
    let rawCountry: string | null = null;
    let readFailed = false;
    try {
      const { data, error } = await this.db.client
        .from("restaurants")
        .select("state_province, country")
        .eq("id", restaurantId)
        .single();
      if (error) throw error;
      const row = data as {
        state_province: string | null;
        country: string | null;
      } | null;
      rawState = row?.state_province ?? null;
      rawCountry = row?.country ?? null;
    } catch (err) {
      readFailed = true;
      this.logger.warn(
        `could not read this house's jurisdiction for the distributor catalogue: ${(err as Error).message}`,
      );
    }
    if (readFailed) {
      return {
        connection: DISTRIBUTOR_FEED_CONNECTION,
        requested: "me",
        jurisdiction: null,
        distributors: [],
        silence:
          "This house's jurisdiction could not be read. This is unknown, not empty.",
        countryNotRecorded: false,
      };
    }
    // The country first, the state only inside it (ADR 0305): "MI" on an
    // Italian house is Milano, and must not be shown Michigan's distributors.
    const house = resolveHouseJurisdiction(rawState, rawCountry);
    if (house.kind === "country_not_recorded") {
      return {
        connection: DISTRIBUTOR_FEED_CONNECTION,
        requested: "me",
        jurisdiction: null,
        distributors: [],
        silence: COUNTRY_NOT_RECORDED_SENTENCE,
        countryNotRecorded: true,
      };
    }
    return this.catalogueFor(
      house.requested,
      house.kind === "resolved" ? house.jurisdiction : null,
    );
  }
}

function toRow(d: DistributorEntry): DistributorCatalogueRow {
  return {
    key: d.key,
    distributor: d.distributor,
    jurisdictions: d.jurisdictions,
    portal: d.portal,
    mechanism: d.mechanism,
    automatedAccess: d.automatedAccess,
    availability: d.availability,
    unbuilt: d.unbuilt,
    connectable: d.unbuilt === null,
  };
}
