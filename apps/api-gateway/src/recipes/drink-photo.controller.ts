import { Body, Controller, Delete, Param, ParseUUIDPipe, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsString, MaxLength } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { DrinkPhotoService } from "./drink-photo.service";

/** 5 MB of photo is ~7 MB of base64; the service refuses anything over 5 MB once decoded. */
export class DrinkPhotoDto {
  @ApiProperty({ description: "The photo, base64 (a data: prefix is allowed): JPEG, PNG or WebP, at most 5 MB" })
  @IsString()
  @MaxLength(7_200_000)
  imageBase64!: string;
}

/**
 * A drink's photo (r110 drinks-g3). Owners and managers set and remove it, as
 * they save a recipe (recipes.controller.ts saveRecipe); every role of the
 * house reads it through the recipe and the spec book. Every route names the
 * house, so `assertTenantMatch` inside `JwtAuthGuard` refuses another house's
 * caller, and the drink is found under the named house only.
 */
@ApiTags("recipes")
@Controller("recipes")
@UseGuards(JwtAuthGuard)
export class DrinkPhotoController {
  constructor(private readonly photos: DrinkPhotoService) {}

  @Put(":restaurantId/cocktails/:cocktailId/photo")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Set a drink's photo (owner/manager): JPEG, PNG or WebP up to 5 MB, stored with every metadata block removed" })
  put(
    @Param("restaurantId", ParseUUIDPipe) restaurantId: string,
    @Param("cocktailId", ParseUUIDPipe) cocktailId: string,
    @Body() dto: DrinkPhotoDto,
  ) {
    return this.photos.put(restaurantId, cocktailId, dto.imageBase64);
  }

  @Delete(":restaurantId/cocktails/:cocktailId/photo")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  @ApiOperation({ summary: "Remove a drink's photo (owner/manager)" })
  remove(@Param("restaurantId", ParseUUIDPipe) restaurantId: string, @Param("cocktailId", ParseUUIDPipe) cocktailId: string) {
    return this.photos.remove(restaurantId, cocktailId);
  }
}
