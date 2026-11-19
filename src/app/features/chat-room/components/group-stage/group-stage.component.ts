import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { CAT_META, collarColor, type RoomMember } from '../../../../core/models/chat.models';

interface ShelfCat {
  id: string;
  name: string;
  png: string;
  color: string;
  me: boolean;
  online: boolean;
  typing: boolean;
}

/** Cabecera de la Manada: repisa con todos los gatitos, quién está en línea y quién escribe. */
@Component({
  selector: 'app-group-stage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './group-stage.component.html',
  styleUrl: './group-stage.component.scss',
})
export class GroupStageComponent {
  readonly members = input<readonly RoomMember[]>([]);
  readonly meId = input<string | null>(null);
  readonly onlineIds = input<ReadonlySet<string>>(new Set());
  readonly typingIds = input<ReadonlySet<string>>(new Set());
  readonly typingNames = input<readonly string[]>([]);
  readonly roomName = input<string | null>(null);
  readonly maxMembers = input(15);

  readonly leaveGroup = output<void>();

  /** Yo primero, luego los que están en línea, luego el resto (orden de llegada). */
  protected readonly cats = computed<ShelfCat[]>(() => {
    const meId = this.meId();
    const online = this.onlineIds();
    const typing = this.typingIds();
    return this.members()
      .map((m) => ({
        id: m.profile.id,
        name: m.profile.username || 'Gatito',
        png: CAT_META[m.profile.avatar_type].png,
        color: collarColor(m.collarColor),
        me: m.profile.id === meId,
        online: m.profile.id === meId || online.has(m.profile.id),
        typing: typing.has(m.profile.id),
      }))
      .sort((a, b) => Number(b.me) - Number(a.me) || Number(b.online) - Number(a.online));
  });

  protected readonly onlineCount = computed(() => this.cats().filter((c) => c.online).length);

  protected readonly typingLabel = computed(() => {
    const names = this.typingNames();
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} está escribiendo…`;
    if (names.length === 2) return `${names[0]} y ${names[1]} están escribiendo…`;
    return `${names.length} gatitos están escribiendo…`;
  });
}