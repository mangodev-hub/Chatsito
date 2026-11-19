import { Injectable, computed, inject, signal } from '@angular/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  type BroadcastEvent,
  type CatState,
  type CatType,
  type Message,
  type PresencePayload,
  type Profile,
  type Room,
  type RoomMember,
  type ThemeMode,
  type TypingSpeed,
  type Emotion,
  type Reaction,
  type ReactionView,
  CAT_META,
  collarColor,
  detectEmotion,
  isOneShot,
  catStateForReaction,
  isReaction,
  reactionFor,
} from '../models/chat.models';

import { SessionService } from './session.service';
import { SoundService } from './sound.service';
import { SupabaseService } from './supabase.service';

export type Side = 'me' | 'partner';

export type Connection = 'connecting' | 'online' | 'offline';

/** Estado de un mensaje propio, para la línea pequeña bajo la burbuja. */
export type Receipt = 'sending' | 'failed' | 'sent' | 'seen';

export interface Flight {
  id: number;
  from: Side;
  icon: string;
}

const TYPING_DEBOUNCE_MS = 300;
const TYPING_IDLE_MS = 1600;
const PARTNER_TYPING_TIMEOUT_MS = 2500;
const PAGE_SIZE = 50;
const CATCH_UP_LIMIT = 500;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
const MARK_READ_DEBOUNCE_MS = 400;

/** Conecta Presence, Broadcast y Postgres Changes de Supabase con Signals. */
@Injectable({ providedIn: 'root' })
export class ChatRealtimeService {
  private readonly db = inject(SupabaseService).client;
  private readonly session = inject(SessionService);
  private readonly sound = inject(SoundService);

  // ---- estado base
  readonly room = signal<Room | null>(null);
  readonly me = signal<Profile | null>(null);
  readonly partner = signal<Profile | null>(null);
  readonly messages = signal<Message[]>([]);
  readonly hasOlder = signal(false);
  readonly loadingOlder = signal(false);
  readonly connection = signal<Connection>('connecting');
  /** Hasta dónde leyó el compañero (servidor, `room_reads`). */
  readonly partnerReadAt = signal<string | null>(null);
  /** Reacciones: mensaje → (usuario → expresión). */
  private readonly reactionRows = signal<ReadonlyMap<string, ReadonlyMap<string, Reaction>>>(new Map());
  readonly isPartnerOnline = signal(false);
  readonly partnerTypingSpeed = signal<TypingSpeed | null>(null);
  readonly myTypingSpeed = signal<TypingSpeed>('normal');
  readonly myCatState = signal<CatState>('idle');
  private readonly partnerAction = signal<CatState>('idle');
  /** Se incrementan en cada estado de un solo disparo para poder repetirlo (dos pokes seguidos). */
  readonly myStateTick = signal(0);
  readonly partnerStateTick = signal(0);
  /** Reacción encadenada tras un segmento de un solo disparo (p. ej. message → happy). */
  private readonly pending: Record<Side, CatState | null> = { me: null, partner: null };

  // ---- Manada (salas de grupo)
  /** Miembros de la Manada con su color de collar (vacío en salas 1 a 1). */
  readonly members = signal<RoomMember[]>([]);
  /** Ids de los miembros con la app abierta y a la vista. */
  readonly onlineIds = signal<ReadonlySet<string>>(new Set());
  /** Ids de los miembros que están escribiendo ahora mismo. */
  readonly typingIds = signal<ReadonlySet<string>>(new Set());
  /** Última lectura de cada miembro (servidor, `room_reads`). */
  private readonly readsByUser = signal<ReadonlyMap<string, string>>(new Map());
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---- pulsos de eventos para la UI
  readonly pokeReceived = signal(0);
  readonly flights = signal<Flight[]>([]);

