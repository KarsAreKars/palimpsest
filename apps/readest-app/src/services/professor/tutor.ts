/**
 * The Tutor seam (master plan §2.2) — one async call, streamed tokens out.
 *
 * Two lanes:
 *   - Configured provider (Ollama / AI Gateway / OpenRouter via the existing
 *     AI plumbing, which already handles Tauri-vs-web transport) → real
 *     professor answers via Vercel AI SDK streamText.
 *   - No provider configured → the offline Echo tutor: deterministic keyword
 *     retrieval over the page excerpt. It never pretends to understand —
 *     it points at the passage the question touches and says what it is.
 *     This keeps the whole loop (PTT → context pack → streaming answer)
 *     exercisable with zero keys, in dev and in CI.
 */
import { streamText, generateText } from 'ai';
import type { AISettings } from '@/services/ai/types';
import { getAIProvider } from '@/services/ai/providers';
import type { ProfessorContextPack } from './contextPack';
import { PROFESSOR_SYSTEM_PROMPT, buildProfessorUserMessage } from './prompt';

export interface TutorCallbacks {
  onToken(token: string): void;
  onDone(fullText: string, meta: { echo: boolean }): void;
  onError(message: string): void;
}

export interface TutorRequest {
  question: string;
  pack: ProfessorContextPack;
  /** When absent or disabled, the echo tutor answers instead. */
  aiSettings?: AISettings | null;
  signal?: AbortSignal;
  /** A8: rendered images of the visible page(s) — PNG data URLs. Evidence
   *  for figures/diagrams/rendered math; annotations still use block ids. */
  images?: string[];
  cb: TutorCallbacks;
}

/** User-message content: plain text, or text + image parts when the Prof
 *  has eyes on the page (A8). Exported for tests. */
export function buildUserContent(
  question: string,
  pack: ProfessorContextPack,
  images?: string[],
): string | Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> {
  const text = buildProfessorUserMessage(question, pack);
  if (!images?.length) return text;
  return [{ type: 'text', text }, ...images.map((url) => ({ type: 'image' as const, image: url }))];
}

const STOPWORDS = new Set([
  'this',
  'that',
  'these',
  'those',
  'there',
  'their',
  'about',
  'would',
  'could',
  'should',
  'what',
  'why',
  'how',
  'when',
  'where',
  'which',
  'does',
  'do',
  'is',
  'are',
  'was',
  'were',
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
  'with',
  'mean',
  'means',
  'meant',
  'explain',
  'tell',
  'wait',
]);

function questionKeywords(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

/** Deterministic offline double: retrieval, not understanding — and says so. */
export function buildEchoAnswer(question: string, pack: ProfessorContextPack): string {
  const keywords = questionKeywords(question);
  const sentences = splitSentences(pack.excerpt);
  const scored = sentences
    .map((s) => {
      const lower = s.toLowerCase();
      const hits = keywords.filter((k) => lower.includes(k)).length;
      return { s, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2);

  const page = pack.position.page ?? '?';
  const note =
    'I am the offline echo tutor — connect an AI provider in Settings and I will actually explain this.';
  if (scored.length === 0) {
    return (
      `You are on page ${page}. None of the sentences on this page obviously match your ` +
      `question, so I would rather not guess. ${note}`
    );
  }
  const quoted = scored.map((x) => `"${x.s}"`).join(' And then: ');
  return (
    `You are on page ${page}. The passage your question touches says: ${quoted} ` +
    `Read those two lines once more — that is where the answer lives. ${note}`
  );
}

async function streamEcho(answer: string, cb: TutorCallbacks): Promise<void> {
  // Chunk by word so the overlay exercises the same streaming path as a real
  // provider (and the demo can watch text grow).
  const words = answer.split(' ');
  let full = '';
  for (const word of words) {
    const token = (full ? ' ' : '') + word;
    full += token;
    cb.onToken(token);
    await new Promise((r) => setTimeout(r, 12));
  }
  cb.onDone(full, { echo: true });
}

export async function askProfessor(req: TutorRequest): Promise<void> {
  const { question, pack, aiSettings, signal, cb } = req;

  if (!aiSettings?.enabled) {
    await streamEcho(buildEchoAnswer(question, pack), cb);
    return;
  }

  let model;
  try {
    model = getAIProvider(aiSettings).getModel();
  } catch (e) {
    cb.onError(
      `Tutor provider is not configured: ${e instanceof Error ? e.message : String(e)}. ` +
        'Add an API key in Settings → AI, or disable AI to use the echo tutor.',
    );
    return;
  }

  try {
    const result = streamText({
      model,
      system: PROFESSOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(question, pack, req.images) }],
      abortSignal: signal,
    });
    let full = '';
    for await (const chunk of result.textStream) {
      full += chunk;
      cb.onToken(chunk);
    }
    cb.onDone(full, { echo: false });
  } catch (e) {
    if (signal?.aborted) return; // user closed the overlay mid-answer
    cb.onError(e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// Notebook distillation (HP-4, plan §7) — exchange → study note in notes.md
// ---------------------------------------------------------------------------

export interface DistillRequest {
  question: string;
  /** The professor's stripped answer (no DSL tags). */
  answer: string;
  page: number;
  concept: string; // slug
  /** Pre-formatted short date, e.g. "Aug 23". */
  date: string;
  aiSettings?: AISettings | null;
  signal?: AbortSignal;
}

const DISTILL_SYSTEM = `You turn a tutoring exchange into one study note, written as the reader's OWN notes — first person, plain sentences, the way a good student writes things down for future-them.

Humanizer rules (hard): no AI-isms. No "delve", no "furthermore", no "it's not just X, it's Y", no "in summary", no rule-of-three padding, no hedging chains, no em-dash habit, no bullet-point lecture voice. Short plain sentences. If the reader's question contained a wrong assumption, name it as "my wrong turn" — that is the most valuable part of the note.

Output ONLY the note, exactly this shape:
### p.{page} — {short title, lowercase} (hey-prof, {date})
**Q:** {the question, lightly trimmed}
**The idea:** {the explanation in 1-3 plain sentences, first person where natural}
**My wrong turn:** {the misconception, or omit this line entirely if there was none}
**Worth remembering:** {the one sentence to reread before an exam}`;

/**
 * Distill one exchange into a notes.md entry. Returns null when AI is
 * disabled or the call fails — a missing note beats a fake one; the
 * exchange is still in learner.json either way.
 */
export async function distillNote(req: DistillRequest): Promise<string | null> {
  const { question, answer, page, concept, date, aiSettings, signal } = req;
  if (!aiSettings?.enabled) return null;
  let model;
  try {
    model = getAIProvider(aiSettings).getModel();
  } catch {
    return null;
  }
  try {
    const { text } = await generateText({
      model,
      system: DISTILL_SYSTEM,
      prompt:
        `Page: ${page}\nConcept: ${concept.replace(/_/g, ' ')}\nDate: ${date}\n\n` +
        `The reader asked: ${question}\n\nYou (the professor) answered: ${answer}`,
      abortSignal: signal,
    });
    const note = text.trim();
    // Sanity: refuse output that lost the required skeleton.
    return note.startsWith('###') && note.includes('**Q:**') ? note : null;
  } catch {
    return null;
  }
}
