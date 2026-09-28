import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CreateProviderContactDto,
  UpdateProviderContactDto,
  UpdateContactDateDto,
  ProviderContactResponseDto,
  ProviderResponseDto,
  BulkImportProvidersDto,
  BulkImportResultDto,
} from "./dto/providers.dto";

describe("ProvidersController", () => {
  let controller: ProvidersController;
  let providersService: ProvidersService;

  const mockUser = { id: "user-123", restaurantId: "restaurant-123" };

  const mockProvidersService = {
    getProviderContacts: jest.fn(),
    addProviderContact: jest.fn(),
    updateProviderContact: jest.fn(),
    deleteProviderContact: jest.fn(),
    searchProviders: jest.fn(),
    getRecommendations: jest.fn(),
    updateLastContactDate: jest.fn(),
    bulkImportProviders: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProvidersController],
      providers: [
        {
          provide: ProvidersService,
          useValue: mockProvidersService,
        },
        {
          // The role half of the vendor usual-currency gate (B1, founder
          // 2026-09-06 batch 65). No test in this file reaches that route; the
          // double exists so the controller can be constructed at all. Its
          // refusals are pinned in `vendor-currency.spec.ts`, which builds the
          // controller directly with a real role double.
          provide: OrganizationsService,
          useValue: { resolveRestaurantRole: jest.fn().mockResolvedValue(null) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProvidersController>(ProvidersController);
    providersService = module.get<ProvidersService>(ProvidersService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("GET /providers/:id/contacts", () => {
    const providerId = "provider-123";

    it("should return provider contacts", async () => {
      const expectedResponse: ProviderContactResponseDto[] = [
        {
          id: "contact-1",
          providerId,
          name: "John Doe",
          email: "john@example.com",
          phone: "+1234567890",
          role: "Sales Manager",
          isPrimary: true,
        },
        {
          id: "contact-2",
          providerId,
          name: "Jane Smith",
          email: "jane@example.com",
          phone: "+0987654321",
          role: "Account Manager",
          isPrimary: false,
        },
      ];

      mockProvidersService.getProviderContacts.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getProviderContacts(providerId);

      expect(result).toEqual(expectedResponse);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("providerId");
      expect(result[0]).toHaveProperty("name");
      expect(result[0]).toHaveProperty("isPrimary");
      expect(mockProvidersService.getProviderContacts).toHaveBeenCalledWith(
        providerId,
      );
    });

    it("should return empty array when no contacts", async () => {
      mockProvidersService.getProviderContacts.mockResolvedValue([]);

      const result = await controller.getProviderContacts(providerId);

      expect(result).toEqual([]);
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockProvidersService.getProviderContacts.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(controller.getProviderContacts(providerId)).rejects.toThrow(
        new HttpException("Database error", HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe("POST /providers/:id/contacts", () => {
    const providerId = "provider-123";
    const createDto: CreateProviderContactDto = {
      name: "New Contact",
      email: "new@example.com",
      phone: "+1111111111",
      role: "Manager",
      isPrimary: false,
    };

    it("should create provider contact", async () => {
      const expectedResponse: ProviderContactResponseDto = {
        id: "contact-new",
        providerId,
        name: createDto.name,
        email: createDto.email,
        phone: createDto.phone,
        role: createDto.role,
        isPrimary: createDto.isPrimary!,
      };

      mockProvidersService.addProviderContact.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.addProviderContact(providerId, createDto);

      expect(result).toEqual(expectedResponse);
      expect(result.id).toBe("contact-new");
      expect(result.name).toBe(createDto.name);
      expect(mockProvidersService.addProviderContact).toHaveBeenCalledWith(
        providerId,
        createDto,
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockProvidersService.addProviderContact.mockRejectedValue(
        new Error("Validation error"),
      );

      await expect(
        controller.addProviderContact(providerId, createDto),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("PATCH /providers/:id/contacts/:contactId", () => {
    const providerId = "provider-123";
    const contactId = "contact-456";
    const updateDto: UpdateProviderContactDto = {
      name: "Updated Name",
      email: "updated@example.com",
    };

    it("should update provider contact", async () => {
      const expectedResponse: ProviderContactResponseDto = {
        id: contactId,
        providerId,
        name: updateDto.name!,
        email: updateDto.email,
        phone: "+1234567890",
        role: "Manager",
        isPrimary: false,
      };

      mockProvidersService.updateProviderContact.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.updateProviderContact(
        providerId,
        contactId,
        updateDto,
      );

      expect(result).toEqual(expectedResponse);
      expect(result.name).toBe(updateDto.name);
      expect(result.email).toBe(updateDto.email);
      expect(mockProvidersService.updateProviderContact).toHaveBeenCalledWith(
        providerId,
        contactId,
        updateDto,
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockProvidersService.updateProviderContact.mockRejectedValue(
        new Error("Not found"),
      );

      await expect(
        controller.updateProviderContact(providerId, contactId, updateDto),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("DELETE /providers/:id/contacts/:contactId", () => {
    const providerId = "provider-123";
    const contactId = "contact-456";

    it("should delete provider contact", async () => {
      mockProvidersService.deleteProviderContact.mockResolvedValue(undefined);

      const result = await controller.deleteProviderContact(
        providerId,
        contactId,
      );

      expect(result).toEqual({ success: true });
      expect(mockProvidersService.deleteProviderContact).toHaveBeenCalledWith(
        providerId,
        contactId,
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockProvidersService.deleteProviderContact.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(
        controller.deleteProviderContact(providerId, contactId),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("GET /providers/search", () => {
    it("should search providers with query param", async () => {
      const query = "wine";
      const expectedResponse: ProviderResponseDto[] = [
        {
          id: "provider-1",
          name: "Wine Distributor Inc",
          specialties: ["red", "white"],
          isActive: true,
        },
      ];

      mockProvidersService.searchProviders.mockResolvedValue(expectedResponse);

      const result = await controller.searchProviders(mockUser, query);

      expect(result).toEqual(expectedResponse);
      expect(mockProvidersService.searchProviders).toHaveBeenCalledWith({
        q: query,
        restaurantId: mockUser.restaurantId,
        specialties: undefined,
        isActive: undefined,
      });
    });

    it("should handle multiple query parameters", async () => {
      const query = "wine";
      const specialties = ["red", "white"];
      const isActive = "true";

      mockProvidersService.searchProviders.mockResolvedValue([]);

      await controller.searchProviders(mockUser, query, specialties, isActive);

      expect(mockProvidersService.searchProviders).toHaveBeenCalledWith({
        q: query,
        restaurantId: mockUser.restaurantId,
        specialties: ["red", "white"],
        isActive: true,
      });
    });

    it("should handle single specialty string", async () => {
      const specialties = "red";

      mockProvidersService.searchProviders.mockResolvedValue([]);

      await controller.searchProviders(mockUser, undefined, specialties);

      expect(mockProvidersService.searchProviders).toHaveBeenCalledWith({
        q: undefined,
        restaurantId: mockUser.restaurantId,
        specialties: ["red"],
        isActive: undefined,
      });
    });
  });

  describe("GET /providers/:id/recommendations", () => {
    const providerId = "provider-123";
    const restaurantId = "restaurant-456";

    it("should return recommendations", async () => {
      const expectedResponse = {
        recommendations: [
          {
            providerId: "provider-1",
            score: 0.95,
            reason: "High reliability score",
          },
        ],
      };

      mockProvidersService.getRecommendations.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getProviderRecommendations(
        providerId,
        restaurantId,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockProvidersService.getRecommendations).toHaveBeenCalledWith(
        restaurantId,
        undefined,
      );
    });

    it("should pass wineId when provided", async () => {
      const wineId = "wine-789";

      mockProvidersService.getRecommendations.mockResolvedValue({});

      await controller.getProviderRecommendations(
        providerId,
        restaurantId,
        wineId,
      );

      expect(mockProvidersService.getRecommendations).toHaveBeenCalledWith(
        restaurantId,
        wineId,
      );
    });

    it("should use empty string when restaurantId not provided", async () => {
      mockProvidersService.getRecommendations.mockResolvedValue({});

      await controller.getProviderRecommendations(providerId);

      expect(mockProvidersService.getRecommendations).toHaveBeenCalledWith(
        "",
        undefined,
      );
    });
  });

  describe("PATCH /providers/:id/contact-date", () => {
    const providerId = "provider-123";
    const updateDto: UpdateContactDateDto = {
      lastContactDate: "2024-02-15",
      notes: "Discussed new wine selection",
    };

    it("should update contact date", async () => {
      const expectedResponse: ProviderResponseDto = {
        id: providerId,
        name: "Test Provider",
        lastContactDate: updateDto.lastContactDate,
        lastContactNotes: updateDto.notes,
      };

      mockProvidersService.updateLastContactDate.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.updateContactDate(
        providerId,
        updateDto,
        mockUser,
      );

      expect(result).toEqual(expectedResponse);
      expect(result.lastContactDate).toBe(updateDto.lastContactDate);
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockProvidersService.updateLastContactDate.mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(
        controller.updateContactDate(providerId, updateDto, mockUser),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("POST /providers/import", () => {
    const bulkImportDto: BulkImportProvidersDto = {
      restaurantId: "restaurant-123",
      providers: [
        {
          name: "Provider 1",
          specialties: ["red"],
        },
        {
          name: "Provider 2",
          specialties: ["white"],
        },
      ],
    };

    it("should bulk import providers", async () => {
      const expectedResponse: BulkImportResultDto = {
        imported: 2,
        failed: 0,
        errors: [],
      };

      mockProvidersService.bulkImportProviders.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.importProviders(bulkImportDto);

      expect(result).toEqual(expectedResponse);
      expect(result.imported).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockProvidersService.bulkImportProviders).toHaveBeenCalledWith(
        bulkImportDto,
      );
    });

    it("should handle partial failures", async () => {
      const expectedResponse: BulkImportResultDto = {
        imported: 1,
        failed: 1,
        errors: ["Provider 2 validation failed"],
      };

      mockProvidersService.bulkImportProviders.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.importProviders(bulkImportDto);

      expect(result).toEqual(expectedResponse);
      expect(result.imported).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockProvidersService.bulkImportProviders.mockRejectedValue(
        new Error("Import failed"),
      );

      await expect(controller.importProviders(bulkImportDto)).rejects.toThrow(
        HttpException,
      );
    });
  });
});
