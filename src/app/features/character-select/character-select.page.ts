import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular';

import { CAT_META, type CatState, type CatType } from '../../core/models/chat.models';
import { RoomJoinError, SessionService } from '../../core/services/session.service';
import { CatAvatarComponent } from '../chat-room/components/cat-avatar/cat-avatar.component';

const CODE_LENGTH = 6;

@Component({
  selector: 'app-character-select',
  imports: [IonContent, CatAvatarComponent],
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
  protected readonly heroState = signal<CatState>('idle');
  protected readonly busy = signal<'create' | 'join' | null>(null);
  protected readonly error = signal<string | null>(null);

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

  protected choose(type: CatType): void {
    if (this.chosen() !== type) this.chosen.set(type);
    this.heroState.set('happy');
  }

  protected onName(event: Event): void {
    this.username.set((event.target as HTMLInputElement).value.slice(0, 32));
    this.error.set(null);
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
      const room = await this.session.createRoom();
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
            ? 'Esa sala ya tiene a sus dos gatitos.'
            : 'No existe una sala con ese código.'
          : 'No pudimos unirte a la sala. Inténtalo de nuevo.',
      );
    } finally {
      this.busy.set(null);
    }
  }

  private clean(value: string): string {
    return value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, CODE_LENGTH);
  }
}
