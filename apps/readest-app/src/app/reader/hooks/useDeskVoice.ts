/**
 * useDeskVoice — the workbench voice player's wiring, extracted verbatim
 * from WorkbenchTab.tsx:427–505 (Desk campaign, audit R5).
 *
 * One player per desk mount; narration owns audio focus (the s4 precedence
 * law is unchanged: `voice-busy` refusal, `unit-change` instant yield,
 * stop-on-new-turn). Both the interim WorkbenchTab and wave 3's DeskCanvas
 * build per-block VoiceControl props through `voicePropsFor`; a new send
 * path calls `stop()` as its first statement so two voices never speak at
 * once (audit Risk 4).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { getNarration } from '@/services/narration/speakMode';
import {
  WorkbenchVoicePlayer,
  type WorkbenchVoiceErrorKind,
  type WorkbenchVoiceState,
} from '@/services/professor/workbenchVoice';
import type { ProfessorSpeechSource } from '@/services/professor/voice';
import {
  useWorkbenchChatStore,
  type TranscriptBlock,
} from '@/app/reader/components/notebook/workbenchChat';
import type { VoiceControlProps } from '@/app/reader/components/notebook/blockBody';

export interface DeskVoice {
  /** The nine-prop VoiceControl wiring for one committed block (audit R11). */
  voicePropsFor: (b: TranscriptBlock) => VoiceControlProps;
  /** Stop-on-new-turn: the first statement of every send path. */
  stop: () => void;
}

export const useDeskVoice = (bookKey: string): DeskVoice => {
  const blocks = useWorkbenchChatStore((s) => s.blocks[bookKey]);
  const updateBlock = useWorkbenchChatStore((s) => s.updateBlock);

  // ── Voice answers (s4): one player per desk; narration owns audio focus ──
  const voiceRef = useRef<WorkbenchVoicePlayer | null>(null);
  const [voiceState, setVoiceState] = useState<WorkbenchVoiceState>('idle');
  const [voiceActiveId, setVoiceActiveId] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<{
    blockId: string | null;
    kind: WorkbenchVoiceErrorKind;
  } | null>(null);

  const getVoicePlayer = useCallback((): WorkbenchVoicePlayer => {
    voiceRef.current ??= new WorkbenchVoicePlayer({
      // HP-3: voice id + rate resolve from the narration controller's
      // speech identity, read live — no new settings.
      getSpeech: () => getNarration(bookKey)?.controller?.speech ?? null,
      isNarrationActive: () => getNarration(bookKey)?.controller?.active ?? false,
      onState: (s) => {
        setVoiceState(s);
        setVoiceActiveId(voiceRef.current?.activeBlockId ?? null);
      },
      onError: (kind) => setVoiceNotice({ blockId: voiceRef.current?.activeBlockId ?? null, kind }),
    });
    return voiceRef.current;
  }, [bookKey]);

  /** A natural completion writes which voice spoke back into the block, so
   *  a restored sitting remembers (s4 §4.4 — metadata only, never audio). */
  const recordHeard = useCallback(
    (block: TranscriptBlock, speech: ProfessorSpeechSource | null) => {
      if (!speech) return;
      updateBlock(bookKey, block.id, {
        voice: {
          requested: block.voice?.requested ?? false,
          voiceId: speech.voice,
          lastHeardAt: new Date().toISOString(),
        },
      });
    },
    [bookKey, updateBlock],
  );

  const handleVoiceSpeak = useCallback(
    (block: TranscriptBlock) => {
      setVoiceNotice(null);
      void getVoicePlayer()
        .speak(block.id, block.content)
        .then((speech) => recordHeard(block, speech));
    },
    [getVoicePlayer, recordHeard],
  );

  const handleVoiceReplay = useCallback(
    (block: TranscriptBlock) => {
      setVoiceNotice(null);
      void getVoicePlayer()
        .replay(block.id)
        .then((speech) => recordHeard(block, speech));
    },
    [getVoicePlayer, recordHeard],
  );

  // Focus law (s4 §5): the narration controller owns audio focus. When it
  // takes focus (unit-change fires at every playFrom), workbench playback
  // yields instantly. A narration session that appears later (the reader
  // opened the book after the desk) un-mutes the controls via reset().
  useEffect(() => {
    const controller = getNarration(bookKey)?.controller;
    if (!controller) return;
    if (voiceRef.current?.state === 'unavailable') voiceRef.current.reset();
    const onUnitChange = () => voiceRef.current?.stop();
    controller.addEventListener('unit-change', onUnitChange);
    return () => controller.removeEventListener('unit-change', onUnitChange);
  }, [blocks, bookKey]);

  // A new sitting gesture silences the old voice; so does leaving.
  useEffect(
    () => () => {
      voiceRef.current?.stop();
    },
    [],
  );

  const voicePropsFor = useCallback(
    (b: TranscriptBlock): VoiceControlProps => ({
      block: b,
      playerState: voiceState,
      notice: voiceNotice?.blockId === b.id ? voiceNotice.kind : null,
      speaking: voiceActiveId === b.id,
      onSpeak: () => handleVoiceSpeak(b),
      onPause: () => voiceRef.current?.pause(),
      onResume: () => voiceRef.current?.resume(),
      onReplay: () => handleVoiceReplay(b),
      onDismissNotice: () => setVoiceNotice(null),
    }),
    [voiceState, voiceNotice, voiceActiveId, handleVoiceSpeak, handleVoiceReplay],
  );

  const stop = useCallback(() => voiceRef.current?.stop(), []);

  return { voicePropsFor, stop };
};
