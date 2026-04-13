import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsObject, IsInt, Min, Max } from 'class-validator';

export enum EventType {
  INVENTORY_CHANGE = 'inventory_change',
  ORDER_CHANGE = 'order_change',
  CALENDAR_EVENT = 'calendar_event',
  DASHBOARD_UPDATE = 'dashboard_update',
  WINE_UPDATE = 'wine_update',
  REPORT_EVENT = 'report_event',
  NOTIFICATION_SENT = 'notification_sent',
  USER_ACTION = 'user_action',
  SYSTEM_EVENT = 'system_event',
  PROVIDER_CHANGE = 'provider_change',
  TEMPLATE_CHANGE = 'template_change',
}

export enum SourcePage {
  DASHBOARD = 'dashboard',
  INVENTORY = 'inventory',
  WINE_LIBRARY = 'wine_library',
  ORDERS = 'orders',
  CALENDAR = 'calendar',
  REPORTS = 'reports',
  COMMUNICATIONS = 'communications',
  PROVIDERS = 'providers',
  DOCUMENTS = 'documents',
  NOTIFICATIONS = 'notifications',
  SETTINGS = 'settings',
  SYSTEM = 'system',
}

export class CreateEventDto {
  @ApiProperty({ enum: EventType })
  @IsEnum(EventType)
  eventType: EventType;

  @ApiProperty({ enum: SourcePage })
  @IsEnum(SourcePage)
  sourcePage: SourcePage;

  @ApiProperty()
  @IsObject()
  payload: Record<string, any>;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @IsOptional()
  schemaVersion?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  traceId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  correlationId?: string;
}

export class GetEventsQueryDto {
  @ApiPropertyOptional({ enum: EventType })
  @IsEnum(EventType)
  @IsOptional()
  eventType?: EventType;

  @ApiPropertyOptional({ enum: SourcePage })
  @IsEnum(SourcePage)
  @IsOptional()
  sourcePage?: SourcePage;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  after?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  before?: string;
}

export class EventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  restaurantId: string;

  @ApiPropertyOptional()
  userId?: string;

  @ApiProperty({ enum: EventType })
  eventType: EventType;

  @ApiProperty({ enum: SourcePage })
  sourcePage: SourcePage;

  @ApiProperty()
  payload: Record<string, any>;

  @ApiProperty()
  schemaVersion: number;

  @ApiPropertyOptional()
  idempotencyKey?: string;

  @ApiPropertyOptional()
  traceId?: string;

  @ApiPropertyOptional()
  correlationId?: string;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional()
  deduped?: boolean;
}

export class EventListResponseDto {
  @ApiProperty({ type: [EventResponseDto] })
  events: EventResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  hasMore: boolean;
}

export class CreateEventResponseDto extends EventResponseDto {
  @ApiProperty()
  deduped: boolean;
}
