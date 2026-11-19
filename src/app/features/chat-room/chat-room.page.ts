import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { AlertController, IonContent, IonFooter, IonHeader, NavController, ToastController } from '@ionic/angular';

import { screenShake } from '../../core/models/animations';
import { CAT_META, type Message, type ReactionView } from '../../core/models/chat.models';
import { ChatRealtimeService } from '../../core/services/chat-realtime.service';
import { RoomJoinError, SessionService } from '../../core/services/session.service';
import { SoundService } from '../../core/services/sound.service';
import { InstallButtonComponent } from '../../shared/install-button/install-button.component';

import { CatStageComponent } from './components/cat-stage/cat-stage.component';
import { ChatInputComponent, type OutgoingMessage } from './components/chat-input/chat-input.component';
import { GroupStageComponent } from './components/group-stage/group-stage.component';
import { MessageBubbleComponent, type ReactionPick } from './components/message-bubble/message-bubble.component';

const LOAD_OLDER_THRESHOLD_PX = 80;
const PAGING_QUIET_MS = 400;

@Component({
  selector: 'app-chat-room',
  imports: [
    IonHeader,
    IonContent,
    IonFooter,
    CatStageComponent,
    GroupStageComponent,
    MessageBubbleComponent,
    ChatInputComponent,
    InstallButtonComponent,
  ],
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
  private readonly nav = inject(NavController);
  private readonly toasts = inject(ToastController);
  private readonly alerts = inject(AlertController);

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

  /** El botón de sonido lleva el collar de mi gatito: margarita o cascabel. */
  protected readonly soundIcon = computed(() => CAT_META[this.chat.myType()].icon);
  protected readonly connectionLabel = computed(() => {
    switch (this.chat.connection()) {
      case 'offline':
        return 'Sin conexión · tus mensajes esperan';
      case 'connecting':
        return this.ready() ? 'Reconectando…' : null;
      default:
        return null;
    }
  });
  /** El compañero liberó su lugar: aún no ha vuelto a entrar. */
  protected readonly partnerReleased = computed(() => {
    const room = this.chat.room();
    return !!room?.released_user && room.released_user === this.chat.partner()?.id;
  });

  /** Constante para burbujas sin reacciones (evita crear un arreglo nuevo en cada render). */
  protected readonly noReactions: readonly ReactionView[] = [];
  private lastBottomId: string | null = null;
  private pagingQuietUntil = 0;
  /** Token de la sesión de chat que abrió esta página. */
  private chatToken: number | null = null;

  constructor() {
    // Solo baja al final cuando llega un mensaje nuevo abajo (no al cargar los anteriores arriba).
    effect(() => {
      const list = this.chat.messages();
      const last = list[list.length - 1];
      if (!last || last.id === this.lastBottomId) return;
      const first = this.lastBottomId === null;
      this.lastBottomId = last.id;
      setTimeout(() => void this.content()?.scrollToBottom(first ? 0 : 280), 30);
    });
    effect(() => {
      document.body.classList.toggle('theme-night', this.tokenTheme() === 'night');
      document.body.classList.toggle('theme-day', this.tokenTheme() === 'day');
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const me = await this.session.currentProfile();
      if (!me) {
        await this.nav.navigateRoot(['/'], { queryParams: { code: this.code() } });
        return;
      }
      const room = await this.session.joinRoom(this.code());
      this.chatToken = await this.chat.joinRoom(room, me);
      this.ready.set(true);
    } catch (err) {
      const msg =
        err instanceof RoomJoinError
          ? err.reason === 'full'
            ? 'Esta sala ya está llena 🐾 Si eras tú en otro teléfono, pide que liberen tu lugar.'
            : 'No encontramos esa sala'
          : 'No pudimos conectar con la sala';
      await this.toast(msg);
      await this.nav.navigateRoot(['/']);
    }
  }

  ngOnDestroy(): void {
    if (this.chatToken !== null) void this.chat.leaveRoom(this.chatToken);
  }

  protected async onSend(msg: OutgoingMessage): Promise<void> {
    try {
      await this.chat.sendMessage(msg.content, msg.secret);
    } catch {
      await this.toast('No se pudo enviar. Toca el mensaje para reintentar.');
    }
  }

  protected async onRetry(message: Message): Promise<void> {
    try {
      await this.chat.retryMessage(message);
    } catch {
      await this.toast('Sigue sin enviarse. Revisa tu conexión.');
    }
  }

  protected async onScroll(event: CustomEvent<{ scrollTop: number }>): Promise<void> {
    if (Date.now() < this.pagingQuietUntil) return;
    if (event.detail.scrollTop < LOAD_OLDER_THRESHOLD_PX) await this.loadOlder();
  }

  /** Carga la página anterior y conserva la posición de lectura. */
  protected async loadOlder(): Promise<void> {
    const content = this.content();
    if (!content || this.chat.loadingOlder() || !this.chat.hasOlder()) return;
    const el = await content.getScrollElement();
    const fromBottom = el.scrollHeight - el.scrollTop;
    try {
      const added = await this.chat.loadOlder();
      // Evita que el salto de posición dispare otra carga en cadena.
      this.pagingQuietUntil = Date.now() + PAGING_QUIET_MS;
      if (added > 0) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - fromBottom));
    } catch {
      await this.toast('No pudimos cargar los mensajes anteriores');
    }
  }

  /** Tu compañero cambió de teléfono o borró la app: libera su asiento para que vuelva con el código. */
  protected async confirmRelease(): Promise<void> {
    const name = this.chat.partner()?.username || 'tu compañero';
    const alert = await this.alerts.create({
      header: `¿${name} cambió de teléfono?`,
      message: `Libera su lugar y podrá volver a entrar con el código ${this.code().toUpperCase()}. Sus mensajes se conservan.`,
      cssClass: 'alert-sketch',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Liberar su lugar', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;
    try {
      await this.chat.releasePartnerSeat();
      await this.toast(`Listo: ${name} puede volver con el código ${this.code().toUpperCase()}`);
    } catch {
      await this.toast('No se pudo liberar su lugar');
    }
  }

  /** Manada: el mensaje abre una racha nueva (otro gatito habló antes) → lleva nombre y mini gatito. */
  protected startsRun(index: number): boolean {
    const list = this.chat.messages();
    const current = list[index];
    if (!current || current.sender_id === this.chat.me()?.id) return false;
    return index === 0 || list[index - 1].sender_id !== current.sender_id;
  }

  /** Salir de la Manada: deja de ser miembro y vuelve al menú. */
  protected async confirmLeaveGroup(): Promise<void> {
    const name = this.chat.room()?.name || 'la manada';
    const alert = await this.alerts.create({
      header: `¿Salir de ${name}?`,
      message: `Dejarás de recibir sus mensajes. Puedes volver con el código ${this.code().toUpperCase()} si queda lugar.`,
      cssClass: 'alert-sketch',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Salir', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;
    try {
      await this.chat.leaveGroup();
      await this.nav.navigateRoot(['/']);
    } catch {
      await this.toast('No se pudo salir de la manada');
    }
  }

  protected onReact(message: Message): void {
    void this.chat.toggleSticker(message);
  }

  /** Reacción con una carita de gatito (mantener presionado un mensaje). */
  protected async onReactWith({ message, reaction }: ReactionPick): Promise<void> {
    try {
      await this.chat.react(message, reaction);
    } catch {
      await this.toast('No se pudo reaccionar. Revisa tu conexión.');
    }
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
    // Raíz nueva: la página de sala se destruye y la próxima entrada empieza limpia.
    await this.nav.navigateRoot(['/']);
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toasts.create({ message, duration: 2200, position: 'top', cssClass: 'toast-sketch' });
    await t.present();
  }
}