/**
 * Learner profile (Workbench 2.x W2.4) — the reader's own account of how
 * they like to learn. One local JSON per reader (app-data dir). Every field
 * is OPTIONAL; an empty profile means "the professor teaches you as he finds
 * you" — the default professor, byte-identical prompts. The profile is a
 * gentle preference only: the evidence in learner.json always outranks it.
 *
 * Prompt use is additive-only: at most 5 short lines at T3 (session state),
 * next to the learner-log summary. It never rewrites
 * PROFESSOR_WORKBENCH_ADDENDUM and never touches the tiered pack (T0–T4).
 */
import environmentConfig from '@/services/environment';
import type { AppService } from '@/types/system';
import { slugifyConcept } from './annotations';
import type { GraphNode } from './conceptGraph';
import { toText } from './io';

export const LEARNER_PROFILE_PATH = 'professor/learner-profile.json';

export const PROFILE_PACES = ['deliberate', 'steady', 'swift'] as const;
export type ProfilePace = (typeof PROFILE_PACES)[number];

/** Preferred probe depth on PROFESSOR-POSED checks — how high the hint
 *  ladder climbs before the professor releases a full answer when the
 *  check was his idea (Bloom ceiling 1..6, matching the concept history's
 *  bloom scale in learner.ts). With the Bloom gates dropped (audit #4)
 *  this IS the release policy for checks; a question the learner asks
 *  outright is always answered immediately, whatever this says. */
export const PROFILE_PROBE_MIN = 1;
export const PROFILE_PROBE_MAX = 6;

export const PROFILE_VOICES = ['formal', 'plain', 'playful'] as const;
export type ProfileVoice = (typeof PROFILE_VOICES)[number];

/** Cap on owned-concept names injected into the prompt line. */
export const PROFILE_OWNED_CONCEPT_MAX = 8;

/** Cap on the stated study goal's length — a destination, not an essay. */
export const PROFILE_GOAL_MAX_CHARS = 80;

/** Cap on knowledge-graph nodes carried in the profile file. */
export const PROFILE_GRAPH_MAX_NODES = 1000;

export interface LearnerProfile {
  pace?: ProfilePace;
  /** Concepts the reader says they already own (slugs, deduped). */
  owned_concepts?: string[];
  probe_level?: number; // 1..6
  voice?: ProfileVoice;
  /** The reader's stated study goal, plain words (Wave 'Learn Mode'):
   *  the PLAN's destination — the route and the practice lane are laid
   *  toward it. A preference, never a gate. */
  study_goal?: string;
  /** The minimal cross-book knowledge graph (Wave 'Learn Mode', audit
   *  Ruling 5 #3): 1-bit mastery + timestamps + book/page sources per
   *  [CONCEPT:name] node, synced from each book's ledger by
   *  conceptGraph.ts. Additive; absent until the first sync. */
  concept_graph?: Record<string, GraphNode>;
}

export const emptyProfile = (): LearnerProfile => ({});

export const isEmptyProfile = (p: LearnerProfile): boolean =>
  p.pace === undefined &&
  p.owned_concepts === undefined &&
  p.probe_level === undefined &&
  p.voice === undefined &&
  p.study_goal === undefined &&
  p.concept_graph === undefined;

/**
 * Tolerant parse — corrupt files degrade to the empty profile, never throw
 * (the loadLearner precedent). Invalid fields are dropped individually; a
 * present-but-empty object normalizes to {} (fields stripped when invalid).
 */
