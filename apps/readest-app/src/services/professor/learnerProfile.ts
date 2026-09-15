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

export const LEARNER_PROFILE_PATH = 'professor/learner-profile.json';

export const PROFILE_PACES = ['deliberate', 'steady', 'swift'] as const;
export type ProfilePace = (typeof PROFILE_PACES)[number];

/** Preferred probe depth — how high the disclosure ladder climbs before the
 *  professor releases a full answer (Bloom ceiling 1..6, matching the
 *  concept history's bloom scale in learner.ts). */
export const PROFILE_PROBE_MIN = 1;
export const PROFILE_PROBE_MAX = 6;

export const PROFILE_VOICES = ['formal', 'plain', 'playful'] as const;
export type ProfileVoice = (typeof PROFILE_VOICES)[number];

/** Cap on owned-concept names injected into the prompt line. */
export const PROFILE_OWNED_CONCEPT_MAX = 8;

export interface LearnerProfile {
  pace?: ProfilePace;
  /** Concepts the reader says they already own (slugs, deduped). */
  owned_concepts?: string[];
  probe_level?: number; // 1..6
  voice?: ProfileVoice;
}

export const emptyProfile = (): LearnerProfile => ({});

export const isEmptyProfile = (p: LearnerProfile): boolean =>
  p.pace === undefined &&
  p.owned_concepts === undefined &&
  p.probe_level === undefined &&
  p.voice === undefined;

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
  return out;
}

// ── Persistence (AppService file API, 'Data' base — per reader) ────────────

const toText = (c: string | ArrayBuffer): string =>
  typeof c === 'string' ? c : new TextDecoder().decode(c);

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
 * human; the professor reads preference, the log's Bloom counts remain the
 * release-gate authority (PROFESSOR_SYSTEM_PROMPT's ladder is untouched).
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
    lines.push(`- Probe them up to Bloom ${p.probe_level} before releasing a full answer.`);
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
