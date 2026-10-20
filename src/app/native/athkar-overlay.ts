import { PluginListenerHandle, registerPlugin } from '@capacitor/core';

/** Mirrors OverlayConfig.kt. */
export interface OverlayConfig {
  enabled: boolean;
  /** Minutes between overlays; 0 = on every unlock. */
  frequencyMinutes: number;
  displaySeconds: number;
  position: 'top' | 'center' | 'bottom';
  size: 'small' | 'medium' | 'large';
  /** 0.3 – 1 */
  opacity: number;
  style: 'system' | 'light' | 'dark';
  quietHoursEnabled: boolean;
  /** Minutes after midnight. */
  quietStart: number;
  quietEnd: number;
  language: 'ar' | 'en';
  notificationTitle: string;
  notificationText: string;
  actionPause: string;
  actionStop: string;
}

export interface OverlayPoolItem {
  id: string;
  text: string;
  categoryId: string;
  repeatCount: number;
}

export type ReminderKind = 'morning' | 'evening' | 'sleep' | 'friday-kahf' | 'friday-salawat';

export interface NativeReminder {
  id: string;
  kind: ReminderKind;
  title: string;
  body: string;
  /** Epoch millis. */
  at: number;
  /** App route opened when the notification is tapped, e.g. /category/morning. */
  route?: string;
}

export interface NativeCount {
  date: string;
  dhikrId: string;
  count: number;
}

export type FallbackReason = 'fgs_not_allowed' | 'no_overlay_permission' | null;

/** Floating tasbih counter over other apps (mirrors BubbleState in OverlayStore.kt). */
export interface BubbleState {
  enabled: boolean;
  counterId: number;
  name: string;
  count: number;
  /** 0 = no target. */
  target: number;
  language: 'ar' | 'en';
}

export interface BubbleCount {
  counterId: number;
  delta: number;
  /** The counter was reset from the bubble before [delta] more taps. */
  reset: boolean;
}

export interface AthkarOverlayPlugin {
  checkOverlayPermission(): Promise<{ granted: boolean }>;
  requestOverlayPermission(): Promise<void>;
  start(options: { config: OverlayConfig }): Promise<{ started: boolean; fallbackReason: FallbackReason }>;
  stop(): Promise<void>;
  updateConfig(options: { config: OverlayConfig }): Promise<void>;
  setPool(options: { items: OverlayPoolItem[] }): Promise<{ count: number }>;
  isRunning(): Promise<{ running: boolean; enabled: boolean; pausedUntil: number; fallbackReason: FallbackReason }>;
  pause(options: { until: number }): Promise<void>;
  preview(): Promise<void>;
  clearFallbackNotice(): Promise<void>;
  getNativeCounters(options?: { clear?: boolean }): Promise<{ counts: NativeCount[] }>;
  scheduleReminders(options: { reminders: NativeReminder[] }): Promise<{ scheduled: number }>;
  cancelReminders(): Promise<void>;
  consumeLaunchRoute(): Promise<{ route: string | null }>;
  checkNotificationPermission(): Promise<{ granted: boolean }>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  openBatteryOptimizationSettings(): Promise<{ opened: boolean }>;
  openAppSettings(): Promise<void>;
  openStoreListing(): Promise<{ opened: boolean }>;
  setBubble(options: Partial<BubbleState>): Promise<{ running: boolean; fallbackReason: FallbackReason }>;
  getBubble(): Promise<BubbleState & { running: boolean }>;
  takeBubbleCounts(options?: { clear?: boolean }): Promise<{ counts: BubbleCount[] }>;
  setAppVisible(options: { visible: boolean }): Promise<void>;
  getDeviceInfo(): Promise<{ manufacturer: string; sdkInt: number }>;
  getApproximateLocation(): Promise<{ latitude: number; longitude: number }>;
  addListener(event: 'launchRoute', listener: (e: { route: string }) => void): Promise<PluginListenerHandle>;
}

/**
 * Browser stand-in so the app runs with `ng serve`. Nothing here touches the network;
 * it only logs, which keeps the overlay/reminder screens usable during web development.
 */
class AthkarOverlayWeb implements AthkarOverlayPlugin {
  private running = false;
  async checkOverlayPermission() { return { granted: true }; }
  async requestOverlayPermission() {}
  async start() { this.running = true; return { started: true, fallbackReason: null }; }
  async stop() { this.running = false; }
  async updateConfig() {}
  async setPool(options: { items: OverlayPoolItem[] }) { return { count: options.items.length }; }
  async isRunning() { return { running: this.running, enabled: this.running, pausedUntil: 0, fallbackReason: null }; }
  async pause() {}
  async preview() {}
  async clearFallbackNotice() {}
  async getNativeCounters() { return { counts: [] }; }
  async scheduleReminders(options: { reminders: NativeReminder[] }) {
    console.info('[AthkarOverlay web] reminders', options.reminders.slice(0, 5));
    return { scheduled: options.reminders.length };
  }
  async cancelReminders() {}
  async consumeLaunchRoute() { return { route: null }; }
  async checkNotificationPermission() { return { granted: true }; }
  async requestNotificationPermission() { return { granted: true }; }
  async isIgnoringBatteryOptimizations() { return { ignoring: true }; }
  async openBatteryOptimizationSettings() { return { opened: false }; }
  async openAppSettings() {}
  async openStoreListing() { return { opened: false }; }
  private bubble: BubbleState = { enabled: false, counterId: 0, name: '', count: 0, target: 33, language: 'ar' };
  async setBubble(options: Partial<BubbleState>) {
    this.bubble = { ...this.bubble, ...options };
    return { running: this.bubble.enabled, fallbackReason: null };
  }
  async getBubble() { return { ...this.bubble, running: this.bubble.enabled }; }
  async takeBubbleCounts() { return { counts: [] }; }
  async setAppVisible() {}
  async getDeviceInfo() { return { manufacturer: 'web', sdkInt: 0 }; }
  async getApproximateLocation(): Promise<{ latitude: number; longitude: number }> {
    throw new Error('UNAVAILABLE');
  }
  async addListener(): Promise<PluginListenerHandle> { return { remove: async () => {} }; }
}

export const AthkarOverlay = registerPlugin<AthkarOverlayPlugin>('AthkarOverlay', {
  web: () => new AthkarOverlayWeb(),
});
