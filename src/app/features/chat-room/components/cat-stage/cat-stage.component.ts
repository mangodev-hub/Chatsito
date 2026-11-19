import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';

import { particleArc } from '../../../../core/models/animations';
import { CAT_META, type CatState, type CatType, type TypingSpeed } from '../../../../core/models/chat.models';
import type { Flight, Side } from '../../../../core/services/chat-realtime.service';
import { CatAvatarComponent } from '../cat-avatar/cat-avatar.component';

const DOUBLE_TAP_MS = 350;

interface ArcParams {
  duration: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  ex: number;
  ey: number;
}

/** "El Balcón de los Gatitos": ambos avatares frente a frente. */
@Component({
  selector: 'app-cat-stage',
  imports: [CatAvatarComponent],
  animations: [particleArc],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cat-stage.component.html',
  styleUrl: './cat-stage.component.scss',
  host: {
    '[style.--left-canvas]': 'leftCanvas()',
    '[style.--right-canvas]': 'rightCanvas()',
  },
})
export class CatStageComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly myType = input.required<CatType>();
  readonly partnerType = input<CatType | null>(null);
  readonly myState = input<CatState>('idle');
  readonly partnerState = input<CatState>('sleeping');
  readonly myReplay = input(0);
  readonly partnerReplay = input(0);
  readonly myTyping = input<TypingSpeed>('normal');
  readonly myName = input('');
  readonly partnerName = input('');
  readonly partnerOnline = input(false);
  readonly partnerTyping = input<TypingSpeed | null>(null);
  readonly roomCode = input('');
  readonly flights = input<Flight[]>([]);

  readonly poke = output<void>();
  readonly collarTap = output<void>();
  readonly oneShotDone = output<Side>();
  readonly flightDone = output<number>();

  protected readonly meta = CAT_META;
  protected readonly leftCanvas = computed(() => this.canvasOf(this.myType()));
  protected readonly rightCanvas = computed(() => this.canvasOf(this.partnerType() ?? this.myType()));
  /** La animación reemplaza el texto "escribiendo…": aquí solo queda presencia. */
  protected readonly partnerStatus = computed(() => (this.partnerOnline() ? 'en línea' : 'durmiendo… zZz'));
  /** Texto solo para lectores de pantalla. */
  protected readonly partnerTypingLabel = computed(() => {
    const t = this.partnerTyping();
    if (!t) return '';
    return `${this.partnerName() || 'Tu compañero'} está escribiendo${t === 'fast' ? ' muy rápido' : ''}`;
  });

  private lastTap = 0;

  /** Doble clic / doble toque sobre el avatar del compañero = poke en vivo. */
  protected onPartnerTap(): void {
    const now = Date.now();
    if (now - this.lastTap < DOUBLE_TAP_MS) {
      this.lastTap = 0;
      this.poke.emit();
    } else {
      this.lastTap = now;
    }
  }

  protected arcFor(flight: Flight): { value: number; params: ArcParams } {
    const width = this.host.nativeElement.clientWidth || 360;
    const dir = flight.from === 'me' ? 1 : -1;
    const ex = dir * width * 0.52;
    const lift = Math.min(110, width * 0.28);
    return {
      value: flight.id,
      params: {
        duration: 950,
        x1: ex * 0.15,
        y1: -lift * 0.55,
        x2: ex * 0.5,
        y2: -lift,
        x3: ex * 0.85,
        y3: -lift * 0.55,
        ex,
        ey: 0,
      },
    };
  }

  private canvasOf(type: CatType): string {
    return type === 'white_cat' ? 'var(--day-canvas)' : 'var(--night-canvas)';
  }
}
