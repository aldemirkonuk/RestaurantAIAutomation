import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateWineSubmissionDto } from "./dto/wine-submissions.dto";

describe("a submission states a US half-barrel keg as its size (F-1383)", () => {
  const errors = (bottleSizeMl: number) =>
    validateSync(
      plainToInstance(CreateWineSubmissionDto, {
        name: "House Lager",
        producer: "Local Brewery",
        bottleSizeMl,
      }),
    ).map((e) => e.property);

  it("takes 58,674 ml, as the inventory row does", () => {
    expect(errors(58674)).toEqual([]);
    expect(errors(750)).toEqual([]);
  });

  it("still refuses a size past 60,000 ml or under 50 ml", () => {
    expect(errors(60001)).toEqual(["bottleSizeMl"]);
    expect(errors(20)).toEqual(["bottleSizeMl"]);
  });
});
