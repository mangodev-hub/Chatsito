import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { RPS_HANDS } from '../../../../core/models/chat.models';
import { RpsService, handEmoji } from '../../../../core/services/rps.service';

/** Franja compacta de piedra, papel o tijera sobre el campo de texto. No roba el foco ni tapa mensajes. */
@Component({
  selector: 'app-rps-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rps.phase() !== 'idle') {
      <div class="bar" role="status" aria-live="polite">
        @switch (rps.phase()) {
          @case ('inviting') {
            <span class="text">✊ Retaste a {{ rps.partnerName() }}… <span class="soft">esperando</span></span>
            <button type="button" class="ghost" (click)="rps.cancel()">Cancelar</button>
          }
          @case ('invited') {
            <span class="text">✊ {{ rps.partnerName() }} te reta</span>
            <span class="actions">
              <button type="button" class="primary" (click)="rps.accept()">Jugar</button>
              <button type="button" class="ghost" (click)="rps.decline()">Ahora no</button>
              <button
                type="button"
                class="ghost icon"
                aria-label="No recibir más retos"
                title="No recibir más retos"
                (click)="rps.decline(true)"
              >
                🔕
              </button>
            </span>
          }
          @case ('choosing') {
            @if (!rps.myHand()) {
              <span class="text">
                Elige
                @if (rps.partnerChose()) {
                  <span class="soft">· {{ rps.partnerName() }} ya eligió</span>
                }
              </span>
              <span class="hands">
                @for (h of hands; track h.key) {
                  <button
                    type="button"
                    class="hand"
                    [attr.aria-label]="h.label"
                    [title]="h.label"
                    (click)="rps.choose(h.key)"
                  >
                    {{ h.emoji }}
                  </button>
                }
              </span>
            } @else {
              <span class="text"
                >Elegiste {{ emoji(rps.myHand()) }}
                <span class="soft">· esperando a {{ rps.partnerName() }}…</span></span
              >
              <button type="button" class="ghost" (click)="rps.cancel()">Cancelar</button>
            }
          }
          @case ('result') {
            <span class="text result" [class.win]="rps.result() === 'win'" [class.lose]="rps.result() === 'lose'">
              {{ resultText() }}
            </span>
            <span class="actions">
              <button type="button" class="primary" [disabled]="!rps.canPlay()" (click)="rps.invite()">Revancha</button>
              <button type="button" class="ghost icon" aria-label="Cerrar" (click)="rps.close()">✕</button>
            </span>
          }
          @case ('notice') {
            <span class="text soft">{{ rps.notice() }}</span>
          }
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 0 12px;
    }

    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 46px;
      margin: 0 auto 6px;
      max-width: 720px;
      padding: 6px 8px 6px 14px;
      border: var(--sketch);
      border-radius: 16px;
      background: var(--bg-surface);
      color: var(--ink-primary);
      box-shadow: 0 2px 0 var(--border-sketch);
      font-size: 14px;
      font-weight: 700;
      animation: bar-in 220ms cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
    }

    .text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .soft {
      color: var(--ink-secondary);
      font-weight: 600;
    }

    .result.win {
      color: #3f9a5a;
    }

    .result.lose {
      color: #c25555;
    }

    .actions,
    .hands {
      flex: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    button {
      appearance: none;
      border: var(--sketch);
      border-radius: 999px;
      font: 800 13px var(--font-body);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: transform 100ms ease;

      &:active {
        transform: translateY(1px) scale(0.97);
      }

      &:disabled {
        opacity: 0.5;
      }
    }

    .primary {
      padding: 6px 14px;
      background: var(--bg-accent-warm);
      color: var(--on-accent);
      box-shadow: 0 2px 0 var(--border-sketch);
    }

    .ghost {
      padding: 6px 10px;
      background: transparent;
      color: var(--ink-secondary);
    }

    .icon {
      width: 34px;
      padding: 6px 0;
    }

    .hand {
      width: 44px;
      height: 40px;
      padding: 0;
      background: var(--bg-canvas);
      font-size: 20px;
      line-height: 1;
      box-shadow: 0 2px 0 var(--border-sketch);
    }

    @keyframes bar-in {
      from {
        opacity: 0;
        transform: translate3d(0, 8px, 0);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .bar {
        animation: none;
      }
    }
  `,
})
export class RpsBarComponent {
  protected readonly rps = inject(RpsService);
  protected readonly hands = RPS_HANDS;

  protected readonly resultText = computed(() => {
    const mine = handEmoji(this.rps.myHand());
    const theirs = handEmoji(this.rps.partnerHand());
    switch (this.rps.result()) {
      case 'win':
        return `¡Ganaste! ${mine} vence a ${theirs}`;
      case 'lose':
        return `Perdiste… ${theirs} vence a ${mine}`;
      default:
        return `¡Empate! ${mine} = ${theirs}`;
    }
  });

  protected emoji = handEmoji;
}
