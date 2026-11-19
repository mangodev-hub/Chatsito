import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { AnimationItem } from 'lottie-web';
import { type AnimationOptions, LottieComponent } from 'ngx-lottie';

import {
  CAT_META,
  CAT_SEGMENTS,
  type CatState,
  type CatType,
  type TypingSpeed,
} from '../../../../core/models/chat.models';

const FAST_TYPING_SPEED = 1.7;

/**
 * Reproductor Lottie del gatito con rig por piezas (orejas, cola, patitas, collar).
 * Cada cambio de `state` (o de `replay`) ejecuta playSegments() con el rango del estado.
 */
@Component({
  selector: 'app-cat-avatar',
  imports: [LottieComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-lottie
      [options]="options()"
      [styles]="lottieStyles"
      (animationCreated)="onCreated($event)"
      (domLoaded)="loaded.set(true)"
      (complete)="onComplete()"
    />
  `,
  styles: `
    :host {
      display: block;
      width: var(--cat-size, 150px);
      aspect-ratio: 1;
      filter: var(--sticker-shadow);
      will-change: transform;
      transform-origin: 50% 92%;
      pointer-events: none;
    }
  `,
})
export class CatAvatarComponent {
  readonly type = input.required<CatType>();
  readonly state = input<CatState>('idle');
  /** Contador para repetir un estado de un solo disparo (dos pokes seguidos). */
  readonly replay = input(0);
  /** Velocidad de tecleo: las patitas golpean al ritmo del otro usuario. */
  readonly typingSpeed = input<TypingSpeed | null>(null);
  readonly oneShotDone = output<void>();

  protected readonly item = signal<AnimationItem | null>(null);
  /** playSegments() antes de que el JSON cargue deja la animación en un frame equivocado. */
  protected readonly loaded = signal(false);
  protected readonly lottieStyles = { width: '100%', height: '100%' };
  protected readonly options = computed<AnimationOptions>(() => ({
    path: CAT_META[this.type()].lottie,
    renderer: 'svg',
    autoplay: false,
    loop: false,
  }));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private lastState: CatState | null = null;

  constructor() {
    // Cada segmento Lottie arranca en su propia pose: un squash corto disimula el salto entre poses.
    effect(() => {
      const state = this.state();
      this.replay();
      if (!this.loaded()) return;
      if (this.lastState !== null && !this.reducedMotion) this.settle();
      this.lastState = state;
    });
    effect(() => {
      const item = this.item();
      const segment = CAT_SEGMENTS[this.state()];
      this.replay();
      if (!item || !this.loaded()) return;
      item.loop = segment.loop;
      item.playSegments(segment.frames, true);
    });
    effect(() => {
      const item = this.item();
      if (!item) return;
      const fast = this.state() === 'typing' && this.typingSpeed() === 'fast';
      item.setSpeed(fast ? FAST_TYPING_SPEED : 1);
    });
  }

  protected onCreated(item: AnimationItem): void {
    this.loaded.set(false);
    this.item.set(item);
  }

  private settle(): void {
    this.host.nativeElement.animate(
      [
        { transform: 'scale(1.04, 0.95)', offset: 0 },
        { transform: 'scale(0.98, 1.02)', offset: 0.55 },
        { transform: 'none', offset: 1 },
      ],
      { duration: 260, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
    );
  }

  protected onComplete(): void {
    if (!CAT_SEGMENTS[this.state()].loop) this.oneShotDone.emit();
  }
}