  // ---- derivados
  readonly isGroup = computed(() => this.room()?.kind === 'group');
  private readonly memberById = computed(() => new Map(this.members().map((m) => [m.profile.id, m])));
  /** Nombres de quienes escriben (sin mí), para "Nube y Mango están escribiendo…". */
  readonly typingNames = computed<string[]>(() =>
    [...this.typingIds()].map((id) => this.memberById().get(id)?.profile.username || 'Un gatito'),
  );
  /** Manada: cuántos miembros (sin mí) vieron mi último mensaje. */
  readonly seenCounts = computed<ReadonlyMap<string, number>>(() => {
    const map = new Map<string, number>();
    const meId = this.me()?.id;
    if (!this.isGroup() || !meId) return map;
    const last = [...this.messages()].reverse().find((m) => m.sender_id === meId && !m.status);
    if (!last) return map;
    const at = toIso(last.created_at);
    let count = 0;
    for (const [userId, readAt] of this.readsByUser()) {
      if (userId !== meId && this.memberById().has(userId) && readAt >= at) count++;
    }
    if (count > 0) map.set(last.id, count);
    return map;
  });
  readonly partnerCatState = computed<CatState>(() => (this.isPartnerOnline() ? this.partnerAction() : 'sleeping'));
  readonly myType = computed<CatType>(() => this.me()?.avatar_type ?? 'white_cat');
  readonly partnerType = computed<CatType | null>(() => this.partner()?.avatar_type ?? null);
  readonly activeTheme = computed<ThemeMode>(() => {
    const mine = this.myType();
    const theirs = this.partnerType();
    if (!theirs || theirs === mine) return CAT_META[mine].theme;
    return 'eclipse';
  });
  /** "visto" va en mi último mensaje leído; "enviado" en el último si aún no lo ha leído. */
  readonly receipts = computed<ReadonlyMap<string, Receipt>>(() => {
    const meId = this.me()?.id;
    const readAt = this.partnerReadAt();
    const map = new Map<string, Receipt>();
    let lastConfirmed: Message | null = null;
    let lastSeen: Message | null = null;
    const group = this.isGroup();
    for (const m of this.messages()) {
      if (m.sender_id !== meId) continue;
      if (m.status) {
        map.set(m.id, m.status);
        continue;
      }
      lastConfirmed = m;
      if (!group && readAt && toIso(m.created_at) <= readAt) lastSeen = m;
    }
    if (group && lastConfirmed) {
      map.set(lastConfirmed.id, this.seenCounts().has(lastConfirmed.id) ? 'seen' : 'sent');
      return map;
    }
    if (lastSeen) map.set(lastSeen.id, 'seen');
    if (lastConfirmed && lastConfirmed !== lastSeen) map.set(lastConfirmed.id, 'sent');
    return map;
  });
  /** Tipo de gatito del último emisor: orienta el degradado del modo Eclipse. */
  /** Reacciones listas para pintar en cada burbuja (con el gatito de quien reaccionó). */
  readonly reactionViews = computed<ReadonlyMap<string, readonly ReactionView[]>>(() => {
    const meId = this.me()?.id;
    const out = new Map<string, ReactionView[]>();
    for (const [messageId, byUser] of this.reactionRows()) {
      const list: ReactionView[] = [];
      for (const [userId, reaction] of byUser) {
        const catType = this.senderType(userId);
        if (catType) list.push({ userId, catType, reaction, mine: userId === meId });
      }
      list.sort((a, b) => Number(a.mine) - Number(b.mine));
      if (list.length) out.set(messageId, list);
    }
    return out;
  });
  readonly lastSenderType = computed<CatType | null>(() => {
    const list = this.messages();
    const last = list[list.length - 1];
    if (!last) return null;
    return this.senderType(last.sender_id);
  });

  private channel: RealtimeChannel | null = null;
  /** Cambia en cada join/leave: invalida reintentos y respuestas de una sala anterior. */
  private generation = 0;
  private subscribedOnce = false;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private markReadTimer: ReturnType<typeof setTimeout> | null = null;
  private myReadAt: string | null = null;
  /** Última `updated_at` de reacciones vista: para recuperar las que llegaron sin conexión. */
  private reactionsSyncedAt: string | null = null;
  private flightSeq = 0;
  private lastTypingSent = 0;
  private typingTrailing: ReturnType<typeof setTimeout> | null = null;
  private typingIdle: ReturnType<typeof setTimeout> | null = null;
  private partnerTypingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibility = (): void => {
    void this.trackPresence();
    if (document.visibilityState === 'visible') {
      void this.catchUp();
      this.scheduleMarkRead();
    }
  };
  private readonly onOnline = (): void => {
    if (this.connection() !== 'online') this.reconnectNow();
    else void this.catchUp();
  };
  private readonly onOffline = (): void => this.connection.set('offline');

