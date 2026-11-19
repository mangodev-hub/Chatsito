// Generado con Supabase MCP (generate_typescript_types) — proyecto "Chatsito".
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      messages: {
        Row: {
          content: string;
          created_at: string;
          emotion: string;
          id: string;
          is_secret: boolean;
          room_id: string;
          sender_id: string;
          sticker_reaction: string | null;
        };
        Insert: {
          content: string;
          created_at?: string;
          emotion?: string;
          id?: string;
          is_secret?: boolean;
          room_id: string;
          sender_id: string;
          sticker_reaction?: string | null;
        };
        Update: {
          content?: string;
          created_at?: string;
          emotion?: string;
          id?: string;
          is_secret?: boolean;
          room_id?: string;
          sender_id?: string;
          sticker_reaction?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_sender_id_fkey';
            columns: ['sender_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_type: string;
          created_at: string;
          id: string;
          username: string;
        };
        Insert: {
          avatar_type?: string;
          created_at?: string;
          id?: string;
          username: string;
        };
        Update: {
          avatar_type?: string;
          created_at?: string;
          id?: string;
          username?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          created_at: string;
          id: string;
          room_code: string;
          user_1: string | null;
          user_2: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          room_code: string;
          user_1?: string | null;
          user_2?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          room_code?: string;
          user_1?: string | null;
          user_2?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rooms_user_1_fkey';
            columns: ['user_1'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rooms_user_2_fkey';
            columns: ['user_2'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
