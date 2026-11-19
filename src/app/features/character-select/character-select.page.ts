import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';

import { CAT_META, type CatState, type CatType, type RoomKind } from '../../core/models/chat.models';
import { RoomJoinError, SessionService } from '../../core/services/session.service';
import { InstallButtonComponent } from '../../shared/install-button/install-button.component';
import { CatAvatarComponent } from '../chat-room/components/cat-avatar/cat-avatar.component';

import { ChatListComponent } from './components/chat-list/chat-list.component';

const CODE_LENGTH = 6;

@Component({
  selector: 'app-character-select',
  imports: [IonContent, CatAvatarComponent, InstallButtonComponent, ChatListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './character-select.page.html',
  styleUrl: './character-select.page.scss',
  host: {
    '[class.theme-day]': "chosen() === 'white_cat'",
    '[class.theme-night]': "chosen() === 'black_cat'",
  },
})
export class CharacterSelectPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  /** `?code=XXXXXX` cuando se llega desde un enlace de sala. */
  readonly code = input<string | undefined>();

  protected readonly cats: readonly CatType[] = ['white_cat', 'black_cat'];
  protected readonly meta = CAT_META;
  protected readonly codeSlots = Array.from({ length: CODE_LENGTH }, (_, i) => i);

  protected readonly chosen = signal<CatType>(this.session.profile()?.avatar_type ?? 'white_cat');
  protected readonly username = signal(this.session.profile()?.username ?? '');
  protected readonly joinCode = signal('');
  /** 'duo' = chat 1 a 1 · 'group' = Manada (sala de varios gatitos). */
  protected readonly mode = signal<RoomKind>('duo');
  protected readonly groupName = signal('');
  protected readonly heroState = signal<CatState>('idle');
  protected readonly busy = signal<'create' | 'join' | null>(null);
  protected readonly error = signal<string | null>(null);

  private readonly chatList = viewChild(ChatListComponent);

  protected readonly nameValid = computed(() => this.username().trim().length > 0);
  protected readonly codeValid = computed(() => this.joinCode().length === CODE_LENGTH);

  constructor() {
    effect(() => {
      const c = this.code();
      if (c) this.joinCode.set(this.clean(c));
    });
    effect(() => {
      const night = this.chosen() === 'black_cat';
      document.body.classList.toggle('theme-night', night);
      document.body.classList.toggle('theme-day', !night);
    });
  }

  /** Ionic reutiliza esta página al volver al menú: refrescar "Tus chats" cada vez que se entra. */
  ionViewWillEnter(): void {
    void this.chatList()?.reload();
  }

  protected choose(type: CatType): void {
    if (this.chosen() !== type) this.chosen.set(type);
    this.heroState.set('happy');
  }

  protected setMode(mode: RoomKind): void {
    this.mode.set(mode);
    this.error.set(null);
  }

  protected onGroupName(event: Event): void {
    this.groupName.set((event.target as HTMLInputElement).value.slice(0, 40));
  }

  protected onName(event: Event): void {
    this.username.set((event.target as HTMLInputElement).value.slice(0, 32));
    this.error.set(null);
  }

  /** Pega el código (o el enlace completo de la sala) desde el portapapeles. */
  protected async pasteCode(): Promise<void> {
    const input = document.getElementById('room-code') as HTMLInputElement | null;
    try {
      const text = await navigator.clipboard.readText();
      const value = this.clean(text);
      if (!value) {
        this.error.set('En el portapapeles no hay un código de sala.');
        return;
      }
      if (input) input.value = value;
      this.joinCode.set(value);
      this.error.set(null);
    } catch {
      // Sin permiso para leer el portapapeles: deja el campo listo para pegar a mano.
      input?.focus();
      this.error.set('Mantén presionado sobre las casillas y elige «Pegar».');
    }
  }

  protected onCode(event: Event): void {
    const el = event.target as HTMLInputElement;
    const value = this.clean(el.value);
    el.value = value;
    this.joinCode.set(value);
    this.error.set(null);
  }

  protected async create(): Promise<void> {
    if (!this.nameValid() || this.busy()) return;
    this.busy.set('create');
    this.error.set(null);
    try {
      await this.session.saveProfile(this.username().trim(), this.chosen());
      const room =
        this.mode() === 'group'
          ? await this.session.createGroupRoom(this.groupName())
          : await this.session.createRoom();
      await this.router.navigate(['/room', room.room_code]);
    } catch {
      this.error.set('No pudimos crear la sala. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async join(): Promise<void> {
    if (!this.nameValid()) {
      this.error.set('Escribe tu nombre antes de unirte.');
      return;
    }
    if (!this.codeValid() || this.busy()) return;
    this.busy.set('join');
    this.error.set(null);
    try {
      await this.session.saveProfile(this.username().trim(), this.chosen());
      const room = await this.session.joinRoom(this.joinCode());
      await this.router.navigate(['/room', room.room_code]);
    } catch (err) {
      this.error.set(
        err instanceof RoomJoinError
          ? err.reason === 'full'
            ? 'Esa sala ya está llena de gatitos.'
            : 'No existe una sala con ese código.'
          : 'No pudimos unirte a la sala. Inténtalo de nuevo.',
      );
    } finally {
      this.busy.set(null);
    }
  }

  /** Acepta el código suelto o un enlace `…/room/ABC123`; quita tildes, espacios y símbolos. */
  private clean(value: string): string {
    const fromLink = /\/room\/([A-Za-z0-9]{6})/.exec(value);
    if (fromLink) return fromLink[1].toUpperCase();
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, CODE_LENGTH);
  }
}
