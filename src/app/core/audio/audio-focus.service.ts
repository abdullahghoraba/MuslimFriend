import { Injectable } from '@angular/core';

/** Only one recitation sounds at a time: the mushaf's verse-by-verse player or the Listen page's sura / radio player. */
@Injectable({ providedIn: 'root' })
export class AudioFocusService {
  private owner?: { name: string; stop: () => void };

  /** [name] starts playing: whoever was playing before stops. */
  claim(name: string, stop: () => void): void {
    const previous = this.owner;
    this.owner = { name, stop };
    if (previous && previous.name !== name) previous.stop();
  }
}
