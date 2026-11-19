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
  type ThemeMode,
  type TypingSpeed,
  type Emotion,
  CAT_META,
  detectEmotion,
  isOneShot,
  reactionFor,
} from '../models/chat.models';

import { SessionService } from './session.service';
import { SoundService } from './sound.service';
import { SupabaseService } from './supabase.service';

export type Side = 'me' | 'partner';

export interface Flight {
  id: number;
  from: Side;
  icon: string;
}

const TYPING_DEBOUNCE_MS = 300;
const TYPING_IDLE_MS = 1600;
const PARTNER_TYPING_TIMEOUT_MS = 2500;

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

  // ---- pulsos de eventos para la UI
  readonly pokeReceived = signal(0);
  readonly flights = signal<Flight[]>([]);

  // ---- derivados
  readonly partnerCatState = computed<CatState>(() =>
    this.isPartnerOnline() ? this.partnerAction() : 'sleeping',
  );
  readonly myType = computed<CatType>(() => this.me()?.avatar_type ?? 'white_cat');
  readonly partnerType = computed<CatType | null>(() => this.partner()?.avatar_type ?? null);
  readonly activeTheme = computed<ThemeMode>(() => {
    const mine = this.myType();
    const theirs = this.partnerType();
    if (!theirs || theirs === mine) return CAT_META[mine].theme;
    return 'eclipse';
  });
  /** Tipo de gatito del último emisor: orienta el degradado del modo Eclipse. */
  readonly lastSenderType = computed<CatType | null>(() => {
    const list = this.messages();
    const last = list[list.length - 1];
    if (!last) return null;
    return this.senderType(last.sender_id);
  });

  private channel: RealtimeChannel | null = null;
  private flightSeq = 0;
  private lastTypingSent = 0;
  private typingTrailing: ReturnType<typeof setTimeout> | null = null;
  private typingIdle: ReturnType<typeof setTimeout> | null = null;
  private partnerTypingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibility = (): void => void this.trackPresence();

  senderType(senderId: string): CatType | null {
    if (senderId === this.me()?.id) return this.myType();
    if (senderId === this.partner()?.id) return this.partnerType();
    return null;
  }

  async joinRoom(room: Room, me: Profile): Promise<void> {
    await this.leaveRoom();
    this.room.set(room);
    this.me.set(me);
    this.myCatState.set('idle');
    this.partnerAction.set('idle');
    await Promise.all([this.loadPartner(room), this.loadMessages(room.id)]);

    const channel = this.db.channel(`room:${room.room_code}`, {
      config: { presence: { key: me.id }, broadcast: { self: false } },
    });

    channel
      // ---- Presence
      .on('presence', { event: 'sync' }, () => this.syncPresence())
      // ---- Broadcast
      .on('broadcast', { event: 'cat-action' }, ({ payload }) => this.handleBroadcast(payload))
      // ---- Postgres Changes
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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void this.trackPresence();
      });

    this.channel = channel;
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async leaveRoom(): Promise<void> {
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const t of [this.typingTrailing, this.typingIdle, this.partnerTypingTimer]) {
      if (t) clearTimeout(t);
    }
    this.typingTrailing = this.typingIdle = this.partnerTypingTimer = null;
    if (this.channel) {
      const ch = this.channel;
      this.channel = null;
      await ch.untrack().catch(() => undefined);
      await this.db.removeChannel(ch);
    }
    this.messages.set([]);
    this.partner.set(null);
    this.room.set(null);
    this.isPartnerOnline.set(false);
    this.flights.set([]);
  }

  // ------------------------------------------------------------------ envío

  async sendMessage(content: string, isSecret: boolean): Promise<void> {
    const room = this.room();
    const me = this.me();
    const text = content.trim();
    if (!room || !me || !text) return;

    this.stopTyping();
    const emotion = detectEmotion(text);
    const { data, error } = await this.db
      .from('messages')
      .insert({ room_id: room.id, sender_id: me.id, content: text, is_secret: isSecret, emotion })
      .select()
      .single();
    if (error) throw error;

    this.upsertMessage(SupabaseService.toMessage(data));
    this.playMessage('me', emotion);
  }

  async toggleSticker(message: Message): Promise<void> {
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
    if (state === 'message' && type === 'black_cat') this.sound.bell();
  }

  removeFlight(id: number): void {
    this.flights.update((list) => list.filter((f) => f.id !== id));
  }

  // ------------------------------------------------------------- recepción

  private handleBroadcast(payload: unknown): void {
    const event = this.parseEvent(payload);
    if (!event || event.senderId === this.me()?.id) return;

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

    this.clearPartnerTyping();
    this.playMessage('partner', message.emotion);
    if (message.emotion === 'alert') void this.haptic(ImpactStyle.Medium);
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

  private async loadPartner(room: Room): Promise<void> {
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
      .limit(150);
    if (error) throw error;
    this.messages.set(data.map((row) => SupabaseService.toMessage(row)).reverse());
  }

  private upsertMessage(message: Message): void {
    this.messages.update((list) => {
      const idx = list.findIndex((m) => m.id === message.id);
      if (idx === -1) {
        return [...list, message].sort((a, b) => a.created_at.localeCompare(b.created_at));
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
