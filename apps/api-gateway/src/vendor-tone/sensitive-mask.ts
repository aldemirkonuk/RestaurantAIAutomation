/**
 * "Sensitive topics redacted" (ADR 0207 round 4) — the founder, 2026-09-22,
 * round 6y, on who may switch Jev on: "... they'd accept the jev too with
 * their names and sensitive topics redacted." Names are `pii-mask.ts`'s job;
 * this module is the second half — financial/government identifiers,
 * credentials, and the KVKK/GDPR/CPRA special-category topics a sentence
 * discloses about a PERSON, never a business.
 *
 * TWO PASSES, called from `maskForEgress` (`pii-mask.ts`) so there is no
 * second path a message can leave by:
 *
 *   1. SHAPES, token-level, run BEFORE the phone pass (a valid IBAN or card
 *      number is a run of digits the phone regex would otherwise chew up
 *      first): IBAN (mod-97 valid) and card number (Luhn-valid) -> [account];
 *      TCKN (checksum-valid) and SSN (ddd-dd-dddd) -> [id]; a line labelled
 *      password/şifre/parola/PIN/kod/code/kullanıcı adı/username -> the rest
 *      of that line [credential]. A checksum-invalid run is left for the
 *      phone pass, exactly as today.
 *   2. TOPICS, sentence-level, run LAST (after names and shapes, so a
 *      sentence's own decision does not depend on what a later pass would
 *      still remove from it): a sentence containing a listed term, in any
 *      category, is replaced WHOLE by [private] — the topic is the sentence
 *      ("Mehmet's in hospital so his brother will deliver" is a disclosure
 *      with the name already gone). A sentence is found across a wrapped
 *      line (it ends only at . ! ? … or a blank line), and the line
 *      structure between sentences survives for the passes that read it
 *      (greetings, sign-offs). [Last call, 2026-09-22: this said "cut on the
 *      exact line/sentence boundaries `splitSentences` uses", which let the
 *      unwrapped half of a private sentence leave — see `sentencePiecesOf`.]
 *
 * WHAT IS COVERED (ADR 0207 §B1) — the floor, union of every list that can
 * apply to a house: KVKK Art. 6 (race, ethnic origin, political opinion,
 * philosophical belief, religion/sect, clothing/appearance, association/
 * foundation/union membership, health, sexual life, criminal conviction and
 * security measures, biometric and genetic data) ∪ GDPR Art. 9 ∪ GDPR Art. 10
 * (criminal convictions) ∪ Cal. Civ. Code 1798.140(ae) (citizenship/
 * immigration status, government IDs, account log-in + password — the shapes
 * pass). Prudence, not law: private life (bereavement, divorce, family
 * illness), financial identifiers, government IDs, credentials.
 *
 * WHAT IS NOT REMOVED, ON PURPOSE: company names, products, prices, dates,
 * order numbers, public holidays as dates, product certifications (helal,
 * kosher, organic — they describe goods, not a person), and BUSINESS
 * DISPUTES (a legal threat, late payment, insolvency) — they are about a
 * company, not a person, and are exactly what the escalation facet reads.
 *
 * LANGUAGE, FAIL CLOSED: the term list reads only Turkish and English. A
 * message this pass cannot read cannot have its private topics removed, so
 * `languageCovered` (below) is read BEFORE anything is sent — by `egressFor`
 * (tone-egress.ts, the one way a message becomes a Jev request), and by the
 * sweep and the sheet to count and say why — on the latest part of the
 * message, the part that would leave. This module does not call it itself,
 * so it stays a pure masking function that never decides whether to run.
 *
 * Pure. Total. Tested on its own (`sensitive-mask.spec.ts`).
 */

export const SENSITIVE_TERMS_VERSION = "sensitive-terms/1" as const;

export const SENSITIVE_MASK = {
  account: "[account]",
  id: "[id]",
  credential: "[credential]",
  private: "[private]",
} as const;

export interface SensitiveMaskCounts {
  private: number;
  accounts: number;
  ids: number;
  credentials: number;
}

export interface SensitiveMaskResult {
  text: string;
  counts: SensitiveMaskCounts;
}

// ---------------------------------------------------------------------------
// Shapes — token-level, checksum-validated
// ---------------------------------------------------------------------------

/** A run of letters/digits/spaces that could be an IBAN: 15-34 chars long. */
const IBAN_CANDIDATE = /\b[A-Za-z]{2}[ ]?\d{2}(?:[ ]?[A-Za-z0-9]{1,4}){2,7}\b/g;
/** 13-19 digits, spaces/dashes allowed, that could be a card number. */
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;
const TCKN = /\b\d{11}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDENTIAL_LABEL =
  /^([ \t]*(?:password|şifre|sifre|parola|pin|kod|code|kullanıcı adı|kullanici adi|username)[ \t]*:[ \t]*)(.+)$/imu;

