import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

/** Downloads and Dorar cache are device data, separate from personal bookmarks/backups. */
@Injectable({ providedIn: 'root' })
export class HadithStorage {
  private database?: Promise<IDBDatabase>;
  private db(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('muslim-friend-hadith', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
    });
  }
  private async web<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const request = action(tx.objectStore('files'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? Error('storage-failed'));
    });
  }
  async read<T>(key: string): Promise<T | null> {
    if (!Capacitor.isNativePlatform()) {
      const raw = await this.web('readonly', (s) => s.get(key)) as string | undefined;
      return raw ? JSON.parse(raw) as T : null;
    }
    try {
      const { data } = await Filesystem.readFile({ path: `hadith/${key}.json`, directory: Directory.Data, encoding: Encoding.UTF8 });
      return JSON.parse(typeof data === 'string' ? data : await data.text()) as T;
    } catch { return null; }
  }
  async write(key: string, value: unknown): Promise<void> {
    const data = JSON.stringify(value);
    if (!Capacitor.isNativePlatform()) { await this.web('readwrite', (s) => s.put(data, key)); return; }
    // A cancelled/interrupted transfer never replaces a complete collection.
    const path = `hadith/${key}.json`;
    await Filesystem.writeFile({ path: `${path}.tmp`, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    await Filesystem.rename({ from: `${path}.tmp`, to: path, directory: Directory.Data, toDirectory: Directory.Data });
  }
  async remove(key: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) { await this.web('readwrite', (s) => s.delete(key)); return; }
    await Filesystem.deleteFile({ path: `hadith/${key}.json`, directory: Directory.Data });
  }
  async keys(): Promise<string[]> {
    if (!Capacitor.isNativePlatform()) return (await this.web('readonly', (s) => s.getAllKeys())).map(String);
    try {
      const { files } = await Filesystem.readdir({ path: 'hadith', directory: Directory.Data });
      return files.filter((f) => f.name.endsWith('.json')).map((f) => f.name.slice(0, -5));
    } catch { return []; }
  }
}
