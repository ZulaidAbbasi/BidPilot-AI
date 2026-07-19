export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_events: {
        Row: {
          agent_name: string | null
          call_id: string | null
          created_at: string
          event_status: string | null
          event_type: string | null
          id: string
          metadata: Json
          negotiation_id: string
          summary: string | null
        }
        Insert: {
          agent_name?: string | null
          call_id?: string | null
          created_at?: string
          event_status?: string | null
          event_type?: string | null
          id?: string
          metadata?: Json
          negotiation_id: string
          summary?: string | null
        }
        Update: {
          agent_name?: string | null
          call_id?: string | null
          created_at?: string
          event_status?: string | null
          event_type?: string | null
          id?: string
          metadata?: Json
          negotiation_id?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_recordings: {
        Row: {
          call_id: string
          conversation_id: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          negotiation_id: string
          provider_reference: string
          status: string
        }
        Insert: {
          call_id: string
          conversation_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          negotiation_id: string
          provider_reference: string
          status?: string
        }
        Update: {
          call_id?: string
          conversation_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          negotiation_id?: string
          provider_reference?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_recordings_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_recordings_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_tool_tokens: {
        Row: {
          call_id: string
          created_at: string
          expires_at: string
          id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          call_id: string
          created_at?: string
          expires_at: string
          id?: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          call_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_tool_tokens_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      call_transcripts: {
        Row: {
          call_id: string
          conversation_id: string | null
          created_at: string
          ended_at_ms: number | null
          id: string
          negotiation_id: string
          sequence_number: number
          source: string
          speaker: string
          started_at_ms: number | null
          text: string
        }
        Insert: {
          call_id: string
          conversation_id?: string | null
          created_at?: string
          ended_at_ms?: number | null
          id?: string
          negotiation_id: string
          sequence_number: number
          source?: string
          speaker: string
          started_at_ms?: number | null
          text: string
        }
        Update: {
          call_id?: string
          conversation_id?: string | null
          created_at?: string
          ended_at_ms?: number | null
          id?: string
          negotiation_id?: string
          sequence_number?: number
          source?: string
          speaker?: string
          started_at_ms?: number | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_transcripts_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_transcripts_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_webhook_events: {
        Row: {
          call_id: string | null
          conversation_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          event_hash: string
          event_type: string
          external_event_id: string | null
          id: string
          negotiation_id: string | null
          payload: Json
          processed_at: string | null
          processing_status: string
          received_at: string
          retry_count: number
          signature_valid: boolean
        }
        Insert: {
          call_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          event_hash: string
          event_type: string
          external_event_id?: string | null
          id?: string
          negotiation_id?: string | null
          payload: Json
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          retry_count?: number
          signature_valid: boolean
        }
        Update: {
          call_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          event_hash?: string
          event_type?: string
          external_event_id?: string | null
          id?: string
          negotiation_id?: string | null
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          retry_count?: number
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "call_webhook_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_webhook_events_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          agent_type: string | null
          call_mode: string | null
          coverage: Json
          created_at: string
          ended_at: string | null
          external_call_id: string | null
          failure_reason: string | null
          final_outcome: string | null
          finalize_idempotency_key: string | null
          id: string
          job_spec_hash: string | null
          job_spec_version: number | null
          metadata: Json
          needs_review: boolean
          negotiation_id: string
          outcome: string | null
          outcome_finalized_at: string | null
          provider_id: string | null
          reconciled_at: string | null
          recording_url: string | null
          session_ended_at: string | null
          started_at: string | null
          status: string | null
          transcript_pending: boolean
          transcript_source: string | null
          transcript_text: string | null
          verified_price_changed: boolean | null
          verified_savings_amount: number | null
          verified_terms_changed: boolean | null
          webhook_received_at: string | null
        }
        Insert: {
          agent_type?: string | null
          call_mode?: string | null
          coverage?: Json
          created_at?: string
          ended_at?: string | null
          external_call_id?: string | null
          failure_reason?: string | null
          final_outcome?: string | null
          finalize_idempotency_key?: string | null
          id?: string
          job_spec_hash?: string | null
          job_spec_version?: number | null
          metadata?: Json
          needs_review?: boolean
          negotiation_id: string
          outcome?: string | null
          outcome_finalized_at?: string | null
          provider_id?: string | null
          reconciled_at?: string | null
          recording_url?: string | null
          session_ended_at?: string | null
          started_at?: string | null
          status?: string | null
          transcript_pending?: boolean
          transcript_source?: string | null
          transcript_text?: string | null
          verified_price_changed?: boolean | null
          verified_savings_amount?: number | null
          verified_terms_changed?: boolean | null
          webhook_received_at?: string | null
        }
        Update: {
          agent_type?: string | null
          call_mode?: string | null
          coverage?: Json
          created_at?: string
          ended_at?: string | null
          external_call_id?: string | null
          failure_reason?: string | null
          final_outcome?: string | null
          finalize_idempotency_key?: string | null
          id?: string
          job_spec_hash?: string | null
          job_spec_version?: number | null
          metadata?: Json
          needs_review?: boolean
          negotiation_id?: string
          outcome?: string | null
          outcome_finalized_at?: string | null
          provider_id?: string | null
          reconciled_at?: string | null
          recording_url?: string | null
          session_ended_at?: string | null
          started_at?: string | null
          status?: string | null
          transcript_pending?: boolean
          transcript_source?: string | null
          transcript_text?: string | null
          verified_price_changed?: boolean | null
          verified_savings_amount?: number | null
          verified_terms_changed?: boolean | null
          webhook_received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_sessions: {
        Row: {
          captured_fields: Json
          conversation_id: string | null
          created_at: string
          draft_id: string
          ended_at: string | null
          id: string
          negotiation_id: string
          post_processing_status: string
          recording_url: string | null
          started_at: string
          status: string
          summary: string | null
          transcript: Json
          unresolved_fields: Json
          updated_at: string
          user_id: string
          webhook_received_at: string | null
        }
        Insert: {
          captured_fields?: Json
          conversation_id?: string | null
          created_at?: string
          draft_id: string
          ended_at?: string | null
          id?: string
          negotiation_id: string
          post_processing_status?: string
          recording_url?: string | null
          started_at?: string
          status?: string
          summary?: string | null
          transcript?: Json
          unresolved_fields?: Json
          updated_at?: string
          user_id: string
          webhook_received_at?: string | null
        }
        Update: {
          captured_fields?: Json
          conversation_id?: string | null
          created_at?: string
          draft_id?: string
          ended_at?: string | null
          id?: string
          negotiation_id?: string
          post_processing_status?: string
          recording_url?: string | null
          started_at?: string
          status?: string
          summary?: string | null
          transcript?: Json
          unresolved_fields?: Json
          updated_at?: string
          user_id?: string
          webhook_received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_sessions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "job_spec_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_sessions_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_tool_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          negotiation_id: string
          session_id: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          negotiation_id: string
          session_id: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          negotiation_id?: string
          session_id?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_tool_tokens_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_tool_tokens_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_webhook_events: {
        Row: {
          conversation_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          event_hash: string
          event_type: string
          external_event_id: string | null
          id: string
          negotiation_id: string | null
          payload: Json
          processed_at: string | null
          processing_status: string
          session_id: string | null
          signature_valid: boolean
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          event_hash: string
          event_type: string
          external_event_id?: string | null
          id?: string
          negotiation_id?: string | null
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          session_id?: string | null
          signature_valid?: boolean
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          event_hash?: string
          event_type?: string
          external_event_id?: string | null
          id?: string
          negotiation_id?: string | null
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          session_id?: string | null
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "intake_webhook_events_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_webhook_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      job_spec_drafts: {
        Row: {
          completion_percent: number
          conflicts: Json
          created_at: string
          field_provenance: Json
          id: string
          negotiation_id: string
          revision: number
          specification: Json
          updated_at: string
        }
        Insert: {
          completion_percent?: number
          conflicts?: Json
          created_at?: string
          field_provenance?: Json
          id?: string
          negotiation_id: string
          revision?: number
          specification?: Json
          updated_at?: string
        }
        Update: {
          completion_percent?: number
          conflicts?: Json
          created_at?: string
          field_provenance?: Json
          id?: string
          negotiation_id?: string
          revision?: number
          specification?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_spec_drafts_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: true
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_specs: {
        Row: {
          confirmed: boolean
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          negotiation_id: string
          specification: Json
          specification_hash: string | null
          version: number
        }
        Insert: {
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          negotiation_id: string
          specification?: Json
          specification_hash?: string | null
          version?: number
        }
        Update: {
          confirmed?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          negotiation_id?: string
          specification?: Json
          specification_hash?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_specs_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiations: {
        Row: {
          bedroom_count: number | null
          created_at: string
          destination_address: string | null
          id: string
          moving_date: string | null
          origin_address: string | null
          title: string
          updated_at: string
          user_id: string
          vertical: string
          workflow_status: string
        }
        Insert: {
          bedroom_count?: number | null
          created_at?: string
          destination_address?: string | null
          id?: string
          moving_date?: string | null
          origin_address?: string | null
          title: string
          updated_at?: string
          user_id: string
          vertical?: string
          workflow_status?: string
        }
        Update: {
          bedroom_count?: number | null
          created_at?: string
          destination_address?: string | null
          id?: string
          moving_date?: string | null
          origin_address?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          vertical?: string
          workflow_status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          created_at: string
          id: string
          location: string | null
          name: string
          negotiation_id: string
          phone: string | null
          source: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          name: string
          negotiation_id: string
          phone?: string | null
          source?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          name?: string
          negotiation_id?: string
          phone?: string | null
          source?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "providers_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_evidence: {
        Row: {
          created_at: string
          evidence_type: string
          extracted_text: string | null
          id: string
          negotiation_id: string
          quote_id: string
          quote_line_item_id: string | null
          support_status: string
          timestamp_ms: number | null
          transcript_id: string | null
        }
        Insert: {
          created_at?: string
          evidence_type: string
          extracted_text?: string | null
          id?: string
          negotiation_id: string
          quote_id: string
          quote_line_item_id?: string | null
          support_status: string
          timestamp_ms?: number | null
          transcript_id?: string | null
        }
        Update: {
          created_at?: string
          evidence_type?: string
          extracted_text?: string | null
          id?: string
          negotiation_id?: string
          quote_id?: string
          quote_line_item_id?: string | null
          support_status?: string
          timestamp_ms?: number | null
          transcript_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_evidence_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_evidence_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_evidence_quote_line_item_id_fkey"
            columns: ["quote_line_item_id"]
            isOneToOne: false
            referencedRelation: "quote_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_evidence_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "call_transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_line_items: {
        Row: {
          amount: number | null
          category: string
          condition_text: string | null
          conditional: boolean
          created_at: string
          currency: string
          evidence: Json
          id: string
          idempotency_key: string | null
          included: boolean
          label: string
          provider_words: string | null
          quantity: number | null
          quote_id: string
          unit: string | null
        }
        Insert: {
          amount?: number | null
          category: string
          condition_text?: string | null
          conditional?: boolean
          created_at?: string
          currency?: string
          evidence?: Json
          id?: string
          idempotency_key?: string | null
          included?: boolean
          label: string
          provider_words?: string | null
          quantity?: number | null
          quote_id: string
          unit?: string | null
        }
        Update: {
          amount?: number | null
          category?: string
          condition_text?: string | null
          conditional?: boolean
          created_at?: string
          currency?: string
          evidence?: Json
          id?: string
          idempotency_key?: string | null
          included?: boolean
          label?: string
          provider_words?: string | null
          quantity?: number | null
          quote_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          call_id: string | null
          captured_at: string
          created_at: string
          currency: string
          deposit_amount: number | null
          deposit_conditions: string | null
          deposit_due: string | null
          deposit_percentage: number | null
          deposit_refundable: boolean | null
          deposit_required: boolean | null
          estimate_type: string | null
          excluded_services: Json
          external_ref: string | null
          final_confirmed_at: string | null
          high_amount: number | null
          id: string
          included_services: Json
          low_amount: number | null
          metadata: Json
          negotiation_id: string
          previous_quote_id: string | null
          price_change_conditions: string | null
          provider_id: string
          quote_stage: string
          spec_hash: string
          spec_version: number
          terms: string | null
          total_amount: number | null
          updated_at: string
          valid_until: string | null
          verification_status: string
        }
        Insert: {
          call_id?: string | null
          captured_at?: string
          created_at?: string
          currency?: string
          deposit_amount?: number | null
          deposit_conditions?: string | null
          deposit_due?: string | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_required?: boolean | null
          estimate_type?: string | null
          excluded_services?: Json
          external_ref?: string | null
          final_confirmed_at?: string | null
          high_amount?: number | null
          id?: string
          included_services?: Json
          low_amount?: number | null
          metadata?: Json
          negotiation_id: string
          previous_quote_id?: string | null
          price_change_conditions?: string | null
          provider_id: string
          quote_stage: string
          spec_hash: string
          spec_version: number
          terms?: string | null
          total_amount?: number | null
          updated_at?: string
          valid_until?: string | null
          verification_status?: string
        }
        Update: {
          call_id?: string | null
          captured_at?: string
          created_at?: string
          currency?: string
          deposit_amount?: number | null
          deposit_conditions?: string | null
          deposit_due?: string | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_required?: boolean | null
          estimate_type?: string | null
          excluded_services?: Json
          external_ref?: string | null
          final_confirmed_at?: string | null
          high_amount?: number | null
          id?: string
          included_services?: Json
          low_amount?: number | null
          metadata?: Json
          negotiation_id?: string
          previous_quote_id?: string | null
          price_change_conditions?: string | null
          provider_id?: string
          quote_stage?: string
          spec_hash?: string
          spec_version?: number
          terms?: string | null
          total_amount?: number | null
          updated_at?: string
          valid_until?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_previous_quote_id_fkey"
            columns: ["previous_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_counters: {
        Row: {
          bucket_key: string
          count: number
          expires_at: string
          window_seconds: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          count?: number
          expires_at: string
          window_seconds: number
          window_start: string
        }
        Update: {
          bucket_key?: string
          count?: number
          expires_at?: string
          window_seconds?: number
          window_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _test_wipe_negotiation: {
        Args: { _negotiation_id: string }
        Returns: undefined
      }
      cleanup_expired_rate_limits: { Args: never; Returns: number }
      consume_rate_limit: {
        Args: { _bucket: string; _limit: number; _window_seconds: number }
        Returns: {
          allowed: boolean
          current_count: number
          retry_after_seconds: number
        }[]
      }
      user_owns_negotiation: {
        Args: { _negotiation_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
