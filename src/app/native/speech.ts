import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

/** The phone's speech recognition (SpeechPlugin.kt): continuous Arabic listening for tasmee'. */
export interface SpeechPlugin {
  available(): Promise<{ available: boolean }>;
  start(options: { language: string; bias?: string[] }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'partial' | 'final', cb: (e: { text: string; alternatives?: string[] }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'level', cb: (e: { level: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', cb: (e: { code: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'state', cb: (e: { listening: boolean }) => void): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<SpeechPlugin>('Speech');

/** What the recogniser heard: [final] text after pauses (to keep), [partial] the words of the current phrase. */
export interface SpeechCallbacks {
  /** [alternatives]: the recogniser's other guesses (best first), when it gives them. */
  onFinal(text: string, alternatives?: string[]): void;
  onPartial(text: string, alternatives?: string[]): void;
  onError(code: string): void;
  /** Microphone level 0..1 (the offline engine; to show it hears you). */
  onLevel?(level: number): void;
}

/** Listens with the phone's recogniser, or the browser's (Chrome) during development. */
export class PhoneSpeech {
  private handles: PluginListenerHandle[] = [];
  private web?: { stop(): void; abort(): void; start(): void; onresult: unknown; onerror: unknown; onend: unknown };
  private active = false;

  static async available(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) return (await Native.available().catch(() => ({ available: false }))).available;
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  /** [bias]: phrases to expect (the ayat, in plain spelling), which the recogniser favours on Android 13+. */
  async start(cb: SpeechCallbacks, bias: string[] = [], language = 'ar-SA'): Promise<void> {
    this.active = true;
    if (Capacitor.isNativePlatform()) {
      this.handles.push(
        await Native.addListener('final', (e) => cb.onFinal(e.text, e.alternatives)),
        await Native.addListener('partial', (e) => cb.onPartial(e.text, e.alternatives)),
        await Native.addListener('error', (e) => cb.onError(String(e.code))),
        await Native.addListener('level', (e) => cb.onLevel?.(e.level)),
      );
      try {
        await Native.start({ language, bias });
      } catch (e) {
        await this.stop();
        throw e;
      }
      return;
    }
    const Ctor = (window as unknown as Record<string, new () => typeof this.web>)['SpeechRecognition'] ?? (window as unknown as Record<string, new () => typeof this.web>)['webkitSpeechRecognition'];
    if (!Ctor) throw Object.assign(new Error('unavailable'), { code: 'UNAVAILABLE' });
    const rec = new Ctor()!;
    Object.assign(rec, { lang: language, continuous: true, interimResults: true, maxAlternatives: 5 });
    rec.onresult = (ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; length: number } & ArrayLike<{ transcript: string }>> }) => {
      let partial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) cb.onFinal(r[0].transcript, Array.from({ length: r.length }, (_, k) => r[k].transcript));
        else partial += r[0].transcript;
      }
      cb.onPartial(partial);
    };
    rec.onerror = (e: { error: string }) => cb.onError(e.error);
    rec.onend = () => this.active && rec.start();
    rec.start();
    this.web = rec;
  }

  async stop(): Promise<void> {
    this.active = false;
    if (Capacitor.isNativePlatform()) await Native.stop().catch(() => undefined);
    this.web?.stop();
    this.web = undefined;
    await Promise.all(this.handles.map((h) => h.remove()));
    this.handles = [];
  }
}
