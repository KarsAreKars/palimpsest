/**
 * diagramSvg contract tests (S3 §8.2): fence extraction, the allowlist
 * sanitizer (real figures survive attribute-for-attribute; XSS attempts are
 * stripped), idempotence, and the graceful-degradation + back-compat paths.
 */
import { describe, expect, test } from 'vitest';
import { extractDiagramSvg, sanitizeDiagramSvg } from '@/services/professor/diagramSvg';
import {
  commitProfessorBlock,
  parseTranscript,
  serializeTranscript,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';

const REAL_FIGURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
    </marker>
  </defs>
  <g stroke="black" fill="none" stroke-width="1.5">
    <path d="M20,100 L100,20 L180,100 Z" marker-end="url(#arrow)" />
    <line x1="20" y1="100" x2="180" y2="100" stroke-dasharray="4 3" />
    <text x="100" y="115" text-anchor="middle" font-size="10">180°</text>
  </g>
</svg>`;

describe('extractDiagramSvg', () => {
  test('display string with prose + one ```svg fence → svg extracted, display clean', () => {
    const display = `Look at the figure.\n\n\`\`\`svg\n${REAL_FIGURE}\n\`\`\`\n\nAs you can see.`;
    const { svg, display: cleaned } = extractDiagramSvg(display);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 200 120"');
    expect(cleaned).not.toContain('```');
    expect(cleaned).not.toContain('  ');
    expect(cleaned).toContain('Look at the figure.');
    expect(cleaned).toContain('As you can see.');
  });

  test("no fence → svg: '', display unchanged", () => {
    const display = 'Plain prose, no drawing.';
    expect(extractDiagramSvg(display)).toEqual({ svg: '', display });
  });

  test('a second fence is left in the display as prose', () => {
    const display = `\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" />\n\`\`\`\n\nprose\n\n\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" />\n\`\`\``;
    const { svg, display: cleaned } = extractDiagramSvg(display);
    expect(svg).toContain('viewBox="0 0 10 10"');
    expect(cleaned).toContain('```svg');
    expect(cleaned).toContain('viewBox="0 0 20 20"');
  });
});

describe('sanitizeDiagramSvg', () => {
  test('allowlist keeps a real figure attribute-for-attribute; idempotent', () => {
    const clean = sanitizeDiagramSvg(REAL_FIGURE);
    expect(clean).toContain('<svg');
    expect(clean).toContain('viewBox="0 0 200 120"');
    expect(clean).toContain('<defs>');
    expect(clean).toContain('<marker');
    expect(clean).toContain('marker-end="url(#arrow)"');
    expect(clean).toContain('stroke-dasharray="4 3"');
    expect(clean).toContain('text-anchor="middle"');
    expect(clean).toContain('font-size="10"');
    expect(clean).toContain('<path');
    expect(clean).toContain('d="M20,100 L100,20 L180,100 Z"');
    // Idempotence: sanitize(sanitize(x)) === sanitize(x).
    expect(sanitizeDiagramSvg(clean)).toBe(clean);
  });

  test('XSS attempts are stripped; the surrounding drawing survives', () => {
    const attacks: [string, string][] = [
      ['script tag', '<script>alert(1)</script>'],
      [
        'onload handler',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)" />',
      ],
      ['foreignObject + iframe', '<foreignObject><iframe src="x"></iframe></foreignObject>'],
      ['anchor with xlink', '<a xlink:href="javascript:alert(1)"><text>x</text></a>'],
      ['use with data URI', '<use href="data:image/svg+xml,&lt;svg/&gt;" />'],
      [
        'style element + attribute',
        '<style>*{fill:red}</style><rect width="4" height="4" style="fill:red" />',
      ],
      ['SMIL set handler', '<set attributeName="onmouseover" to="alert(1)" />'],
    ];
    for (const [name, payload] of attacks) {
      const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${payload}<rect x="1" y="1" width="4" height="4" /></svg>`;
      const clean = sanitizeDiagramSvg(dirty);
      expect(clean, name).not.toContain('<script');
      expect(clean, name).not.toContain('onload');
      expect(clean, name).not.toContain('foreignObject');
      expect(clean, name).not.toContain('<iframe');
      expect(clean, name).not.toContain('xlink:href');
      expect(clean, name).not.toContain('javascript:');
      expect(clean, name).not.toContain('<use');
      expect(clean, name).not.toContain('data:image');
      expect(clean, name).not.toContain('<style');
      expect(clean, name).not.toContain('style=');
      expect(clean, name).not.toContain('<set');
      expect(clean, name).not.toContain('<a ');
      // The honest drawing markup survives.
      expect(clean, name).toContain('<rect');
    }
  });

  test('empty or hostile-only input sanitizes to empty (the missing-figure path)', () => {
    expect(sanitizeDiagramSvg('')).toBe('');
    expect(sanitizeDiagramSvg('<script>alert(1)</script>')).toBe('');
  });
});

describe('diagram block degrade + round-trip back-compat (S3 §8.2 case 12)', () => {
  test("[DIAGRAM claim:…] with no fence → svg '', claim preserved", () => {
    const block = commitProfessorBlock(
      '[DIAGRAM claim:The three angles of a triangle sum to 180 degrees]\nNo drawing attached.',
      [],
    );
    expect(block.diagram).toEqual({
      claim: 'The three angles of a triangle sum to 180 degrees',
      svg: '',
    });
    expect(block.content).not.toContain('[DIAGRAM');
  });

  test('[DIAGRAM claim:…] with a fence → svg extracted, fence never in content', () => {
    const raw =
      '[DIAGRAM claim:The three angles of a triangle sum to 180 degrees]\n' +
      'Consider the figure.\n\n' +
      '```svg\n' +
      REAL_FIGURE +
      '\n```';
    const block = commitProfessorBlock(raw, []);
    expect(block.diagram!.svg).toContain('<svg');
    expect(block.content).not.toContain('```');
    expect(block.content).toContain('Consider the figure.');
  });

  test('an empty claim captures nothing — the block degrades to plain prose', () => {
    const block = commitProfessorBlock('[DIAGRAM claim:]\nJust prose here.\n```svg\n<svg />', []);
    expect(block.diagram).toBeUndefined();
  });

  test('a 2.1-style transcript (unknown kind included) round-trips unchanged — version stays 1', () => {
    const legacy: TranscriptBlock[] = [
      {
        id: 'old_1',
        author: 'professor',
        content: 'Welcome back.',
        at: '2026-09-15T10:00:00Z',
        kind: 'greeting',
      },
      {
        id: 'old_2',
        author: 'professor',
        content: 'A block from a newer build.',
        at: '2026-09-15T10:01:00Z',
        // An unknown kind from a newer build must parse and ride along
        // (isBlock ignores kind — campaign non-negotiable 5).
        kind: 'mystery' as unknown as TranscriptBlock['kind'],
      },
    ];
    const json = serializeTranscript(legacy);
    expect(JSON.parse(json).version).toBe(1);
    expect(parseTranscript(json)).toEqual(legacy);
  });
});
