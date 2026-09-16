/**
 * blockBody — the per-block body of the workbench transcript, extracted
 * from the retired notebook tab (Desk campaign wave 2, d3 §A.2 + audit
 * R5/R11).
 *
 * A pure move: BlockBody renders exactly the JSX that used to live inline
 * in the tab's block loop (byline → content → voice → concept map →
 * consult mark → probe row → figure → folio → learner folio → teach-back
 * captions → probe-signal marker → check chips → hairline), and
 * StreamingBody renders the professor's streaming ink-nib article. The
 * output DOM is byte-identical — same wb-* classes, same data-bid anchors
 * (the scroll target of scrollToBlock). VoiceControl moved here as a named
 * export with its nine-prop interface (audit R11); the player wiring that
 * builds VoiceControlProps lives in useDeskVoice (audit R5).
 *
 * DeskCanvas (wave 3) re-hosts these exports on the sheet; this module
 * also owns the wb-* stylesheet (wb.css, audit R16).
 */
import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { WorkbenchVoiceErrorKind, WorkbenchVoiceState } from '@/services/professor/workbenchVoice';
import { parseProfessorTags } from '@/services/professor/professorTags';
import { extractDiagramSvg } from '@/services/professor/diagramSvg';
import {
  derivationOrdinal,
  stripPartialTagTail,
  type BlockCheck,
  type ConceptMapData,
  type ProbeStance,
  type TranscriptBlock,
} from './workbenchChat';
import { Prose, Slip, VerdictChip } from './wbShared';
import DerivationSlip from './DerivationSlip';
import DiagramSlip from './DiagramSlip';
import './wb.css';

/** Split display markdown on the professor's `[Page N]` citations: the
 *  anchors become chips (evidence you can travel to), the rest stays prose. */
