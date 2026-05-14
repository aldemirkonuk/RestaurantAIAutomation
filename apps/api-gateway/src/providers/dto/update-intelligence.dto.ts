import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsObject } from 'class-validator';

export class UpdateIntelligenceDto {
  @ApiPropertyOptional({ description: 'Foundational intelligence profile (5 static dimensions)' })
  @IsOptional()
  @IsObject()
  profile_foundational?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Dynamic intelligence profile (auto-updated by LLM)' })
  @IsOptional()
  @IsObject()
  profile_dynamic?: Record<string, any>;
}
