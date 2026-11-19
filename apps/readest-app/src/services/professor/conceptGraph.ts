/**
 * The knowledge graph (Learning Engine Wave 'Learn Mode'), minimal per
 * audit Ruling 5 #3: nodes + 1-bit mastery + timestamps + a source
 * back-reference to the book/page. NO proposition graph, no graph DB.
 *
 * A node is the learner's [CONCEPT:name] keyed by its ledger slug; it
 * LINKS books because the key is shared — when two books' ledgers both
 * carry "eigenvalues", one node carries a source from each book. The
 * fresher graded review wins the 1-bit (known = the last-10 graded
 * window ≥ 0.8, via masteryOf); sources union, deduped by book:page.
 *
 * The graph lives on the learner PROFILE (additive, per reader —
 * learnerProfile.ts), not in any book's learner.json: it is the
 * cross-book memory, written opportunistically when the Study tab opens.
 * Everything here is pure for contract tests.
 */
import { masteryOf, UNCATEGORIZED_CONCEPT, type LearnerState } from './learner';
import type { LearnerProfile } from './learnerProfile';

/** Where a concept was met: the book it came from and the page. */
export interface GraphSource {
  /** Book identifier (hash — stable across sessions). */
  book: string;
  /** 1-based page of the most recent logged exchange about it. */
  page?: number;
}

export interface GraphNode {
  /** Ledger slug — the cross-book link key. */
  name: string;
  /** 1-bit mastery: the freshest graded window says known. */
  known: boolean;
  /** ms epoch of the freshest graded review, when any exists. */
  last_review_ts?: number;
  /** Back-references, deduped by book:page, newest first by review. */
  sources: GraphSource[];
}

/** Render tones (StudyTab map): stamp = known, sage = forming,
 *  muted = not yet approached. edge falls out of 1-bit + timestamps —
 *  reviewed but not yet proven. */
export type GraphTone = 'known' | 'edge' | 'unknown';

export function toneOf(node: GraphNode): GraphTone {
  if (node.known) return 'known';
  return node.last_review_ts !== undefined ? 'edge' : 'unknown';
}

export const GRAPH_SOURCES_MAX = 8;

const SKIP_CONCEPTS = new Set([UNCATEGORIZED_CONCEPT, 'chapter_session']);

const sourceKey = (s: GraphSource): string => `${s.book}:${s.page ?? ''}`;

/** Union two source lists: existing order kept, incoming appended when
 *  new, capped — the earliest back-reference drops first. */
function mergeSources(prev: GraphSource[], incoming: GraphSource[]): GraphSource[] {
  const seen = new Set(prev.map(sourceKey));
  const out = [...prev];
  for (const s of incoming) {
    if (seen.has(sourceKey(s))) continue;
    seen.add(sourceKey(s));
    out.push(s);
  }
  return out.slice(-GRAPH_SOURCES_MAX);
}

/** The fresher review wins the 1-bit; on a tie the incoming fold stands
 *  (it is the most recent evidence by construction). */
function mergeNode(prev: GraphNode, incoming: GraphNode): GraphNode {
  const prevTs = prev.last_review_ts ?? 0;
  const incTs = incoming.last_review_ts ?? 0;
  const fresh = incTs >= prevTs ? incoming : prev;
  return {
    name: prev.name,
    known: fresh.known,
    ...(fresh.last_review_ts !== undefined ? { last_review_ts: fresh.last_review_ts } : {}),
    sources: mergeSources(prev.sources, incoming.sources),
  };
}

/**
 * Fold one book's learner state into the graph — the write that links
 * books: a concept both books carry lands on ONE node with two sources.
 * Graded outcomes only feed the bit (masteryOf); asks change nothing.
 */
export function syncBookIntoGraph(
  graph: Record<string, GraphNode>,
  book: string,
  state: LearnerState,
): Record<string, GraphNode> {
  // Last-seen page per concept, from the log's own order (append-only).
  const pageByConcept = new Map<string, number>();
  for (const ex of state.exchanges) {
    if (!SKIP_CONCEPTS.has(ex.concept) && Number.isFinite(ex.page)) {
      pageByConcept.set(ex.concept, ex.page); // later wins
    }
  }

  const out: Record<string, GraphNode> = { ...graph };
  for (const [name, cs] of Object.entries(state.concept_states)) {
    if (SKIP_CONCEPTS.has(name)) continue;
    const lastReviewRaw = cs.card?.last_review_ts;
    const lastReview = Number.isFinite(lastReviewRaw)
      ? lastReviewRaw
      : cs.graded && cs.graded.length > 0
        ? Date.parse(cs.last_ts)
        : undefined;
    const page = pageByConcept.get(name);
    const incoming: GraphNode = {
      name,
      known: masteryOf(cs) === 'known',
      ...(Number.isFinite(lastReview) && lastReview !== undefined
        ? { last_review_ts: lastReview }
        : {}),
      sources: [{ book, ...(page !== undefined ? { page } : {}) }],
    };
    out[name] = out[name] ? mergeNode(out[name]!, incoming) : incoming;
  }
  return out;
}

/**
 * Fold one book's ledger into the profile's graph — the additive,
 * opportunistic write (the Study tab calls this when it opens). Returns
 * the SAME profile object when nothing changed, so callers can skip the
 * save entirely; a new object only when the graph moved.
 */
export function syncProfileGraph(
  profile: LearnerProfile,
  book: string,
  state: LearnerState,
): LearnerProfile {
  const next = syncBookIntoGraph(profile.concept_graph ?? {}, book, state);
  const prevJson = JSON.stringify(profile.concept_graph ?? {});
  if (JSON.stringify(next) === prevJson) return profile;
  return { ...profile, concept_graph: next };
}
