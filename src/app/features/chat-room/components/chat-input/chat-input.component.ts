import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { CAT_META, type CatType, type TypingSpeed } from '../../../../core/models/chat.models';

const WPM_WINDOW_MS = 4000;
const FAST_WPM = 45;
const MAX_LENGTH = 2000;

export interface OutgoingMessage {
  content: string;
  secret: boolean;
}

/** Input con detector WPM, modo secreto y botón cascabel / flor. */
@Component({
  selector: 'app-chat-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-input.component.html',
  styleUrl: './chat-input.component.scss',
})
export class ChatInputComponent {
  readonly myType = input<CatType>('white_cat');
  readonly disabled = input(false);

  readonly send = output<OutgoingMessage>();
  readonly typing = output<TypingSpeed>();
  readonly poke = output<void>();

  protected readonly maxLength = MAX_LENGTH;
  protected readonly text = signal('');
  protected readonly secret = signal(false);
  protected readonly canSend = computed(() => this.text().trim().length > 0 && !this.disabled());
  protected readonly sendIcon = computed(() => CAT_META[this.myType()].icon);
  /** El botón de llamado usa el cascabel; si mi gatito ya es el cascabel, una huellita. */
  protected readonly pokeIcon = computed(() =>
    this.myType() === 'black_cat' ? 'assets/icons/icon-blush-paw.svg' : 'assets/icons/icon-bell.svg',
  );

  private strokes: number[] = [];

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const grew = value.length > this.text().length;
    this.text.set(value);
    if (!grew) return;
    const now = Date.now();
    this.strokes = [...this.strokes.filter((t) => now - t < WPM_WINDOW_MS), now];
    this.typing.emit(this.speed());
  }

  protected submit(event?: Event): void {
    event?.preventDefault();
    if (!this.canSend()) return;
    this.send.emit({ content: this.text().trim(), secret: this.secret() });
    this.text.set('');
    this.secret.set(false);
    this.strokes = [];
  }

  protected toggleSecret(): void {
    this.secret.update((v) => !v);
  }

  /** WPM = (caracteres / 5) por minuto en la ventana reciente. */
  private speed(): TypingSpeed {
    if (this.strokes.length < 6) return 'normal';
    const span = Math.max(this.strokes[this.strokes.length - 1] - this.strokes[0], 600);
    const wpm = this.strokes.length / 5 / (span / 60000);
    return wpm >= FAST_WPM ? 'fast' : 'normal';
  }
}
