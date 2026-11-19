import { DatePipe } from '@angular/common';
import type { OnDestroy } from '@angular/core';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { type AnimationOptions, LottieComponent } from 'ngx-lottie';

import { bubbleIn, stickerDrop } from '../../../../core/models/animations';
import { CAT_META, type CatType, type Message, type ThemeMode } from '../../../../core/models/chat.models';
import type { Receipt } from '../../../../core/services/chat-realtime.service';

const RECEIPT_LABEL: Readonly<Record<Receipt, string>> = {
  sending: 'enviando…',
  failed: 'no se envió · toca para reintentar',
  sent: 'enviado',
  seen: 'visto',
};

const DOUBLE_TAP_MS = 320;
const PURR_INTERVAL_MS = 180;

const EMOTION_ICON: Readonly<Record<Message['emotion'], string | null>> = {
  neutral: null,
  happy: 'assets/icons/icon-sparkle-star.svg',
  love: 'assets/icons/icon-blush-paw.svg',
  alert: 'assets/icons/icon-bell.svg',
};

/** Burbuja con Hold-to-Reveal y stickers posados. */
@Component({
  selector: 'app-message-bubble',
  imports: [LottieComponent, DatePipe],
  animations: [bubbleIn, stickerDrop],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './message-bubble.component.html',
  styleUrl: './message-bubble.component.scss',
  host: {
    '[@bubbleIn]': '',
    '[class.mine]': 'mine()',
    '[class.theirs]': '!mine()',
    '[class.eclipse]': "mode() === 'eclipse'",
    '[class.from-white]': "senderType() === 'white_cat'",
    '[class.from-black]': "senderType() === 'black_cat'",
    '[class.sending]': "message().status === 'sending'",
    '[class.failed]': "message().status === 'failed'",
  },
})
export class MessageBubbleComponent implements OnDestroy {
  readonly message = input.required<Message>();
  readonly mine = input(false);
  readonly senderType = input<CatType | null>(null);
  readonly mode = input<ThemeMode>('day');
  readonly receipt = input<Receipt | null>(null);

  readonly react = output<Message>();
  readonly purr = output<void>();
  readonly retry = output<Message>();

  protected readonly revealed = signal(false);
  protected readonly stickerSrc = computed(() => {
    const s = this.message().sticker_reaction;
    return s ? CAT_META[s].png : null;
  });
  protected readonly emotionIcon = computed(() => EMOTION_ICON[this.message().emotion]);
  protected readonly receiptLabel = computed(() => {
    const r = this.receipt();
    return r ? RECEIPT_LABEL[r] : null;
  });
  protected readonly cloudOptions: AnimationOptions = {
    path: 'assets/lottie/secret-cloud.json',
    renderer: 'svg',
    autoplay: true,
    loop: true,
  };
  protected readonly cloudStyles = { width: '100%', height: '100%' };

  private lastTap = 0;
  private purrTimer: ReturnType<typeof setInterval> | null = null;

  protected onPointerDown(event: PointerEvent): void {
    if (!this.message().is_secret) return;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    this.revealed.set(true);
    this.purr.emit();
    this.stopPurr();
    this.purrTimer = setInterval(() => this.purr.emit(), PURR_INTERVAL_MS);
  }

  protected onPointerUp(): void {
    this.hide();
    if (this.message().status === 'failed') {
      this.retry.emit(this.message());
      return;
    }
    const now = Date.now();
    if (now - this.lastTap < DOUBLE_TAP_MS) {
      this.lastTap = 0;
      this.react.emit(this.message());
    } else {
      this.lastTap = now;
    }
  }

  protected hide(): void {
    this.revealed.set(false);
    this.stopPurr();
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 's' || event.key === 'S') this.react.emit(this.message());
    if (this.message().is_secret && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      this.revealed.update((v) => !v);
    }
  }

  ngOnDestroy(): void {
    this.stopPurr();
  }

  private stopPurr(): void {
    if (this.purrTimer) clearInterval(this.purrTimer);
    this.purrTimer = null;
  }
}
