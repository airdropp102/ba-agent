/**
 * Deterministic evidence gate. The model may label an item `confirmed`, but only
 * code decides whether its sourceEvidence quote really exists in a project source.
 * A failed check downgrades the item to `assumption`; it never upgrades anything.
 */
export const normalizeQuote = s => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

export const MIN_QUOTE_LENGTH = 12;

export function verifyEvidence(analysis, sources, {minLen = MIN_QUOTE_LENGTH} = {}) {
  const corpus = (sources || []).map(s => ({id: s.id, text: normalizeQuote(s.text)}));
  const downgraded = [];

  const check = (item, kind) => {
    if (!item || typeof item !== 'object' || item.certainty !== 'confirmed') return item;
    const quote = normalizeQuote(item.sourceEvidence);
    const hit = quote.length >= minLen ? corpus.find(s => s.text.includes(quote)) : null;
    if (hit) return {...item, evidenceSourceId: hit.id};
    downgraded.push({
      kind, id: item.id ?? null,
      reason: quote.length < minLen ? 'QUOTE_TOO_SHORT_OR_EMPTY' : 'QUOTE_NOT_FOUND',
    });
    return {...item, certainty: 'assumption', sourceEvidence: '', evidenceSourceId: null, downgradedFrom: 'confirmed'};
  };

  return {
    downgraded,
    analysis: {
      ...analysis,
      functionalRequirements: (analysis.functionalRequirements || []).map(x => check(x, 'FR')),
      nonFunctionalRequirements: (analysis.nonFunctionalRequirements || []).map(x => check(x, 'NFR')),
      businessRules: (analysis.businessRules || []).map(x => check(x, 'BR')),
    },
  };
}