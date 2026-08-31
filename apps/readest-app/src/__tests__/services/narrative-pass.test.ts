/**
 * Narrative-pass contract tests (NARRATIVE_PASS_PLAN §6).
 *
 * Exact before/after string pairs per rule, plus the golden strings
 * observed in the user's own books (🔬 Almanack header). The ears drive
 * the backlog: every wince becomes a pinned pair here.
 */
import { describe, it, expect } from 'vitest';
import { doctorSpeakText, applyNarrativePass } from '@/services/narration/narrative';
import type { NarrationUnit } from '@/services/narration';

describe('doctorSpeakText', () => {
  it('Class 1: collapses letter-spaced runs into words', () => {
    expect(doctorSpeakText('l e t t e r by l e t t e r')).toBe('letter by letter');
    expect(doctorSpeakText('C H A P T E R one')).toBe('CHAPTER one');
  });

  it('Class 1: leaves normal single-letter words alone', () => {
    expect(doctorSpeakText('I am a reader')).toBe('I am a reader');
    expect(doctorSpeakText('a or b')).toBe('a or b');
  });

  it('Class 1b: rejoins drop caps at string start', () => {
    expect(doctorSpeakText('T. he morning began quietly')).toBe('The morning began quietly');
    expect(doctorSpeakText('W. hen in doubt')).toBe('When in doubt');
  });

  it('Class 2: de-hyphenates line-break artifacts', () => {
    expect(doctorSpeakText('deci- sion')).toBe('decision');
    expect(doctorSpeakText('under- standing the prob- lem')).toBe('understanding the problem');
  });

  it('Class 2: keeps true compound prefixes', () => {
    expect(doctorSpeakText('self- taught')).toBe('self-taught');
    expect(doctorSpeakText('well- known')).toBe('well-known');
    expect(doctorSpeakText('well-known')).toBe('well-known'); // closed form untouched
  });

  it('Class 5: expands symbols and abbreviations', () => {
    expect(doctorSpeakText('see Fig. 3')).toBe('see Figure 3');
    expect(doctorSpeakText('e.g. this')).toBe('for example this');
    expect(doctorSpeakText('i.e. that')).toBe('that is that');
    expect(doctorSpeakText('rock & roll')).toBe('rock and roll');
    expect(doctorSpeakText('50% of the time')).toBe('50 percent of the time');
    expect(doctorSpeakText('x ≤ y')).toBe('x less than or equal to y');
    expect(doctorSpeakText('~50 pages')).toBe('about 50 pages');
  });

  it('Class 5: compresses URLs to their domain', () => {
    expect(doctorSpeakText('visit https://www.example.com/very/long/path?q=1')).toBe(
      'visit example dot com',
    );
  });

  it('unwraps strikethrough markup before the tilde rule (🔬 Lean Learning)', () => {
    // Real front-matter artifact: a struck-through list of wrong approaches.
    expect(doctorSpeakText('~~1. LEARN EVERYTHING~~')).toBe('1. LEARN EVERYTHING');
    expect(doctorSpeakText('~~1. LEARN EVERYTHING~~ ~~2. GIVE UP~~')).toBe(
      '1. LEARN EVERYTHING 2. GIVE UP',
    );
    // …while a genuine approximate number still expands.
    expect(doctorSpeakText('~50 pages')).toBe('about 50 pages');
  });

  it('collapses leftover double spaces', () => {
    expect(doctorSpeakText('rock  &  roll')).toBe('rock and roll');
  });
});

const unit = (
  n: number,
  page: number | null,
  speak: string | undefined,
  start: number,
  end: number,
  kind: NarrationUnit['kind'] = 'prose',
): NarrationUnit => ({
  unit: n,
  md_start: start,
  md_end: end,
  page,
  kind,
  ...(speak ? { speak } : {}),
});

describe('applyNarrativePass', () => {
  it('Class 3: drops lone page numbers and ornament lines', () => {
    const out = applyNarrativePass([
      unit(0, 1, '157', 0, 3),
      unit(1, 1, 'Actual prose here.', 4, 22),
      unit(2, 1, '·', 23, 24),
    ]);
    expect(out[0]!.speak).toBeUndefined();
    expect(out[1]!.speak).toBe('Actual prose here.');
    expect(out[2]!.speak).toBeUndefined();
    // Spans and pages survive the silencing (click-to-speak alignment).
    expect(out[0]).toMatchObject({ md_start: 0, md_end: 3, page: 1 });
  });

  it('Class 3: drops running heads repeated across ≥3 page edges (🔬 Almanack)', () => {
    // 🔬 golden string from the user's Almanack session.
    const head = 'SAVING YOURSELF · 157';
    const units: NarrationUnit[] = [];
    for (let p = 1; p <= 4; p++) {
      units.push(unit(units.length, p, p === 4 ? head : 'SAVING YOURSELF', p * 100, p * 100 + 20));
      units.push(
        unit(
          units.length,
          p,
          `Real body text of page ${p}, different each time.`,
          p * 100 + 21,
          p * 100 + 60,
        ),
      );
    }
    const out = applyNarrativePass(units);
    // 'SAVING YOURSELF' appears at 3 page edges → running head → silenced.
    expect(out[0]!.speak).toBeUndefined();
    expect(out[2]!.speak).toBeUndefined();
    expect(out[4]!.speak).toBeUndefined();
    // The variant with the page number is short furniture on its own? It
    // appears once — kept (deterministic rule: only ≥3 repeats are heads).
    expect(out[6]!.speak).toBe('SAVING YOURSELF · 157');
    // Body text never touched.
    expect(out[1]!.speak).toBe('Real body text of page 1, different each time.');
  });

  it('prosody: headings get long beats, prose gets paragraph pauses on md gaps', () => {
    const out = applyNarrativePass([
      unit(0, 1, 'Chapter One', 0, 11, 'heading'),
      unit(1, 1, 'First sentence.', 20, 35),
      unit(2, 1, 'Second sentence.', 36, 52), // contiguous: no paragraph pause
      unit(3, 1, 'New paragraph.', 60, 74),
    ]);
    expect(out[0]!.prosody).toMatchObject({ pause_before_ms: 700, pause_after_ms: 600 });
    expect(out[1]!.prosody?.pause_before_ms).toBe(650); // md gap = paragraph
    expect(out[2]!.prosody?.pause_before_ms ?? 0).toBe(0); // same block
    expect(out[3]!.prosody?.pause_before_ms).toBe(650);
  });

  it('prosody: display equations get surrounding beats', () => {
    const out = applyNarrativePass([unit(0, 1, 'Equation: x squared.', 0, 20, 'display_eq')]);
    expect(out[0]!.prosody).toMatchObject({ pause_before_ms: 300, pause_after_ms: 300 });
  });

  it('doctors speak strings in place and keeps silent units silent', () => {
    const out = applyNarrativePass([
      unit(0, 1, 'l e t t e r spacing.', 0, 18),
      unit(1, 1, undefined, 19, 30, 'skip'),
    ]);
    expect(out[0]!.speak).toBe('letter spacing.');
    expect(out[1]!.speak).toBeUndefined();
  });
});
