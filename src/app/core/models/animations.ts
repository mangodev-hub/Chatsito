import { animate, keyframes, style, transition, trigger } from '@angular/animations';

/** Entrada de burbujas: sube con un pequeño rebote (solo transform + opacity). */
export const bubbleIn = trigger('bubbleIn', [
  transition(':enter', [
    style({ opacity: 0, transform: 'translate3d(0, 14px, 0) scale(0.94)' }),
    animate(
      '320ms cubic-bezier(0.2, 0.9, 0.25, 1.2)',
      style({ opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }),
    ),
  ]),
]);

/**
 * Partícula viajera en arco de un gatito al otro.
 * Params: x1..x3/y1..y3 = puntos intermedios del arco, ex/ey = destino (px).
 */
export const particleArc = trigger('particleArc', [
  transition(
    ':enter',
    [
      style({ opacity: 0, transform: 'translate3d(0, 0, 0) scale(0.3) rotate(0deg)' }),
      animate(
        '{{ duration }}ms cubic-bezier(0.45, 0, 0.3, 1)',
        keyframes([
          style({ offset: 0, opacity: 0, transform: 'translate3d(0, 0, 0) scale(0.3) rotate(0deg)' }),
          style({ offset: 0.15, opacity: 1, transform: 'translate3d({{ x1 }}px, {{ y1 }}px, 0) scale(1) rotate(40deg)' }),
          style({ offset: 0.5, opacity: 1, transform: 'translate3d({{ x2 }}px, {{ y2 }}px, 0) scale(1.15) rotate(150deg)' }),
          style({ offset: 0.85, opacity: 1, transform: 'translate3d({{ x3 }}px, {{ y3 }}px, 0) scale(0.9) rotate(260deg)' }),
          style({ offset: 1, opacity: 0, transform: 'translate3d({{ ex }}px, {{ ey }}px, 0) scale(0.4) rotate(320deg)' }),
        ]),
      ),
    ],
    { params: { duration: 950, x1: 0, y1: 0, x2: 0, y2: 0, x3: 0, y3: 0, ex: 0, ey: 0 } },
  ),
]);

/** Sacudida de pantalla al recibir un poke. Se dispara con un contador incremental. */
export const screenShake = trigger('screenShake', [
  transition(':increment', [
    animate(
      '420ms ease-out',
      keyframes([
        style({ offset: 0, transform: 'translate3d(0, 0, 0)' }),
        style({ offset: 0.15, transform: 'translate3d(-8px, 0, 0) rotate(-0.6deg)' }),
        style({ offset: 0.3, transform: 'translate3d(8px, 0, 0) rotate(0.6deg)' }),
        style({ offset: 0.45, transform: 'translate3d(-6px, 0, 0)' }),
        style({ offset: 0.6, transform: 'translate3d(5px, 0, 0)' }),
        style({ offset: 0.8, transform: 'translate3d(-2px, 0, 0)' }),
        style({ offset: 1, transform: 'translate3d(0, 0, 0)' }),
      ]),
    ),
  ]),
]);

/** Sticker posado: cae sobre el borde de la burbuja. */
export const stickerDrop = trigger('stickerDrop', [
  transition(':enter', [
    style({ opacity: 0, transform: 'translate3d(0, -18px, 0) scale(0.6) rotate(-12deg)' }),
    animate(
      '380ms cubic-bezier(0.3, 1.4, 0.5, 1)',
      style({ opacity: 1, transform: 'translate3d(0, 0, 0) scale(1) rotate(0deg)' }),
    ),
  ]),
  transition(':leave', [animate('160ms ease-in', style({ opacity: 0, transform: 'scale(0.6)' }))]),
]);
