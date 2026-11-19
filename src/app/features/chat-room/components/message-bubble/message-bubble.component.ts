import { DatePipe } from '@angular/common';
import type { OnDestroy } from '@angular/core';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { type AnimationOptions, LottieComponent } from 'ngx-lottie';

import { bubbleIn, stickerDrop } from '../../../../core/models/animations';
import {
  CAT_META,
  REACTIONS,
  type CatType,
  type Message,
  type Reaction,
  type ReactionView,
  type ThemeMode,
} from '../../../../core/models/chat.models';
import type { Receipt } from '../../../../core/services/chat-realtime.service';
import { CatFaceComponent } from '../../../../shared/cat-face/cat-face.component';

export interface ReactionPick {
  message: Message;
  reaction: Reaction;
}

const RECEIPT_LABEL: Readonly<Record<Receipt, string>> = {
  sending: 'enviando…',
  failed: 'no se envió · toca para reintentar',
  sent: 'enviado',
  seen: 'visto',
};

const DOUBLE_TAP_MS = 320;
const PURR_INTERVAL_MS = 180;
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;
/** Si la burbuja está muy arriba, el selector se abre debajo para no quedar tapado. */
const PICKER_FLIP_TOP_PX = 150;

const EMOTION_ICON: Readonly<Record<Message['emotion'], string | null>> = {
  neutral: null,
  happy: 'assets/icons/icon-sparkle-star.svg',
  love: 'assets/icons/icon-blush-paw.svg',
  alert: 'assets/icons/icon-bell.svg',
};

/** Burbuja con Hold-to-Reveal, stickers posados y reacciones con caritas de gatito (mantener presionado). */
@Component({
  selector: 'app-message-bubble',
  imports: [LottieComponent, DatePipe, CatFaceComponent],
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
    '[class.has-reactions]': 'reactions().length > 0',
    '[class.picking]': 'pickerOpen()',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'closePicker()',
  },
})
export class MessageBubbleComponent implements OnDestroy {
  readonly message = input.required<Message>();
  readonly mine = input(false);
  readonly senderType = input<CatType | null>(null);
  readonly mode = input<ThemeMode>('day');
  readonly receipt = input<Receipt | null>(null);
  /** Mi gatito: las caritas del selector son las suyas. */
  readonly myType = input<CatType>('white_cat');
  readonly reactions = input<readonly ReactionView[]>([]);

  readonly react = output<Message>();
  readonly purr = output<void>();
  readonly retry = output<Message>();
  readonly reactWith = output<ReactionPick>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly reactionOptions = REACTIONS;
  protected readonly pickerOpen = signal(false);
  protected readonly pickerBelow = signal(false);
  protected readonly myReaction = computed(() => this.reactions().find((r) => r.mine)?.reaction ?? null);
  protected readonly reactionsLabel = computed(() =>
    this.reactions()
      .map((r) => `${r.mine ? 'Tú' : CAT_META[r.catType].name}: ${REACTIONS.find((o) => o.key === r.reaction)?.label}`)
      .join(', '),
  );

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
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressStart: { x: number; y: number } | null = null;
  private longPressed = false;

  protected onPointerDown(event: PointerEvent): void {
    // Mantener presionado (cualquier mensaje ya enviado) abre las caritas para reaccionar.
    this.longPressed = false;
    this.clearPress();
    if (!this.message().status) {
      this.pressStart = { x: event.clientX, y: event.clientY };
      this.pressTimer = setTimeout(() => {
        this.pressTimer = null;
        this.longPressed = true;
        this.openPicker();
      }, LONG_PRESS_MS);
    }
    if (!this.message().is_secret) return;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    this.revealed.set(true);
    this.purr.emit();
    this.stopPurr();
    this.purrTimer = setInterval(() => this.purr.emit(), PURR_INTERVAL_MS);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.pressStart) return;
    const dx = event.clientX - this.pressStart.x;
    const dy = event.clientY - this.pressStart.y;
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) this.clearPress();
  }

  protected onPointerUp(): void {
    this.hide();
    this.clearPress();
    if (this.longPressed) {
      this.longPressed = false;
      this.lastTap = 0;
      return;
    }
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

  protected onPointerCancel(): void {
    this.hide();
    this.clearPress();
  }

  protected openPicker(): void {
    if (this.message().status) return;
    const top = this.host.nativeElement.getBoundingClientRect().top;
    this.pickerBelow.set(top < PICKER_FLIP_TOP_PX);
    this.pickerOpen.set(true);
    this.purr.emit();
  }

  protected closePicker(): void {
    this.pickerOpen.set(false);
  }

  protected pick(reaction: Reaction): void {
    this.pickerOpen.set(false);
    this.reactWith.emit({ message: this.message(), reaction });
  }

  protected onDocumentPointerDown(event: PointerEvent): void {
    if (this.pickerOpen() && !this.host.nativeElement.contains(event.target as Node)) this.pickerOpen.set(false);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 's' || event.key === 'S') this.react.emit(this.message());
    if (event.key === 'r' || event.key === 'R') this.openPicker();
    if (this.message().is_secret && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      this.revealed.update((v) => !v);
    }
  }

  ngOnDestroy(): void {
    this.stopPurr();
    this.clearPress();
  }

  private clearPress(): void {
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = null;
    this.pressStart = null;
  }

  private stopPurr(): void {
    if (this.purrTimer) clearInterval(this.purrTimer);
    this.purrTimer = null;
  }
}
