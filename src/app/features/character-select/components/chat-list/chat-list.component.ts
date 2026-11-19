import { ChangeDetectionStrategy, Component, type OnDestroy, type OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';

import { CAT_META, type RoomSummary } from '../../../../core/models/chat.models';
import { SessionService } from '../../../../core/services/session.service';

/** "Tus chats": salas en las que has estado, con último mensaje, no leídos y opciones para eliminar. */
@Component({
  selector: 'app-chat-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-list.component.html',
  styleUrl: './chat-list.component.scss',
})
export class ChatListComponent implements OnInit, OnDestroy {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly sheets = inject(ActionSheetController);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);

  protected readonly rooms = signal<RoomSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly meta = CAT_META;

  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') void this.reload();
  };

  ngOnInit(): void {
    void this.reload();
    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  async reload(): Promise<void> {
    try {
      this.rooms.set(await this.session.myRooms());
      this.failed.set(false);
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected open(room: RoomSummary): void {
    void this.router.navigate(['/room', room.code]);
  }

  protected title(room: RoomSummary): string {
    if (room.kind === 'group') return room.name || 'Manada';
    return room.partnerName ?? 'Esperando a alguien…';
  }

  protected subtitle(room: RoomSummary): string {
    if (!room.lastAt) {
      return room.kind === 'duo' && !room.partnerName ? `Comparte el código ${room.code}` : 'Sin mensajes todavía';
    }
    const who = room.lastFromMe ? 'Tú: ' : '';
    return who + (room.lastIsSecret ? '✦ mensaje secreto' : (room.lastContent ?? ''));
  }

  /** "10:42", "ayer" o "17/11". */
  protected when(room: RoomSummary): string {
    const iso = room.lastAt ?? room.createdAt;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const same = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
    if (same(d, today)) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    if (same(d, yesterday)) return 'ayer';
    return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' });
  }

  protected avatars(room: RoomSummary): string[] {
    if (room.kind === 'group') return room.memberTypes.slice(0, 3).map((t) => CAT_META[t].png);
    return room.partnerType ? [CAT_META[room.partnerType].png] : [];
  }

  protected async options(room: RoomSummary, event: Event): Promise<void> {
    event.stopPropagation();
    const buttons = [
      { text: 'Quitar de mi lista', role: 'hide' },
      room.kind === 'duo'
        ? { text: 'Borrar para las dos', role: 'destructive', data: 'delete' }
        : { text: 'Salir de la Manada', role: 'destructive', data: 'leave' },
      { text: 'Cancelar', role: 'cancel' },
    ];
    const sheet = await this.sheets.create({
      header: this.title(room),
      subHeader: room.kind === 'duo' ? `Chat 1 a 1 · ${room.code}` : `Manada · ${room.code}`,
      cssClass: 'sheet-sketch',
      buttons,
    });
    await sheet.present();
    const { role, data } = await sheet.onDidDismiss<string>();
    if (role === 'hide') await this.hide(room);
    else if (data === 'delete') await this.confirmDelete(room);
    else if (data === 'leave') await this.confirmLeave(room);
  }

  private async hide(room: RoomSummary): Promise<void> {
    const before = this.rooms();
    this.rooms.set(before.filter((r) => r.roomId !== room.roomId));
    try {
      await this.session.hideRoom(room.roomId);
      await this.toast('Quitado de tu lista. Si te escriben, vuelve a aparecer.');
    } catch {
      this.rooms.set(before);
      await this.toast('No se pudo quitar. Revisa tu conexión.');
    }
  }

  /** Segunda confirmación: borrar para las dos no tiene vuelta atrás. */
  private async confirmDelete(room: RoomSummary): Promise<void> {
    const who = room.partnerName ?? 'la otra persona';
    const alert = await this.alerts.create({
      header: '¿Borrar para las dos?',
      message: `Se borrarán todos los mensajes con ${who}, también en su teléfono. No se puede deshacer.`,
      cssClass: 'alert-sketch',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Borrar para siempre', role: 'confirm', cssClass: 'alert-danger' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;
    try {
      await this.session.deleteRoom(room.roomId);
      this.rooms.update((list) => list.filter((r) => r.roomId !== room.roomId));
      await this.toast('Chat borrado 🐾');
    } catch {
      await this.toast('No se pudo borrar. Revisa tu conexión.');
    }
  }

  private async confirmLeave(room: RoomSummary): Promise<void> {
    const alert = await this.alerts.create({
      header: '¿Salir de la Manada?',
      message: 'Tus mensajes se quedan en el grupo. Podrás volver con el código.',
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
      await this.session.leaveGroup(room.roomId);
      this.rooms.update((list) => list.filter((r) => r.roomId !== room.roomId));
      await this.toast('Saliste de la Manada');
    } catch {
      await this.toast('No se pudo salir. Revisa tu conexión.');
    }
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toasts.create({ message, duration: 2400, position: 'top', cssClass: 'toast-sketch' });
    await t.present();
  }
}
