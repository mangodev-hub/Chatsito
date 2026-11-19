import { Injectable, inject, signal } from '@angular/core';

import { type CatType, type Profile, type Room, isCatType } from '../models/chat.models';

import { SupabaseService } from './supabase.service';

const STORAGE_KEY = 'day-night-sync.profile';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type JoinError = 'not-found' | 'full';

export class RoomJoinError extends Error {
  constructor(readonly reason: JoinError) {
    super(reason);
  }
}

/** Perfil anónimo local + creación / unión a salas 1 a 1. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly db = inject(SupabaseService).client;

  readonly profile = signal<Profile | null>(this.restore());

  async saveProfile(username: string, avatar: CatType): Promise<Profile> {
    const current = this.profile();
    if (current) {
      const { data } = await this.db
        .from('profiles')
        .update({ username, avatar_type: avatar })
        .eq('id', current.id)
        .select()
        .maybeSingle();
      if (data) return this.persist(SupabaseService.toProfile(data));
    }
    const { data, error } = await this.db
      .from('profiles')
      .insert({ username, avatar_type: avatar })
      .select()
      .single();
    if (error) throw error;
    return this.persist(SupabaseService.toProfile(data));
  }

  async createRoom(): Promise<Room> {
    const me = this.requireProfile();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await this.db
        .from('rooms')
        .insert({ room_code: this.generateCode(), user_1: me.id })
        .select()
        .single();
      if (!error) return SupabaseService.toRoom(data);
      if (error.code !== '23505') throw error; // 23505 = código repetido, reintentar
    }
    throw new Error('No se pudo generar un código de sala único');
  }

  async joinRoom(rawCode: string): Promise<Room> {
    const me = this.requireProfile();
    const room = await this.fetchRoom(rawCode);
    if (!room) throw new RoomJoinError('not-found');
    if (room.user_1 === me.id || room.user_2 === me.id) return room;
    if (room.user_2 !== null) throw new RoomJoinError('full');

    const { data, error } = await this.db
      .from('rooms')
      .update({ user_2: me.id })
      .eq('id', room.id)
      .is('user_2', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new RoomJoinError('full');
    return SupabaseService.toRoom(data);
  }

  async fetchRoom(rawCode: string): Promise<Room | null> {
    const { data, error } = await this.db
      .from('rooms')
      .select()
      .eq('room_code', rawCode.trim().toUpperCase())
      .maybeSingle();
    if (error) throw error;
    return data ? SupabaseService.toRoom(data) : null;
  }

  async fetchProfile(id: string): Promise<Profile | null> {
    const { data, error } = await this.db.from('profiles').select().eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? SupabaseService.toProfile(data) : null;
  }

  private requireProfile(): Profile {
    const me = this.profile();
    if (!me) throw new Error('Primero elige tu gatito y tu nombre');
    return me;
  }

  private generateCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  private persist(profile: Profile): Profile {
    this.profile.set(profile);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch {
      /* almacenamiento no disponible: el perfil vive solo en memoria */
    }
    return profile;
  }

  private restore(): Profile | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const p = parsed as Record<string, unknown>;
      if (typeof p['id'] !== 'string' || typeof p['username'] !== 'string' || !isCatType(p['avatar_type'])) {
        return null;
      }
      return {
        id: p['id'],
        username: p['username'],
        avatar_type: p['avatar_type'],
        created_at: typeof p['created_at'] === 'string' ? p['created_at'] : '',
      };
    } catch {
      return null;
    }
  }
}
