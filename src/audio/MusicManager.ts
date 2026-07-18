/* MusicManager — looping background track from a real audio file.
   Uses a single HTMLAudioElement (reliable looping + volume across browsers).
   Autoplay-safe: play() is only ever called from a user gesture (game start
   or the toggle). Fades in/out, pauses on tab-hide, remembers ON/OFF. */
import { MUSIC_VOLUME, MUSIC_PREF_KEY } from "../config";

export class MusicManager {
  private audio: HTMLAudioElement;
  private enabled: boolean;
  private wantPlaying = false;        // should be playing (game started + enabled)
  private fadeId: number | null = null;

  constructor(src: string, private targetVol = MUSIC_VOLUME) {
    this.audio = new Audio(src);
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.volume = 0;
    this.enabled = this.loadPref();
  }

  get isEnabled(): boolean { return this.enabled; }

  /** Begin the loop (fade in) if enabled. Must be called from a user gesture. */
  play(): void {
    this.wantPlaying = true;
    if (this.enabled) this.playAudio();
  }

  /** Fade out and pause (e.g. explicit stop). */
  stop(): void {
    this.wantPlaying = false;
    this.fadeTo(0, 700, () => this.audio.pause());
  }

  /** Tab hidden: pause immediately, keep the intent so resume() can restore. */
  suspend(): void {
    this.cancelFade();
    this.audio.pause();
  }

  /** Tab visible again: resume if it should be playing. */
  resume(): void {
    if (this.wantPlaying && this.enabled) this.playAudio();
  }

  /** HUD toggle. Returns the new enabled state. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    this.savePref();
    if (this.enabled) { if (this.wantPlaying) this.playAudio(); }
    else this.fadeTo(0, 400, () => this.audio.pause());
    return this.enabled;
  }

  private playAudio(): void {
    const p = this.audio.play();
    // Autoplay may reject until a gesture; harmless — the next gesture retries.
    if (p && typeof p.catch === "function") p.catch(() => { /* blocked */ });
    this.fadeTo(this.targetVol, 900);
  }

  private fadeTo(target: number, ms: number, done?: () => void): void {
    this.cancelFade();
    const from = this.audio.volume;
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      this.audio.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k < 1) this.fadeId = requestAnimationFrame(step);
      else { this.fadeId = null; done?.(); }
    };
    this.fadeId = requestAnimationFrame(step);
  }
  private cancelFade(): void {
    if (this.fadeId !== null) { cancelAnimationFrame(this.fadeId); this.fadeId = null; }
  }

  private loadPref(): boolean {
    try { return localStorage.getItem(MUSIC_PREF_KEY) !== "off"; } catch { return true; }
  }
  private savePref(): void {
    try { localStorage.setItem(MUSIC_PREF_KEY, this.enabled ? "on" : "off"); } catch { /* ignore */ }
  }
}
