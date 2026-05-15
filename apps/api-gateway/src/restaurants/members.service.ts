import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private async assertMembership(
    actorUserId: string,
    restaurantId: string,
    requiredRole?: 'owner' | 'manager' | 'owner|manager',
  ): Promise<{ role: string }> {
    const { data: access } = await this.databaseService.supabase
      .from('user_restaurant_access')
      .select('role')
      .eq('user_id', actorUserId)
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (!access) throw new ForbiddenException('Access denied to this restaurant');

    if (requiredRole === 'owner' && access.role !== 'owner') {
      throw new ForbiddenException('Only owners can perform this action');
    }
    if (requiredRole === 'owner|manager' && access.role === 'staff') {
      throw new ForbiddenException(
        'Only owners and managers can perform this action',
      );
    }

    return access;
  }

  async getMembers(actorUserId: string, restaurantId: string): Promise<any[]> {
    await this.assertMembership(actorUserId, restaurantId);

    const { data: rows, error } = await this.databaseService.supabase
      .from('user_restaurant_access')
      .select('id, role, created_at, valid_until, is_active, user_id, invited_via')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('granted_at', { ascending: true });

    if (error) {
      this.logger.error(
        `getMembers failed for restaurant ${restaurantId}: ${error.message}`,
      );
      return [];
    }

    const userIds = [...new Set((rows ?? []).map((r: any) => r.user_id))];
    if (userIds.length === 0) return [];

    const { data: users } = await this.databaseService.supabase
      .from('users')
      .select('user_id, name, email, avatar_url, auth_provider')
      .in('user_id', userIds);

    const userMap = new Map((users ?? []).map((u: any) => [u.user_id, u]));

    return (rows ?? []).map((r: any) => ({
      ...r,
      users: userMap.get(r.user_id) ?? null,
    }));
  }

  async getInvites(actorUserId: string, restaurantId: string): Promise<any[]> {
    await this.assertMembership(actorUserId, restaurantId, 'owner|manager');

    const { data: invites, error } = await this.databaseService.supabase
      .from('organization_invites')
      .select('id, code, role, expires_at, created_at, invited_by')
      .eq('restaurant_id', restaurantId)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(
        `getInvites failed for restaurant ${restaurantId}: ${error.message}`,
      );
      return [];
    }

    return invites ?? [];
  }

  async updateMemberRole(
    actorUserId: string,
    restaurantId: string,
    targetUserId: string,
    newRole: 'owner' | 'manager' | 'staff',
  ): Promise<void> {
    await this.assertMembership(actorUserId, restaurantId, 'owner');

    if (actorUserId === targetUserId && newRole !== 'owner') {
      const { count } = await this.databaseService.supabase
        .from('user_restaurant_access')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('role', 'owner')
        .eq('is_active', true);

      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          "You're the only owner. Transfer ownership or delete the restaurant first.",
        );
      }
    }

    const { error: uraErr } = await this.databaseService.supabase
      .from('user_restaurant_access')
      .update({ role: newRole })
      .eq('user_id', targetUserId)
      .eq('restaurant_id', restaurantId);

    if (uraErr) {
      this.logger.error(`updateMemberRole URA update failed: ${uraErr.message}`);
      throw new InternalServerErrorException('Failed to update member role');
    }

    await this.databaseService.supabase
      .from('users')
      .update({ role: newRole })
      .eq('user_id', targetUserId);
  }

  async removeMember(
    actorUserId: string,
    restaurantId: string,
    targetUserId: string,
  ): Promise<void> {
    const selfLeave = actorUserId === targetUserId;

    if (selfLeave) {
      await this.assertMembership(actorUserId, restaurantId);
    } else {
      await this.assertMembership(actorUserId, restaurantId, 'owner');
    }

    const { data: targetAccess } = await this.databaseService.supabase
      .from('user_restaurant_access')
      .select('role')
      .eq('user_id', targetUserId)
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (!targetAccess) {
      throw new NotFoundException('Member not found in this restaurant');
    }

    if (targetAccess.role === 'owner') {
      const { count } = await this.databaseService.supabase
        .from('user_restaurant_access')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('role', 'owner')
        .eq('is_active', true);

      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          "You're the only owner. Transfer ownership or delete the restaurant first.",
        );
      }
    }

    const { error } = await this.databaseService.supabase
      .from('user_restaurant_access')
      .delete()
      .eq('user_id', targetUserId)
      .eq('restaurant_id', restaurantId);

    if (error) {
      this.logger.error(`removeMember delete failed: ${error.message}`);
      throw new InternalServerErrorException('Failed to remove member');
    }
  }

  async addMember(
    actorUserId: string,
    restaurantId: string,
    email: string,
    role: 'owner' | 'manager' | 'staff',
  ): Promise<void> {
    const actorAccess = await this.assertMembership(
      actorUserId,
      restaurantId,
      'owner|manager',
    );

    if (actorAccess.role === 'manager' && role !== 'staff') {
      throw new ForbiddenException('Managers can only add staff members');
    }

    const { data: targetUser } = await this.databaseService.supabase
      .from('users')
      .select('user_id')
      .ilike('email', email.trim())
      .maybeSingle();

    if (!targetUser) {
      throw new NotFoundException(
        'User not found. Send them an invite link to create an account first.',
      );
    }

    const { data: existingAccess } = await this.databaseService.supabase
      .from('user_restaurant_access')
      .select('id')
      .eq('user_id', targetUser.user_id)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();

    if (existingAccess) {
      throw new ConflictException('User is already a member of this restaurant');
    }

    const { data: restaurant } = await this.databaseService.supabase
      .from('restaurants')
      .select('organization_id')
      .eq('id', restaurantId)
      .maybeSingle();

    const { error: uraErr } = await this.databaseService.supabase
      .from('user_restaurant_access')
      .insert({
        user_id: targetUser.user_id,
        restaurant_id: restaurantId,
        role,
        invited_via: null,
        is_active: true,
      });

    if (uraErr) {
      this.logger.error(`addMember URA insert failed: ${uraErr.message}`);
      throw new InternalServerErrorException('Failed to add member');
    }

    if (restaurant?.organization_id) {
      await this.databaseService.supabase.from('organization_members').upsert(
        {
          organization_id: restaurant.organization_id,
          user_id: targetUser.user_id,
          role,
        },
        { onConflict: 'organization_id,user_id' },
      );
    }
  }

  async revokeInvite(
    actorUserId: string,
    restaurantId: string,
    code: string,
  ): Promise<void> {
    await this.assertMembership(actorUserId, restaurantId, 'owner|manager');

    const { error } = await this.databaseService.supabase
      .from('organization_invites')
      .delete()
      .eq('code', code.toUpperCase())
      .eq('restaurant_id', restaurantId)
      .is('used_at', null);

    if (error) {
      this.logger.error(`revokeInvite failed: ${error.message}`);
      throw new InternalServerErrorException('Failed to revoke invite');
    }
  }
}
