import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class FeatureFlagsDto {
  @ApiProperty({ description: 'Enable inventory storage locations feature' })
  @IsBoolean()
  enable_inventory_storage_locations: boolean;

  @ApiProperty({ description: 'Enable auto procurement feature' })
  @IsBoolean()
  enable_auto_procurement: boolean;

  @ApiProperty({ description: 'Enable visual verification feature' })
  @IsBoolean()
  enable_visual_verification: boolean;

  @ApiProperty({ description: 'Enable predictive analytics feature' })
  @IsBoolean()
  enable_predictive_analytics: boolean;

  @ApiProperty({ description: 'Enable AI negotiation feature' })
  @IsBoolean()
  enable_ai_negotiation: boolean;

  @ApiProperty({ description: 'Enable sommelier AI feature' })
  @IsBoolean()
  enable_sommelier_ai: boolean;

  @ApiProperty({ description: 'Enable voice agent feature' })
  @IsBoolean()
  enable_voice_agent: boolean;

  @ApiProperty({ description: 'Enable menu analyzer feature' })
  @IsBoolean()
  enable_menu_analyzer: boolean;

  @ApiProperty({ description: 'Enable calendar sync feature' })
  @IsBoolean()
  enable_calendar_sync: boolean;

  @ApiProperty({ description: 'Enable WhatsApp Business feature' })
  @IsBoolean()
  enable_whatsapp_business: boolean;

  @ApiProperty({ description: 'Enable QuickBooks sync feature' })
  @IsBoolean()
  enable_quickbooks_sync: boolean;

  @ApiProperty({ description: 'Enable recurring orders feature' })
  @IsBoolean()
  enable_recurring_orders: boolean;

  @ApiProperty({ description: 'Enable invoice scanning feature' })
  @IsBoolean()
  enable_invoice_scanning: boolean;

  @ApiProperty({ description: 'Enable check scanning feature' })
  @IsBoolean()
  enable_check_scanning: boolean;

  @ApiProperty({ description: 'Enable auction purchases feature' })
  @IsBoolean()
  enable_auction_purchases: boolean;

  @ApiProperty({ description: 'Enable profit margin tracking feature' })
  @IsBoolean()
  enable_profit_margin_tracking: boolean;

  @ApiProperty({ description: 'Enable guest CRM feature' })
  @IsBoolean()
  enable_guest_crm: boolean;

  @ApiProperty({ description: 'Enable wine pairing AI feature' })
  @IsBoolean()
  enable_wine_pairing_ai: boolean;

  @ApiProperty({ description: 'Enable compliance autopilot feature' })
  @IsBoolean()
  enable_compliance_autopilot: boolean;

  @ApiProperty({ description: 'Enable shrinkage detective feature' })
  @IsBoolean()
  enable_shrinkage_detective: boolean;

  @ApiProperty({ description: 'Enable staff training simulator feature' })
  @IsBoolean()
  enable_staff_training_simulator: boolean;

  @ApiProperty({ description: 'Enable pour cost optimizer feature' })
  @IsBoolean()
  enable_pour_cost_optimizer: boolean;
}

export class UpdateFeatureFlagsDto {
  @ApiPropertyOptional({ description: 'Enable inventory storage locations feature' })
  @IsOptional()
  @IsBoolean()
  enable_inventory_storage_locations?: boolean;

  @ApiPropertyOptional({ description: 'Enable auto procurement feature' })
  @IsOptional()
  @IsBoolean()
  enable_auto_procurement?: boolean;

  @ApiPropertyOptional({ description: 'Enable visual verification feature' })
  @IsOptional()
  @IsBoolean()
  enable_visual_verification?: boolean;

  @ApiPropertyOptional({ description: 'Enable predictive analytics feature' })
  @IsOptional()
  @IsBoolean()
  enable_predictive_analytics?: boolean;

  @ApiPropertyOptional({ description: 'Enable AI negotiation feature' })
  @IsOptional()
  @IsBoolean()
  enable_ai_negotiation?: boolean;

  @ApiPropertyOptional({ description: 'Enable sommelier AI feature' })
  @IsOptional()
  @IsBoolean()
  enable_sommelier_ai?: boolean;

  @ApiPropertyOptional({ description: 'Enable voice agent feature' })
  @IsOptional()
  @IsBoolean()
  enable_voice_agent?: boolean;

  @ApiPropertyOptional({ description: 'Enable menu analyzer feature' })
  @IsOptional()
  @IsBoolean()
  enable_menu_analyzer?: boolean;

  @ApiPropertyOptional({ description: 'Enable calendar sync feature' })
  @IsOptional()
  @IsBoolean()
  enable_calendar_sync?: boolean;

  @ApiPropertyOptional({ description: 'Enable WhatsApp Business feature' })
  @IsOptional()
  @IsBoolean()
  enable_whatsapp_business?: boolean;

  @ApiPropertyOptional({ description: 'Enable QuickBooks sync feature' })
  @IsOptional()
  @IsBoolean()
  enable_quickbooks_sync?: boolean;

  @ApiPropertyOptional({ description: 'Enable recurring orders feature' })
  @IsOptional()
  @IsBoolean()
  enable_recurring_orders?: boolean;

  @ApiPropertyOptional({ description: 'Enable invoice scanning feature' })
  @IsOptional()
  @IsBoolean()
  enable_invoice_scanning?: boolean;

  @ApiPropertyOptional({ description: 'Enable check scanning feature' })
  @IsOptional()
  @IsBoolean()
  enable_check_scanning?: boolean;

  @ApiPropertyOptional({ description: 'Enable auction purchases feature' })
  @IsOptional()
  @IsBoolean()
  enable_auction_purchases?: boolean;

  @ApiPropertyOptional({ description: 'Enable profit margin tracking feature' })
  @IsOptional()
  @IsBoolean()
  enable_profit_margin_tracking?: boolean;

  @ApiPropertyOptional({ description: 'Enable guest CRM feature' })
  @IsOptional()
  @IsBoolean()
  enable_guest_crm?: boolean;

  @ApiPropertyOptional({ description: 'Enable wine pairing AI feature' })
  @IsOptional()
  @IsBoolean()
  enable_wine_pairing_ai?: boolean;

  @ApiPropertyOptional({ description: 'Enable compliance autopilot feature' })
  @IsOptional()
  @IsBoolean()
  enable_compliance_autopilot?: boolean;

  @ApiPropertyOptional({ description: 'Enable shrinkage detective feature' })
  @IsOptional()
  @IsBoolean()
  enable_shrinkage_detective?: boolean;

  @ApiPropertyOptional({ description: 'Enable staff training simulator feature' })
  @IsOptional()
  @IsBoolean()
  enable_staff_training_simulator?: boolean;

  @ApiPropertyOptional({ description: 'Enable pour cost optimizer feature' })
  @IsOptional()
  @IsBoolean()
  enable_pour_cost_optimizer?: boolean;
}

export class CheckFeatureFlagDto {
  @ApiProperty({ description: 'Restaurant ID' })
  @IsUUID()
  restaurant_id: string;

  @ApiProperty({ description: 'Feature name to check' })
  feature_name: string;
}
