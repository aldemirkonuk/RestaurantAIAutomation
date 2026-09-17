/* Sketch 110 — one invented house, used by all three directions.
   Example data, not a tenant. Counts are internally consistent. */
(function (root) {
  const EM = "—";

  const REGISTERS = [
    { id: "wines", title: "Wines" },
    { id: "beer", title: "Beer" },
    { id: "spirits", title: "Spirits" },
    { id: "cocktails", title: "Cocktails" },
    { id: "non_alcoholic", title: "Non-alcoholic" },
  ];

  const ZONES = [
    { id: "north", name: "North rack", holds: "reds", confirmedBy: "Deniz", when: "2 Sep" },
    { id: "cold", name: "Cold wall", holds: "whites, orange, sparkling", confirmedBy: "Deniz", when: "2 Sep" },
    { id: "keg", name: "Keg line", holds: "beer", confirmedBy: "Aslı", when: "3 Sep", provenance: "renamed by the house" },
    { id: "bar", name: "Back bar", holds: "rakı, gin, amaro, bottles of beer", confirmedBy: "Aslı", when: "3 Sep" },
  ];

  const UNCONFIRMED = ["Reserve Room — Rare Collection", "Overflow Storage"];

  const bottles = [
    /* ── wines, north rack ─────────────────────────────────────────── */
    { id: "w1", r: "wines", producer: "Kavaklıdere", name: "Yakut", vintage: 2021, origin: "Cappadocia", style: "red", format: "750ml", list: 420, onHand: 14, par: 12, zone: "north", shelf: 2, firstBought: "12 Mar 2026", paid: 1840, sold: 31, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIQOT", knowledge: "known",
      memo: "House red. We first bought it the week we opened, from Kavaklıdere themselves, and have not changed. Deniz's note: 'dust, dried cherry, drinks cooler than it looks.' Four are spoken for Saturday's tasting." },
    { id: "w2", r: "wines", producer: "Sevilen", name: "900 Syrah", vintage: 2020, origin: "İzmir", style: "red", format: "750ml", list: 380, onHand: 3, par: 8, zone: "north", shelf: 2, firstBought: "4 Apr 2026", paid: 960, sold: 22, lastQuote: "Ankara Şarap, 18 Aug", lastCounted: "2 Sep · Deniz", books: "MIQOT", knowledge: "known",
      memo: "Under its own par since the 28th. Selin sealed six more that night; they have not arrived. The three that remain are on Saturday if the case is late." },
    { id: "w3", r: "wines", producer: "Vinkara", name: "Kalecik Karası", vintage: 2022, origin: "Ankara", style: "red", format: "750ml", list: 290, onHand: 18, par: 12, zone: "north", shelf: 3, firstBought: "12 Mar 2026", paid: 2100, sold: 44, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "The glass we pour when somebody asks for 'just a red.' First bought the same week as the Yakut. Nobody has written a tasting note; the till has." },
    { id: "w4", r: "wines", producer: "Kayra", name: "Öküzgözü", vintage: 2021, origin: "Elazığ", style: "red", format: "750ml", list: 340, onHand: 4, par: 6, zone: "north", shelf: 3, firstBought: "22 May 2026", paid: 720, sold: 11, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "Aslı brought this onto the list after a dinner in Elazığ. Four left, par six. We have not yet asked for more." },
    { id: "w5", r: "wines", producer: "Urla", name: "Nero d'Avola", vintage: 2021, origin: "Urla", style: "red", format: "750ml", list: 560, onHand: 5, par: 6, zone: "north", shelf: 1, firstBought: "9 Jun 2026", paid: 1680, sold: 8, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "Urla's own vines, not a Sicilian story. Selin's note, recalled: 'black olive, warm, wants lamb.' One under par; the next case is not yet sealed." },
    { id: "w6", r: "wines", producer: "Vietti", name: "Barolo Castiglione", vintage: 2019, origin: "Piedmont", style: "red", format: "750ml", list: 1840, onHand: 6, par: 4, zone: "north", shelf: 1, firstBought: "3 Mar 2026", paid: 9240, sold: 4, lastQuote: "Kavaklıdere, 11 Aug", lastCounted: "2 Sep · Deniz", books: "MIQOT", knowledge: "known",
      memo: "We first bought six in March. Deniz poured the last of the 2018 on 12 August and we ordered twelve more the same night; six have landed. Selin: 'tar, rose, still closed — decant an hour.'" },
    { id: "w7", r: "wines", producer: "Produttori del Barbaresco", name: "Barbaresco", vintage: 2018, origin: "Piedmont", style: "red", format: "750ml", list: 1280, onHand: 2, par: 4, zone: "north", shelf: 1, firstBought: "3 Mar 2026", paid: 4100, sold: 7, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "The quieter Piedmont. Two on the rack, par four. Deniz has asked twice; the seal has not been pressed." },
    { id: "w8", r: "wines", producer: "Château Musar", name: "Rouge", vintage: 2017, origin: "Bekaa Valley", style: "red", format: "750ml", list: 2100, onHand: 6, par: 4, zone: "north", shelf: 1, firstBought: "17 Apr 2026", paid: 7800, sold: 3, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "The bottle we open when the table is going to stay. Six in, four would do. Nobody has quoted it to us since April; we pay what the last invoice paid." },

    /* ── wines, cold wall ──────────────────────────────────────────── */
    { id: "w9", r: "wines", producer: "Gaia", name: "Thalassitis Assyrtiko", vintage: 2023, origin: "Santorini", style: "white", format: "750ml", list: 890, onHand: 11, par: 8, zone: "cold", shelf: 1, firstBought: "28 Mar 2026", paid: 3960, sold: 19, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "The glass next to anything from the water. Eleven on the cold wall. Deniz's note: 'salt, lemon peel, drinks like a tide going out.'" },
    { id: "w10", r: "wines", producer: "Domaine Vocoret", name: "Chablis", vintage: 2022, origin: "Burgundy", style: "white", format: "750ml", list: 720, onHand: 8, par: 6, zone: "cold", shelf: 1, firstBought: "11 Apr 2026", paid: 2880, sold: 14, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "We list it because the room asks for Chablis by name. Eight on the wall. No tasting note of our own — the producer is the sentence." },
    { id: "w11", r: "wines", producer: "Tselepos", name: "Mantinia Moschofilero", vintage: 2023, origin: "Peloponnese", style: "white", format: "750ml", list: 410, onHand: 9, par: 8, zone: "cold", shelf: 2, firstBought: "2 May 2026", paid: 1470, sold: 16, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "Aslı's pick from a trip to Tripoli. Nine left. The till calls it 'Moscho'; the list calls it by its full name, which is the one we keep." },
    { id: "w12", r: "wines", producer: "Çamlıca", name: "Narince", vintage: 2023, origin: "Tokat", style: "white", format: "750ml", list: 240, onHand: 22, par: 16, zone: "cold", shelf: 3, firstBought: "12 Mar 2026", paid: 1760, sold: 61, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "The house white the way Yakut is the house red. Twenty-two on the wall, which is more than we need and exactly what a Thursday looks like." },
    { id: "w13", r: "wines", producer: "Trimbach", name: "Riesling", vintage: 2022, origin: "Alsace", style: "white", format: "750ml", list: 640, onHand: null, par: 4, zone: "cold", shelf: 2, firstBought: "19 Jun 2026", paid: 1280, sold: 6, lastQuote: null, lastCounted: null, books: "MIOT", knowledge: "known",
      memo: "Carried, and off this read. Deniz walked the cold wall on the 2nd and did not mark it. The last till line is 28 August. We do not invent a count." },
    { id: "w14", r: "wines", producer: "Séliar", name: "Skin Contact", vintage: 2022, origin: "Cappadocia", style: "orange", format: "750ml", list: 480, onHand: 5, par: 4, zone: "cold", shelf: 3, firstBought: "7 Jul 2026", paid: 960, sold: 5, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "Five on the cold wall, amber in the glass. Selin wrote: 'tea, apricot skin, a little tannin — we pour it when the table wants a story.' Recalled, not reasoned." },
    { id: "w15", r: "wines", producer: "Billecart-Salmon", name: "Brut Réserve", vintage: null, origin: "Champagne", style: "sparkling", format: "750ml", list: 1450, onHand: 7, par: 6, zone: "cold", shelf: 1, firstBought: "12 Mar 2026", paid: 6300, sold: 9, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "The only sparkling we keep by the bottle. Vintage is the dash: the house did not print a year, and we do not write NV in its place." },
    { id: "w16", r: "wines", producer: "Château Suduiraut", name: "Sauternes", vintage: 2016, origin: "Bordeaux", style: "white", format: "375ml", list: 980, onHand: 2, par: null, zone: "cold", shelf: 3, firstBought: "30 Apr 2026", paid: 1400, sold: 2, lastQuote: null, lastCounted: "2 Sep · Deniz", books: "MIOT", knowledge: "known",
      memo: "Two halves, no par of our own. We open one when a table finishes a meal we are proud of. The next case has not been asked for." },
    { id: "w17", r: "wines", producer: "Ridge", name: "Monte Bello", vintage: 2016, origin: "Santa Cruz Mountains", style: "red", format: "750ml", list: 4200, onHand: null, par: 1, zone: "north", shelf: 1, firstBought: "8 May 2026", paid: 3600, sold: 1, lastQuote: null, lastCounted: null, books: "MIOT", knowledge: "inferred",
      memo: "Carried, off this read. The only note we have is reasoned from the vintage and the mountain — not a fact about this bottle. Deniz has not walked the north rack for it since May." },
    { id: "w18", r: "wines", producer: "Golan Heights", name: "Yarden Cabernet", vintage: 2018, origin: "Golan", style: "red", format: "750ml", list: 760, onHand: null, par: null, zone: null, shelf: null, firstBought: null, paid: null, sold: null, lastQuote: null, lastCounted: null, books: "M", knowledge: "inferred",
      memo: "On the list. Not in the building. The catalogue has a reasoned profile; this house has never been invoiced for it. Presence on a menu is not a cellar row." },

    /* ── beer ──────────────────────────────────────────────────────── */
    { id: "b1", r: "beer", producer: "Anadolu Efes", name: "Efes Pilsen", vintage: null, origin: "Istanbul", style: "pilsner", format: "50l keg", list: 95, onHand: 2, par: 2, zone: "keg", shelf: 1, firstBought: "2 Mar 2026", paid: 9240, sold: 410, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "The keg we never let go dry. Two on the line, par two. Aslı renamed this zone from 'Bar Area — Bar Fridge' on the 3rd. Paid is the whole record across four invoices." },
    { id: "b2", r: "beer", producer: "Bomonti", name: "Filtresiz", vintage: null, origin: "Istanbul", style: "unfiltered lager", format: "50cl", list: 85, onHand: 18, par: 24, zone: "bar", shelf: 2, firstBought: "2 Mar 2026", paid: 2100, sold: 96, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "Under par. The till still sells it faster than the door replaces it. Eighteen in the back bar, twenty-four would do." },
    { id: "b3", r: "beer", producer: "Gara Guzu", name: "IPA", vintage: null, origin: "Muğla", style: "ipa", format: "33cl", list: 110, onHand: 6, par: 8, zone: "bar", shelf: 2, firstBought: "18 Apr 2026", paid: 640, sold: 28, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "The one Anatolian IPA we keep. Six left. Aslı's note: 'pine, not fruit — we pour it with the grilled things.'" },
    { id: "b4", r: "beer", producer: "BrewDog", name: "Punk IPA", vintage: null, origin: "Scotland", style: "ipa", format: "33cl", list: 120, onHand: 12, par: 12, zone: "bar", shelf: 2, firstBought: "18 Apr 2026", paid: 880, sold: 22, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "On its par. We carry it because the room asks for it by the name on the can." },
    { id: "b5", r: "beer", producer: "Guinness", name: "Draught", vintage: null, origin: "Ireland", style: "stout", format: "30l keg", list: 130, onHand: 1, par: 1, zone: "keg", shelf: 1, firstBought: "27 Feb 2026", paid: 1840, sold: 60, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "One keg, par one. First bought in February, before we opened to the room. The line has not been dry." },

    /* ── spirits ───────────────────────────────────────────────────── */
    { id: "s1", r: "spirits", producer: "Yeni Rakı", name: "Yeni Rakı", vintage: null, origin: "Izmir", style: "rakı", format: "70cl", list: 320, onHand: 8, par: 6, zone: "bar", shelf: 1, firstBought: "12 Mar 2026", paid: 4200, sold: 40, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "The bottle the house is for. Eight on the back bar. We do not write a tasting note for rakı we have poured since we were children." },
    { id: "s2", r: "spirits", producer: "Efe", name: "Göbek", vintage: null, origin: "Izmir", style: "rakı", format: "70cl", list: 410, onHand: 3, par: 4, zone: "bar", shelf: 1, firstBought: "12 Mar 2026", paid: 1640, sold: 14, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "The other rakı. Three left, par four. Aslı will seal two more before Friday." },
    { id: "s3", r: "spirits", producer: "Black Forest Distillers", name: "Monkey 47", vintage: null, origin: "Schwarzwald", style: "gin", format: "50cl", list: 890, onHand: 2, par: 2, zone: "bar", shelf: 1, firstBought: "9 May 2026", paid: 1280, sold: 7, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "On its par. Used in two cocktails and poured neat when asked. The recipe book names it; the till names the cocktail." },
    { id: "s4", r: "spirits", producer: "Talisker", name: "10 Year Old", vintage: null, origin: "Isle of Skye", style: "whisky", format: "70cl", list: 720, onHand: 1, par: 2, zone: "bar", shelf: 3, firstBought: "21 Jun 2026", paid: 980, sold: 4, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "One bottle, par two. The whisky register is not on: this house keeps whisky inside spirits, because that is how it answered at onboarding." },
    { id: "s5", r: "spirits", producer: "Montenegro", name: "Amaro Montenegro", vintage: null, origin: "Bologna", style: "amaro", format: "70cl", list: 280, onHand: 4, par: 3, zone: "bar", shelf: 3, firstBought: "9 May 2026", paid: 640, sold: 11, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "Four on the bar, above par. Aslı's after-service glass. The till has it as a pour and as an ingredient." },

    /* ── cocktails (the house can write these) ─────────────────────── */
    { id: "c1", r: "cocktails", producer: null, name: "Yeni Highball", vintage: null, origin: "this house", style: "cocktail", format: "glass", list: 180, onHand: null, par: null, zone: "bar", shelf: null, firstBought: "12 Mar 2026", paid: null, sold: 220, lastQuote: null, lastCounted: null, books: "MT", knowledge: "known",
      memo: "Rakı, soda, a strip of cucumber. Written here on opening night. A cocktail is not a bottle: there is no on-hand, and the recipe is the record. Selin has not taken it off." },
    { id: "c2", r: "cocktails", producer: null, name: "Ayran Sour", vintage: null, origin: "this house", style: "cocktail", format: "glass", list: 160, onHand: null, par: null, zone: "bar", shelf: null, firstBought: "4 Apr 2026", paid: null, sold: 64, lastQuote: null, lastCounted: null, books: "MT", knowledge: "known",
      memo: "Ayran, lemon, a dash of rakı, egg white when the board says so. Aslı wrote it in April. The recipe sits in cocktail_ingredients because a bartender typed it — not because an extractor found it." },
    { id: "c3", r: "cocktails", producer: null, name: "New York Sour", vintage: null, origin: "this house", style: "cocktail", format: "glass", list: 220, onHand: null, par: null, zone: "bar", shelf: null, firstBought: "9 May 2026", paid: null, sold: 31, lastQuote: null, lastCounted: null, books: "MT", knowledge: "known",
      memo: "The Kalecik Karası float on a whisky sour. Written the week Monkey 47 arrived. Thirty-one at the till; the recipe names both bottles." },

    /* ── non-alcoholic ─────────────────────────────────────────────── */
    { id: "n1", r: "non_alcoholic", producer: "this house", name: "Şıra", vintage: null, origin: "Istanbul", style: "must", format: "glass", list: 70, onHand: null, par: null, zone: "bar", shelf: null, firstBought: "12 Mar 2026", paid: null, sold: 48, lastQuote: null, lastCounted: null, books: "MT", knowledge: "known",
      memo: "Pressed grape must, made here. Not a cellar row — a menu line and a till line. Soft drinks are not on this house's registers." },
    { id: "n2", r: "non_alcoholic", producer: "Kombuçe", name: "Kombucha, bergamot", vintage: null, origin: "Kadıköy", style: "kombucha", format: "33cl", list: 90, onHand: 14, par: 12, zone: "bar", shelf: 4, firstBought: "2 May 2026", paid: 420, sold: 37, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "The neighbour's brew. Fourteen in, par twelve. Aslı counts them with the beer." },
    { id: "n3", r: "non_alcoholic", producer: "Kızılay", name: "Sparkling water", vintage: null, origin: "Afyon", style: "water", format: "20cl", list: 40, onHand: 48, par: 36, zone: "bar", shelf: 4, firstBought: "12 Mar 2026", paid: 280, sold: 200, lastQuote: null, lastCounted: "3 Sep · Aslı", books: "MIOT", knowledge: "known",
      memo: "Always. Forty-eight on the bar. The till calls it 'soda'; the list calls it Kızılay, which is the bottle." },
  ];

  function money(n) {
    if (n === null || n === undefined) return EM;
    return "₺" + Number(n).toLocaleString("tr-TR");
  }
  function year(n) {
    if (n === null || n === undefined) return EM;
    return String(n);
  }
  function count(n) {
    if (n === null || n === undefined) return EM;
    return String(n);
  }
  function depth(b) {
    if (b.onHand === null || b.onHand === undefined) return null;
    const cap = b.par && b.par > 0 ? Math.max(b.par, b.onHand) : Math.max(b.onHand, 8);
    return Math.max(0.08, Math.min(1, b.onHand / cap));
  }
  function underPar(b) {
    return b.par != null && b.onHand != null && b.onHand <= b.par;
  }
  function offRead(b) {
    return b.par != null && b.onHand === null && b.books.indexOf("I") >= 0;
  }
  function notInBuilding(b) {
    return b.onHand === null && b.par === null && b.zone === null;
  }
  function inRegister(b, id) {
    return !id || id === "cellar" || b.r === id;
  }
  function zoneOf(id) {
    return ZONES.find(function (z) { return z.id === id; }) || null;
  }
  function booksMarks(s) {
    const keys = [
      ["M", "menu"],
      ["I", "invoice"],
      ["Q", "quote"],
      ["O", "order"],
      ["T", "till"],
    ];
    return keys.map(function (k) {
      return { k: k[0], label: k[1], on: s.indexOf(k[0]) >= 0 };
    });
  }

  const titlesCarried = bottles.filter(function (b) { return b.books.indexOf("I") >= 0 || b.onHand != null; }).length;
  const bottlesOnHand = bottles.reduce(function (n, b) { return n + (typeof b.onHand === "number" ? b.onHand : 0); }, 0);
  const atPar = bottles.filter(underPar).length;
  const off = bottles.filter(offRead).length;

  root.HOUSE = {
    EM: EM,
    name: "Kadıköy Meyhane",
    book: "The Cellar",
    why: "Called the Cellar because this house keeps bottles — wine or spirits are on its registers. The address stays /cellar.",
    registers: REGISTERS,
    zones: ZONES,
    unconfirmed: UNCONFIRMED,
    bottles: bottles,
    tonight: {
      bottlesOnHand: bottlesOnHand,
      titlesCarried: titlesCarried,
      atPar: atPar,
      offRead: off,
    },
    money: money,
    year: year,
    count: count,
    depth: depth,
    underPar: underPar,
    offRead: offRead,
    notInBuilding: notInBuilding,
    inRegister: inRegister,
    zoneOf: zoneOf,
    booksMarks: booksMarks,
  };
})(window);
