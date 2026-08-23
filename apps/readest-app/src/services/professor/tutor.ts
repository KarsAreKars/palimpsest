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
import { streamText } from 'ai';
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
  cb: TutorCallbacks;
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
      messages: [{ role: 'user', content: buildProfessorUserMessage(question, pack) }],
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