export function normalizeProfile(raw: unknown): LearnerProfile {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: LearnerProfile = {};
  const pace = r['pace'];
  const voice = r['voice'];
  if (PROFILE_PACES.includes(pace as ProfilePace)) out.pace = pace as ProfilePace;
  if (PROFILE_VOICES.includes(voice as ProfileVoice)) out.voice = voice as ProfileVoice;
  const probe = r['probe_level'];
  // Strict typing: strings ('4') and fractions (0.5) degrade to the default
  // rather than coerce — the file is reader-edited and JSON only carries
  // what saveProfile wrote (always an integer).
  if (
    typeof probe === 'number' &&
    Number.isInteger(probe) &&
    probe >= PROFILE_PROBE_MIN &&
    probe <= PROFILE_PROBE_MAX
  )
    out.probe_level = probe;
  const owned = r['owned_concepts'];
  if (Array.isArray(owned)) {
    const slugs = [
      ...new Set(
        owned
          .filter((c): c is string => typeof c === 'string')
          .map((c) => slugifyConcept(c))
          .filter(Boolean),
      ),
    ];
    if (slugs.length > 0) out.owned_concepts = slugs;
  }
  const goal = r['study_goal'];
  if (typeof goal === 'string' && goal.trim().length > 0) {
    const clean = goal.trim().slice(0, PROFILE_GOAL_MAX_CHARS);
    if (clean) out.study_goal = clean;
  }
  const graph = r['concept_graph'];
  if (graph && typeof graph === 'object' && !Array.isArray(graph)) {
    const cleanGraph: Record<string, GraphNode> = {};
    for (const [name, rawNode] of Object.entries(graph).slice(0, PROFILE_GRAPH_MAX_NODES)) {
      if (!rawNode || typeof rawNode !== 'object') continue;
      const n = rawNode as Record<string, unknown>;
      if (typeof n['known'] !== 'boolean') continue; // the 1-bit is mandatory
      const sources = Array.isArray(n['sources'])
        ? n['sources']
            .filter(
              (s): s is Record<string, unknown> =>
                !!s &&
                typeof s === 'object' &&
                typeof (s as Record<string, unknown>)['book'] === 'string',
            )
            .map((s) => {
              const page = s['page'];
              return {
                book: String(s['book']),
                ...(typeof page === 'number' && Number.isFinite(page) ? { page } : {}),
              };
            })
        : [];
      const lastTs = n['last_review_ts'];
      cleanGraph[name] = {
        name: typeof n['name'] === 'string' ? n['name'] : name,
        known: n['known'],
        ...(typeof lastTs === 'number' && Number.isFinite(lastTs)
          ? { last_review_ts: lastTs }
          : {}),
        sources,
      };
    }
    if (Object.keys(cleanGraph).length > 0) out.concept_graph = cleanGraph;
  }
  return out;
}

// ── Persistence (AppService file API, 'Data' base — per reader) ────────────

export async function loadProfile(appService: AppService): Promise<LearnerProfile> {
  try {
    const raw = toText(await appService.readFile(LEARNER_PROFILE_PATH, 'Data', 'text'));
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return {}; // no profile yet — the default professor
  }
}

export async function saveProfile(appService: AppService, profile: LearnerProfile): Promise<void> {
  const clean = normalizeProfile(profile);
  await appService.writeFile(LEARNER_PROFILE_PATH, 'Data', JSON.stringify(clean, null, 2));
}

/** Convenience for UI lanes: acquire the service the loadLearnerSafely way. */
export async function loadProfileCurrent(): Promise<LearnerProfile> {
  try {
    return await loadProfile(await environmentConfig.getAppService());
  } catch {
    return {};
  }
}

// ── Prompt material (additive-only, T3 session state) ─────────────────────

/**
 * The profile as 0–5 prompt lines (3–5 when anything is set — the header
 * plus one line per set field). Empty profile → []. Each line is short and
 * human. probe_level is a stance preference for checks the professor poses
 * (audit #29) — it is not a gate on the learner's own questions.
 */
export function profileLinesForPrompt(profile: LearnerProfile): string[] {
  const p = normalizeProfile(profile);
  if (isEmptyProfile(p)) return [];
  const lines: string[] = [
    "Reader's own account of themselves (their study profile — a gentle preference; the study log outranks it):",
  ];
  if (p.pace === 'deliberate')
    lines.push('- They like a deliberate pace — give ideas room to land before moving on.');
  else if (p.pace === 'steady')
    lines.push('- They keep a steady pace — match it, neither rushed nor lingering.');
  else if (p.pace === 'swift')
    lines.push('- They move swiftly — keep explanations tight and get to the question.');
  if (typeof p.probe_level === 'number')
    lines.push(
      `- On checks you pose, probe them up to Bloom ${p.probe_level} before releasing the full answer — but a question they ask outright is always answered immediately.`,
    );
  if (p.owned_concepts && p.owned_concepts.length > 0)
    lines.push(
      `- They say they already own: ${p.owned_concepts.slice(0, PROFILE_OWNED_CONCEPT_MAX).join(', ')}.`,
    );
  if (p.voice === 'formal') lines.push('- Voice of instruction: formal — precise, no familiarity.');
  else if (p.voice === 'plain')
    lines.push('- Voice of instruction: plain — say it as you would across a desk.');
  else if (p.voice === 'playful')
    lines.push("- Voice of instruction: playful — wit welcome, never at the idea's expense.");
  return lines.slice(0, 5);
}
