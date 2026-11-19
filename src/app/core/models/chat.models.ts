export type CatType = 'white_cat' | 'black_cat';
export type CatState = 'idle' | 'typing' | 'happy' | 'poke' | 'sleeping' | 'message' | 'angry';
export type Emotion = 'neutral' | 'happy' | 'love' | 'alert';
export type TypingSpeed = 'normal' | 'fast';
export type ThemeMode = 'day' | 'night' | 'eclipse';
export type Reaction = 'love' | 'laugh' | 'happy' | 'wow' | 'sad' | 'angry';

/** Expresiones de los gatitos para reaccionar a un mensaje (en el orden del selector). */
export const REACTIONS: readonly { key: Reaction; label: string }[] = [
  { key: 'love', label: 'Me encanta' },
  { key: 'laugh', label: 'Jajaja' },
  { key: 'happy', label: 'Feliz' },
  { key: 'wow', label: '¡Wow!' },
  { key: 'sad', label: 'Triste' },
  { key: 'angry', label: 'Grr' },
];

export function isReaction(value: unknown): value is Reaction {
  return REACTIONS.some((r) => r.key === value);
}

/** Reacción ya resuelta para pintar: qué gatito y qué cara. */
export interface ReactionView {
  userId: string;
  catType: CatType;
  reaction: Reaction;
  mine: boolean;
}

/** Cómo responde en el balcón el gatito de quien reacciona. */
export function catStateForReaction(reaction: Reaction): CatState {
  switch (reaction) {
    case 'wow':
    case 'sad': // orejas hacia atrás
      return 'poke';
    case 'angry':
      return 'angry';
    default:
      return 'happy';
  }
}

export interface Profile {
  id: string;
  username: string;
  avatar_type: CatType;
  created_at: string;
}

export type RoomKind = 'duo' | 'group';

export interface Room {
  id: string;
  room_code: string;
  /** 'duo' = chat 1 a 1 (asientos user_1 / user_2) · 'group' = Manada (miembros en room_members). */
  kind: RoomKind;
  /** Nombre opcional de la Manada. */
  name: string | null;
  max_members: number;
  user_1: string | null;
  user_2: string | null;
  /** Compañero cuyo asiento fue liberado (cambió de teléfono): puede reclamarlo con el código. */
  released_user: string | null;
  created_at: string;
}

/** Miembro de una Manada: perfil + color de collar asignado al entrar. */
export interface RoomMember {
  profile: Profile;
  collarColor: number;
  joinedAt: string;
}

/** Paleta de collares para identificar a cada gatito en la Manada (índice = room_members.collar_color). */
export const COLLAR_COLORS: readonly string[] = [
  '#e8879c', // rosa
  '#5fb89a', // menta
  '#9b86d6', // lila
  '#5aa6d6', // celeste
  '#e9a06a', // durazno
  '#e06c5f', // coral
  '#c9a23f', // mostaza
  '#7aa85a', // oliva
  '#d77fc4', // fucsia
  '#4fa3a5', // turquesa
  '#b98a6a', // caramelo
  '#7d8fd6', // azul lavanda
  '#d6a35a', // miel
  '#a6729c', // ciruela
  '#6fb3c9', // cielo
];

export function collarColor(index: number): string {
  return COLLAR_COLORS[((index % COLLAR_COLORS.length) + COLLAR_COLORS.length) % COLLAR_COLORS.length];
}

export interface Message {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  is_secret: boolean;
  emotion: Emotion;
  sticker_reaction: CatType | null;
  created_at: string;
  /** Solo en el cliente: envío optimista. Sin valor = guardado en el servidor. */
  status?: 'sending' | 'failed';
}

/** Eventos efímeros enviados por Broadcast (`cat-action`). */
export type BroadcastEvent =
  | { type: 'typing'; senderId: string; speed: TypingSpeed }
  | { type: 'typing-stop'; senderId: string }
  | { type: 'poke'; senderId: string }
  | { type: 'collar-ring'; senderId: string }
  /** Enviado por el servidor (delete_room) cuando la otra persona borra el chat para las dos. */
  | { type: 'room-deleted'; senderId: string }
  | RpsEvent;

/** Piedra, papel o tijera (solo 1 a 1). Nada se guarda: todo viaja por el canal privado de la sala. */
export type RpsHand = 'rock' | 'paper' | 'scissors';

export type RpsEvent =
  | { type: 'rps-invite'; senderId: string; gameId: string }
  | { type: 'rps-accept'; senderId: string; gameId: string }
  | { type: 'rps-decline'; senderId: string; gameId: string; reason: 'later' | 'muted' | 'busy' }
  | { type: 'rps-cancel'; senderId: string; gameId: string }
  /** Jugada sellada: huella de (partida + jugada + sal). Nadie puede ver la jugada antes de tiempo. */
  | { type: 'rps-commit'; senderId: string; gameId: string; seal: string }
  | { type: 'rps-reveal'; senderId: string; gameId: string; hand: RpsHand; salt: string };

