import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'day-night-sync.sound';

/** Sonidos suaves sintetizados con WebAudio (sin archivos). Opcional y silenciable. */
@Injectable({ providedIn: 'root' })
export class SoundService {
  readonly enabled = signal(this.restore());
  private ctx: AudioContext | null = null;

  toggle(): void {
    this.enabled.update((v) => !v);
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled() ? '1' : '0');
    } catch {
      /* sin almacenamiento */
    }
  }

  /** Cascabel: dos parciales metálicos con caída rápida y un leve trémolo. */
  bell(): void {
    const ctx = this.context();
    if (!ctx) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.08;
    master.connect(ctx.destination);
    for (const [freq, delay, decay] of [
      [1568, 0, 0.9],
      [2349, 0, 0.6],
      [1568, 0.11, 0.7],
      [3136, 0.11, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(1, now + delay + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + decay);
      osc.connect(gain).connect(master);
      osc.start(now + delay);
      osc.stop(now + delay + decay + 0.05);
    }
  }

  private context(): AudioContext | null {
    if (!this.enabled() || typeof AudioContext === 'undefined') return null;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private restore(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }
}
