// Downward expander ("gate") for the recitation studio, after the noise removal: between words and ayat, what is
// left of the room's noise is turned down by 24 dB, so the pauses are quiet; the voice passes untouched. It opens
// 6 ms before a word starts (the signal is delayed by that much), and closes slowly after it ends, so neither the
// first letter nor the fading end of a word is cut.
//
// The noise level is the loudness of the quietest tenth of the last 3 seconds (in 10 ms blocks): between two words
// and ayat there are always such moments, so it follows the room without ever taking the voice for noise.
class GateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const rate = sampleRate;
    this.delay = new Float32Array(Math.round(rate * 0.006));
    this.at = 0;
    this.env = 0;
    this.gain = 1;
    this.hold = 0;
    this.holdSamples = Math.round(rate * 0.2);
    this.envAttack = Math.exp(-1 / (rate * 0.002));
    this.envRelease = Math.exp(-1 / (rate * 0.03));
    this.open = 1 - Math.exp(-1 / (rate * 0.003));
    this.close = 1 - Math.exp(-1 / (rate * 0.12));
    this.closed = 0.063; // -24 dB
    // Loudness (mean square) of 10 ms blocks over the last 3 s.
    this.blockLen = Math.round(rate * 0.01);
    this.blocks = new Float32Array(300).fill(1);
    this.sorted = new Float32Array(300);
    this.block = 0;
    this.blockSum = 0;
    this.blockFill = 0;
    this.floor = 1e-8;
    this.peak = 1e-4;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;
    const x = input[0];
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const sq = v * v;
      // Envelope (mean square, fast up, slower down).
      this.env = sq > this.env ? this.envAttack * this.env + (1 - this.envAttack) * sq : this.envRelease * this.env + (1 - this.envRelease) * sq;
      this.blockSum += sq;
      if (++this.blockFill === this.blockLen) {
        const ms = this.blockSum / this.blockLen;
        this.blocks[this.block] = ms;
        this.block = (this.block + 1) % this.blocks.length;
        this.blockSum = 0;
        this.blockFill = 0;
        if (this.block % 5 === 0) {
          this.sorted.set(this.blocks);
          this.sorted.sort();
          this.floor = Math.max(this.sorted[30], 1e-10);
        }
        this.peak = Math.max(ms, this.peak * 0.995); // the recitation's level, falling slowly
      }
      // Voice: 10 dB above the noise left (mean square x10), and within 30 dB of the recitation.
      const voice = this.env > this.floor * 10 && this.env > this.peak * 0.001;
      if (voice) this.hold = this.holdSamples;
      else if (this.hold > 0) this.hold--;
      const target = this.hold > 0 ? 1 : this.closed;
      this.gain += (target > this.gain ? this.open : this.close) * (target - this.gain);
      const delayed = this.delay[this.at];
      this.delay[this.at] = v;
      this.at = (this.at + 1) % this.delay.length;
      const y = delayed * this.gain;
      for (let c = 0; c < output.length; c++) output[c][i] = y;
    }
    return true;
  }
}

registerProcessor('studio-gate', GateProcessor);
