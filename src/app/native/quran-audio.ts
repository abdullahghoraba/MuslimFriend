import { Injectable } from '@angular/core';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

/** One file of the queue. Items with the same [group] (an ayah and its repeats) count as one for next / previous. */
export interface QuranAudioItem {
  url: string;
  title: string;
  artist?: string;
  album?: string;
  group: string;
}
export type QuranAudioRepeat = 'off' | 'one' | 'all';
/** Who plays: each screen follows only its own playback. */
export type QuranAudioSession = 'listen' | 'mushaf';

export interface QuranAudioState {
  /** '' once stopped. */
  session: QuranAudioSession | '';
  /** -1 when nothing is queued (stopped, also from the notification). */
  index: number;
  group: string;
  playing: boolean;
  buffering: boolean;
  /** The queue played to its end. */
  ended: boolean;
  /** The stream failed three times. */
  error: boolean;
  /** Seconds. */
  position: number;
  /** Seconds; 0 for live radio. */
  duration: number;
  /** When the sleep timer stops playback (epoch ms), or 0. */
  sleepAt: number;
}

export interface QuranAudioPlugin {
  play(options: {
    session: QuranAudioSession;
    items: QuranAudioItem[];
    index: number;
    /** Seconds into the first item. */
    position?: number;
    repeat: QuranAudioRepeat;
    speed: number;
    live: boolean;
  }): Promise<void>;
  toggle(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(options: { position: number }): Promise<void>;
  setRepeat(options: { repeat: QuranAudioRepeat }): Promise<void>;
  setSpeed(options: { speed: number }): Promise<void>;
  setSleep(options: { minutes: number }): Promise<void>;
  getState(): Promise<QuranAudioState>;
  addListener(event: 'state', fn: (state: QuranAudioState) => void): Promise<PluginListenerHandle>;
}

/**
 * The native player (Android): keeps reciting with the screen off or another app open, with lock-screen,
 * notification, headphone and Bluetooth controls. The web build plays in the page instead.
 */
export const QuranAudio = registerPlugin<QuranAudioPlugin>('QuranAudio');

/** The native player when the app runs on Android; injected so tests can stand in for it. */
@Injectable({ providedIn: 'root' })
export class NativeAudio {
  readonly enabled = Capacitor.getPlatform() === 'android';
  readonly player: QuranAudioPlugin = QuranAudio;
}