const splitPageCites = (text: string): { text?: string; page?: number }[] => {
  const out: { text?: string; page?: number }[] = [];
  const re = /\[Page (\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ page: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
};

/** The silent checker's verdicts, rendered inside the student block. No
 *  verdict and no chip for plain prose; `unavailable` renders nothing at
 *  all (echo mode — no marks, no blame). */
const BlockChips: React.FC<{ check?: BlockCheck }> = ({ check }) => {
  const _ = useTranslation();
  if (!check || check.status === 'unavailable') return null;
  if (check.status === 'checking') {
    return (
      <div className='wb-chip-row'>
        <span className='wb-chip wb-chip-muted' role='img' aria-label={_('Checking')}>
          {_('CHECKING…')}
          <span className='wb-dots' aria-hidden='true'>
            <i />
            <i />
            <i />
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className='wb-chip-row'>
      {check.verdicts.map((v) => (
        <VerdictChip key={v.id} verdict={v} />
      ))}
    </div>
  );
};

const PageChip: React.FC<{ page: number; quote: string | null; onGo: () => void }> = ({
  page,
  quote,
  onGo,
}) => {
  const _ = useTranslation();
  return (
    <button
      type='button'
      className='wb-chip wb-page-chip'
      aria-label={_('P. {{page}}', { page })}
      onClick={onGo}
    >
      {_('P. {{page}}', { page })}
      {quote && <Slip label={_('From the page')}>{quote}</Slip>}
    </button>
  );
};

const STANCES: { stance: ProbeStance; label: string }[] = [
  { stance: 'lead', label: 'Lead me' },
  { stance: 'ask', label: 'Ask me first' },
  { stance: 'work', label: 'I will work it' },
];

/** The stance chip row under a [PROBE] block (s1 §5.2) — the sanctioned
 *  mid-session interaction: the chips replace a typed message and go inert
 *  after a pick. */
const ProbeRow: React.FC<{
  picked?: ProbeStance;
  onPick: (stance: ProbeStance, message: string) => void;
}> = ({ picked, onPick }) => {
  const _ = useTranslation();
  return (
    <div
      className='wb-probe-row'
      role='group'
      aria-label={_('Choose how the professor guides you')}
    >
      {STANCES.map(({ stance, label }) => (
        <button
          key={stance}
          type='button'
          className={`wb-chip wb-probe-chip${picked === stance ? ' wb-probe-picked' : ''}`}
          disabled={picked !== undefined}
          onClick={() => onPick(stance, _(label))}
        >
          {_(label)}
          {picked === stance && (
            <span className='wb-probe-tick' aria-hidden='true'>
              {_('Chosen')}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

/** The concept-map slip (s1 §5.2) — the session's known/edge/unknown
 *  catalogue; every chip travels to the thread where the concept was last
 *  discussed. Names never yet discussed render as muted, inert chips. */
const ConceptMapSlip: React.FC<{
  map: ConceptMapData;
  onOpen: (threadId: string) => void;
}> = ({ map, onOpen }) => {
  const _ = useTranslation();
  const shelves: { head: string; entries: ConceptMapData['known'] }[] = [
    { head: _('KNOWN'), entries: map.known },
    { head: _('EDGE'), entries: map.edge },
    { head: _('UNKNOWN'), entries: map.unknown },
  ];
  return (
    <div className='wb-map'>
      <p className='wb-map-caption'>{_('The catalogue so far')}</p>
      <div className='wb-map-cols'>
        {shelves.map(({ head, entries }) => (
          <div className='wb-map-col' key={head}>
            <span className='wb-map-head'>{head}</span>
            {entries.length === 0 && (
              <span className='wb-map-empty'>{_('Nothing filed here yet')}</span>
            )}
            {entries.map((entry) =>
              entry.threadId ? (
                <button
                  key={entry.name}
                  type='button'
                  className='wb-chip wb-map-chip'
                  aria-label={_('Open the thread on {{concept}}', { concept: entry.name })}
                  onClick={() => onOpen(entry.threadId!)}
                >
                  {entry.name}
                </button>
              ) : (
                <span key={entry.name} className='wb-chip wb-map-chip wb-map-chip-dim'>
                  {entry.name}
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/** The "consulting the book" mark under a block whose professor consulted
 *  pages via [LOOK] (s2 §8 — landed with wave A per audit R7a). */
const ConsultMark: React.FC<{ pages: number[] }> = ({ pages }) => {
  const _ = useTranslation();
  return (
    <p className='wb-consult' role='status'>
      <span className='wb-consult-mark' aria-hidden='true'>
        ❧
      </span>
      {pages.length > 0
        ? _('Consulted page {{pages}}', { pages: pages.join(', ') })
        : _('The book had nothing on that page.')}
    </p>
  );
};

/** The read-aloud control under a PROFESSOR block only (asymmetric voice —
 *  learner blocks never speak, s4 §6). A [VOICE]-tagged block renders the
 *  control promoted, in the stamp accent, with the professor's slip. The
 *  control is a real button reached by Tab like every other control — no
 *  global shortcuts, no mid-session buttons. Nine props (audit R11). */
export interface VoiceControlProps {
  block: TranscriptBlock;
  playerState: WorkbenchVoiceState;
  notice: WorkbenchVoiceErrorKind | null;
  speaking: boolean;
  onSpeak: () => void;
  onPause: () => void;
  onResume: () => void;
  onReplay: () => void;
  onDismissNotice: () => void;
}

export const VoiceControl: React.FC<VoiceControlProps> = ({
  block,
  playerState,
  notice,
  speaking,
  onSpeak,
  onPause,
  onResume,
  onReplay,
  onDismissNotice,
}) => {
  const _ = useTranslation();
  const promoted = Boolean(block.voice?.requested);
  const heard = Boolean(block.voice?.lastHeardAt);
  const btnClass = `wb-chip wb-voice-btn${promoted ? ' wb-voice-promoted' : ''}`;
  return (
    <div className='wb-voice'>
      {speaking && playerState === 'synthesizing' && (
        <span className='wb-chip wb-voice-speaking' role='status'>
          {_('Speaking…')}
          <span className='wb-dots' aria-hidden='true'>
            <i />
            <i />
            <i />
          </span>
        </span>
      )}
      {speaking && playerState === 'playing' && (
        <button
          type='button'
          className='wb-chip wb-voice-btn wb-voice-speaking'
          aria-pressed='true'
          onClick={onPause}
        >
          {_('Pause reading')}
        </button>
      )}
      {speaking && playerState === 'paused' && (
        <button
          type='button'
          className='wb-chip wb-voice-btn'
          aria-pressed='false'
          onClick={onResume}
        >
          {_('Resume reading')}
        </button>
      )}
      {!speaking && (
        <>
          <button type='button' className={btnClass} onClick={onSpeak}>
            {_('Read this aloud')}
            {promoted && <Slip>{_('The professor asks that this be heard.')}</Slip>}
          </button>
          {heard && (
            <button
              type='button'
              className='wb-chip wb-voice-btn wb-voice-muted'
              onClick={onReplay}
            >
              {_('Read again')}
            </button>
          )}
        </>
      )}
      {notice && (
        <p className='wb-voice-notice' role='note'>
          {notice === 'voice-busy' &&
            _('The book is still reading aloud. The desk waits its turn.')}
          {notice === 'voice-unavailable' && _('The reading voice is away.')}
          {notice === 'voice-failed' && _("The professor's voice faltered. Nothing was lost.")}
          {notice === 'voice-busy' && (
            <button type='button' className='ink-btn' onClick={onDismissNotice}>
              {_('Dismiss')}
            </button>
          )}
          {notice === 'voice-failed' && (
            <button type='button' className='ink-btn' onClick={onSpeak}>
              {_('Try again')}
            </button>
          )}
        </p>
      )}
    </div>
  );
};

/** `[Page N]` anchors become chips, the rest stays prose — moved verbatim
 *  from the retired tab; the page callbacks are surface-level wiring passed
 *  in. */
const renderContent = (
  text: string,
  quoteForPage: (page: number) => string | null,
  onGoPage: (page: number) => void,
) =>
  splitPageCites(text).map((seg, i) => {
    if (seg.page !== undefined) {
      const page = seg.page;
      return (
        <PageChip key={i} page={page} quote={quoteForPage(page)} onGo={() => onGoPage(page)} />
      );
    }
    return seg.text?.trim() ? <Prose key={i} text={seg.text} /> : null;
  });

export interface BlockBodyProps {
  b: TranscriptBlock;
  /** The whole transcript: derivationOrdinal + the learner compact folio
   *  lookup both derive from block order. */
  blocks: TranscriptBlock[];
  /** This block's own silent-check state (R11's pinned `check` prop). */
  check?: BlockCheck;
  /** The per-book check map, consulted for the folio a learner block
   *  extends — the compact folio renders the FOLIO's verdicts, not the
   *  learner block's (additive to d3 §A.2; without it the learner rows
   *  lose their chips). */
  checks?: Record<string, BlockCheck>;
  /** i === 0 && !resumeNotice — owns the wb-block-first class. */
  resumeFirst: boolean;
  /** The voice player's per-block props, built by useDeskVoice (audit R5). */
  voice: VoiceControlProps;
  onOpenThread: (threadId: string) => void;
  onPickProbe: (blockId: string, stance: ProbeStance, message: string) => void;
  quoteForPage: (page: number) => string | null;
  onGoPage: (page: number) => void;
}

/** One committed block on the paper: the <article> shell with its data-bid
 *  scroll anchor, everything the tab's loop used to render inline. */
export const BlockBody: React.FC<BlockBodyProps> = ({
  b,
  blocks,
  check,
  checks = {},
  resumeFirst,
  voice,
  onOpenThread,
  onPickProbe,
  quoteForPage,
  onGoPage,
}) => {
  const _ = useTranslation();
  return (
    <article className={`wb-block${resumeFirst ? ' wb-block-first' : ''}`} data-bid={b.id}>
      <p className='wb-byline'>{_(b.author === 'professor' ? 'THE PROFESSOR' : 'YOU')}</p>
      <div className='wb-content'>{renderContent(b.content, quoteForPage, onGoPage)}</div>
      {b.author === 'professor' && <VoiceControl {...voice} />}
      {b.author === 'professor' && b.conceptMap && (
        <ConceptMapSlip map={b.conceptMap} onOpen={onOpenThread} />
      )}
      {b.author === 'professor' && b.lookedUp && <ConsultMark pages={b.lookedUp} />}
      {b.author === 'professor' && b.probe && (
        <ProbeRow picked={b.probePicked} onPick={(s, m) => onPickProbe(b.id, s, m)} />
      )}
      {b.diagram && <DiagramSlip block={b} />}
      {b.author === 'professor' && b.derivation && b.derivation.steps.length > 0 && (
        <DerivationSlip
          block={b}
          ordinalBase={derivationOrdinal(blocks, b.id, 0) - 1}
          check={check}
        />
      )}
      {b.author === 'user' &&
        b.extendsDerivation &&
        (() => {
          const folio = blocks.find((f) => f.id === b.extendsDerivation);
          if (!folio?.derivation) return null;
          const stepCount = folio.derivation.steps.length;
          const learnerStepCount = (b.content.match(/\$\$[\s\S]*?\$\$/g) ?? []).length;
          if (learnerStepCount === 0 || learnerStepCount > stepCount) return null;
          // The folio already carries these steps (associate-
          // LearnerStep appended them); render the learner's paper
          // compactly with the folio's own step ids and ordinals.
          const base = derivationOrdinal(blocks, folio.id, 0) - 1 + stepCount - learnerStepCount;
          const learnerBlock: TranscriptBlock = {
            ...b,
            derivation: {
              steps: folio.derivation.steps.slice(stepCount - learnerStepCount),
            },
          };
          return (
            <DerivationSlip
              compact
              block={learnerBlock}
              ordinalBase={base}
              check={checks[folio.id]}
            />
          );
        })()}
      {b.author === 'user' && b.teachbackAsk && (
        <p className='wb-teachback-caption'>
          {_('The professor asked you to restate it — in your own words')}
          <span className='wb-teachback-ask'>
            {_('His question: {{ask}}', { ask: b.teachbackAsk })}
          </span>
        </p>
      )}
      {b.author === 'professor' && b.teachbackOf && (
        <p className='wb-teachback-caption'>{_('His reading of your restatement')}</p>
      )}
      {b.author === 'user' && b.probeSignal && (
        <div className='wb-chip-row'>
          <span
            className='wb-chip wb-chip-muted wb-idk'
            role='img'
            aria-label={_('Said honestly: not yet known')}
          >
            {_('Said honestly: not yet known')}
          </span>
        </div>
      )}
      {b.author === 'user' && <BlockChips check={check} />}
      <hr className='wb-sep' />
    </article>
  );
};

export interface StreamingBodyProps {
  partial: string;
  thinking: boolean;
  quoteForPage: (page: number) => string | null;
  onGoPage: (page: number) => void;
}

/** The streaming ink-nib article (d3 §A.3): rides the token tail at the
 *  placed position; a complete ```svg fence mid-stream holds a muted
 *  placeholder instead of raw SVG. The mount condition (phase !== 'idle'
 *  && showPlaceholder) stays with the host. */
export const StreamingBody: React.FC<StreamingBodyProps> = ({
  partial,
  thinking,
  quoteForPage,
  onGoPage,
}) => {
  const _ = useTranslation();
  return (
    <article className='wb-block'>
      <p className='wb-byline'>{_('THE PROFESSOR')}</p>
      <div className='wb-prose wb-streaming'>
        {partial.trim()
          ? (() => {
              const disp = parseProfessorTags(stripPartialTagTail(partial)).display;
              // Raw SVG never streams into the DOM uncommitted:
              // a complete fence mid-stream holds a muted
              // placeholder instead (s3 §3.2).
              const { svg, display } = extractDiagramSvg(disp);
              return (
                <>
                  {renderContent(display, quoteForPage, onGoPage)}
                  {svg !== '' && (
                    <p className='wb-figure-pending'>{_('The professor is drawing.')}</p>
                  )}
                </>
              );
            })()
          : null}
        <span className='wb-nib' aria-hidden='true' />
      </div>
      {thinking && <p className='wb-thinking'>{_('The professor is writing.')}</p>}
      <hr className='wb-sep' />
    </article>
  );
};
