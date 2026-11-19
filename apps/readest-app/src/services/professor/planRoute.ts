/**
 * The route (Learning Engine Wave 'Learn Mode' — the LearnHarness loop,
 * Palimpsest-style). When the learner names a goal, the plan is the
 * visible thing that makes the engine feel like teaching: an ordered
 * path of concept nodes from current mastery to the goal —
 * [known … edge … unknown … goal].
 *
 * Palimpsest rules kept (audit Ruling 5): measurement is LATENT (#6) —
 * the edge is sensed from the existing graded ledger (learner.ts), never
 * from an upfront quiz; where the log is silent the route simply starts
 * conservatively, at the edge nearest the goal. The route is built from
 * [CONCEPT:name] ledger keys plus cheap TOC/index seeds (King R6), and
 * it is emitted with the EXISTING catalogue tag — no new tags, no graph
 * DB, no proposition graph (#3).
 *
 * The plan ADAPTS: planRoute is pure and cheap, so when a node flips
 * mastery the caller re-routes by calling it again with the fresh
 * ledger. Everything here is pure for contract tests.
 */
import { masteryOf, UNCATEGORIZED_CONCEPT, type ConceptState, type Mastery } from './learner';
import { slugifyConcept } from './annotations';

/** A concept seed from the book's own structure (TOC/index, King R6) —
 *  cheap, ordered the way the book builds. */
export interface RouteSeed {
  /** Plain-words name (label); slugified here to the ledger key. */
  name: string;
  /** 1-based page the seed points at, when the TOC carries one. */
  page?: number;
}

export type RouteRole = 'known' | 'edge' | 'unknown' | 'goal';

export interface RouteNode {
  /** Slug — the ledger/graph key ([CONCEPT:name] spelling may differ on
   *  the desk; the label is what the professor sees). */
  name: string;
  /** Plain words for the professor and the desk. */
  label: string;
  mastery: Mastery;
  role: RouteRole;
  /** Where this node lives in the book (for tap-to-source). */
  sourceRef?: { book?: string; page?: number };
}

export interface StudyRoute {
  /** Slug of the goal (may equal a node's name). */
  goal: string;
  /** The goal as the learner stated it. */
  goalLabel: string;
  /** Ordered known … edge … unknown … goal. */
  nodes: RouteNode[];
}

/** A route longer than this reads as a syllabus, not a path. */
export const ROUTE_MAX_NODES = 12;

const SKIP_CONCEPTS = new Set([UNCATEGORIZED_CONCEPT, 'chapter_session']);

const pretty = (slug: string): string => slug.replace(/_/g, ' ');

// --- MEASURE, latent (Ruling 5 #6) ------------------------------------------

/** The light sense of the edge: the ledger partitioned by graded-outcome
 *  mastery, inferred only from what checks have already happened. This is
 *  the whole measure — no quiz, no gate. Where everything is 'unknown'
 *  the plan starts conservatively (see planRoute). */
export interface EdgeSense {
  known: string[];
  edge: string[];
  unknown: string[];
}

export function senseEdge(conceptStates: Record<string, ConceptState>): EdgeSense {
  const out: EdgeSense = { known: [], edge: [], unknown: [] };
  for (const [name, state] of Object.entries(conceptStates)) {
    if (SKIP_CONCEPTS.has(name)) continue;
    out[masteryOf(state)].push(name);
  }
  return out;
}

// --- PLAN -------------------------------------------------------------------

/**
 * Lay the route from current mastery to the goal. Candidates are the
 * TOC/index seeds (in the book's own order — the TOC is the lesson plan)
 * followed by ledger concepts the seeds missed. Known nodes lead, edge
 * nodes follow, unknowns trail, the goal closes. A goal that names no
 * known candidate is appended as a fresh destination. When the ledger is
 * silent about the learner (nothing graded), every candidate is unknown
 * and the route degenerates to the book's own order toward the goal —
 * the conservative start.
 */
