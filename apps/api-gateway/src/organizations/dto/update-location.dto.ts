import { IsOptional, IsUUID } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsUUID()
  chainId?: string | null; // null = remove from chain (make standalone)
}
