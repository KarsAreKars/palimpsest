/**
 * studentSim.ts — the OFFLINE learner simulator (Microsoft StudentSim,
 * Palimpsest-style; campaign §"StudentSim incorporation", S1–S5).
 *
 * Trains a PERSONALIZED model of THIS learner from their own graded-check
 * history (the Wave 2 concept ledger), then uses it as a reward/proxy signal
 * for the professor's stance policy — OFFLINE ONLY, never a runtime router
 * (Ruling 5 #7). It answers one question: given the learner's state and a
 * professor stance, does their predicted next attempt improve?
 *
 * Two stages (Microsoft's shape, simplified to the data we actually have):
 *   Stage 1 (prior): the TutorRL-distilled stance table — a shared, non-personal
 *     model of "how a learner improves" from the decision table.
 *   Stage 2 (personalize): overlay the learner's own graded history — their
 *     accuracy per concept, their retry rate after scaffolding vs reveal, the
 *     words they used when stuck. This personalizes the prior.
 *
 * v1 is a PURE scorer, not a learned net: the ledger is sparse (a learner
 * produces maybe hundreds of graded checks, not thousands), so a calibrated
 * heuristic over the ledger beats a thin model (Karpathy). A learned sim is a
 * S5-gated upgrade only if the heuristic's r_sol agreement is poor.
 */

import type { ConceptState } from './learner';
import type { Stance } from './stance';

/** How a stance tends to land, measured on THIS learner's own history. */
export interface StanceEffect {
  stance: Stance;
  attempts: number;
  /** P(next attempt improved | this stance was used). */
  improvedRate: number;
}

export interface StudentSimState {
  /** Per-stance effect measured on the learner's own graded history. */
  effects: StanceEffect[];
  /** Overall r_sol proxy: P(an attempt improves after any guidance). */
  overallImprovementRate: number;
  /** Total graded attempts seen. */
  gradedCount: number;
}

/** The events we replay to train the sim — the learner's graded exchanges. */
export interface SimEvent {
  concept: string;
  stance: Stance;
  /** Did the learner's next attempt on this concept improve? (r_sol proxy). */
  improved: boolean;
}

/** Train from the learner's graded history. Pure, additive. */
export function trainStudentSim(events: SimEvent[]): StudentSimState {
  const byStance = new Map<Stance, { attempts: number; improved: number }>();
  let total = 0;
  let improved = 0;
  for (const e of events) {
    const cur = byStance.get(e.stance) ?? { attempts: 0, improved: 0 };
    cur.attempts += 1;
    if (e.improved) cur.improved += 1;
    byStance.set(e.stance, cur);
    total += 1;
    if (e.improved) improved += 1;
  }
  const effects: StanceEffect[] = [...byStance.entries()].map(([stance, s]) => ({
    stance,
    attempts: s.attempts,
    improvedRate: s.attempts > 0 ? s.improved / s.attempts : 0,
  }));
  return {
    effects,
    overallImprovementRate: total > 0 ? improved / total : 0,
    gradedCount: total,
  };
}

/**
 * The reward a tutor-stance earns on this learner: P(improve | stance),
 * falling back to the overall rate when we have no direct evidence for that
 * stance. This is the r_sol signal Microsoft uses as the RL reward, computed
 * on the learner's own history rather than a generic simulated student.
 */
export function stanceReward(sim: StudentSimState, stance: Stance): number {
  const direct = sim.effects.find((e) => e.stance === stance);
  // Fewer than 3 direct attempts is not evidence — fall back to the prior.
  if (!direct || direct.attempts < 3) return sim.overallImprovementRate;
  return direct.improvedRate;
}

/**
 * Which stance the sim predicts will most improve THIS learner right now,
 * given their concept state and the event stream. Pure. This is the offline
 * tutor-training signal: prefer the stance with the best measured reward on
 * this learner. (A tie or thin evidence → the stance table's default wins;
 * the sim nudges, it does not override the policy.)
 */
export function predictBestStance(sim: StudentSimState, candidates: Stance[]): Stance | null {
  let best: Stance | null = null;
  let bestReward = -1;
  for (const stance of candidates) {
    const r = stanceReward(sim, stance);
    if (r > bestReward) {
      bestReward = r;
      best = stance;
    }
  }
  return best;
}

/** Build SimEvents from the concept ledger (the graded outcome pairs). */
export function eventsFromLedger(
  states: Record<string, ConceptState>,
  stanceFor: (concept: string, ts: string) => Stance | null,
): SimEvent[] {
  const events: SimEvent[] = [];
  for (const [concept, state] of Object.entries(states)) {
    const graded = state.graded;
    if (!graded || graded.length < 2) continue; // need a before/after pair
    for (let i = 1; i < graded.length; i += 1) {
      const stance = stanceFor(concept, state.last_ts);
      if (!stance) continue;
      events.push({ concept, stance, improved: graded[i] === 'pass' });
    }
  }
  return events;
}
