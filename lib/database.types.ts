/* eslint-disable @typescript-eslint/no-empty-object-type */
/**
 * Database types for Supabase.
 * Regenerate with: npx supabase gen types typescript --local > lib/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          timezone: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          timezone?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          timezone?: string;
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          organization_id: string;
          full_name: string | null;
          role: 'owner' | 'staff';
          created_at: string;
        };
        Insert: {
          id: string;
          organization_id: string;
          full_name?: string | null;
          role?: 'owner' | 'staff';
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          full_name?: string | null;
          role?: 'owner' | 'staff';
          created_at?: string;
        };
      };
      whatsapp_configs: {
        Row: {
          organization_id: string;
          phone_number_id: string;
          waba_id: string;
          access_token_encrypted: string;
          verify_token: string;
          app_secret_encrypted: string;
          openwa_api_url: string | null;
          openwa_session_id: string | null;
          openwa_api_key: string | null;
          provider: 'meta' | 'openwa';
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          phone_number_id?: string;
          waba_id?: string;
          access_token_encrypted?: string;
          verify_token?: string;
          app_secret_encrypted?: string;
          openwa_api_url?: string | null;
          openwa_session_id?: string | null;
          openwa_api_key?: string | null;
          provider?: 'meta' | 'openwa';
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          phone_number_id?: string;
          waba_id?: string;
          access_token_encrypted?: string;
          verify_token?: string;
          app_secret_encrypted?: string;
          openwa_api_url?: string | null;
          openwa_session_id?: string | null;
          openwa_api_key?: string | null;
          provider?: 'meta' | 'openwa';
          updated_at?: string;
        };
      };
      google_calendar_configs: {
        Row: {
          organization_id: string;
          calendar_id: string;
          refresh_token_encrypted: string;
          access_token_encrypted: string | null;
          token_expires_at: string | null;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          calendar_id?: string;
          refresh_token_encrypted?: string;
          access_token_encrypted?: string | null;
          token_expires_at?: string | null;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          calendar_id?: string;
          refresh_token_encrypted?: string;
          access_token_encrypted?: string | null;
          token_expires_at?: string | null;
          updated_at?: string;
        };
      };
      agent_configs: {
        Row: {
          organization_id: string;
          system_prompt: string;
          tone: string;
          business_info: Json;
          services: Json;
          business_hours: Json;
          handoff_message: string | null;
          metadata: Json;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          system_prompt?: string;
          tone?: string;
          business_info?: Json;
          services?: Json;
          business_hours?: Json;
          handoff_message?: string | null;
          metadata?: Json;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          system_prompt?: string;
          tone?: string;
          business_info?: Json;
          services?: Json;
          business_hours?: Json;
          handoff_message?: string | null;
          metadata?: Json;
          updated_at?: string;
        };
      };
      knowledge_documents: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          source_type: 'manual' | 'pdf' | 'url' | 'doc' | 'sheet' | 'api';
          source_url: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          title: string;
          source_type?: 'manual' | 'pdf' | 'url' | 'doc' | 'sheet' | 'api';
          source_url?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          title?: string;
          source_type?: 'manual' | 'pdf' | 'url' | 'doc' | 'sheet' | 'api';
          source_url?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      knowledge_chunks: {
        Row: {
          id: string;
          organization_id: string;
          document_id: string;
          content: string;
          embedding: number[];
          token_count: number | null;
          tags: string[];
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          document_id: string;
          content: string;
          embedding: number[];
          token_count?: number | null;
          tags?: string[];
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          document_id?: string;
          content?: string;
          embedding?: number[];
          token_count?: number | null;
          tags?: string[];
          metadata?: Json;
          created_at?: string;
        };
      };
      contacts: {
        Row: {
          id: string;
          organization_id: string;
          wa_phone: string;
          full_name: string | null;
          is_new_patient: boolean | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          wa_phone: string;
          full_name?: string | null;
          is_new_patient?: boolean | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          wa_phone?: string;
          full_name?: string | null;
          is_new_patient?: boolean | null;
          metadata?: Json;
          created_at?: string;
        };
      };
      conversations: {
        Row: {
          id: string;
          organization_id: string;
          contact_id: string;
          bot_active: boolean;
          last_message_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          contact_id: string;
          bot_active?: boolean;
          last_message_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          contact_id?: string;
          bot_active?: boolean;
          last_message_at?: string;
          created_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          organization_id: string;
          wa_message_id: string | null;
          direction: 'inbound' | 'outbound';
          sender: 'contact' | 'bot' | 'human';
          content: string | null;
          raw: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          organization_id: string;
          wa_message_id?: string | null;
          direction: 'inbound' | 'outbound';
          sender: 'contact' | 'bot' | 'human';
          content?: string | null;
          raw?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          organization_id?: string;
          wa_message_id?: string | null;
          direction?: 'inbound' | 'outbound';
          sender?: 'contact' | 'bot' | 'human';
          content?: string | null;
          raw?: Json | null;
          created_at?: string;
        };
      };
      appointments: {
        Row: {
          id: string;
          organization_id: string;
          contact_id: string;
          service: string;
          starts_at: string;
          ends_at: string;
          google_event_id: string | null;
          status: 'confirmed' | 'cancelled' | 'completed';
          is_new_patient: boolean | null;
          full_name: string;
          phone: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          contact_id: string;
          service: string;
          starts_at: string;
          ends_at: string;
          google_event_id?: string | null;
          status?: 'confirmed' | 'cancelled' | 'completed';
          is_new_patient?: boolean | null;
          full_name: string;
          phone: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          contact_id?: string;
          service?: string;
          starts_at?: string;
          ends_at?: string;
          google_event_id?: string | null;
          status?: 'confirmed' | 'cancelled' | 'completed';
          is_new_patient?: boolean | null;
          full_name?: string;
          phone?: string;
          notes?: string | null;
          created_at?: string;
        };
      };
    };
    Views: {};
    Functions: {
      user_org_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      match_knowledge_chunks: {
        Args: {
          target_organization_id: string;
          query_embedding: number[];
          match_count?: number;
          match_threshold?: number;
          filter_tags?: string[] | null;
        };
        Returns: {
          chunk_id: string;
          document_id: string;
          document_title: string;
          source_url: string | null;
          content: string;
          similarity: number;
          tags: string[];
          metadata: Json;
        }[];
      };
    };
    Enums: {};
  };
}

// Convenience types
export type Organization = Database['public']['Tables']['organizations']['Row'];
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type WhatsAppConfig = Database['public']['Tables']['whatsapp_configs']['Row'];
export type GoogleCalendarConfig = Database['public']['Tables']['google_calendar_configs']['Row'];
export type AgentConfig = Database['public']['Tables']['agent_configs']['Row'];
export type KnowledgeDocument = Database['public']['Tables']['knowledge_documents']['Row'];
export type KnowledgeChunk = Database['public']['Tables']['knowledge_chunks']['Row'];
export type Contact = Database['public']['Tables']['contacts']['Row'];
export type Conversation = Database['public']['Tables']['conversations']['Row'];
export type Message = Database['public']['Tables']['messages']['Row'];
export type Appointment = Database['public']['Tables']['appointments']['Row'];

// Business types
export interface ServiceConfig {
  name: string;
  duration_minutes: number;
  description: string;
  price?: number;
}

export interface BusinessHours {
  mon: { start: string; end: string }[];
  tue: { start: string; end: string }[];
  wed: { start: string; end: string }[];
  thu: { start: string; end: string }[];
  fri: { start: string; end: string }[];
  sat: { start: string; end: string }[];
  sun: { start: string; end: string }[];
}

export interface BusinessInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  cancellation_policy: string;
  faq: { question: string; answer: string }[];
}
