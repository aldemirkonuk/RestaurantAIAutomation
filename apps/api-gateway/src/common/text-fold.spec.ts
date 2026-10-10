import { foldText } from "./text-fold";

describe("foldText", () => {
  it("folds the Turkish dotless and dotted i to a plain i", () => {
    expect(foldText("Rakı")).toBe("raki");
    expect(foldText("RAKI")).toBe("raki");
    expect(foldText("İzmir")).toBe("izmir");
    expect(foldText("Kavaklıdere")).toBe(foldText("KAVAKLIDERE"));
  });

  it("strips the other accents, so a Turkish label meets its ASCII spelling", () => {
    expect(foldText("Çay")).toBe("cay");
    expect(foldText("Öküzgözü")).toBe("okuzgozu");
    expect(foldText("Boğazkere Şarap")).toBe("bogazkere sarap");
    expect(foldText("Château")).toBe("chateau");
  });

  it("returns an empty string for nothing", () => {
    expect(foldText(null)).toBe("");
    expect(foldText(undefined)).toBe("");
    expect(foldText("")).toBe("");
  });
});