/** IBAN mod-97 check (ISO 7064). */
export function ibanValid(raw: string): boolean {
  const s = raw.replace(/[ ]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let numeric = "";
  for (const ch of rearranged) {
    if (ch >= "0" && ch <= "9") numeric += ch;
    else numeric += (ch.charCodeAt(0) - 55).toString(); // A=10 ... Z=35
  }
  // mod-97 on a big numeral string, computed in chunks (the value can vastly
  // exceed a safe integer for a long IBAN).
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(`${remainder}${numeric.slice(i, i + 7)}`) % 97;
  }
  return remainder === 1;
}

/** Luhn checksum. */
export function luhnValid(raw: string): boolean {
  const digits = raw.replace(/[ -]/g, "");
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Turkish national id (TCKN) checksum. */
export function tcknValid(raw: string): boolean {
  if (!/^\d{11}$/.test(raw)) return false;
  const d = [...raw].map(Number);
  if (d[0] === 0) return false;
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  const d10 = (oddSum * 7 - evenSum) % 10;
  if (((d10 % 10) + 10) % 10 !== d[9]) return false;
  const sumFirst10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return sumFirst10 % 10 === d[10];
}

/**
 * `IBAN_CANDIDATE` is deliberately greedy (an IBAN's grouped segments can be
 * letters as well as digits, e.g. GB's "NWBK"), so it happily sweeps ordinary
 * following words into the match too ("...0130 00 or card" — "or" and
 * "card" both satisfy the group's `[A-Za-z0-9]{1,4}`). Rather than trying to
 * out-guess IBAN grammar with a stricter regex, this takes the LONGEST
 * checksum-valid PREFIX of the greedy match, cut only at its own space
 * boundaries — so a real IBAN followed by prose is masked correctly and the
 * prose after it is left exactly as it was.
 */
function longestValidIbanPrefix(candidate: string): string | null {
  const tokens = candidate.split(/(\s+)/);
  for (let end = tokens.length - 1; end >= 0; end -= 2) {
    const prefix = tokens.slice(0, end + 1).join("");
    if (ibanValid(prefix)) return prefix;
  }
  return null;
}

function maskShapesInLine(line: string): { text: string; counts: SensitiveMaskCounts } {
  const counts: SensitiveMaskCounts = {
    private: 0,
    accounts: 0,
    ids: 0,
    credentials: 0,
  };

  // Credential label lines are handled whole, first: the rest of the line
  // goes regardless of what shape it is, so a label carrying an IBAN-shaped
  // password does not get a different mask than a label carrying a word.
  const credMatch = CREDENTIAL_LABEL.exec(line);
  CREDENTIAL_LABEL.lastIndex = 0;
  if (credMatch) {
    counts.credentials += 1;
    return { text: `${credMatch[1]}${SENSITIVE_MASK.credential}`, counts };
  }

  let out = line.replace(IBAN_CANDIDATE, (m) => {
    const valid = longestValidIbanPrefix(m);
    if (!valid) return m;
    counts.accounts += 1;
    return SENSITIVE_MASK.account + m.slice(valid.length);
  });
  out = out.replace(CARD_CANDIDATE, (m) => {
    if (!luhnValid(m)) return m;
    counts.accounts += 1;
    return SENSITIVE_MASK.account;
  });
  out = out.replace(SSN, (m) => {
    counts.ids += 1;
    return SENSITIVE_MASK.id;
  });
  out = out.replace(TCKN, (m) => {
    if (!tcknValid(m)) return m;
    counts.ids += 1;
    return SENSITIVE_MASK.id;
  });
  return { text: out, counts };
}

// ---------------------------------------------------------------------------
// Topics — sentence-level
// ---------------------------------------------------------------------------

/**
 * Stems matched at a word start, Turkish suffixes allowed
 * (`(?<!\p{L})stem\p{L}*`), never a bare ambiguous word. Grouped by the
 * statute category it answers, purely for readers of this file — the mask
 * treats every hit alike.
 */
const TOPIC_TERMS: readonly string[] = [
  // Race / ethnic origin
  "ırkç", "irkc", "racis", "ethnicit", "etnik köken", "etnik koken",
  // Political opinion / party
  "siyasi görüş", "siyasi gorus", "political opinion", "political party",
  "parti üyesi", "parti uyesi", "milletvekili aday",
  // Philosophical belief
  "felsefi görüş", "felsefi gorus", "philosophical belief",
  // Religion / sect
  "dini inanç", "dini inanc", "mezhep", "religious belief", "religion",
  // Association / union membership
  "sendika üyesi", "sendika uyesi", "trade union", "labor union",
  "labour union", "on strike", "grevde",
  // Health
  "hastane", "hastalık", "hastalik", "ameliyat", "kanser", "tedavi görüyor",
  "tedavi goruyor", "hospital", "surgery", "diagnosed with", "cancer",
  "rehabilitation", "psikiyatr", "psychiatr",
  // [Last call, 2026-09-22: the plainest words for being ill were missing —
  // "hasta" (sick, and the stem of hastane/hastalık), "doktor"/"doctor", being
  // off sick, pregnancy and maternity leave. "sick" is phrase-level only:
  // "we are sick of these delays" is a business complaint the escalation
  // facet reads, not a health disclosure.]
  "hasta", "doktor", "doctor", "off sick", "out sick", "called in sick",
  "sick leave", "sickness", "pregnan", "hamile", "maternity leave",
  "doğum izn", "dogum izn", "miscarriage",
  // Sexual life / sexual orientation
  "cinsel yönelim", "cinsel yonelim", "sexual orientation", "sexual life",
  // Criminal conviction / security measures
  "sabıka", "sabika", "hüküm giy", "hukum giy", "tutukland", "criminal record",
  "convicted", "arrested", "prosecution",
  // Biometric / genetic
  "parmak izi", "biyometrik", "genetik test", "biometric data", "genetic test",
  "dna test",
  // CPRA: citizenship / immigration status, precise geolocation
  "vatandaşlık statüs", "vatandaslik status", "immigration status",
  "residency permit", "oturma izni", "sığınmacı", "siginmaci", "refugee",
  // Private life: bereavement, divorce, family illness
  "vefat", "cenaze", "başsağlığı", "baş sağlığı", "bassagligi", "bas sagligi",
  "bereavement", "funeral", "condolence", "passed away", "hayatını kaybet",
  "hayatini kaybet", "boşan", "bosan", "divorce", "divorcing",
  "ailesinde hastalık", "ailesinde hastalik", "family illness",
  // Credentials written in a sentence rather than on a labelled line (the
  // shapes pass reads only "password: …"): "the portal password is X".
  "password", "passcode", "şifre", "sifre", "parola",
];

const TOPIC_RE = new RegExp(
  `(?<!\\p{L})(?:${TOPIC_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\p{L}*`,
  "iu",
);

function isPrivateSentence(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length === 0) return false;
  // ASCII-folded form too (oruç / oruc), so a diacritic-stripped mail still
  // matches a Turkish stem written without its dotted/undotted letters.
  const folded = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I");
  return TOPIC_RE.test(s) || TOPIC_RE.test(folded);
}

