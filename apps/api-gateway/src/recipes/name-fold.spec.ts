import { foldName, shelfSearchPattern } from "./name-fold";

/** r28 recipes audit, gap 14: the shelf search pattern, read as PostgreSQL's `~*` would. */
const finds = (term: string, name: string) => new RegExp(shelfSearchPattern(term) as string, "i").test(name);

describe("shelfSearchPattern", () => {
  it.each([
    ["RAKI", "Yeni Rakı"],
    ["raki", "YENİ RAKI"],
    ["seker", "Toz Şeker"],
    ["cig kofte", "Çiğ  Köfte"],
    ["creme", "Crème fraîche"],
    ["İsot", "isot biberi"],
  ])("%s finds %s", (term, name) => {
    expect(finds(term, name)).toBe(true);
    expect(foldName(name).includes(foldName(term))).toBe(true);
  });

  it.each([
    ["gin", "Gun"],
    ["seker", "Şaker"],
    ["a.b", "axb"],
    ["100%", "1000"],
    ["g_n", "gin"],
  ])("%s does not find %s", (term, name) => {
    expect(finds(term, name)).toBe(false);
  });

  it("a blank term is no pattern", () => {
    expect(shelfSearchPattern("   ")).toBeNull();
  });

  it("every regex character typed is searched as itself", () => {
    for (const ch of "\\^$.|?*+()[]{}-") expect(finds(`a${ch}b`, `xa${ch}by`)).toBe(true);
  });
});
