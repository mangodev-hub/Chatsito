import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

import { RPS_HANDS, type RpsEvent, type RpsHand, rpsOutcome } from '../models/chat.models';

import { ChatRealtimeService } from './chat-realtime.service';

/**
 * Piedra, papel o tijera para el 1 a 1, pensado para no molestar:
 * - todo va por el canal privado de la sala y no se guarda nada;
 * - la invitación es una franja pequeña sobre el campo de texto y caduca sola;
 * - si estás escribiendo, la invitación espera a que termines;
 * - cada jugada viaja sellada (huella de partida+jugada+sal) y se revela solo cuando las dos eligieron.
 */
export type RpsPhase = 'idle' | 'inviting' | 'invited' | 'choosing' | 'result' | 'notice';
export type RpsResult = 'win' | 'lose' | 'draw';

const INVITE_WAIT_MS = 25_000;
const INVITE_SHOW_MS = 20_000;
const CHOOSE_MS = 30_000;
const RESULT_MS = 8_000;
const NOTICE_MS = 3_500;
const MUTED_KEY = 'day-night-sync.rps-muted';

@Injectable({ providedIn: 'root' })
export class RpsService {
  private readonly chat = inject(ChatRealtimeService);

  readonly phase = signal<RpsPhase>('idle');
  readonly myHand = signal<RpsHand | null>(null);
  readonly partnerHand = signal<RpsHand | null>(null);
  readonly partnerChose = signal(false);
  readonly result = signal<RpsResult | null>(null);
  readonly notice = signal('');
  /** "No recibir retos": rechaza solo, sin mostrar nada. */
  readonly muted = signal(this.restoreMuted());
  /** Se puede jugar: sala 1 a 1 con el compañero en línea. */
  readonly canPlay = computed(() => !this.chat.isGroup() && !!this.chat.partner() && this.chat.isPartnerOnline());
  /** Manos que se muestran en el balcón (solo al revelar). */
  readonly shownHands = computed(() =>
    this.phase() === 'result' ? { me: this.myHand(), partner: this.partnerHand() } : { me: null, partner: null },
  );
  readonly partnerName = computed(() => this.chat.partner()?.username || 'Tu compañera');

