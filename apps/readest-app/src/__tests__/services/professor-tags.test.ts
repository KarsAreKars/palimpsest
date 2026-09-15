/**
 * Workbench transcript tag parser contract tests (Workbench 2.1).
 *
 * parseProfessorTags is the seam between the streamed professor message and
 * the UI: display markdown (math intact) one way, protocol tags the other.
 */
import { describe, expect, test } from 'vitest';
import { parseProfessorTags } from '@/services/professor/professorTags';

describe('parseProfessorTags', () => {
  test('extracts concept and qkind, strips the tags from display', () => {
    const raw =
      'The Fourier idea lives on page 41. What do you think the integral computes?\n' +
      '[CONCEPT:Fourier transform]\n' +
      '[QKIND:why]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.concept).toBe('Fourier transform');
    expect(parsed.qkind).toBe('why');
    expect(parsed.end).toBeUndefined();
    expect(parsed.display).toContain('The Fourier idea lives on page 41.');
    expect(parsed.display).not.toContain('[CONCEPT');
    expect(parsed.display).not.toContain('[QKIND');
    expect(parsed.display).not.toContain(']');
  });

  test('flags a session-closing [WORKBENCH:END]', () => {
    const raw = 'That closes our session — read page 88 once more before bed.\n[WORKBENCH:END]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.end).toBe(true);
    expect(parsed.display).not.toContain('WORKBENCH');
  });

  test('leaves display text intact and never mangles $$ math blocks', () => {
    const math = '$$\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x) e^{-2\\pi i x \\xi}\\, dx$$';
    const withMatrix =
      '$$A = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix},\\quad x \\in [0,1]$$';
    const raw = `Look at the transform:\n\n${math}\n\nand the matrix ${withMatrix} — now your turn.\n[CONCEPT:fourier transform]`;
    const parsed = parseProfessorTags(raw);
    expect(parsed.display).toContain(math);
    expect(parsed.display).toContain(withMatrix);
    expect(parsed.display).toContain('[0,1]'); // interval inside math survives
    expect(parsed.display).not.toContain('[CONCEPT');
    expect(parsed.concept).toBe('fourier transform');
  });

  test('an unterminated $$ does not shield a protocol tag (the leak fix)', () => {
    const raw = '$$x^2 + 1\n[CONCEPT:leak]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.concept).toBe('leak');
    expect(parsed.display).not.toContain('[CONCEPT');
    expect(parsed.display).not.toContain('leak]');
  });

  test('protocol tags are captured even inside a $$ shield; real math stays protected', () => {
    const raw =
      '$$\\int_0^1 f(x)\\,dx \\in [0,1]$$\n' +
      '[CONCEPT:integration]\n' +
      '[QKIND:how-connects]\n' +
      'tail [QKIND:why]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.concept).toBe('integration');
    expect(parsed.qkind).toBe('why'); // last one wins
    expect(parsed.display).toContain('[0,1]'); // interval inside math survives
    expect(parsed.display).not.toContain('[CONCEPT');
    expect(parsed.display).not.toContain('[QKIND');
  });

  test('an unterminated $$ followed by a partial protocol tag captures nothing but leaks nothing', () => {
    const raw = '$$x^2 + 1\n[CONCEPT:';
    const parsed = parseProfessorTags(raw);
    expect(parsed.concept).toBeUndefined(); // unclosed tag captures nothing
    expect(parsed.display).toContain('[CONCEPT:'); // malformed brackets pass through intact
  });

  test('passes text with no tags straight through', () => {
    const raw = 'Plain prose, no tags at all. $$x^2 + y^2 = r^2$$ still here.';
    const parsed = parseProfessorTags(raw);
    expect(parsed.display).toBe(raw);
    expect(parsed.concept).toBeUndefined();
    expect(parsed.qkind).toBeUndefined();
    expect(parsed.end).toBeUndefined();
    expect(parsed.point).toBeUndefined();
  });

  test('malformed and lowercase brackets are left untouched', () => {
    const raw = 'See [concept:lowercase] and [UNFINISHED and [QKIND without a bracket.';
    const parsed = parseProfessorTags(raw);
    expect(parsed.display).toBe(raw);
    expect(parsed.concept).toBeUndefined();
    expect(parsed.qkind).toBeUndefined();
  });

  test('removes unknown ALL-CAPS tags without capturing them', () => {
    const raw = 'Some text.\n[FROBNICATE:whatever]\n[CONCEPT:limits]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.display).not.toContain('FROBNICATE');
    expect(parsed.display).not.toContain('[');
    expect(parsed.concept).toBe('limits');
  });

  test('extracts a [POINT:…] takeaway and tolerates tags mid-text', () => {
    const raw =
      'The constant is the whole point.\n[POINT:the 2π lives inside the exponent]\n[CONCEPT:gaussian integral]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.point).toBe('the 2π lives inside the exponent');
    expect(parsed.concept).toBe('gaussian integral');
    expect(parsed.display).toContain('The constant is the whole point.');
    expect(parsed.display).not.toContain('[POINT');
  });

  test('tags on one line are all stripped; last repeated concept wins', () => {
    const raw = 'Body.\n[CONCEPT:old]\n[CONCEPT:new]\n[QKIND:check-me]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.concept).toBe('new');
    expect(parsed.qkind).toBe('check-me');
    expect(parsed.display).toBe('Body.');
  });
});

