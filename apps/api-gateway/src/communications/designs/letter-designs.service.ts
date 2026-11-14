/**
 * Letter designs: a house's own mail layouts (ADR 0357).
 *
 * Every read and write is scoped by `restaurant_id` here, because the gateway
 * talks to the database as the service role and RLS does not narrow it. A
 * design that is not this house's is "not found", never "forbidden": the
 * existence of another house's design is not this house's business.
 *
 * Nothing in this file sends mail. Designs are layouts; the Send tab's use of a
 * version arrives in its own PR.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { assertNamedActor } from "../letters/house-letters.actor";
import { LETTER_CATEGORIES } from "../letters/house-letters.service";
import { DESIGN_LOOKS, blockCatalogue, blockProblems } from "./letter-design-blocks";
import type {
  CreateLetterDesignDto,
  UpdateLetterDesignDto,
} from "./letter-designs.dto";

const DESIGN_COLUMNS =
  "id, name, purpose, look, blocks, published_version, created_by, updated_by, created_at, updated_at";

/** A house starts a design from nothing but its own words and one closer. */
const STARTER_BLOCKS = [
  { id: "b1", t: "text", p: { text: "Hello {{contact_name}}," } },
  { id: "b2", t: "signoff", p: { text: "Thank you,\n{{house_name}}" } },
];

@Injectable()
export class LetterDesignsService {
  constructor(private readonly db: DatabaseService) {}

  catalogue() {
    return { ...blockCatalogue(), purposes: LETTER_CATEGORIES };
  }

  private refusePurpose(purpose: string) {
    if (!(LETTER_CATEGORIES as readonly string[]).includes(purpose)) {
      throw new UnprocessableEntityException(
        `"${purpose}" is not one of the house's letter purposes (${LETTER_CATEGORIES.join(", ")}).`,
      );
    }
  }

  private refuseBlocks(blocks: unknown) {
    const problems = blockProblems(blocks);
    if (problems.length) {
      throw new UnprocessableEntityException({
        message: "These blocks cannot be saved. Nothing was changed.",
        problems,
      });
    }
  }

  private readFailed(what: string, message: string): never {
    throw new BadRequestException(`${what} could not be read (${message}).`);
  }

