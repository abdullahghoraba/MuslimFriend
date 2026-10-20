import { AthkarOverlay } from './athkar-overlay';
export type AthanSound = 'none' | 'system' | 'tone' | `file:${string}`;
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
}
export interface AthanPluginMethods {
  canScheduleExactAlarms(): Promise<{ granted: boolean }>;
  openExactAlarmSettings(): Promise<void>;
  scheduleAthan(options: { events: AthanEvent[] }): Promise<{ scheduled: number; exact: boolean }>;
  cancelAthan(): Promise<void>;
  previewAthan(options: { sound: AthanSound; volume: number }): Promise<void>;
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
