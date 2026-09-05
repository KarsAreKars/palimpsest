/**
 * NarrationController — one book's narration session.
 *
 * Owns the NarrationPlayer plus the book's artifacts (content.md, manifest,
 * narration.jsonl) and translates reader interactions into playback:
 * start-from-page (speak button) and start-from-word (click-to-speak,
 * plan §5's signature interaction).
 *
 * The `Narrator` capability seam (plan §2.2): the player talks to a
 * SpeechProvider — EdgeSpeechProvider (free tier) here; ElevenLabs slots in
 * behind the same interface without touching this class.
 */
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { getDir } from '@/utils/book';
import { isTauriAppPlatform } from '@/services/environment';
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import { nlog, nwarn } from './log';
import { EdgeSpeechProvider } from '@/services/tts/providers/edge';
import { ElevenLabsProvider } from '@/services/tts/providers/elevenlabs';
import type { SpeechProvider } from '@/services/tts/providers/types';
import { NarrationPlayer, type AudioSink } from './player';
import { NarrationEdgeProvider } from './narrationEdgeProvider';
import { NarrationQwenProvider } from './narrationQwenProvider';
import { useNarrationSettings } from './settings';
import { WebAudioSink } from './webAudioSink';
import {
  loadNarration,
  buildNarrationForBook,
  type HpubManifest,
  type NarrationUnit,
} from './index';
import { resolveClickToUnit } from './locate';

export interface NarrationControllerDeps {
  provider?: SpeechProvider;
  sink?: AudioSink;
}

// React StrictMode double-mounts effects in dev; the spoken-script build is
// expensive, so share one in-flight build per book hash.
const buildInFlight = new Map<string, Promise<unknown>>();
const buildOnce = (appService: AppService, book: Book): Promise<unknown> => {
  const key = book.hash;
  let p = buildInFlight.get(key);
  if (!p) {
    p = buildNarrationForBook(appService, book).finally(() => buildInFlight.delete(key));
    buildInFlight.set(key, p);
  }
  return p;
};

export class NarrationController extends EventTarget {
  readonly units: NarrationUnit[];
  readonly manifest: HpubManifest;
  readonly md: string;
  #player: NarrationPlayer;