  async list(restaurantId: string) {
    const { data, error } = await this.db.client
      .from("letter_designs")
      .select(DESIGN_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false });
    if (error) this.readFailed("The house's letter designs", error.message);
    return { designs: data ?? [] };
  }

  async get(restaurantId: string, id: string) {
    const { data, error } = await this.db.client
      .from("letter_designs")
      .select(DESIGN_COLUMNS)
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .is("archived_at", null)
      .maybeSingle();
    if (error) this.readFailed("That letter design", error.message);
    if (!data) throw new NotFoundException("No such letter design in this house.");
    return data as Record<string, unknown>;
  }

  async create(params: { restaurantId: string; userId: string; dto: CreateLetterDesignDto }) {
    const userId = assertNamedActor(params.userId, "saved");
    const { dto, restaurantId } = params;
    this.refusePurpose(dto.purpose);
    const blocks = dto.blocks ?? STARTER_BLOCKS;
    this.refuseBlocks(blocks);
    const { data, error } = await this.db.client
      .from("letter_designs")
      .insert({
        restaurant_id: restaurantId,
        name: dto.name.trim(),
        purpose: dto.purpose,
        blocks,
        created_by: userId,
        updated_by: userId,
      })
      .select(DESIGN_COLUMNS)
      .single();
    if (error || !data) {
      throw new BadRequestException(
        `The letter design could not be saved (${error?.message ?? "no row came back"}). Nothing was saved.`,
      );
    }
    return data;
  }

  async update(params: {
    restaurantId: string;
    userId: string;
    id: string;
    dto: UpdateLetterDesignDto;
  }) {
    const userId = assertNamedActor(params.userId, "saved");
    const { dto, restaurantId, id } = params;
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.purpose !== undefined) {
      this.refusePurpose(dto.purpose);
      patch.purpose = dto.purpose;
    }
    if (dto.look !== undefined) {
      if (!(DESIGN_LOOKS as readonly string[]).includes(dto.look)) {
        throw new UnprocessableEntityException(
          `"${dto.look}" is not a look the house has (${DESIGN_LOOKS.join(", ")}).`,
        );
      }
      patch.look = dto.look;
    }
    if (dto.blocks !== undefined) {
      this.refuseBlocks(dto.blocks);
      patch.blocks = dto.blocks;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("Nothing to change: send a name, purpose, look or blocks.");
    }
    patch.updated_by = userId;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await this.db.client
      .from("letter_designs")
      .update(patch)
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .is("archived_at", null)
      .select(DESIGN_COLUMNS)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(`The letter design could not be saved (${error.message}). Nothing was changed.`);
    }
    if (!data) throw new NotFoundException("No such letter design in this house.");
    return data;
  }

  /** Copies the draft into the next immutable version. */
  async publish(params: { restaurantId: string; userId: string; id: string }) {
    const userId = assertNamedActor(params.userId, "published");
    const design = await this.get(params.restaurantId, params.id);
    const blocks = design.blocks;
    this.refuseBlocks(blocks);
    if (Array.isArray(blocks) && blocks.length === 0) {
      throw new UnprocessableEntityException("An empty design cannot be published. Add a block first.");
    }
    const next = ((design.published_version as number | null) ?? 0) + 1;
    const { error: vErr } = await this.db.client.from("letter_design_versions").insert({
      design_id: params.id,
      restaurant_id: params.restaurantId,
      version: next,
      name: design.name,
      purpose: design.purpose,
      look: design.look,
      blocks,
      published_by: userId,
    });
    if (vErr) {
      // (design_id, version) is unique: a second publish racing this one lands here.
      if ((vErr as { code?: string }).code === "23505") {
        throw new ConflictException("Someone published this design a moment ago. Reload and publish again.");
      }
      throw new BadRequestException(`The design could not be published (${vErr.message}). Nothing was published.`);
    }
    const { data, error } = await this.db.client
      .from("letter_designs")
      .update({ published_version: next, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("restaurant_id", params.restaurantId)
      .select(DESIGN_COLUMNS)
      .single();
    if (error || !data) {
      // The version row exists; the pointer did not move. Say so rather than claim success.
      throw new BadRequestException(
        `Version ${next} was recorded but the design still points at the previous one (${error?.message ?? "no row came back"}). Publish again to move it.`,
      );
    }
    return { design: data, version: next };
  }

  async versions(restaurantId: string, id: string) {
    await this.get(restaurantId, id);
    const { data, error } = await this.db.client
      .from("letter_design_versions")
      .select("id, version, name, purpose, look, blocks, published_by, published_at")
      .eq("design_id", id)
      .eq("restaurant_id", restaurantId)
      .order("version", { ascending: false });
    if (error) this.readFailed("The design's versions", error.message);
    return { versions: data ?? [] };
  }

  /** Puts a published version back into the draft. Publishing is a separate act. */
  async restore(params: { restaurantId: string; userId: string; id: string; version: number }) {
    const userId = assertNamedActor(params.userId, "restored");
    await this.get(params.restaurantId, params.id);
    const { data: v, error } = await this.db.client
      .from("letter_design_versions")
      .select("name, purpose, look, blocks")
      .eq("design_id", params.id)
      .eq("restaurant_id", params.restaurantId)
      .eq("version", params.version)
      .maybeSingle();
    if (error) this.readFailed("That version", error.message);
    if (!v) throw new NotFoundException(`This design has no version ${params.version}.`);
    return this.update({
      restaurantId: params.restaurantId,
      userId,
      id: params.id,
      dto: {
        name: v.name as string,
        purpose: v.purpose as string,
        look: v.look as string,
        blocks: v.blocks as unknown[],
      },
    });
  }

  /** A copy is a new design with no published version of its own. */
  async duplicate(params: { restaurantId: string; userId: string; id: string }) {
    const src = await this.get(params.restaurantId, params.id);
    const name = `${String(src.name)} (copy)`.slice(0, 120);
    return this.create({
      restaurantId: params.restaurantId,
      userId: params.userId,
      dto: { name, purpose: src.purpose as string, blocks: src.blocks as unknown[] },
    });
  }

  /** Hides the design. Its published versions stay, because a filed letter may name one. */
  async archive(params: { restaurantId: string; userId: string; id: string }) {
    const userId = assertNamedActor(params.userId, "archived");
    const { data, error } = await this.db.client
      .from("letter_designs")
      .update({ archived_at: new Date().toISOString(), updated_by: userId })
      .eq("id", params.id)
      .eq("restaurant_id", params.restaurantId)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      throw new BadRequestException(`The design could not be removed (${error.message}). Nothing was changed.`);
    }
    if (!data) throw new NotFoundException("No such letter design in this house.");
    return { id: params.id, archived: true };
  }
}
