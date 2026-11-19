import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param,
  ParseUUIDPipe, Post, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AppendHouseTasteDto, RollupPreviewDto } from './dto/taste.dto';
import { isSubjectKind, SubjectKind, TasteService } from './taste.service';

type Caller = { userId: string; restaurantId: string; name?: string; email?: string };

/**
 * How a good, cocktail or dish tastes: every layer, and the fused result.
 *
 * TENANT SCOPE. The restaurant is named in the path, so `assertTenantMatch`
 * inside `JwtAuthGuard` refuses a caller reaching into another house before
 * this runs; the check below repeats it so no future guard change can open it.
 * Any member of the house may describe a taste; roles gate money, not palates.
 */
@ApiTags('taste')
@Controller('taste')
@UseGuards(JwtAuthGuard)
export class TasteController {
  constructor(private readonly taste: TasteService) {}

  private subject(kind: string, restaurantId: string, user: Caller): SubjectKind {
    if (!user?.restaurantId || user.restaurantId !== restaurantId) {
      throw new ForbiddenException('That is not your house.');
    }
    if (!isSubjectKind(kind)) {
      throw new BadRequestException('Taste is kept for a good, a cocktail or a dish.');
    }
    return kind;
  }

  @Get(':restaurantId/:subjectKind/:subjectId')
  @ApiOperation({ summary: 'The fused taste profile and every layer behind it' })
  @ApiResponse({ status: 200 })
  async read(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('subjectKind') kind: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @CurrentUser() user: Caller,
  ) {
    return this.taste.read(restaurantId, this.subject(kind, restaurantId, user), subjectId);
  }

  // Declared first: a 3-segment POST that is not a subject.
  @Post(':restaurantId/rollup/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'What a typed, unsaved recipe would taste like. Reads and writes nothing.' })
  @ApiResponse({ status: 200 })
  preview(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Body() body: RollupPreviewDto,
    @CurrentUser() user: Caller,
  ) {
    this.subject('dish', restaurantId, user);
    return this.taste.preview(body);
  }

  @Post(':restaurantId/:subjectKind/:subjectId/rollup')
  @HttpCode(201)
  @ApiOperation({ summary: 'Work out how a cocktail or dish tastes from its current recipe, and keep it as a layer' })
  @ApiResponse({ status: 201 })
  async rollup(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('subjectKind') kind: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @CurrentUser() user: Caller,
  ) {
    return this.taste.rollupSubject(restaurantId, this.subject(kind, restaurantId, user), subjectId);
  }

  @Post(':restaurantId/:subjectKind/:subjectId/house')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add the caller\'s own description of how this tastes' })
  @ApiResponse({ status: 201 })
  async appendHouse(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('subjectKind') kind: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() body: AppendHouseTasteDto,
    @CurrentUser() user: Caller,
  ) {
    return this.taste.appendHouse(
      restaurantId, this.subject(kind, restaurantId, user), subjectId, body,
      { userId: user.userId, name: user.name, email: user.email },
    );
  }
}
