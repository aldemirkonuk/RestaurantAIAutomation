import { SetMetadata } from "@nestjs/common";

export const TENANT_BYPASS_KEY = "tenantBypass";
export const TenantBypass = () => SetMetadata(TENANT_BYPASS_KEY, true);
