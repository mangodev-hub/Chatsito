import type {
  OnDestroy,
  OnInit} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonFooter, IonHeader, ToastController } from '@ionic/angular';

import { screenShake } from '../../core/models/animations';
import type { Message } from '../../core/models/chat.models';
import { ChatRealtimeService } from '../../core/services/chat-realtime.service';
import { RoomJoinError, SessionService } from '../../core/services/session.service';
import { SoundService } from '../../core/services/sound.service';

import { CatStageComponent } from './components/cat-stage/cat-stage.component';
import { ChatInputComponent, type OutgoingMessage } from './components/chat-input/chat-input.component';
import { MessageBubbleComponent } from './components/message-bubble/message-bubble.component';

@Component({
  selector: 'app-chat-room',
  imports: [IonHeader, IonContent, IonFooter, CatStageComponent, MessageBubbleComponent, ChatInputComponent],
  animations: [screenShake],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-room.page.html',
  styleUrl: './chat-room.page.scss',
  host: {
    '[@screenShake]': 'chat.pokeReceived()',
    '[class.theme-day]': "tokenTheme() === 'day'",
    '[class.theme-night]': "tokenTheme() === 'night'",
    '[class.mode-eclipse]': "chat.activeTheme() === 'eclipse'",
    '[class.bias-white]': "chat.lastSenderType() === 'white_cat'",
    '[class.bias-black]': "chat.lastSenderType() === 'black_cat'",
  },
})
export class ChatRoomPage implements OnInit, OnDestroy {
  protected readonly chat = inject(ChatRealtimeService);
  protected readonly sound = inject(SoundService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastController);

  /** Parámetro de ruta `room/:code` (withComponentInputBinding). */
  readonly code = input.required<string>();

  protected readonly ready = signal(false);
  protected readonly copied = signal(false);
  private readonly content = viewChild(IonContent);

  /** Los tokens de UI (input, cabecera) siguen mi gatito; Eclipse cambia solo el fondo y las burbujas. */
  protected readonly tokenTheme = computed(() => {
    const t = this.chat.activeTheme();
    return t === 'eclipse' ? (this.chat.myType() === 'white_cat' ? 'day' : 'night') : t;
  });

  constructor() {
    effect(() => {
      const count = this.chat.messages().length;
      if (count > 0) setTimeout(() => void this.content()?.scrollToBottom(280), 30);
    });
    effect(() => {
      document.body.classList.toggle('theme-night', this.tokenTheme() === 'night');
      document.body.classList.toggle('theme-day', this.tokenTheme() === 'day');
    });
  }

  async ngOnInit(): Promise<void> {
    const me = this.session.profile();
    if (!me) {
      await this.router.navigate(['/'], { queryParams: { code: this.code() } });
      return;
    }
    try {
      const room = await this.session.joinRoom(this.code());
      await this.chat.joinRoom(room, me);
      this.ready.set(true);
    } catch (err) {
      const msg =
        err instanceof RoomJoinError
          ? err.reason === 'full'
            ? 'Esta sala ya tiene dos gatitos 🐾'
            : 'No encontramos esa sala'
          : 'No pudimos conectar con la sala';
      await this.toast(msg);
      await this.router.navigate(['/']);
    }
  }

  ngOnDestroy(): void {
    void this.chat.leaveRoom();
  }

  protected async onSend(msg: OutgoingMessage): Promise<void> {
    try {
      await this.chat.sendMessage(msg.content, msg.secret);
    } catch {
      await this.toast('El mensaje no se pudo enviar');
    }
  }

  protected onReact(message: Message): void {
    void this.chat.toggleSticker(message);
  }

  protected async copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.code().toUpperCase());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    } catch {
      await this.toast(`Código: ${this.code().toUpperCase()}`);
    }
  }

  protected async leave(): Promise<void> {
    await this.router.navigate(['/']);
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toasts.create({ message, duration: 2200, position: 'top', cssClass: 'toast-sketch' });
    await t.present();
  }
}
