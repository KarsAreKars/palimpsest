/**
 * Palimpsest narration TTS route — local, unauthenticated.
 *
 * Browser-direct Edge TTS is dead upstream: Microsoft's endpoint requires
 * headers (Origin: chrome-extension://…) that a browser WebSocket cannot
 * send. The Tauri shell sidesteps this via its WebSocket plugin; the web
 * lane needs a same-origin hop. This route runs the synthesis server-side
 * (Node, where custom WS headers work) on the user's own machine — no
 * accounts, no cloud service of ours, per the plan's local-only constraint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { EdgeSpeechTTS } from '@/libs/edgeTTS';

const getLangFromVoice = (voiceId: string): string =>
  voiceId.match(/^([a-z]{2}-[A-Z]{2})/)?.[1] ?? 'en-US';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { input: text, voice } = body as { input?: string; voice?: string };
    if (!text || typeof text !== 'string' || text.length > 4096) {
      return NextResponse.json({ error: 'Missing or oversized "input"' }, { status: 400 });
    }
    if (!voice || typeof voice !== 'string' || !EdgeSpeechTTS.voices.some((v) => v.id === voice)) {
      return NextResponse.json({ error: 'Unknown voice' }, { status: 400 });
    }

    const tts = new EdgeSpeechTTS('wss');
    const { response } = await tts.createWithBoundaries({
      lang: (body.lang as string) || getLangFromVoice(voice),
      text,
      voice,
      rate: 1.0, // rate is applied at playout (WebAudioSink playbackRate)
      pitch: 1.0,
    });
    return new NextResponse(response.body, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'synthesis failed' },
      { status: 502 },
    );
  }
}
