import { CLASS_PRIORS, ClassPrior } from './taste-priors';

/**
 * Read a recipe line's label as one class prior, or as nothing. Unknown stays
 * unknown: a label that fits two classes with no clear winner, or that names a
 * prepared dish ("tomato soup", "ice cream"), is NOT guessed.
 */
const STAY = new Set(['bitters', 'molasses', 'hummus', 'couscous', 'swiss', 'asparagus', 'citrus', 'cress', 'watercress', 'grass', 'brussels', 'harissa']);
const SYNONYM: ReadonlyArray<[RegExp, string]> = [
  [/\bwhisky\b/g, 'whiskey'], [/\byog(h)?o?urt\b/g, 'yogurt'], [/\bparmigiano\b/g, 'parmesan'],
  [/\bcapsicum\b/g, 'bell pepper'], [/\b(green onion|spring onion)\b/g, 'scallion'], [/\brocket\b/g, 'arugula'],
  [/\b(courgette)\b/g, 'zucchini'], [/\b(prawn)\b/g, 'shrimp'], [/\b(sugar|caster|icing) syrup\b/g, 'simple syrup'],
];
/** A prepared dish is not its main word. */
const PREPARED = /\b(soup|stew|salad|dressing|sandwich|pie|cake|cookie|biscuit|ice cream|gelato|sorbet|jam|marmalade|pudding|custard|batter|chocolate|sauce mix|mix|blend|cordial|curd|zest|peel|rind|yolk|cube|powder)\b/;

const singular = (w: string): string => {
  if (STAY.has(w) || w.length < 4) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(oes|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w) || !w.endsWith('s')) return w;
  return w.slice(0, -1);
};

export function normaliseLabel(raw: string): string {
  let s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(singular).join(' ');
  for (const [re, to] of SYNONYM) s = s.replace(re, to);
  return s;
}

export function findClass(label: string): ClassPrior | undefined {
  const n = normaliseLabel(label);
  if (!n || PREPARED.test(n)) return undefined;
  const hits = CLASS_PRIORS.filter((c) => c.match.test(n) && !(c.not && c.not.test(n)));
  if (hits.length <= 1) return hits[0];
  const tight = hits.filter((c) => c.tight);
  return tight.length === 1 ? tight[0] : undefined;
}