export const RPS_HANDS: readonly { key: RpsHand; emoji: string; label: string }[] = [
  { key: 'rock', emoji: '✊', label: 'Piedra' },
  { key: 'paper', emoji: '✋', label: 'Papel' },
  { key: 'scissors', emoji: '✌️', label: 'Tijera' },
];

export function isRpsHand(value: unknown): value is RpsHand {
  return value === 'rock' || value === 'paper' || value === 'scissors';
}

/** 1 = gana `a`, -1 = gana `b`, 0 = empate. */
export function rpsOutcome(a: RpsHand, b: RpsHand): 1 | -1 | 0 {
  if (a === b) return 0;
  const beats: Record<RpsHand, RpsHand> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  return beats[a] === b ? 1 : -1;
}

/** Fila de "Tus chats" en el menú principal. */
export interface RoomSummary {
  roomId: string;
  code: string;
  kind: RoomKind;
  name: string | null;
  partnerName: string | null;
  partnerType: CatType | null;
  memberCount: number;
  memberTypes: CatType[];
  lastContent: string | null;
  lastIsSecret: boolean;
  lastFromMe: boolean;
  lastAt: string | null;
  createdAt: string;
  unread: number;
}

/** Payload que cada usuario publica en Presence. */
export interface PresencePayload {
  profileId: string;
  username: string;
  avatarType: CatType;
  visible: boolean;
}

export interface CatSegment {
  frames: [number, number];
  loop: boolean;
}

/**
 * Mapa de segmentos de white-cat.json / black-cat.json (60 FPS, rig por piezas:
 * orejas, cola, patitas, collar y borde del sticker se animan por separado).
 *
 * - idle      respira (1.00→1.03), cola en bucle, parpadeo y tic de orejas
 * - typing    orejas rápidas, mejillas sonrojadas, patitas golpeando
 * - happy     salto con rebote (spring) y brillo en los ojos
 * - poke      sobresalto: salto con squash & stretch y orejas hacia atrás 1 s
 * - sleeping  acurrucado, cola enroscada, ojos cerrados y zZz
 * - message   collar: la margarita gira y suelta pétalos / el cascabel vibra con ondas
 * - angry     cola erizada y borde blanco del sticker vibrando
 */
export const CAT_SEGMENTS: Readonly<Record<CatState, CatSegment>> = {
  idle: { frames: [0, 120], loop: true },
  typing: { frames: [121, 180], loop: true },
  happy: { frames: [181, 240], loop: false },
  poke: { frames: [241, 300], loop: false },
  sleeping: { frames: [301, 420], loop: true },
  message: { frames: [421, 480], loop: false },
  angry: { frames: [481, 540], loop: false },
};

export function isOneShot(state: CatState): boolean {
  return !CAT_SEGMENTS[state].loop;
}

/** Estado de reacción del gatito según el sentimiento del mensaje. */
export function reactionFor(emotion: Emotion): CatState | null {
  if (emotion === 'happy' || emotion === 'love') return 'happy';
  if (emotion === 'alert') return 'angry';
  return null;
}

export const CAT_META: Readonly<
  Record<CatType, { name: string; nickname: string; theme: 'day' | 'night'; png: string; lottie: string; icon: string }>
> = {
  white_cat: {
    name: 'Nube',
    nickname: 'Gatito Blanco',
    theme: 'day',
    png: 'assets/cats/white_cat.png',
    lottie: 'assets/lottie/white-cat.json',
    icon: 'assets/icons/icon-daisy.svg',
  },
  black_cat: {
    name: 'Mango',
    nickname: 'Gatito Negro',
    theme: 'night',
    png: 'assets/cats/black_cat.png',
    lottie: 'assets/lottie/black-cat.json',
    icon: 'assets/icons/icon-bell.svg',
  },
};

export function isCatType(value: unknown): value is CatType {
  return value === 'white_cat' || value === 'black_cat';
}

export function isEmotion(value: unknown): value is Emotion {
  return value === 'neutral' || value === 'happy' || value === 'love' || value === 'alert';
}

/**
 * Analizador léxico simple (ADR Fase 3.5). Prioridad: alert (enojo/estrés) > love > happy.
 * `alert` gana para que un "¡urgente!" con risa no se lea como alegría.
 */
export function detectEmotion(content: string): Emotion {
  const text = content.toLowerCase();
  if (/urgente|😡|😠|🤬|grr+|estresad|enojad|!{2,}/.test(text)) return 'alert';
  if (/❤️|❤|💕|💖|tqm|te quiero|te amo/.test(text)) return 'love';
  if (/ja(ja)+|je(je)+|😁|😂|🤣|😄|😆|hola+\b|holi/.test(text)) return 'happy';
  if (/!/.test(text)) return 'alert';
  return 'neutral';
}