describe('workbench 2.x protocol tags', () => {
  test('[DERIVE title:.. goal:..] inside an unterminated $$ shield is still captured (pass-1 everywhere)', () => {
    const raw = '$$x^2 + 1\n[DERIVE title:Open folio goal:x = 2]';
    const parsed = parseProfessorTags(raw);
    expect(parsed.derive).toEqual({ title: 'Open folio', goal: 'x = 2' });
    expect(parsed.display).not.toContain('[DERIVE');
  });

  test('[STEP 3 /CHECKED ok] captures and strips; bare [STEP] is legal', () => {
    const parsed = parseProfessorTags(
      '$$a = b$$\nwhy\n[STEP 3 /CHECKED ok]\n$$b = c$$\nmore\n[STEP]',
    );
    expect(parsed.stepMarks).toEqual([{ professorChecked: 'ok' }, {}]);
    expect(parsed.display).not.toContain('[STEP');
    expect(parsed.display).toContain('$$a = b$$');
  });

  test('[DIAGRAM claim:…] with an empty claim captures nothing but consumes the tag', () => {
    const parsed = parseProfessorTags('A drawing was meant to sit here.\n[DIAGRAM claim:]');
    expect(parsed.diagram).toBeUndefined();
    expect(parsed.display).not.toContain('[DIAGRAM');
  });

  test('[LOOK page:N,M] parses into numbers; malformed values capture nothing', () => {
    expect(parseProfessorTags('I will look.\n[LOOK page:12]').look).toEqual([12]);
    expect(parseProfessorTags('I will look.\n[LOOK page:7, 12]').look).toEqual([7, 12]);
    expect(parseProfessorTags('I will look.\n[LOOK page:3,9, 15]').look).toEqual([3, 9, 15]);
    expect(parseProfessorTags('I will look.\n[LOOK page:]').look).toBeUndefined();
    expect(parseProfessorTags('I will look.\n[LOOK page:abc]').look).toBeUndefined();
    expect(parseProfessorTags('I will look.\n[LOOK page:12x]').look).toBeUndefined();
    expect(parseProfessorTags('I will look.\n[LOOK]').look).toBeUndefined();
    // Captured or not, the tag never reaches the eye.
    expect(parseProfessorTags('I will look.\n[LOOK page:12]').display).not.toContain('[LOOK');
  });

  test('[VOICE] is a boolean tag; value ignored; lowercase passes through', () => {
    expect(parseProfessorTags('Hear the rhythm.\n[VOICE]').voice).toBe(true);
    expect(parseProfessorTags('Hear it.\n[VOICE:ignored]').voice).toBe(true);
    const lower = parseProfessorTags('A [voice] in prose stays.');
    expect(lower.voice).toBeUndefined();
    expect(lower.display).toContain('[voice]');
  });

  test('[0,1] and [A] inside $$…$$ still survive; unknown ALL-CAPS tags still stripped without capture', () => {
    const parsed = parseProfessorTags(
      '$$x \\in [0,1],\\quad A = [B]$$\n[FROBNICATE:x]\n[CONCEPT:intervals]',
    );
    expect(parsed.display).toContain('[0,1]');
    expect(parsed.display).toContain('[B]');
    expect(parsed.display).not.toContain('FROBNICATE');
    expect(parsed.concept).toBe('intervals');
  });

  test('a prose bracket like [NOTE see: below] is not mistaken for a protocol tag', () => {
    const raw = 'See [NOTE see: below] for the convention.';
    const parsed = parseProfessorTags(raw);
    expect(parsed.display).toContain('[NOTE see: below]');
    expect(parsed.concept).toBeUndefined();
    expect(parsed.probe).toBeUndefined();
  });
});
