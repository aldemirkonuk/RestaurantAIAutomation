import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ToastMenuItemDto {
  @ApiProperty({ description: 'Menu item GUID' })
  guid: string;

  @ApiProperty({ description: 'Item name' })
  name: string;

  @ApiPropertyOptional({ description: 'Item description' })
  description?: string;

  @ApiProperty({ description: 'Price in cents' })
  price: number;

  @ApiPropertyOptional({ description: 'Item category' })
  category?: string;

  @ApiPropertyOptional({ description: 'Item image URL' })
  imageUrl?: string;

  @ApiProperty({ description: 'Whether item is available' })
  isAvailable: boolean;
}

export class ToastMenuGroupDto {
  @ApiProperty({ description: 'Menu group GUID' })
  guid: string;

  @ApiProperty({ description: 'Group name' })
  name: string;

  @ApiPropertyOptional({ description: 'Group description' })
  description?: string;

  @ApiProperty({ description: 'Items in this group', type: [ToastMenuItemDto] })
  items: ToastMenuItemDto[];
}

export class ToastMenuDto {
  @ApiProperty({ description: 'Menu GUID' })
  guid: string;

  @ApiProperty({ description: 'Menu name' })
  name: string;

  @ApiPropertyOptional({ description: 'Menu description' })
  description?: string;

  @ApiProperty({ description: 'Menu groups', type: [ToastMenuGroupDto] })
  groups: ToastMenuGroupDto[];

  @ApiProperty({ description: 'Whether menu is active' })
  isActive: boolean;
}

export class ToastMenuListResponseDto {
  @ApiProperty({ description: 'List of menus', type: [ToastMenuDto] })
  menus: ToastMenuDto[];

  @ApiProperty({ description: 'Total count' })
  total: number;
}
