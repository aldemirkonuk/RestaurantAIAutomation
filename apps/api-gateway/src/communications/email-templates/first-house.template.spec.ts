import { firstHouseEmailTemplate } from "./first-house.template";

const html = firstHouseEmailTemplate({
  ownerName: "Selin Kaya",
  restaurantName: "Meyhane",
  frontendBaseUrl: "https://mudavym.com",
});

describe("the first-house letter", () => {
  it("links the five steps, in order, to the pages that do them", () => {
    const urls = [
      "https://mudavym.com/menu",
      "https://mudavym.com/inventory",
      "https://mudavym.com/vendors",
      "https://mudavym.com/communications?tab=mail&amp;setup=1",
      "https://mudavym.com/receipts",
    ];
    let at = -1;
    for (const url of urls) {
      const found = html.indexOf(`href="${url}"`, at + 1);
      expect(found).toBeGreaterThan(at);
      at = found;
    }
  });

  it("promises nothing the product does not do", () => {
    for (const stale of [
      "Verify your email",
      "negotiates",
      "Toast",
      "2 hours",
      "AI sommelier",
      "/dashboard",
    ])
      expect(html).not.toContain(stale);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("says the owner's first name and the house", () => {
    expect(html).toContain("Welcome to Mudavym, Selin.");
    expect(html).toContain("<strong>Meyhane</strong>");
  });

  it("keeps a typed name from becoming markup", () => {
    const mean = firstHouseEmailTemplate({
      ownerName: "<img src=x>",
      restaurantName: '<b onmouseover="x">Cafe</b>',
      frontendBaseUrl: "https://mudavym.com/",
    });
    expect(mean).not.toContain("<img src=x>");
    expect(mean).not.toContain("<b onmouseover");
    expect(mean).toContain("&lt;b onmouseover");
    expect(mean).not.toContain("com//menu");
  });
});