  senderType(senderId: string): CatType | null {
    if (senderId === this.me()?.id) return this.myType();
    if (senderId === this.partner()?.id) return this.partnerType();
    return this.memberById().get(senderId)?.profile.avatar_type ?? null;
  }

  /** Manada: nombre de quien envió el mensaje. */
  memberName(userId: string): string {
    return this.memberById().get(userId)?.profile.username || 'Gatito';
  }

  /** Manada: color del collar de un miembro. */
  memberColor(userId: string): string {
    return collarColor(this.memberById().get(userId)?.collarColor ?? 0);
  }

  /** Devuelve un token de sesión: solo quien lo tiene puede cerrar esta sesión con `leaveRoom(token)`. */
  async joinRoom(room: Room, me: Profile): Promise<number> {
    await this.leaveRoom();
    const gen = ++this.generation;
    this.room.set(room);
    this.me.set(me);
    this.myCatState.set('idle');
    this.partnerAction.set('idle');
    this.subscribedOnce = false;
    this.retryCount = 0;
    await Promise.all([
      this.loadPartner(room),
      this.loadMembers(room),
      this.loadMessages(room.id),
      this.loadReads(room.id),
    ]);
    if (gen !== this.generation) return gen;

    this.subscribe(room, me);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.scheduleMarkRead();
    return gen;
  }

  /** Con `token`, solo cierra si esa sesión sigue activa (una página vieja no cierra la de una nueva). */
  async leaveRoom(token?: number): Promise<void> {
    if (token !== undefined && token !== this.generation) return;
    this.generation++;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    for (const t of [
      this.typingTrailing,
      this.typingIdle,
      this.partnerTypingTimer,
      this.retryTimer,
      this.markReadTimer,
    ]) {
      if (t) clearTimeout(t);
    }
    this.typingTrailing = this.typingIdle = this.partnerTypingTimer = this.retryTimer = this.markReadTimer = null;
    for (const t of this.typingTimers.values()) clearTimeout(t);
    this.typingTimers.clear();
    this.members.set([]);
    this.onlineIds.set(new Set());
    this.typingIds.set(new Set());
    this.readsByUser.set(new Map());
    await this.dropChannel();
    this.messages.set([]);
    this.hasOlder.set(false);
    this.partner.set(null);
    this.partnerReadAt.set(null);
    this.reactionRows.set(new Map());
    this.reactionsSyncedAt = null;
    this.myReadAt = null;
    this.room.set(null);
    this.isPartnerOnline.set(false);
    this.flights.set([]);
    this.connection.set('connecting');
  }

