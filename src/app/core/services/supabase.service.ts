import { Injectable } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';
import { type Message, type Profile, type Room, isCatType, isEmotion } from '../models/chat.models';
import type { Database } from '../models/database.types';

type Row = Readonly<Record<string, unknown>>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Instancia singleton de SupabaseClient + conversores tipados de filas. */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient<Database> = createClient<Database>(environment.supabaseUrl, environment.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'day-night-sync.auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  private session: Promise<string> | null = null;

  /**
   * Id del usuario de Auth (= id del perfil). Si no hay sesión, inicia una anónima.
   * La sesión se guarda en el dispositivo: es la "llave" de tu asiento en la sala.
   */
  userId(): Promise<string> {
    this.session ??= this.resolveUser().catch((err: unknown) => {
      this.session = null;
      throw err;
    });
    return this.session;
  }

  /** Id de la sesión ya existente en este teléfono, sin crear una nueva (null si nunca entró). */
  async existingUserId(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  private async resolveUser(): Promise<string> {
    const { data } = await this.client.auth.getSession();
    if (data.session) return data.session.user.id;
    const { data: anon, error } = await this.client.auth.signInAnonymously();
    if (error || !anon.user) throw error ?? new Error('No se pudo iniciar la sesión anónima');
    return anon.user.id;
  }

  static toProfile(row: Row): Profile {
    const avatar = row['avatar_type'];
    return {
      id: str(row['id']),
      username: str(row['username']),
      avatar_type: isCatType(avatar) ? avatar : 'white_cat',
      created_at: str(row['created_at']),
    };
  }

  static toRoom(row: Row): Room {
    return {
      id: str(row['id']),
      room_code: str(row['room_code']),
      kind: row['kind'] === 'group' ? 'group' : 'duo',
      name: strOrNull(row['name']),
      max_members: typeof row['max_members'] === 'number' ? row['max_members'] : 2,
      user_1: strOrNull(row['user_1']),
      user_2: strOrNull(row['user_2']),
      released_user: strOrNull(row['released_user']),
      created_at: str(row['created_at']),
    };
  }

  static toMessage(row: Row): Message {
    const emotion = row['emotion'];
    const sticker = row['sticker_reaction'];
    return {
      id: str(row['id']),
      room_id: str(row['room_id']),
      sender_id: str(row['sender_id']),
      content: str(row['content']),
      is_secret: row['is_secret'] === true,
      emotion: isEmotion(emotion) ? emotion : 'neutral',
      sticker_reaction: isCatType(sticker) ? sticker : null,
      created_at: str(row['created_at']),
    };
  }
}