  private constructor(
    md: string,
    manifest: HpubManifest,
    units: NarrationUnit[],
    player: NarrationPlayer,
  ) {
    super();
    this.md = md;
    this.manifest = manifest;
    this.units = units;
    this.#player = player;
    this.#player.addEventListener('unit-change', (e) => {
      this.dispatchEvent(new CustomEvent('unit-change', { detail: (e as CustomEvent).detail }));
    });
    this.#player.addEventListener('book-ended', () =>
      this.dispatchEvent(new CustomEvent('book-ended')),
    );
  }

  /**
   * Load a book's narration session, or null when the text layer / spoken
   * script aren't built yet (extraction still running, or a plain PDF import
   * on web). Absence must degrade gracefully — the caller falls back to the
   * upstream TTS path.
   */
  static async load(
    appService: AppService,
    book: Book,
    deps: NarrationControllerDeps = {},
  ): Promise<NarrationController | null> {
    let units = await loadNarration(appService, book);
    if (
      (!units || units.length === 0) &&
      (await appService.exists(`${getDir(book)}/manifest.json`, 'Books'))
    ) {
      // The text layer is present but the spoken script was never built
      // (e.g. an .hpub package predating the narration pipeline). Build it
      // once, in place — same artifacts, same directory.
      try {
        console.info('narration: building spoken script from text layer…');
        await buildOnce(appService, book);
        units = await loadNarration(appService, book);
      } catch (e) {
        console.warn('narration: spoken-script build failed', e);
      }
    }
    if (!units || units.length === 0) return null;
    console.info('narration: loaded', units.length, 'units');
    const dir = getDir(book);
    const toText = (c: string | ArrayBuffer): string =>
      typeof c === 'string' ? c : new TextDecoder().decode(c);
    const md = toText(await appService.readFile(`${dir}/content.md`, 'Books', 'text'));
    const manifest = JSON.parse(
      toText(await appService.readFile(`${dir}/manifest.json`, 'Books', 'text')),
    ) as HpubManifest;

    // Provider + voice come from Settings → Narration (plan §5). The Tauri
    // WebSocket plugin can send the headers Microsoft's endpoint requires; a
    // plain browser cannot, so the web lane relays Edge synthesis through
    // the local /api/tts/narration route. ElevenLabs answers plain curl, but
    // the webview's preflight (custom xi-api-key header from a tauri://
    // origin) is rejected — so it rides the same native reqwest transport
    // as the AI providers via getAIFetch().
    const settings = useNarrationSettings.getState();
    const edgeProvider = (): SpeechProvider =>
      isTauriAppPlatform() ? new EdgeSpeechProvider() : new NarrationEdgeProvider();
    let provider: SpeechProvider;
    if (deps.provider) {
      provider = deps.provider;
    } else if (settings.provider === 'elevenlabs' && settings.elevenlabsApiKey) {
      const el = new ElevenLabsProvider({
        apiKey: settings.elevenlabsApiKey,
        tier: settings.elevenlabsTier,
        fetchImpl: getAIFetch(),
      });
      // Fall back to the free tier when the key is bad or the API is down —
      // a book that reads in a worse voice beats a book that doesn't read.
      const ok = await el.init().catch(() => false);
      if (ok) {
        provider = el;
      } else {
        nwarn('narration: ElevenLabs unavailable, falling back to Edge');
        provider = edgeProvider();
      }
    } else if (settings.provider === 'qwen-local') {
      // Local Qwen3-TTS server (A9): probe /health, fall back to Edge when
      // the user hasn't started the server — never leave the book voiceless.
      const q = new NarrationQwenProvider();
      const ok = await q.init().catch(() => false);
      if (ok) {
        provider = q;
      } else {
        nwarn('narration: Qwen local server not reachable (port 8737), falling back to Edge');
        provider = edgeProvider();
      }
    } else {
      provider = edgeProvider();
    }
    nlog(`narration: provider=${provider.id}`);
    if (!deps.provider && provider.id !== 'elevenlabs') {
      const ok = await provider.init().catch(() => false);
      if (!ok) {
        console.warn('narration: speech engine unavailable');
        return null; // engine unavailable — caller falls back
      }
    }
    const voices = await provider.getAllVoices().catch(() => []);
    const lang = (book.primaryLanguage || 'en').split('-')[0]!;
    const langVoices = voices.filter((v) => (v.lang || v.id).startsWith(lang));
    let voice: string;
    if (provider.id === 'qwen-local') {
      voice =
        (settings.qwenVoiceId && voices.some((v) => v.id === settings.qwenVoiceId)
          ? settings.qwenVoiceId
          : undefined) ??
        provider.fallbackVoiceId ??
        voices[0]?.id ??
        'af_heart';
    } else if (provider.id === 'elevenlabs') {
      voice = settings.elevenlabsVoiceId ?? langVoices[0]?.id ?? voices[0]?.id ?? '';
      if (!voice) {
        console.warn('narration: ElevenLabs returned no voices');
        return null;
      }
    } else {
      voice =
        (settings.edgeVoiceId && voices.some((v) => v.id === settings.edgeVoiceId)
          ? settings.edgeVoiceId
          : undefined) ??
        provider.pickDefaultVoice?.(langVoices) ??
        langVoices[0]?.id ??
        provider.fallbackVoiceId ??
        voices[0]?.id ??
        'en-US-AriaNeural';
    }

    const player = new NarrationPlayer({
      provider,
      sink: deps.sink ?? new WebAudioSink(),
      voice,
      lang,
    });
    nlog(`narration: voice=${voice} provider=${provider.id}`);
    player.setRate(settings.rate); // remembered listening speed (plan §5)
    player.load(units);
    return new NarrationController(md, manifest, units, player);
  }

  get player(): NarrationPlayer {
    return this.#player;
  }

  /** Speech identity for the professor voice loop (HP-3): same provider,
   * voice, language, and rate the book reads with — read live so a Settings
   * hot-swap applies to the professor's next sentence. */
  get speech(): { provider: SpeechProvider; voice: string; lang: string; rate: number } {
    return {
      provider: this.#player.provider,
      voice: this.#player.voice,
      lang: this.#player.lang,
      rate: this.#player.rate,
    };
  }

  get playing(): boolean {
    return this.#player.state === 'playing';
  }

  get paused(): boolean {
    return this.#player.state === 'paused';
  }

  get active(): boolean {
    return this.#player.state !== 'stopped';
  }

  /** Speak button path: start at the first speakable unit of a 1-based page. */
  async startFromPage(page: number): Promise<void> {
    const idx = this.units.findIndex((u) => u.page !== null && u.page >= page);
    await this.#player.playFrom(idx === -1 ? 0 : idx);
  }

  /**
   * Click-to-speak: resolve the clicked word to its narration unit and start
   * reading AT THAT WORD — the entry utterance is the sentence fragment from
   * the clicked word onward, then playback streams forward whole-unit.
   */
  async startFromWord(page: number, clickedWord: string): Promise<boolean> {
    const hit = resolveClickToUnit(this.md, this.manifest, this.units, page, clickedWord);
    if (!hit) return false;
    const { unit, mdOffset } = hit;

    // Map the clicked word's position inside the unit's original span to a
    // proportional position in its speak text, snapped to a word boundary.
    // Math verbalization makes this approximate; snapping keeps words whole.
    const spanLen = Math.max(unit.md_end - unit.md_start, 1);
    const fraction = Math.min(Math.max((mdOffset - unit.md_start) / spanLen, 0), 1);
    let firstSpeakText: string | undefined;
    if (unit.speak) {
      const approx = Math.floor(fraction * unit.speak.length);
      const boundary = unit.speak.indexOf(' ', approx);
      firstSpeakText =
        boundary !== -1 && boundary < unit.speak.length - 1
          ? unit.speak.slice(boundary + 1)
          : unit.speak;
    }
    await this.#player.playFrom(unit.unit, { firstSpeakText });
    return true;
  }

  async togglePlay(): Promise<void> {
    if (this.playing) this.#player.pause();
    else if (this.paused) this.#player.resume();
    else await this.startFromPage(1);
  }

  async next(): Promise<void> {
    await this.#player.next();
  }

  async prev(): Promise<void> {
    await this.#player.prev();
  }

  setRate(rate: number): void {
    this.#player.setRate(rate);
  }

  stop(): void {
    this.#player.stop();
    this.dispatchEvent(new CustomEvent('stopped'));
  }
}