/**
 * Split a PARAGRAPH into sentence pieces: a sentence ends at . ! ? … followed
 * by whitespace, and a line break with no end mark before it does NOT end one.
 * The whitespace between pieces is kept, so a paragraph's own shape survives a
 * mask that changes nothing in it.
 *
 * [Last call, 2026-09-22: this cut per LINE, on `splitSentences`' boundaries.
 * Plain-text mail wraps a long sentence across lines, so only the line holding
 * the listed term was replaced and the rest of the sentence left —
 * "…our owner's mother passed away and he is at the" / "funeral today." sent
 * its first half. The topic is the sentence, so the sentence is found across
 * the wrap. The cost is named: a greeting line with no end mark ("Hi,") joins
 * the sentence under it and goes with it when that sentence is private.]
 */
function sentencePiecesOf(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?…])(\s+)/);
}

function maskTopicsInParagraph(paragraph: string): { text: string; n: number } {
  let n = 0;
  const pieces = sentencePiecesOf(paragraph).map((piece) => {
    if (/^\s*$/.test(piece)) return piece;
    // A wrapped sentence is read as one line, so a phrase term broken by the
    // wrap ("diagnosed" / "with cancer") still matches.
    if (isPrivateSentence(piece.replace(/\s+/g, " "))) {
      n += 1;
      return SENSITIVE_MASK.private;
    }
    return piece;
  });
  return { text: pieces.join(""), n };
}

// ---------------------------------------------------------------------------
// Language gate — read by egressFor, the sweep and the sheet, not called here
// ---------------------------------------------------------------------------

/**
 * Words that mark a text as English or Turkish and are NOT also ordinary
 * words of the other languages a wine house's mail arrives in (Italian,
 * French, Spanish, German, Portuguese): so no "in", "no", "so", "am", "an",
 * "on", "de", "da", "ok". Turkish words are kept ASCII-folded (ı -> i, marks
 * stripped), the form `languageCovered` compares.
 */
