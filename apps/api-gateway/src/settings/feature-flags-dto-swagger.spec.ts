/**
 * The feature-flag DTOs must produce an OpenAPI schema.
 *
 * `main.ts` calls `SwaggerModule.createDocument` at boot, so a DTO the schema
 * factory cannot read crashes the gateway before it listens. The registry keys
 * `feature-flags.dto.ts` decorates by direct call carry no `design:type`
 * metadata; without an explicit `type` the factory threw
 * "A circular dependency has been detected (property key:
 * \"mudavym_design_arrival\")" and production's gateway never came up
 * (deploy audits from 744874263 on answered HTTP 000).
 */
import { SchemaObjectFactory } from "@nestjs/swagger/dist/services/schema-object-factory";
import { ModelPropertiesAccessor } from "@nestjs/swagger/dist/services/model-properties-accessor";
import { SwaggerTypesMapper } from "@nestjs/swagger/dist/services/swagger-types-mapper";
import { ACTIVE_FEATURE_FLAG_KEYS } from "./feature-flag-registry";
import {
  FeatureFlagsDto,
  UpdateFeatureFlagsDto,
} from "./dto/feature-flags.dto";

function schemaOf(dto: new () => unknown): Record<string, any> {
  const factory = new SchemaObjectFactory(
    new ModelPropertiesAccessor(),
    new SwaggerTypesMapper(),
  );
  const schemas: Record<string, any> = {};
  const name = factory.exploreModelSchema(dto as any, schemas);
  return schemas[name];
}

describe.each([
  ["FeatureFlagsDto", FeatureFlagsDto],
  ["UpdateFeatureFlagsDto", UpdateFeatureFlagsDto],
])("%s OpenAPI schema", (_name, dto) => {
  it("builds without throwing, as SwaggerModule.createDocument does at boot", () => {
    expect(() => schemaOf(dto)).not.toThrow();
  });

  it("types every ACTIVE registry key as a boolean", () => {
    const schema = schemaOf(dto);
    for (const key of ACTIVE_FEATURE_FLAG_KEYS) {
      expect(schema.properties[key]).toEqual(
        expect.objectContaining({ type: "boolean" }),
      );
    }
  });
});