export function planRoute(args: {
  /** The goal as the learner stated it, plain words. */
  goal: string;
  conceptStates: Record<string, ConceptState>;
  seeds?: RouteSeed[];
  /** Book identifier for source references. */
  book?: string;
  /** Last-seen page per concept slug (from the learner log), for
   *  tap-to-source. */
  pages?: Record<string, number>;
}): StudyRoute {
  const { goal, conceptStates, seeds = [], book, pages = {} } = args;
  const goalLabel = goal.trim() || 'the goal';
  const goalSlug = slugifyConcept(goalLabel) || 'the_goal';

  // Candidate slugs, seeds first (the book's order), ledger second.
  const order: string[] = [];
  const seen = new Set<string>();
  const push = (slug: string) => {
    if (!slug || SKIP_CONCEPTS.has(slug) || seen.has(slug)) return;
    seen.add(slug);
    order.push(slug);
  };
  for (const seed of seeds) push(slugifyConcept(seed.name));
  for (const name of Object.keys(conceptStates)) push(name);

  // Build nodes, then stable-partition into known / edge / unknown.
  const built = new Map<string, RouteNode>();
  for (const slug of order) {
    const state = conceptStates[slug];
    const seed = seeds.find((s) => slugifyConcept(s.name) === slug);
    const page = pages[slug] ?? seed?.page;
    built.set(slug, {
      name: slug,
      label: pretty(slug),
      mastery: state ? masteryOf(state) : 'unknown',
      role: state ? masteryOf(state) : 'unknown',
      ...(book !== undefined || page !== undefined
        ? {
            sourceRef: {
              ...(book !== undefined ? { book } : {}),
              ...(page !== undefined ? { page } : {}),
            },
          }
        : {}),
    });
  }

  // The goal: pull an existing candidate into the destination role, else
  // append it as a fresh node.
  if (built.has(goalSlug)) built.get(goalSlug)!.role = 'goal';
  else
    built.set(goalSlug, {
      name: goalSlug,
      label: goalLabel,
      mastery: 'unknown',
      role: 'goal',
      ...(book !== undefined ? { sourceRef: { book } } : {}),
    });

  const byMastery = (m: Mastery): RouteNode[] =>
    order.filter((s) => built.get(s)!.role === m).map((s) => built.get(s)!);
  const body: RouteNode[] = [...byMastery('known'), ...byMastery('edge'), ...byMastery('unknown')];
  const goalNode = built.get(goalSlug)!;

  // Trim over-long bodies without ever dropping the goal: unknowns first
  // (farthest from it), then edge, then known — the spine of what they
  // own survives longest.
  const droppable = (n: RouteNode): boolean => n.role !== 'goal';
  while (body.length + 1 > ROUTE_MAX_NODES) {
    const idx = body.findIndex((n) => droppable(n) && n.role === 'unknown');
    const cut = idx >= 0 ? idx : body.findIndex((n) => droppable(n) && n.role === 'edge');
    const drop = cut >= 0 ? cut : body.findIndex(droppable);
    if (drop < 0) break;
    body.splice(drop, 1);
  }

  return { goal: goalSlug, goalLabel, nodes: [...body, goalNode] };
}

/**
 * The professor's emission for the desk: the EXISTING catalogue tag with
 * the goal filed last — [CONCEPTS known:…; edge:…; unknown:…; goal:…].
 * No new tags; the desk already draws the catalogue as a slip.
 */
export function routeTagLine(route: StudyRoute): string {
  const shelf = (role: RouteRole): string =>
    route.nodes
      .filter((n) => n.role === role)
      .map((n) => n.label)
      .join(', ');
  return `[CONCEPTS known:${shelf('known')}; edge:${shelf('edge')}; unknown:${shelf('unknown')}; goal:${route.goalLabel}]`;
}

/**
 * A couple of in-flow probes for the first exchange on a fresh route:
 * the edge nodes whose answers would most change the plan. The prompt
 * offers them as a woven-in check, never a gate (Ruling 5 #6).
 */
export function probeCandidates(route: StudyRoute, max = 2): string[] {
  const labels = (role: RouteRole): string[] =>
    route.nodes.filter((n) => n.role === role).map((n) => n.label);
  const edge = labels('edge');
  return (edge.length > 0 ? edge : labels('unknown')).slice(0, max);
}
