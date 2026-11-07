/**
 * /communications/designs: the house's letter designs (ADR 0357).
 *
 * Reads are open to any member of the house, so staff see designs read-only
 * (founder answer 3, 2026-11-02). Every write is owner or manager, enforced
 * here by `RolesGuard` and not by the page hiding a button.
 *
 * The block catalogue is declared before `:id`, so "blocks" is never read as a
 * design id.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { houseActor, type TokenUser } from "../letters/house-letters.actor";
import { LetterDesignsService } from "./letter-designs.service";
import {
  CreateLetterDesignDto,
  RestoreLetterDesignDto,
  UpdateLetterDesignDto,
} from "./letter-designs.dto";

@ApiTags("Communications")
@UseGuards(JwtAuthGuard)
@Controller("communications/designs")
export class LetterDesignsController {
  constructor(private readonly designs: LetterDesignsService) {}

  @Get("blocks")
  @ApiOperation({ summary: "The block types, merge fields and purposes a design may use" })
  blocks(@CurrentUser() user: TokenUser) {
    houseActor(user);
    return this.designs.catalogue();
  }

  @Get()
  @ApiOperation({ summary: "The house's letter designs" })
  list(@CurrentUser() user: TokenUser) {
    const { restaurantId } = houseActor(user);
    return this.designs.list(restaurantId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Start a letter design" })
  create(@CurrentUser() user: TokenUser, @Body() dto: CreateLetterDesignDto) {
    const { userId, restaurantId } = houseActor(user);
    return this.designs.create({ restaurantId, userId, dto });
  }

  @Get(":id")
  @ApiOperation({ summary: "One letter design, with its draft blocks" })
  async one(@CurrentUser() user: TokenUser, @Param("id", ParseUUIDPipe) id: string) {
    const { restaurantId } = houseActor(user);
    return { design: await this.designs.get(restaurantId, id) };
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Save the draft (autosave)" })
  update(
    @CurrentUser() user: TokenUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateLetterDesignDto,
  ) {
    const { userId, restaurantId } = houseActor(user);
    return this.designs.update({ restaurantId, userId, id, dto });
  }

  @Post(":id/publish")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @HttpCode(201)
  @ApiOperation({ summary: "Publish the draft as the next version" })
  publish(@CurrentUser() user: TokenUser, @Param("id", ParseUUIDPipe) id: string) {
    const { userId, restaurantId } = houseActor(user);
    return this.designs.publish({ restaurantId, userId, id });
  }

  @Get(":id/versions")
  @ApiOperation({ summary: "A design's published versions, newest first" })
  versions(@CurrentUser() user: TokenUser, @Param("id", ParseUUIDPipe) id: string) {
    const { restaurantId } = houseActor(user);
    return this.designs.versions(restaurantId, id);
  }

  @Post(":id/restore")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @HttpCode(200)
  @ApiOperation({ summary: "Copy a published version back into the draft" })
  restore(
    @CurrentUser() user: TokenUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RestoreLetterDesignDto,
  ) {
    const { userId, restaurantId } = houseActor(user);
    return this.designs.restore({ restaurantId, userId, id, version: dto.version });
  }

  @Post(":id/duplicate")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Copy a design into a new unpublished one" })
  duplicate(@CurrentUser() user: TokenUser, @Param("id", ParseUUIDPipe) id: string) {
    const { userId, restaurantId } = houseActor(user);
    return this.designs.duplicate({ restaurantId, userId, id });
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Remove a design from the list; its published versions are kept" })
  remove(@CurrentUser() user: TokenUser, @Param("id", ParseUUIDPipe) id: string) {
    const { userId, restaurantId } = houseActor(user);
    return this.designs.archive({ restaurantId, userId, id });
  }
}
