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

/**
 * Perfil = usuario anónimo de Supabase Auth (una sesión por dispositivo).
 * Las salas tienen 2 asientos: unirse y recuperar un asiento pasa por RPC en el servidor.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly supabase = inject(SupabaseService);
  private readonly db = this.supabase.client;

  /** Caché local: también sirve para rellenar nombre y gatito si la sesión cambió. */
  readonly profile = signal<Profile | null>(this.restore());

  /** Perfil válido para la sesión actual, o null si hay que elegir gatito y nombre. */
  async currentProfile(): Promise<Profile | null> {
    const uid = await this.supabase.userId();
    const cached = this.profile();
    if (cached?.id === uid) return cached;
    const fresh = await this.fetchProfile(uid);
    if (fresh) this.persist(fresh);
    return fresh;
  }

  async saveProfile(username: string, avatar: CatType): Promise<Profile> {
    const uid = await this.supabase.userId();
    const { data: updated, error: updateError } = await this.db
      .from('profiles')
      .update({ username, avatar_type: avatar })
      .eq('id', uid)
      .select()
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) return this.persist(SupabaseService.toProfile(updated));

    const { data, error } = await this.db
      .from('profiles')
      .insert({ id: uid, username, avatar_type: avatar })
      .select()
      .single();
    if (error) throw error;
    return this.persist(SupabaseService.toProfile(data));
  }

  async createRoom(): Promise<Room> {
    const uid = await this.supabase.userId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await this.db
        .from('rooms')
        .insert({ room_code: this.generateCode(), user_1: uid })
        .select()
        .single();
      if (!error) return SupabaseService.toRoom(data);
      if (error.code !== '23505') throw error; // 23505 = código repetido, reintentar
    }
    throw new Error('No se pudo generar un código de sala único');
  }

  /** Entra a la sala: asiento libre, asiento liberado por el compañero o el tuyo de antes. */
  async joinRoom(rawCode: string): Promise<Room> {
    await this.supabase.userId();
    const { data, error } = await this.db.rpc('join_room', { p_code: rawCode.trim().toUpperCase() });
    if (error) {
      if (error.message.includes('not-found')) throw new RoomJoinError('not-found');
      if (error.message.includes('full')) throw new RoomJoinError('full');
      throw error;
    }
    return SupabaseService.toRoom(data);
  }

  /** Tu compañero cambió de teléfono: su asiento queda libre para que vuelva a entrar con el código. */
  async releasePartnerSeat(roomId: string): Promise<Room> {
    const { data, error } = await this.db.rpc('release_partner_seat', { p_room: roomId });
    if (error) throw error;
    return SupabaseService.toRoom(data);
  }

  /** Solo devuelve salas de las que eres miembro (RLS). */
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
