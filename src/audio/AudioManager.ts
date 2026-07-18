/* AudioManager — ported verbatim from reference/supernova.html (validated build).
   GOLDEN RULE: behavior and visuals must remain identical. */


export class AudioManager {
  [key: string]: any;
  constructor(){ this.ctx = null; this.master = null; this.humGain = null; this.musicOn = false; }
  init(){
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    const bufferSize = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random()*2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    this.humFilter = this.ctx.createBiquadFilter();
    this.humFilter.type = "lowpass";
    this.humFilter.frequency.value = 220;
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0;
    noise.connect(this.humFilter).connect(this.humGain).connect(this.master);
    noise.start();
    // Ambient music now comes from MusicManager (real audio file), not the
    // procedural chord generator — so it is intentionally not started here.
  }
  setHum(speed01, on){
    if (!this.ctx) return;
    this.humGain.gain.setTargetAtTime(on ? 0.05 + speed01*0.09 : 0, this.ctx.currentTime, 0.2);
    this.humFilter.frequency.setTargetAtTime(180 + speed01*520, this.ctx.currentTime, 0.2);
  }
  startMusic(){
    if (this.musicOn || !this.ctx) return;
    this.musicOn = true;
    const chords = [[0,7,12,16],[-3,4,12,16],[-5,2,10,14],[-7,0,7,16]]
      .map(c => c.map(n => 220*Math.pow(2, n/12)));
    const mg = this.ctx.createGain();
    mg.gain.value = 0.05;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 900;
    mg.connect(lp).connect(this.master);
    let step = 0;
    const playChord = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const freqs = chords[step % chords.length];
      step++;
      for (const f of freqs){
        for (const det of [-4, 4]){
          const o = this.ctx.createOscillator();
          o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.028, t+1.2);
          g.gain.linearRampToValueAtTime(0.0, t+7.6);
          o.connect(g).connect(mg);
          o.start(t); o.stop(t+7.8);
        }
      }
      for (let i = 0; i < 8; i++){
        const o = this.ctx.createOscillator();
        o.type = "sine"; o.frequency.value = freqs[i%freqs.length]*2;
        const g = this.ctx.createGain();
        const st = t + i*0.95;
        g.gain.setValueAtTime(0, st);
        g.gain.linearRampToValueAtTime(0.02, st+0.03);
        g.gain.exponentialRampToValueAtTime(0.0008, st+0.7);
        o.connect(g).connect(mg);
        o.start(st); o.stop(st+0.8);
      }
      this._musicTimer = setTimeout(playChord, 7600);
    };
    playChord();
  }
  /** Suspend the generative-music scheduler (used on pause and tab-hide).
      Already-scheduled notes ring out on the audio timeline; no new chords
      are queued until startMusic() runs again. */
  stopMusic(){
    if (this._musicTimer){ clearTimeout(this._musicTimer); this._musicTimer = null; }
    this.musicOn = false;
  }
  /** Tab hidden: pause the AudioContext clock and the music scheduler.
      Never recreates the context. */
  suspendContext(){
    if (!this.ctx) return;
    this.stopMusic();
    this.ctx.suspend();
  }
  /** Tab visible again: resume the same AudioContext and, if requested,
      relaunch the music loop. */
  resumeContext(restartMusic){
    if (!this.ctx) return;
    this.ctx.resume();
    if (restartMusic) this.startMusic();
  }
  ping(){
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [f, d] of [[1320, 0], [1760, 0.05]]){
      const o = this.ctx.createOscillator();
      o.type = "sine"; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0, t+d);
      g.gain.linearRampToValueAtTime(0.11, t+d+0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t+d+0.35);
      o.connect(g).connect(this.master);
      o.start(t+d); o.stop(t+d+0.4);
    }
  }
  whoosh(){
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t+0.25);
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 400; f.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+0.3);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t+0.32);
  }
  boom(big){
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dur = big ? 1.6 : 0.7;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate*dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++){
      const e = 1 - i/d.length;
      d[i] = (Math.random()*2-1) * e * e;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(big ? 2400 : 1400, t);
    f.frequency.exponentialRampToValueAtTime(90, t+dur);
    const g = this.ctx.createGain();
    g.gain.value = big ? 0.9 : 0.5;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(big ? 90 : 70, t);
    o.frequency.exponentialRampToValueAtTime(28, t+dur*0.8);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(big ? 0.5 : 0.3, t);
    og.gain.exponentialRampToValueAtTime(0.001, t+dur);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t+dur);
  }
}
