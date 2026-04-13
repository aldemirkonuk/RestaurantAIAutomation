import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ContactsService,
  ContactDto,
  ContactAddressDto,
  ContactWithAddresses,
  PaginatedResult,
} from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  /**
   * GET /contacts?restaurant_id=&type=&search=&page=&pageSize=&includeAddresses=
   * Paginated, filterable contact search with trigram matching
   */
  @Get()
  async findAll(
    @Query('restaurant_id') restaurantId?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeAddresses') includeAddresses?: string,
  ): Promise<PaginatedResult<ContactWithAddresses>> {
    return this.contactsService.findAll({
      restaurantId,
      type,
      search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      includeAddresses: includeAddresses === 'true',
    });
  }

  /**
   * GET /contacts/:id
   * Get a single contact with all addresses
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ContactWithAddresses> {
    return this.contactsService.findOne(id);
  }

  /**
   * POST /contacts
   * Create a contact with optional addresses
   */
  @Post()
  async create(
    @Body() body: { contact: ContactDto; addresses?: ContactAddressDto[] },
  ): Promise<ContactWithAddresses> {
    return this.contactsService.create(body.contact, body.addresses);
  }

  /**
   * PATCH /contacts/:id
   * Update a contact
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<ContactDto>,
  ): Promise<ContactWithAddresses> {
    return this.contactsService.update(id, dto);
  }

  /**
   * DELETE /contacts/:id
   * Soft-delete a contact (set is_active=false)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.contactsService.remove(id);
  }

  /**
   * GET /contacts/:id/addresses
   * List all addresses for a contact
   */
  @Get(':id/addresses')
  async getAddresses(@Param('id') id: string): Promise<ContactAddressDto[]> {
    return this.contactsService.getAddresses(id);
  }

  /**
   * POST /contacts/:id/addresses
   * Add an address to a contact
   */
  @Post(':id/addresses')
  async addAddress(
    @Param('id') id: string,
    @Body() dto: ContactAddressDto,
  ): Promise<ContactAddressDto> {
    return this.contactsService.addAddress(id, dto);
  }

  /**
   * DELETE /contacts/addresses/:addressId
   * Delete a specific address
   */
  @Delete('addresses/:addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAddress(@Param('addressId') addressId: string): Promise<void> {
    return this.contactsService.removeAddress(addressId);
  }
}