  private gameId: string | null = null;
  private iInvited = false;
  private salt = '';
  private partnerSeal: string | null = null;
  private revealSent = false;
  private pendingInvite: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const sub = this.chat.rpsEvents.subscribe((event) => void this.onEvent(event));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());

    // Una invitación que llegó mientras escribías aparece cuando dejas de escribir.
    effect(() => {
      const typing = this.chat.myCatState() === 'typing';
      if (!typing && this.pendingInvite && this.phase() === 'idle') {
        const id = this.pendingInvite;
        this.pendingInvite = null;
        this.showInvite(id);
      }
    });
    // Si el compañero se desconecta o cambias de sala, la partida se cierra sin ruido.
    effect(() => {
      const online = this.chat.isPartnerOnline();
      const roomId = this.chat.room()?.id;
      if ((!online || !roomId) && this.phase() !== 'idle' && this.phase() !== 'notice') {
        this.reset();
        if (roomId) this.showNotice(`${this.partnerName()} se desconectó`);
      }
    });
  }

  // ------------------------------------------------------------------ acciones propias

  invite(): void {
    if (this.muted()) this.setMuted(false);
    if (!this.canPlay() || (this.phase() !== 'idle' && this.phase() !== 'result' && this.phase() !== 'notice')) return;
    this.reset();
    this.gameId = newGameId();
    this.iInvited = true;
    this.phase.set('inviting');
    this.send({ type: 'rps-invite', senderId: '', gameId: this.gameId });
    this.arm(INVITE_WAIT_MS, () => {
      this.send({ type: 'rps-cancel', senderId: '', gameId: this.gameId ?? '' });
      this.reset();
      this.showNotice(`${this.partnerName()} no respondió`);
    });
  }

  accept(): void {
    if (this.phase() !== 'invited' || !this.gameId) return;
    this.send({ type: 'rps-accept', senderId: '', gameId: this.gameId });
    this.startChoosing();
  }

  decline(mute = false): void {
    if (this.gameId)
      this.send({ type: 'rps-decline', senderId: '', gameId: this.gameId, reason: mute ? 'muted' : 'later' });
    if (mute) this.setMuted(true);
    this.reset();
  }

  cancel(): void {
    if (this.gameId && (this.phase() === 'inviting' || this.phase() === 'choosing')) {
      this.send({ type: 'rps-cancel', senderId: '', gameId: this.gameId });
    }
    this.reset();
  }

  async choose(hand: RpsHand): Promise<void> {
    if (this.phase() !== 'choosing' || this.myHand() || !this.gameId) return;
    this.myHand.set(hand);
    this.salt = randomHex(16);
    const seal = await sealOf(this.gameId, hand, this.salt);
    this.send({ type: 'rps-commit', senderId: '', gameId: this.gameId, seal });
    if (this.partnerSeal) this.reveal();
  }

  close(): void {
    this.reset();
  }

  // ------------------------------------------------------------------ eventos del compañero

  private async onEvent(event: RpsEvent): Promise<void> {
    if (event.type === 'rps-invite') {
      if (this.muted()) {
        this.chat.sendRps({ type: 'rps-decline', senderId: this.me(), gameId: event.gameId, reason: 'muted' });
        return;
      }
      if (this.phase() !== 'idle' && this.phase() !== 'notice' && this.phase() !== 'result') {
        this.chat.sendRps({ type: 'rps-decline', senderId: this.me(), gameId: event.gameId, reason: 'busy' });
        return;
      }
      if (this.chat.myCatState() === 'typing') {
        this.pendingInvite = event.gameId;
        return;
      }
      this.showInvite(event.gameId);
      return;
    }

    if (event.gameId !== this.gameId) return; // eventos de otra partida
    switch (event.type) {
      case 'rps-accept':
        if (this.phase() === 'inviting' && this.iInvited) this.startChoosing();
        break;
      case 'rps-decline':
        this.reset();
        this.showNotice(
          event.reason === 'muted'
            ? `${this.partnerName()} no está recibiendo retos`
            : event.reason === 'busy'
              ? `${this.partnerName()} está en otra partida`
              : `${this.partnerName()} ahora no puede jugar`,
        );
        break;
      case 'rps-cancel':
        this.reset();
        this.showNotice(`${this.partnerName()} canceló la partida`);
        break;
      case 'rps-commit':
        if (this.phase() !== 'choosing') return;
        this.partnerSeal = event.seal;
        this.partnerChose.set(true);
        if (this.myHand()) this.reveal();
        break;
      case 'rps-reveal': {
        if (this.phase() !== 'choosing' || !this.partnerSeal || !this.gameId) return;
        const expected = await sealOf(this.gameId, event.hand, event.salt);
        if (expected !== this.partnerSeal) {
          this.reset();
          this.showNotice('La jugada no coincidió 🙀 Partida anulada');
          return;
        }
        this.partnerHand.set(event.hand);
        this.finishIfReady();
        break;
      }
    }
  }

  // ------------------------------------------------------------------ internos

  private showInvite(gameId: string): void {
    this.reset();
    this.gameId = gameId;
    this.iInvited = false;
    this.phase.set('invited');
    this.arm(INVITE_SHOW_MS, () => this.decline());
  }

  private startChoosing(): void {
    this.phase.set('choosing');
    this.myHand.set(null);
    this.partnerHand.set(null);
    this.partnerChose.set(false);
    this.partnerSeal = null;
    this.revealSent = false;
    this.arm(CHOOSE_MS, () => {
      this.cancel();
      this.showNotice('Se acabó el tiempo ⏱️');
    });
  }

  private reveal(): void {
    const hand = this.myHand();
    if (this.revealSent || !hand || !this.gameId) return;
    this.revealSent = true;
    this.send({ type: 'rps-reveal', senderId: '', gameId: this.gameId, hand, salt: this.salt });
    this.finishIfReady();
  }

  private finishIfReady(): void {
    const mine = this.myHand();
    const theirs = this.partnerHand();
    if (!mine || !theirs || !this.revealSent) return;
    const outcome = rpsOutcome(mine, theirs);
    this.result.set(outcome === 1 ? 'win' : outcome === -1 ? 'lose' : 'draw');
    this.phase.set('result');
    this.chat.playGameOutcome(outcome === 1 ? 'me' : outcome === -1 ? 'partner' : null);
    this.arm(RESULT_MS, () => this.reset());
  }

  private showNotice(text: string): void {
    this.notice.set(text);
    this.phase.set('notice');
    this.arm(NOTICE_MS, () => {
      if (this.phase() === 'notice') this.phase.set('idle');
    });
  }

  private reset(): void {
    this.disarm();
    this.phase.set('idle');
    this.gameId = null;
    this.iInvited = false;
    this.salt = '';
    this.partnerSeal = null;
    this.revealSent = false;
    this.myHand.set(null);
    this.partnerHand.set(null);
    this.partnerChose.set(false);
    this.result.set(null);
  }

  private send(event: RpsEvent): void {
    this.chat.sendRps({ ...event, senderId: this.me() } as RpsEvent);
  }

  private me(): string {
    return this.chat.me()?.id ?? '';
  }

  private arm(ms: number, fn: () => void): void {
    this.disarm();
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setMuted(value: boolean): void {
    this.muted.set(value);
    try {
      localStorage.setItem(MUTED_KEY, value ? '1' : '0');
    } catch {
      /* sin almacenamiento */
    }
  }

  private restoreMuted(): boolean {
    try {
      return localStorage.getItem(MUTED_KEY) === '1';
    } catch {
      return false;
    }
  }
}

/** Texto corto para la franja: "✋ vence a ✊". */
export function handEmoji(hand: RpsHand | null): string {
  return RPS_HANDS.find((h) => h.key === hand)?.emoji ?? '';
}

function newGameId(): string {
  return `${Date.now().toString(36)}-${randomHex(6)}`;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sello de la jugada: SHA-256 en HTTPS; por http (prueba en la WiFi local) un hash simple basta entre amigas. */
async function sealOf(gameId: string, hand: RpsHand, salt: string): Promise<string> {
  const text = `${gameId}:${hand}:${salt}`;
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
