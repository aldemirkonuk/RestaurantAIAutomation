import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { MembersService } from "./members.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UpdateMemberRoleDto } from "../auth/dto/update-member-role.dto";
import { AddMemberDto } from "./dto/add-member.dto";
import { Request } from "express";

interface AuthenticatedUser {
  userId: string;
  role: string;
}

@Controller("restaurants")
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class MembersController {
  private readonly logger = new Logger(MembersController.name);

  constructor(private readonly membersService: MembersService) {}

  @Get(":restaurantId/members")
  async getMembers(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("restaurantId") restaurantId: string,
  ) {
    const userId = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new ForbiddenException("Missing user identity");
    return this.membersService.getMembers(userId, restaurantId);
  }

  @Get(":restaurantId/invites")
  async getInvites(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("restaurantId") restaurantId: string,
  ) {
    const userId = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new ForbiddenException("Missing user identity");
    return this.membersService.getInvites(userId, restaurantId);
  }

  @Patch(":restaurantId/members/:memberId")
  async updateMemberRole(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("restaurantId") restaurantId: string,
    @Param("memberId") memberId: string,
    @Body() body: UpdateMemberRoleDto,
  ): Promise<void> {
    const userId = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new ForbiddenException("Missing user identity");
    return this.membersService.updateMemberRole(
      userId,
      restaurantId,
      memberId,
      body.role,
    );
  }

  @Delete(":restaurantId/members/:memberId")
  async removeMember(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("restaurantId") restaurantId: string,
    @Param("memberId") memberId: string,
  ): Promise<void> {
    const userId = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new ForbiddenException("Missing user identity");
    return this.membersService.removeMember(userId, restaurantId, memberId);
  }

  @Post(":restaurantId/members")
  async addMember(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("restaurantId") restaurantId: string,
    @Body() body: AddMemberDto,
  ): Promise<void> {
    const userId = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new ForbiddenException("Missing user identity");
    return this.membersService.addMember(
      userId,
      restaurantId,
      body.email,
      body.role,
    );
  }

  @Delete(":restaurantId/invites/:code")
  async revokeInvite(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("restaurantId") restaurantId: string,
    @Param("code") code: string,
  ): Promise<void> {
    const userId = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new ForbiddenException("Missing user identity");
    return this.membersService.revokeInvite(userId, restaurantId, code);
  }
}
