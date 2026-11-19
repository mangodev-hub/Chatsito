import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'day-night-sync.sound';

/** Sonidos suaves sintetizados con WebAudio (sin archivos). Opcional y silenciable. */
@Injectable({ providedIn: 'root' })
export class SoundService {
  readonly enabled = signal(this.restore());
  private ctx: AudioContext | null = null;

  constructor() {
    // Chrome solo deja sonar audio tras un gesto real. En pantallas táctiles el gesto válido es al LEVANTAR
    // el dedo (pointerup / touchend / click), no pointerdown. Se escucha siempre: si Android suspende el audio
    // al pasar a segundo plano, el siguiente toque lo reactiva y los mensajes que llegan vuelven a sonar.
    const unlock = (): void => {
      if (!this.enabled() || typeof AudioContext === 'undefined') return;
      this.ctx ??= new AudioContext();
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    };
    for (const type of ['pointerup', 'touchend', 'click', 'keydown'] as const) {
      document.addEventListener(type, unlock, { passive: true, capture: true });
    }
  }

  /** Sonido del collar del gatito: cascabel para Cascabel, pétalos para Margarita. */
  collar(type: 'white_cat' | 'black_cat'): void {
    if (type === 'black_cat') this.bell();
    else this.petal();
  }

  toggle(): void {
    this.enabled.update((v) => !v);
    // El toque en el botón ya es un gesto válido: aprovecharlo para activar el audio.
    if (this.enabled()) this.context();
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

  /** Margarita: tres notas de marimba suave que suben (do–mi–sol), cálidas y redondas. */
  petal(): void {
    const ctx = this.context();
    if (!ctx) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.11;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    tone.connect(ctx.destination);
    master.connect(tone);
    for (const [freq, delay, level] of [
      [523.25, 0, 0.9],
      [659.25, 0.075, 0.8],
      [783.99, 0.15, 1],
    ] as const) {
      // fundamental + armónico 4 (madera) con caída corta
      for (const [mult, amp, decay] of [
        [1, 1, 0.45],
        [4, 0.18, 0.12],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        const t = now + delay;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level * amp, t + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + decay + 0.05);
      }
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