const EN_STOPWORDS = new Set([
  "the", "and", "you", "for", "was", "are", "have", "this", "that", "with",
  "your", "will", "please", "thanks", "order", "delivery",
  "we", "our", "is", "it", "to", "of", "be", "not", "would", "thank", "hello",
  "hi", "dear", "regards", "noted", "received", "confirmed", "shipped",
  "delivered", "done", "yes", "sure", "great", "perfect", "today", "tomorrow",
]);
const TR_STOPWORDS = new Set([
  "ve", "bir", "bu", "icin", "tesekkur", "tesekkurler", "siparis", "teslimat",
  "merhaba", "degil", "lutfen", "tamam", "evet", "hayir", "olur", "yarin",
  "bugun", "iyi", "gunler", "calismalar", "saygilarimizla", "saygilarimla",
  "rica", "ederiz", "ederim", "ile", "gonderildi", "yok",
]);

/**
 * Is this text recognisably Turkish or English, so that `TOPIC_TERMS` had a
 * chance to read it? A coarse word test — no language-detection library, no
 * new subprocessor.
 *
 * FAIL CLOSED (ADR 0207 choice 30). A text with no marker word at all is not
 * covered, however short; a longer one needs at least 3% of its words to be
 * markers. Callers pass the part that would actually LEAVE (the latest part,
 * `tone-scale.ts` `latestPart`), never the whole thread.
 *
 * [Last call, 2026-09-22: this read "too short to call unreadable" for any
 * text under eight words and returned covered — "Marco è in ospedale,
 * consegna domani." was sent with its health sentence — and the sweep and the
 * sheet passed the RAW message, so an Italian reply above an English quoted
 * thread passed on the thread's words and its Italian latest part was sent.
 * The cost of failing closed is named: a bare "Ok." is no longer scored.]
 */
export function languageCovered(text: string): boolean {
  const words = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 2);
  // No word at all (digits and symbols only): there is no sentence a topic
  // could be written in.
  if (words.length === 0) return true;
  let hits = 0;
  for (const w of words) {
    if (EN_STOPWORDS.has(w) || TR_STOPWORDS.has(w)) hits += 1;
  }
  if (hits === 0) return false;
  return hits / words.length >= 0.03;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The shapes pass alone: IBAN, card, TCKN/SSN, credential lines. Called from
 * `maskForEgress` BEFORE the phone pass — a valid IBAN or card number is a
 * run of digits the phone regex would otherwise chew up first (and mask as
 * `[phone]`, which is not wrong exactly, but hides the shapes count and lets
 * a Luhn/mod-97 check that would have refused a false positive never run).
 */
export function maskSensitiveShapes(text: string): {
  text: string;
  counts: Pick<SensitiveMaskCounts, "accounts" | "ids" | "credentials">;
} {
  const source = typeof text === "string" ? text : "";
  const counts = { accounts: 0, ids: 0, credentials: 0 };
  const lines = source.split("\n").map((line) => {
    const shaped = maskShapesInLine(line);
    counts.accounts += shaped.counts.accounts;
    counts.ids += shaped.counts.ids;
    counts.credentials += shaped.counts.credentials;
    return shaped.text;
  });
  return { text: lines.join("\n"), counts };
}

/**
 * The topics pass alone: a sentence carrying a listed term is replaced whole.
 * Called from `maskForEgress` LAST — after names and shapes, so this
 * decision is never second-guessed by a later pass, and a `[name]`/
 * `[account]`/`[id]`/`[credential]` token a caller already applied is inert
 * text here (none of `TOPIC_TERMS` matches a mask token).
 */
export function maskSensitiveTopics(text: string): {
  text: string;
  counts: Pick<SensitiveMaskCounts, "private">;
} {
  const source = typeof text === "string" ? text : "";
  let n = 0;
  // Paragraphs are separated by a blank line; the separators are kept as
  // they were (odd indices of the split), so line structure outside a masked
  // sentence is untouched.
  const parts = source.split(/(\n[ \t]*\n(?:[ \t]*\n)*)/).map((part, i) => {
    if (i % 2 === 1) return part;
    const r = maskTopicsInParagraph(part);
    n += r.n;
    return r.text;
  });
  return { text: parts.join(""), counts: { private: n } };
}

/**
 * Both passes, in the order `maskForEgress` runs them (shapes, then topics),
 * with nothing else between them. A convenience for tests and for any future
 * caller that has no phone/name pass of its own to run in between — the real
 * egress pipeline calls the two functions above directly, with the phone and
 * name passes between them.
 */
export function maskSensitive(text: string): SensitiveMaskResult {
  const shapes = maskSensitiveShapes(text);
  const topics = maskSensitiveTopics(shapes.text);
  return {
    text: topics.text,
    counts: { ...shapes.counts, private: topics.counts.private },
  };
}
