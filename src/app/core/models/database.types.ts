export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      room_hidden: {
        Row: { room_id: string; user_id: string; hidden_at: string };
        Insert: { room_id: string; user_id: string; hidden_at?: string };
        Update: { room_id?: string; user_id?: string; hidden_at?: string };
        Relationships: [];
      };
      room_members: {
        Row: {
          room_id: string;
          user_id: string;
          collar_color: number;
          joined_at: string;
        };
        Insert: {
          room_id: string;
          user_id: string;
          collar_color?: number;
          joined_at?: string;
        };
        Update: {
          room_id?: string;
          user_id?: string;
          collar_color?: number;
          joined_at?: string;
        };
        Relationships: [];
      };
      message_reactions: {
        Row: {
          message_id: string;
          reaction: string | null;
          room_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          message_id: string;
          reaction?: string | null;
          room_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          message_id?: string;
          reaction?: string | null;
          room_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
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
      room_reads: {
        Row: {
          last_read_at: string;
          room_id: string;
          user_id: string;
        };
        Insert: {
          last_read_at?: string;
          room_id: string;
          user_id: string;
        };
        Update: {
          last_read_at?: string;
          room_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          created_at: string;
          id: string;
          released_user: string | null;
          room_code: string;
          user_1: string | null;
          user_2: string | null;
          kind: string;
          name: string | null;
          max_members: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          released_user?: string | null;
          room_code: string;
          user_1?: string | null;
          user_2?: string | null;
          kind?: string;
          name?: string | null;
          max_members?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          released_user?: string | null;
          room_code?: string;
          user_1?: string | null;
          user_2?: string | null;
          kind?: string;
          name?: string | null;
          max_members?: number;
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
    Functions: {
      join_room: {
        Args: { p_code: string };
        Returns: Database['public']['Tables']['rooms']['Row'];
      };
      release_partner_seat: {
        Args: { p_room: string };
        Returns: Database['public']['Tables']['rooms']['Row'];
      };
      create_group_room: {
        Args: { p_code: string; p_name?: string | null };
        Returns: Database['public']['Tables']['rooms']['Row'];
      };
      leave_group: {
        Args: { p_room: string };
        Returns: undefined;
      };
      my_rooms: {
        Args: Record<string, never>;
        Returns: {
          room_id: string;
          room_code: string;
          kind: string;
          name: string | null;
          room_created_at: string;
          partner_id: string | null;
          partner_username: string | null;
          partner_avatar: string | null;
          member_count: number;
          member_avatars: string[] | null;
          last_content: string | null;
          last_is_secret: boolean | null;
          last_sender_id: string | null;
          last_at: string | null;
          unread: number;
        }[];
      };
      hide_room: {
        Args: { p_room: string };
        Returns: undefined;
      };
      delete_room: {
        Args: { p_room: string };
        Returns: undefined;
      };
      react_to_message: {
        Args: { p_message: string; p_reaction: string | null };
        Returns: Database['public']['Tables']['message_reactions']['Row'];
      };
      mark_read: {
        Args: { p_room: string; p_at: string };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
