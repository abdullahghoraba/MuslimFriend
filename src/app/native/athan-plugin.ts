import { AthkarOverlay } from './athkar-overlay';
/** 'athan' is the full athan bundled with the app (the default); 'tone' a short chime. */
export type AthanSound = 'none' | 'system' | 'tone' | 'athan' | `file:${string}`;
export interface AthanEvent {
  id: string;
  prayer: 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
  kind: 'athan' | 'pre' | 'iqama';
  at: number;
  title: string;
  body: string;
  sound: AthanSound;
  volume: number;
  silentMinutes?: number;
  /** Ways the user can stop the sound while it plays. */
  stopOn?: AthanStopWay[];
}
export type AthanStopWay = 'flip' | 'shake' | 'volume';
export interface AthanPluginMethods {
  canScheduleExactAlarms(): Promise<{ granted: boolean }>;
  openExactAlarmSettings(): Promise<void>;
  scheduleAthan(options: { events: AthanEvent[] }): Promise<{ scheduled: number; exact: boolean }>;
  cancelAthan(): Promise<void>;
  previewAthan(options: { sound: AthanSound; volume: number; stopOn?: AthanStopWay[] }): Promise<void>;
  stopAthan(): Promise<void>;
  hasDndAccess(): Promise<{ granted: boolean }>;
  openDndAccessSettings(): Promise<void>;
  setWidgetData(options: {
    prayers: { name: string; at: number }[];
    nextLabel: string;
    appName: string;
  }): Promise<void>;
}
export const AthanNative = AthkarOverlay as unknown as AthanPluginMethods;
