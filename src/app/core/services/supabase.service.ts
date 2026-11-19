import { Injectable } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';
import {
  type Message,
  type Profile,
  type Room,
  isCatType,
  isEmotion,
} from '../models/chat.models';
import type { Database } from '../models/database.types';

type Row = Readonly<Record<string, unknown>>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Instancia singleton de SupabaseClient + conversores tipados de filas. */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient<Database> = createClient<Database>(
    environment.supabaseUrl,
    environment.supabaseKey,
    {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 20 } },
    },
  );

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
      user_1: strOrNull(row['user_1']),
      user_2: strOrNull(row['user_2']),
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
