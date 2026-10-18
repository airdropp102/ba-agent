/**
 * Stable digests shared by clarification flows.
 * - canonical(): key-order independent JSON.
 * - analysisSignature(): hashes only the semantic part of the analysis, so resolving
 *   question A (status change) or recomputing `quality` does not invalidate the
 *   proposals of question B.
 * - briefUnchangedSince(): the brief is append-only; a decision stays valid when the
 *   text it was approved against is still an exact prefix of the current brief.
 */
import {fingerprint} from './revisions.js';

const sortDeep = v => Array.isArray(v)
  ? v.map(sortDeep)
  : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]))
    : v;
export const canonical = v => JSON.stringify(sortDeep(v));

export const analysisCore = analysis => {
  if (!analysis || typeof analysis !== 'object') return analysis ?? null;
  const {quality, clarificationQuestions, ...rest} = analysis;
  return {
    ...rest,
    questions: (clarificationQuestions || []).map(q => ({
      id: q.id, question: q.question, impact: q.impact,
      origin: q.origin || '', relatedRequirementId: q.relatedRequirementId || '',
    })),
  };
};

export const analysisSignature = p => fingerprint(canonical({brief: p.brief, analysis: analysisCore(p.analysis)}));
// Format used before this patch; still accepted so existing proposals are not wiped on deploy.
export const legacyAnalysisSignature = p => fingerprint(JSON.stringify({brief: p.brief, analysis: p.analysis}));

/** `memo` lets a batch hash the project once instead of once per entry. */
export function analysisDigestMatches(digest, p, memo = {}) {
  memo.sig ??= analysisSignature(p);
  if (digest === memo.sig) return true;
  memo.legacy ??= legacyAnalysisSignature(p);
  return digest === memo.legacy;
}

export function briefUnchangedSince(row, brief, cache) {
  const text = String(brief ?? '');
  if (!Number.isInteger(row?.briefLength)) return fingerprint(text) === row?.briefDigest; // pre-patch rows
  if (row.briefLength > text.length) return false;
  let digest = cache?.get(row.briefLength);
  if (digest === undefined) {
    digest = fingerprint(row.briefLength === text.length ? text : text.slice(0, row.briefLength));
    cache?.set(row.briefLength, digest);
  }
  return digest === row.briefDigest;
}