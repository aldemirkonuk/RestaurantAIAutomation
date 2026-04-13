import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

export type Role = 'owner' | 'manager' | 'staff';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true; // No roles required
    }

    const { user } = context.switchToHttp().getRequest();
    
    if (!user) {
      return false;
    }

    // Owner and Manager are equal (as per requirements)
    const userRole = user.role as Role;
    
    // If owner/manager required, accept both
    if (requiredRoles.includes('owner') || requiredRoles.includes('manager')) {
      if (userRole === 'owner' || userRole === 'manager') {
        return true;
      }
    }

    return requiredRoles.some((role) => userRole === role);
  }
}

