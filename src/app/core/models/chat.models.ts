export type CatType = 'white_cat' | 'black_cat';
export type CatState = 'idle' | 'typing' | 'happy' | 'poke' | 'sleeping' | 'message' | 'angry';
export type Emotion = 'neutral' | 'happy' | 'love' | 'alert';
export type TypingSpeed = 'normal' | 'fast';
export type ThemeMode = 'day' | 'night' | 'eclipse';

export interface Profile {
  id: string;
  username: string;
  avatar_type: CatType;
  created_at: string;
}

export interface Room {
  id: string;
  room_code: string;
  user_1: string | null;
  user_2: string | null;
  created_at: string;
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
}

/** Eventos efímeros enviados por Broadcast (`cat-action`). */
export type BroadcastEvent =
  | { type: 'typing'; senderId: string; speed: TypingSpeed }
  | { type: 'typing-stop'; senderId: string }
  | { type: 'poke'; senderId: string }
  | { type: 'collar-ring'; senderId: string };

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
    name: 'Margarita',
    nickname: 'Gatito Blanco',
    theme: 'day',
    png: 'assets/cats/white_cat.png',
    lottie: 'assets/lottie/white-cat.json',
    icon: 'assets/icons/icon-daisy.svg',
  },
  black_cat: {
    name: 'Cascabel',
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