  /** Canal privado `room:<uuid>`: solo los dos miembros pueden escuchar o emitir (RLS en realtime.messages). */
  private subscribe(room: Room, me: Profile): void {
    const gen = this.generation;
    this.connection.set('connecting');
    const channel = this.db.channel(`room:${room.id}`, {
      config: { private: true, presence: { key: me.id }, broadcast: { self: false } },
    });

    channel
      // ---- Presence
      .on('presence', { event: 'sync' }, () => this.syncPresence())
      // ---- Broadcast
      .on('broadcast', { event: 'cat-action' }, ({ payload }) => this.handleBroadcast(payload))
      // ---- Postgres Changes (filtrados además por RLS)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${room.id}` },
        (p) => this.handleInsert(SupabaseService.toMessage(p.new)),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${room.id}` },
        (p) => this.upsertMessage(SupabaseService.toMessage(p.new)),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
        (p) => {
          const updated = SupabaseService.toRoom(p.new);
          this.room.set(updated);
          void this.loadPartner(updated);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${room.id}` },
        () => void this.loadMembers(room),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_reads', filter: `room_id=eq.${room.id}` },
        (p) => this.applyRead(p.new as Readonly<Record<string, unknown>>),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions', filter: `room_id=eq.${room.id}` },
        (p) => this.applyReaction(p.new as Readonly<Record<string, unknown>>, true),
      )
      .subscribe((status) => {
        if (gen !== this.generation || channel !== this.channel) return;
        if (status === 'SUBSCRIBED') {
          this.connection.set('online');
          this.retryCount = 0;
          void this.trackPresence();
          // Tras una reconexión: recuperar lo que llegó mientras no escuchábamos.
          if (this.subscribedOnce) void this.catchUp();
          this.subscribedOnce = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.connection.set(navigator.onLine ? 'connecting' : 'offline');
          this.scheduleReconnect();
        }
      });

    this.channel = channel;
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.retryCount);
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.reconnectNow();
    }, delay);
  }

  private reconnectNow(): void {
    const room = this.room();
    const me = this.me();
    if (!room || !me) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const gen = this.generation;
    void this.dropChannel().then(() => {
      if (gen === this.generation) this.subscribe(room, me);
    });
  }

  private async dropChannel(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    if (!ch) return;
    await ch.untrack().catch(() => undefined);
    await this.db.removeChannel(ch).catch(() => undefined);
  }

  // ------------------------------------------------------------------ envío

  /** Envío optimista: la burbuja aparece al instante como "enviando…" y se confirma o queda para reintentar. */
  async sendMessage(content: string, isSecret: boolean): Promise<void> {
    const room = this.room();
    const me = this.me();
    const text = content.trim();
    if (!room || !me || !text) return;

    this.stopTyping();
    const emotion = detectEmotion(text);
    const draft: Message = {
      id: newId(),
      room_id: room.id,
      sender_id: me.id,
      content: text,
      is_secret: isSecret,
      emotion,
      sticker_reaction: null,
      created_at: new Date().toISOString(),
      status: 'sending',
    };
    this.upsertMessage(draft);
    this.playMessage('me', emotion);
    await this.deliver(draft);
  }

  async retryMessage(message: Message): Promise<void> {
    if (message.status !== 'failed') return;
    const draft: Message = { ...message, status: 'sending' };
    this.upsertMessage(draft);
    await this.deliver(draft);
  }

  private async deliver(draft: Message): Promise<void> {
    const gen = this.generation;
    const { data, error } = await this.db
      .from('messages')
      .insert({
        id: draft.id,
        room_id: draft.room_id,
        sender_id: draft.sender_id,
        content: draft.content,
        is_secret: draft.is_secret,
        emotion: draft.emotion,
      })
      .select()
      .single();
    if (gen !== this.generation) return;
    if (!error) {
      this.upsertMessage(SupabaseService.toMessage(data));
      return;
    }
    // 23505: el intento anterior sí llegó (se perdió la respuesta). Lo traemos tal cual.
    if (error.code === '23505') {
      const { data: saved } = await this.db.from('messages').select().eq('id', draft.id).maybeSingle();
      if (saved && gen === this.generation) {
        this.upsertMessage(SupabaseService.toMessage(saved));
        return;
      }
    }
    if (gen === this.generation) this.upsertMessage({ ...draft, status: 'failed' });
    throw error;
  }

  async toggleSticker(message: Message): Promise<void> {
    if (message.status) return;
    const mine = this.myType();
    const next = message.sticker_reaction === mine ? null : mine;
    this.upsertMessage({ ...message, sticker_reaction: next });
    const { error } = await this.db.from('messages').update({ sticker_reaction: next }).eq('id', message.id);
    if (error) this.upsertMessage(message);
  }

  /** Llamada en cada pulsación; emite `typing` con debounce de 300 ms. */
  notifyTyping(speed: TypingSpeed): void {
    this.myTypingSpeed.set(speed);
    if (!isOneShot(this.myCatState())) this.myCatState.set('typing');
    if (this.typingIdle) clearTimeout(this.typingIdle);
    this.typingIdle = setTimeout(() => this.stopTyping(), TYPING_IDLE_MS);

    const now = Date.now();
    if (now - this.lastTypingSent >= TYPING_DEBOUNCE_MS) {
      this.lastTypingSent = now;
      this.broadcast({ type: 'typing', senderId: this.myId(), speed });
    } else {
      if (this.typingTrailing) clearTimeout(this.typingTrailing);
      this.typingTrailing = setTimeout(() => {
        this.lastTypingSent = Date.now();
        this.broadcast({ type: 'typing', senderId: this.myId(), speed });
      }, TYPING_DEBOUNCE_MS);
    }
  }

  stopTyping(): void {
    if (this.typingIdle) clearTimeout(this.typingIdle);
    if (this.typingTrailing) clearTimeout(this.typingTrailing);
    this.typingIdle = this.typingTrailing = null;
    if (this.myCatState() === 'typing') {
      this.myCatState.set('idle');
      this.broadcast({ type: 'typing-stop', senderId: this.myId() });
    }
  }

  /** Doble toque sobre el gatito del compañero o botón de llamado: se sobresalta. */
  sendPoke(): void {
    this.setState('partner', 'poke');
    this.broadcast({ type: 'poke', senderId: this.myId() });
    void this.haptic(ImpactStyle.Light);
  }

  /** Toque sobre el collar (flor / cascabel) del compañero. */
  ringPartnerCollar(): void {
    this.setState('partner', 'message');
    this.broadcast({ type: 'collar-ring', senderId: this.myId() });
    void this.haptic(ImpactStyle.Light);
  }

  /** Al terminar un segmento de un solo disparo: reacción encadenada o vuelta a idle. */
  oneShotDone(side: Side): void {
    const current = side === 'me' ? this.myCatState() : this.partnerAction();
    if (!isOneShot(current)) return;
    const next = this.pending[side];
    this.pending[side] = null;
    this.setState(side, next ?? 'idle');
  }

  /** Mensaje enviado o recibido: el collar del emisor reacciona y luego su sentimiento. */
  private playMessage(side: Side, emotion: Emotion): void {
    this.setState(side, 'message', reactionFor(emotion));
    this.launchFlight(side);
  }

  private setState(side: Side, state: CatState, next: CatState | null = null): void {
    this.pending[side] = next;
    if (side === 'me') {
      this.myCatState.set(state);
      if (isOneShot(state)) this.myStateTick.update((n) => n + 1);
    } else {
      this.partnerAction.set(state);
      if (isOneShot(state)) this.partnerStateTick.update((n) => n + 1);
    }
    const type = side === 'me' ? this.myType() : this.partnerType();
    if (state === 'message' && type) this.sound.collar(type);
  }

  removeFlight(id: number): void {
    this.flights.update((list) => list.filter((f) => f.id !== id));
  }

  // ------------------------------------------------------------- recepción

  private handleBroadcast(payload: unknown): void {
    const event = this.parseEvent(payload);
    if (!event || event.senderId === this.me()?.id) return;

    if (this.isGroup()) {
      // Manada: "escribiendo" y el llamado de atención (vibra y sacude la pantalla de todos).
      if (event.type === 'typing') this.setMemberTyping(event.senderId, true);
      else if (event.type === 'typing-stop') this.setMemberTyping(event.senderId, false);
      else if (event.type === 'poke') {
        this.pokeReceived.update((n) => n + 1);
        void this.haptic(ImpactStyle.Medium);
      }
      return;
    }

    switch (event.type) {
      case 'typing':
        if (!isOneShot(this.partnerAction())) this.partnerAction.set('typing');
        this.partnerTypingSpeed.set(event.speed);
        if (this.partnerTypingTimer) clearTimeout(this.partnerTypingTimer);
        this.partnerTypingTimer = setTimeout(() => this.clearPartnerTyping(), PARTNER_TYPING_TIMEOUT_MS);
        break;
      case 'typing-stop':
        this.clearPartnerTyping();
        break;
      case 'poke':
        this.setState('me', 'poke');
        this.pokeReceived.update((n) => n + 1);
        void this.haptic(ImpactStyle.Medium);
        break;
      case 'collar-ring':
        this.setState('me', 'message');
        void this.haptic(ImpactStyle.Light);
        break;
    }
  }

  private handleInsert(message: Message): void {
    const isNew = !this.messages().some((m) => m.id === message.id);
    this.upsertMessage(message);
    if (!isNew || message.sender_id === this.me()?.id) return;

    if (this.isGroup()) {
      this.setMemberTyping(message.sender_id, false);
      const type = this.senderType(message.sender_id);
      if (type) this.sound.collar(type);
      if (message.emotion === 'alert') void this.haptic(ImpactStyle.Medium);
      this.scheduleMarkRead();
      return;
    }

    this.clearPartnerTyping();
    this.playMessage('partner', message.emotion);
    if (message.emotion === 'alert') void this.haptic(ImpactStyle.Medium);
    this.scheduleMarkRead();
  }

  private setMemberTyping(userId: string, typing: boolean): void {
    const prev = this.typingTimers.get(userId);
    if (prev) clearTimeout(prev);
    this.typingTimers.delete(userId);
    if (typing) {
      this.typingTimers.set(
        userId,
        setTimeout(() => this.setMemberTyping(userId, false), PARTNER_TYPING_TIMEOUT_MS),
      );
    }
    this.typingIds.update((ids) => {
      if (ids.has(userId) === typing) return ids;
      const next = new Set(ids);
      if (typing) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  private clearPartnerTyping(): void {
    if (this.partnerTypingTimer) clearTimeout(this.partnerTypingTimer);
    this.partnerTypingTimer = null;
    this.partnerTypingSpeed.set(null);
    this.partnerAction.update((s) => (s === 'typing' ? 'idle' : s));
  }

  private syncPresence(): void {
    const ch = this.channel;
    const meId = this.me()?.id;
    if (!ch || !meId) return;
    const state = ch.presenceState<PresencePayload>();
    const entries = Object.entries(state).filter(([key]) => key !== meId);

    if (this.isGroup()) {
      const online = new Set(entries.filter(([, metas]) => metas.some((m) => m.visible)).map(([key]) => key));
      this.onlineIds.set(online);
      this.isPartnerOnline.set(online.size > 0);
      // Alguien nuevo apareció antes de que llegara su fila de room_members: recargar la lista.
      if (entries.some(([key]) => !this.memberById().has(key))) {
        const room = this.room();
        if (room) void this.loadMembers(room);
      }
      return;
    }

    const partnerMetas = entries.flatMap(([, metas]) => metas);
    const online = partnerMetas.length > 0 && partnerMetas.some((m) => m.visible);
    this.isPartnerOnline.set(online);

    // Si el compañero entró pero aún no tenemos su perfil, recargarlo.
    if (partnerMetas.length > 0 && !this.partner()) {
      const room = this.room();
      if (room) void this.refreshRoom(room.room_code);
    }
  }

  private async trackPresence(): Promise<void> {
    const ch = this.channel;
    const me = this.me();
    if (!ch || !me) return;
    const payload: PresencePayload = {
      profileId: me.id,
      username: me.username,
      avatarType: me.avatar_type,
      visible: document.visibilityState === 'visible',
    };
    await ch.track(payload);
  }

  // ------------------------------------------------------------- helpers

  private async loadMembers(room: Room): Promise<void> {
    if (room.kind !== 'group') return;
    const gen = this.generation;
    const list = await this.session.fetchMembers(room.id);
    if (gen === this.generation) this.members.set(list);
  }

  private async loadPartner(room: Room): Promise<void> {
    if (room.kind === 'group') return; // la Manada no tiene "compañero": usa members
    const meId = this.me()?.id;
    const partnerId = room.user_1 === meId ? room.user_2 : room.user_1;
    if (!partnerId) {
      this.partner.set(null);
      return;
    }
    if (this.partner()?.id === partnerId) return;
    this.partner.set(await this.session.fetchProfile(partnerId));
  }

  private async refreshRoom(code: string): Promise<void> {
    const room = await this.session.fetchRoom(code);
    if (room) {
      this.room.set(room);
      await this.loadPartner(room);
    }
  }

  private async loadMessages(roomId: string): Promise<void> {
    const { data, error } = await this.db
      .from('messages')
      .select()
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (error) throw error;
    this.messages.set(data.map((row) => SupabaseService.toMessage(row)).reverse());
    void this.loadReactions(data.map((row) => row.id));
    this.hasOlder.set(data.length === PAGE_SIZE);
  }

  /** Página anterior (scroll hacia arriba). Devuelve cuántos mensajes se añadieron. */
  async loadOlder(): Promise<number> {
    const room = this.room();
    const oldest = this.messages().find((m) => !m.status);
    if (!room || !oldest || this.loadingOlder() || !this.hasOlder()) return 0;
    const gen = this.generation;
    this.loadingOlder.set(true);
    try {
      const { data, error } = await this.db
        .from('messages')
        .select()
        .eq('room_id', room.id)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      if (gen !== this.generation) return 0;
      const older = data.map((row) => SupabaseService.toMessage(row)).reverse();
      this.messages.update((list) => [...older, ...list]);
      void this.loadReactions(older.map((m) => m.id));
      this.hasOlder.set(data.length === PAGE_SIZE);
      return older.length;
    } finally {
      this.loadingOlder.set(false);
    }
  }

  /** Mensajes que llegaron mientras el canal estaba caído o la app en segundo plano. */
  private async catchUp(): Promise<void> {
    const room = this.room();
    if (!room) return;
    const gen = this.generation;
    const confirmed = this.messages().filter((m) => !m.status);
    const newest = confirmed[confirmed.length - 1]?.created_at;
    let query = this.db.from('messages').select().eq('room_id', room.id);
    if (newest) query = query.gt('created_at', newest);
    const { data, error } = await query.order('created_at', { ascending: true }).limit(CATCH_UP_LIMIT);
    if (error || gen !== this.generation) return;
    for (const row of data) this.handleInsert(SupabaseService.toMessage(row));
    void this.refreshRoom(room.room_code);
    void this.loadMembers(room);
    void this.loadReads(room.id);
    void this.syncReactions(room.id);
  }

  // ------------------------------------------------------------- reacciones

  /** Reaccionar con una expresión de tu gatito; la misma otra vez la quita. */
  async react(message: Message, reaction: Reaction): Promise<void> {
    const meId = this.me()?.id;
    if (!meId || message.status) return;
    const previous = this.reactionRows().get(message.id)?.get(meId) ?? null;
    const next = previous === reaction ? null : reaction;
    this.setReaction(message.id, meId, next);
    if (next) this.setState('me', catStateForReaction(next));
    const { error } = await this.db.rpc('react_to_message', { p_message: message.id, p_reaction: next });
    if (error) {
      this.setReaction(message.id, meId, previous);
      throw error;
    }
  }

  private async loadReactions(messageIds: readonly string[]): Promise<void> {
    if (!messageIds.length) return;
    const { data, error } = await this.db
      .from('message_reactions')
      .select()
      .in('message_id', [...messageIds]);
    if (error) return; // sin la tabla (migración pendiente) el chat sigue funcionando
    for (const row of data) this.applyReaction(row, false);
  }

  /** Reacciones que cambiaron mientras no escuchábamos. */
  private async syncReactions(roomId: string): Promise<void> {
    let query = this.db.from('message_reactions').select().eq('room_id', roomId);
    if (this.reactionsSyncedAt) query = query.gt('updated_at', this.reactionsSyncedAt);
    const { data, error } = await query.order('updated_at', { ascending: true }).limit(CATCH_UP_LIMIT);
    if (error) return;
    for (const row of data) this.applyReaction(row, true);
  }

  private applyReaction(row: Readonly<Record<string, unknown>>, live: boolean): void {
    const messageId = row['message_id'];
    const userId = row['user_id'];
    const raw = row['reaction'];
    const updatedAt = row['updated_at'];
    if (typeof messageId !== 'string' || typeof userId !== 'string') return;
    const reaction = isReaction(raw) ? raw : null;
    if (typeof updatedAt === 'string') {
      const iso = toIso(updatedAt);
      if (!this.reactionsSyncedAt || iso > this.reactionsSyncedAt) this.reactionsSyncedAt = iso;
    }
    const before = this.reactionRows().get(messageId)?.get(userId) ?? null;
    this.setReaction(messageId, userId, reaction);
    // El compañero reaccionó: su gatito hace el gesto en el balcón.
    if (live && reaction && reaction !== before && userId !== this.me()?.id) {
      this.setState('partner', catStateForReaction(reaction));
      void this.haptic(ImpactStyle.Light);
    }
  }

  private setReaction(messageId: string, userId: string, reaction: Reaction | null): void {
    this.reactionRows.update((all) => {
      const next = new Map(all);
      const byUser = new Map(next.get(messageId) ?? []);
      if (reaction) byUser.set(userId, reaction);
      else byUser.delete(userId);
      if (byUser.size) next.set(messageId, byUser);
      else next.delete(messageId);
      return next;
    });
  }

  // ------------------------------------------------------------- "visto"

  private async loadReads(roomId: string): Promise<void> {
    const { data, error } = await this.db.from('room_reads').select().eq('room_id', roomId);
    if (error) return;
    for (const row of data) this.applyRead(row);
  }

  private applyRead(row: Readonly<Record<string, unknown>>): void {
    const userId = row['user_id'];
    const at = row['last_read_at'];
    if (typeof userId !== 'string' || typeof at !== 'string') return;
    const iso = toIso(at);
    this.readsByUser.update((all) => {
      const prev = all.get(userId);
      if (prev && prev >= iso) return all;
      const next = new Map(all);
      next.set(userId, iso);
      return next;
    });
    if (userId === this.me()?.id) {
      if (!this.myReadAt || iso > this.myReadAt) this.myReadAt = iso;
    } else {
      this.partnerReadAt.update((prev) => (prev && prev > iso ? prev : iso));
    }
  }

  /** Marca como leído lo último del compañero, solo si la app está a la vista. */
  private scheduleMarkRead(): void {
    if (this.markReadTimer) clearTimeout(this.markReadTimer);
    this.markReadTimer = setTimeout(() => {
      this.markReadTimer = null;
      void this.markRead();
    }, MARK_READ_DEBOUNCE_MS);
  }

  private async markRead(): Promise<void> {
    const room = this.room();
    const meId = this.me()?.id;
    if (!room || !meId || document.visibilityState !== 'visible') return;
    const latest = [...this.messages()].reverse().find((m) => m.sender_id !== meId && !m.status);
    if (!latest) return;
    const at = toIso(latest.created_at);
    if (this.myReadAt && this.myReadAt >= at) return;
    const { error } = await this.db.rpc('mark_read', { p_room: room.id, p_at: latest.created_at });
    if (!error) this.myReadAt = at;
  }

  // ------------------------------------------------------------- asiento

  /** Salir de la Manada: deja de ser miembro (sus mensajes se conservan). */
  async leaveGroup(): Promise<void> {
    const room = this.room();
    if (!room || room.kind !== 'group') return;
    await this.session.leaveGroup(room.id);
  }

  /** Tu compañero cambió de teléfono: su asiento queda libre para volver a entrar con el código. */
  async releasePartnerSeat(): Promise<void> {
    const room = this.room();
    if (!room) return;
    this.room.set(await this.session.releasePartnerSeat(room.id));
  }

  private upsertMessage(message: Message): void {
    this.messages.update((list) => {
      const idx = list.findIndex((m) => m.id === message.id);
      if (idx === -1) {
        return [...list, message].sort((a, b) => toIso(a.created_at).localeCompare(toIso(b.created_at)));
      }
      const copy = list.slice();
      copy[idx] = message;
      return copy;
    });
  }

  private launchFlight(from: Side): void {
    const type = from === 'me' ? this.myType() : (this.partnerType() ?? this.myType());
    const icon = type === 'white_cat' ? 'assets/icons/icon-daisy.svg' : 'assets/icons/icon-sparkle-star.svg';
    const id = ++this.flightSeq;
    this.flights.update((list) => [...list, { id, from, icon }]);
  }

  private broadcast(event: BroadcastEvent): void {
    void this.channel?.send({ type: 'broadcast', event: 'cat-action', payload: event });
  }

  private parseEvent(payload: unknown): BroadcastEvent | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as Record<string, unknown>;
    const senderId = p['senderId'];
    if (typeof senderId !== 'string') return null;
    switch (p['type']) {
      case 'typing':
        return { type: 'typing', senderId, speed: p['speed'] === 'fast' ? 'fast' : 'normal' };
      case 'typing-stop':
        return { type: 'typing-stop', senderId };
      case 'poke':
        return { type: 'poke', senderId };
      case 'collar-ring':
        return { type: 'collar-ring', senderId };
      default:
        return null;
    }
  }

  private myId(): string {
    return this.me()?.id ?? '';
  }

  private async haptic(style: ImpactStyle): Promise<void> {
    try {
      await Haptics.impact({ style });
    } catch {
      /* sin soporte háptico (navegador de escritorio) */
    }
  }

  /** Vibración suave tipo ronroneo para Hold-to-Reveal. */
  async purr(): Promise<void> {
    await this.haptic(ImpactStyle.Light);
  }
}

/**
 * UUID v4 para el envío optimista. `crypto.randomUUID` solo existe en HTTPS/localhost;
 * `getRandomValues` funciona también por http (p. ej. probando en el teléfono por la WiFi local).
 */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Normaliza timestamps de Postgres/JS para poder compararlos como texto. */
function toIso(value: string): string {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toISOString();
}