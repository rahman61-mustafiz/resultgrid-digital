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
      client_businesses: {
        Row: {
          address: string | null
          archived_at: string | null
          country: string
          created_at: string
          display_name: string
          email: string | null
          id: string
          industry: string | null
          internal_notes: string | null
          legal_name: string | null
          logo_url: string | null
          phone: string | null
          primary_contact_name: string | null
          record_type: string
          status: string
          status_revision: number
          timezone: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          country: string
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          industry?: string | null
          internal_notes?: string | null
          legal_name?: string | null
          logo_url?: string | null
          phone?: string | null
          primary_contact_name?: string | null
          record_type: string
          status?: string
          status_revision?: number
          timezone: string
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          country?: string
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          industry?: string | null
          internal_notes?: string | null
          legal_name?: string | null
          logo_url?: string | null
          phone?: string | null
          primary_contact_name?: string | null
          record_type?: string
          status?: string
          status_revision?: number
          timezone?: string
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_businesses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_share_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          failed_pin_attempts: number
          id: string
          last_accessed_at: string | null
          locked_until: string | null
          pin_hash: string
          project_id: string
          report_rules_version: number
          revoked_at: string | null
          session_nonce_expires_at: string | null
          session_nonce_hash: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          failed_pin_attempts?: number
          id?: string
          last_accessed_at?: string | null
          locked_until?: string | null
          pin_hash: string
          project_id: string
          report_rules_version?: number
          revoked_at?: string | null
          session_nonce_expires_at?: string | null
          session_nonce_hash?: string | null
          token: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          failed_pin_attempts?: number
          id?: string
          last_accessed_at?: string | null
          locked_until?: string | null
          pin_hash?: string
          project_id?: string
          report_rules_version?: number
          revoked_at?: string | null
          session_nonce_expires_at?: string | null
          session_nonce_hash?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_share_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_share_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_approval_history: {
        Row: {
          actor_id: string | null
          created_at: string
          creative_id: string
          id: string
          project_id: string
          status: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          creative_id: string
          id?: string
          project_id: string
          status: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          creative_id?: string
          id?: string
          project_id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_approval_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creatives: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          asset_url: string | null
          channel: string | null
          copy: string | null
          created_at: string
          created_by: string | null
          format: string | null
          id: string
          planned_date: string | null
          project_id: string
          status: string
          title: string
          updated_at: string
          version: number
          version_history: Json
          workspace_id: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          asset_url?: string | null
          channel?: string | null
          copy?: string | null
          created_at?: string
          created_by?: string | null
          format?: string | null
          id?: string
          planned_date?: string | null
          project_id: string
          status?: string
          title: string
          updated_at?: string
          version?: number
          version_history?: Json
          workspace_id: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          asset_url?: string | null
          channel?: string | null
          copy?: string | null
          created_at?: string
          created_by?: string | null
          format?: string | null
          id?: string
          planned_date?: string | null
          project_id?: string
          status?: string
          title?: string
          updated_at?: string
          version?: number
          version_history?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creatives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_preferences: {
        Row: {
          hidden_cards: string[]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          hidden_cards?: string[]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          hidden_cards?: string[]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_preferences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_items: {
        Row: {
          category: string
          content_type: string | null
          created_at: string
          created_by: string | null
          evidence_date: string | null
          external_url: string | null
          id: string
          notes: string | null
          original_filename: string | null
          project_id: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          sha256: string | null
          size_bytes: number | null
          storage_path: string | null
          updated_at: string
          verification_status: string
          version: number
          workspace_id: string
        }
        Insert: {
          category: string
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          evidence_date?: string | null
          external_url?: string | null
          id?: string
          notes?: string | null
          original_filename?: string | null
          project_id: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          sha256?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          updated_at?: string
          verification_status?: string
          version?: number
          workspace_id: string
        }
        Update: {
          category?: string
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          evidence_date?: string | null
          external_url?: string | null
          id?: string
          notes?: string | null
          original_filename?: string | null
          project_id?: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          sha256?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          updated_at?: string
          verification_status?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_uploads: {
        Row: {
          content_type: string
          created_at: string
          created_by: string
          declared_size_bytes: number
          evidence_item_id: string | null
          id: string
          original_filename: string
          project_id: string
          resolution_reason: string | null
          resolved_at: string | null
          status: string
          storage_path: string
          verified_at: string | null
          verified_object_id: string | null
          verified_object_version: string | null
          verified_sha256: string | null
          verified_size_bytes: number | null
          workspace_id: string
        }
        Insert: {
          content_type: string
          created_at?: string
          created_by: string
          declared_size_bytes: number
          evidence_item_id?: string | null
          id?: string
          original_filename: string
          project_id: string
          resolution_reason?: string | null
          resolved_at?: string | null
          status?: string
          storage_path: string
          verified_at?: string | null
          verified_object_id?: string | null
          verified_object_version?: string | null
          verified_sha256?: string | null
          verified_size_bytes?: number | null
          workspace_id: string
        }
        Update: {
          content_type?: string
          created_at?: string
          created_by?: string
          declared_size_bytes?: number
          evidence_item_id?: string | null
          id?: string
          original_filename?: string
          project_id?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          status?: string
          storage_path?: string
          verified_at?: string | null
          verified_object_id?: string | null
          verified_object_version?: string | null
          verified_sha256?: string | null
          verified_size_bytes?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_records: {
        Row: {
          amount: number
          attributed_to_marketing: boolean
          correction_history: Json
          created_at: string
          created_by: string | null
          evidence_status: string
          evidence_url: string | null
          id: string
          notes: string | null
          period_end: string
          period_start: string
          project_id: string
          record_type: string
          updated_at: string
          value_status: string
          workspace_id: string
        }
        Insert: {
          amount: number
          attributed_to_marketing?: boolean
          correction_history?: Json
          created_at?: string
          created_by?: string | null
          evidence_status?: string
          evidence_url?: string | null
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          project_id: string
          record_type: string
          updated_at?: string
          value_status?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          attributed_to_marketing?: boolean
          correction_history?: Json
          created_at?: string
          created_by?: string | null
          evidence_status?: string
          evidence_url?: string | null
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          project_id?: string
          record_type?: string
          updated_at?: string
          value_status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      known_devices: {
        Row: {
          device_id: string
          first_seen_at: string
          id: string
          last_seen_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          device_id: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          device_id?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      lead_archive_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          lead_id: string
          reason: string
          seq: number
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          lead_id: string
          reason: string
          seq?: never
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string
          reason?: string
          seq?: never
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_archive_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_archive_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          budget: string | null
          business_name: string | null
          consent: boolean
          created_at: string
          created_by: string | null
          email: string | null
          followup_count: number
          id: string
          last_followup_at: string | null
          name: string
          normalized_email: string | null
          normalized_phone: string | null
          phone: string | null
          qualification_reason: string | null
          service_needed: string | null
          source: string | null
          stage: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          budget?: string | null
          business_name?: string | null
          consent?: boolean
          created_at?: string
          created_by?: string | null
          email?: string | null
          followup_count?: number
          id?: string
          last_followup_at?: string | null
          name: string
          normalized_email?: string | null
          normalized_phone?: string | null
          phone?: string | null
          qualification_reason?: string | null
          service_needed?: string | null
          source?: string | null
          stage?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          budget?: string | null
          business_name?: string | null
          consent?: boolean
          created_at?: string
          created_by?: string | null
          email?: string | null
          followup_count?: number
          id?: string
          last_followup_at?: string | null
          name?: string
          normalized_email?: string | null
          normalized_phone?: string | null
          phone?: string | null
          qualification_reason?: string | null
          service_needed?: string | null
          source?: string | null
          stage?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_events: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_name: string
          entity_revision: number | null
          entity_type: string
          event_type: string
          from_status: string | null
          id: string
          reason: string | null
          seq: number
          to_status: string | null
          txid: number | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_name: string
          entity_revision?: number | null
          entity_type: string
          event_type: string
          from_status?: string | null
          id?: string
          reason?: string | null
          seq?: never
          to_status?: string | null
          txid?: number | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_name?: string
          entity_revision?: number | null
          entity_type?: string
          event_type?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          seq?: never
          to_status?: string | null
          txid?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lifecycle_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_answers: {
        Row: {
          evidence_url: string | null
          id: string
          project_id: string
          question_key: string
          questionnaire_version: number
          status: string
          updated_at: string
          updated_by: string | null
          value: Json | null
          workspace_id: string
        }
        Insert: {
          evidence_url?: string | null
          id?: string
          project_id: string
          question_key: string
          questionnaire_version?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
          workspace_id: string
        }
        Update: {
          evidence_url?: string | null
          id?: string
          project_id?: string
          question_key?: string
          questionnaire_version?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_answers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_answers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_approval_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          export_version: number | null
          from_status: string | null
          id: string
          project_id: string
          reason: string | null
          to_status: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          export_version?: number | null
          from_status?: string | null
          id?: string
          project_id: string
          reason?: string | null
          to_status?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          export_version?: number | null
          from_status?: string | null
          id?: string
          project_id?: string
          reason?: string | null
          to_status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_approval_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_approval_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_export_archive_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          export_id: string
          id: string
          reason: string | null
          seq: number
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          export_id: string
          id?: string
          reason?: string | null
          seq?: never
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          export_id?: string
          id?: string
          reason?: string | null
          seq?: never
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_export_archive_events_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "project_exports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_export_archive_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_export_evidence: {
        Row: {
          evidence_item_id: string
          export_id: string
        }
        Insert: {
          evidence_item_id: string
          export_id: string
        }
        Update: {
          evidence_item_id?: string
          export_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_export_evidence_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "project_exports"
            referencedColumns: ["id"]
          },
        ]
      }
      project_exports: {
        Row: {
          content: string
          evidence_index_content: string
          export_manifest_content: string
          generated_at: string
          generated_by: string | null
          id: string
          project_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          content: string
          evidence_index_content?: string
          export_manifest_content?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          project_id: string
          version: number
          workspace_id: string
        }
        Update: {
          content?: string
          evidence_index_content?: string
          export_manifest_content?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          project_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_exports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_targets: {
        Row: {
          actual: number | null
          actual_source: string | null
          baseline: number | null
          created_at: string
          created_by: string | null
          id: string
          metric: string
          notes: string | null
          period_end: string
          period_start: string
          project_id: string
          target: number
          unit: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual?: number | null
          actual_source?: string | null
          baseline?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          metric: string
          notes?: string | null
          period_end: string
          period_start: string
          project_id: string
          target: number
          unit: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actual?: number | null
          actual_source?: string | null
          baseline?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          metric?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          project_id?: string
          target?: number
          unit?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_targets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          client_business_id: string
          created_at: string
          custom_type_label: string | null
          default_currency: string
          export_language: string
          id: string
          internal_notes: string | null
          lifecycle_revision: number
          lifecycle_status: string
          project_name: string
          project_type: string
          readiness_status: string
          short_description: string | null
          start_date: string | null
          tags: string[]
          target_completion_date: string | null
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          client_business_id: string
          created_at?: string
          custom_type_label?: string | null
          default_currency: string
          export_language?: string
          id?: string
          internal_notes?: string | null
          lifecycle_revision?: number
          lifecycle_status?: string
          project_name: string
          project_type: string
          readiness_status?: string
          short_description?: string | null
          start_date?: string | null
          tags?: string[]
          target_completion_date?: string | null
          timezone: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          client_business_id?: string
          created_at?: string
          custom_type_label?: string | null
          default_currency?: string
          export_language?: string
          id?: string
          internal_notes?: string | null
          lifecycle_revision?: number
          lifecycle_status?: string
          project_name?: string
          project_type?: string
          readiness_status?: string
          short_description?: string | null
          start_date?: string | null
          tags?: string[]
          target_completion_date?: string | null
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_business_id_fkey"
            columns: ["client_business_id"]
            isOneToOne: false
            referencedRelation: "client_businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: unknown
          metadata: Json
          user_agent: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_cleanup_queue: {
        Row: {
          attempts: number
          bucket_id: string
          completed_at: string | null
          enqueued_at: string
          id: number
          last_attempt_at: string | null
          last_error: string | null
          outcome: string | null
          project_id: string | null
          reason: string
          storage_path: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          bucket_id?: string
          completed_at?: string | null
          enqueued_at?: string
          id?: never
          last_attempt_at?: string | null
          last_error?: string | null
          outcome?: string | null
          project_id?: string | null
          reason: string
          storage_path: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          bucket_id?: string
          completed_at?: string | null
          enqueued_at?: string
          id?: never
          last_attempt_at?: string | null
          last_error?: string | null
          outcome?: string | null
          project_id?: string | null
          reason?: string
          storage_path?: string
          workspace_id?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          default_timezone: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          default_timezone?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          default_timezone?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_evidence_attachment: {
        Args: {
          p_category: string
          p_evidence_date?: string
          p_notes?: string
          p_project_id: string
          p_upload_id: string
          p_verification_status?: string
        }
        Returns: {
          category: string
          content_type: string | null
          created_at: string
          created_by: string | null
          evidence_date: string | null
          external_url: string | null
          id: string
          notes: string | null
          original_filename: string | null
          project_id: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          sha256: string | null
          size_bytes: number | null
          storage_path: string | null
          updated_at: string
          verification_status: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "evidence_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_evidence_item: {
        Args: {
          p_category: string
          p_evidence_date?: string
          p_external_url?: string
          p_notes?: string
          p_original_filename?: string
          p_project_id: string
          p_verification_status?: string
        }
        Returns: {
          category: string
          content_type: string | null
          created_at: string
          created_by: string | null
          evidence_date: string | null
          external_url: string | null
          id: string
          notes: string | null
          original_filename: string | null
          project_id: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          sha256: string | null
          size_bytes: number | null
          storage_path: string | null
          updated_at: string
          verification_status: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "evidence_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_financial_record: {
        Args: {
          p_amount: number
          p_attributed_to_marketing?: boolean
          p_evidence_status?: string
          p_evidence_url?: string
          p_notes?: string
          p_period_end: string
          p_period_start: string
          p_project_id: string
          p_record_type: string
          p_value_status: string
        }
        Returns: {
          amount: number
          attributed_to_marketing: boolean
          correction_history: Json
          created_at: string
          created_by: string | null
          evidence_status: string
          evidence_url: string | null
          id: string
          notes: string | null
          period_end: string
          period_start: string
          project_id: string
          record_type: string
          updated_at: string
          value_status: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "financial_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_project_target: {
        Args: {
          p_actual?: number
          p_actual_source?: string
          p_baseline?: number
          p_metric: string
          p_notes?: string
          p_period_end: string
          p_period_start: string
          p_project_id: string
          p_target: number
          p_unit: string
        }
        Returns: {
          actual: number | null
          actual_source: string | null
          baseline: number | null
          created_at: string
          created_by: string | null
          id: string
          metric: string
          notes: string | null
          period_end: string
          period_start: string
          project_id: string
          target: number
          unit: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_targets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_and_export_project: {
        Args: {
          p_approval_note?: string
          p_content: string
          p_evidence_index_content: string
          p_expected_fingerprint: string
          p_expected_version: number
          p_export_manifest_content: string
          p_project_id: string
        }
        Returns: {
          event_id: string
          export_version: number
        }[]
      }
      archive_client_business: {
        Args: { p_client_business_id: string; p_reason?: string }
        Returns: {
          address: string | null
          archived_at: string | null
          country: string
          created_at: string
          display_name: string
          email: string | null
          id: string
          industry: string | null
          internal_notes: string | null
          legal_name: string | null
          logo_url: string | null
          phone: string | null
          primary_contact_name: string | null
          record_type: string
          status: string
          status_revision: number
          timezone: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "client_businesses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bulk_add_financial_records: {
        Args: { p_project_id: string; p_records: Json }
        Returns: number
      }
      claim_storage_cleanup: {
        Args: { p_limit?: number }
        Returns: {
          bucket_id: string
          id: number
          storage_path: string
        }[]
      }
      complete_storage_cleanup: {
        Args: { p_error?: string; p_id: number }
        Returns: undefined
      }
      correct_financial_record: {
        Args: {
          p_new_amount: number
          p_project_id: string
          p_reason: string
          p_record_id: string
        }
        Returns: {
          amount: number
          attributed_to_marketing: boolean
          correction_history: Json
          created_at: string
          created_by: string | null
          evidence_status: string
          evidence_url: string | null
          id: string
          notes: string | null
          period_end: string
          period_start: string
          project_id: string
          record_type: string
          updated_at: string
          value_status: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "financial_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_client_business_permanently: {
        Args: { p_client_business_id: string; p_confirm_name: string }
        Returns: undefined
      }
      delete_project_permanently: {
        Args: { p_confirm_name: string; p_project_id: string }
        Returns: undefined
      }
      discard_evidence_upload: {
        Args: { p_project_id: string; p_reason: string; p_upload_id: string }
        Returns: undefined
      }
      get_client_report_snapshot: {
        Args: { p_project_id: string }
        Returns: Json
      }
      get_project_export_snapshot: {
        Args: { p_project_id: string }
        Returns: Json
      }
      invalidate_client_approvals: {
        Args: { p_client_business_id: string; p_reason: string }
        Returns: {
          actor_id: string | null
          created_at: string
          event_type: string
          export_version: number | null
          from_status: string | null
          id: string
          project_id: string
          reason: string | null
          to_status: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "project_approval_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      invalidate_project_approval: {
        Args: { p_next_status: string; p_project_id: string; p_reason: string }
        Returns: {
          actor_id: string | null
          created_at: string
          event_type: string
          export_version: number | null
          from_status: string | null
          id: string
          project_id: string
          reason: string | null
          to_status: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_approval_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_evidence_upload: {
        Args: {
          p_original_filename: string
          p_project_id: string
          p_size_bytes: number
        }
        Returns: Json
      }
      project_retained_history: {
        Args: { p_project_id: string }
        Returns: string[]
      }
      record_evidence_upload_verification: {
        Args: {
          p_content_type: string
          p_project_id: string
          p_sha256: string
          p_size_bytes: number
          p_upload_id: string
        }
        Returns: undefined
      }
      record_project_export: {
        Args: {
          p_content: string
          p_evidence_index_content: string
          p_expected_fingerprint: string
          p_expected_version: number
          p_export_manifest_content: string
          p_project_id: string
        }
        Returns: {
          event_id: string
          export_version: number
        }[]
      }
      remove_evidence_item: {
        Args: { p_item_id: string; p_project_id: string; p_reason: string }
        Returns: Json
      }
      restore_client_business: {
        Args: { p_client_business_id: string; p_reason?: string }
        Returns: {
          address: string | null
          archived_at: string | null
          country: string
          created_at: string
          display_name: string
          email: string | null
          id: string
          industry: string | null
          internal_notes: string | null
          legal_name: string | null
          logo_url: string | null
          phone: string | null
          primary_contact_name: string | null
          record_type: string
          status: string
          status_revision: number
          timezone: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "client_businesses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_project: {
        Args: { p_project_id: string; p_reason?: string }
        Returns: {
          archived_at: string | null
          client_business_id: string
          created_at: string
          custom_type_label: string | null
          default_currency: string
          export_language: string
          id: string
          internal_notes: string | null
          lifecycle_revision: number
          lifecycle_status: string
          project_name: string
          project_type: string
          readiness_status: string
          short_description: string | null
          start_date: string | null
          tags: string[]
          target_completion_date: string | null
          timezone: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_export_archived: {
        Args: { p_archived: boolean; p_export_id: string; p_reason?: string }
        Returns: undefined
      }
      set_financial_record_attribution: {
        Args: {
          p_attributed_to_marketing?: boolean
          p_evidence_status: string
          p_evidence_url?: string
          p_project_id: string
          p_record_id: string
        }
        Returns: {
          amount: number
          attributed_to_marketing: boolean
          correction_history: Json
          created_at: string
          created_by: string | null
          evidence_status: string
          evidence_url: string | null
          id: string
          notes: string | null
          period_end: string
          period_start: string
          project_id: string
          record_type: string
          updated_at: string
          value_status: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "financial_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_lead_archived: {
        Args: { p_archived: boolean; p_lead_id: string; p_reason: string }
        Returns: undefined
      }
      set_project_lifecycle: {
        Args: { p_project_id: string; p_reason?: string; p_to_status: string }
        Returns: {
          archived_at: string | null
          client_business_id: string
          created_at: string
          custom_type_label: string | null
          default_currency: string
          export_language: string
          id: string
          internal_notes: string | null
          lifecycle_revision: number
          lifecycle_status: string
          project_name: string
          project_type: string
          readiness_status: string
          short_description: string | null
          start_date: string | null
          tags: string[]
          target_completion_date: string | null
          timezone: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_project_for_review: {
        Args: { p_expected_fingerprint: string; p_project_id: string }
        Returns: {
          actor_id: string | null
          created_at: string
          event_type: string
          export_version: number | null
          from_status: string | null
          id: string
          project_id: string
          reason: string | null
          to_status: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_approval_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_client_business_details: {
        Args: {
          p_address?: string
          p_client_business_id: string
          p_country?: string
          p_display_name: string
          p_email?: string
          p_industry?: string
          p_internal_notes?: string
          p_legal_name?: string
          p_phone?: string
          p_primary_contact_name?: string
          p_record_type: string
          p_timezone?: string
          p_website?: string
        }
        Returns: {
          address: string | null
          archived_at: string | null
          country: string
          created_at: string
          display_name: string
          email: string | null
          id: string
          industry: string | null
          internal_notes: string | null
          legal_name: string | null
          logo_url: string | null
          phone: string | null
          primary_contact_name: string | null
          record_type: string
          status: string
          status_revision: number
          timezone: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "client_businesses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project_details: {
        Args: {
          p_custom_type_label?: string
          p_default_currency?: string
          p_export_language?: string
          p_internal_notes?: string
          p_project_id: string
          p_project_name: string
          p_project_type: string
          p_short_description?: string
          p_start_date?: string
          p_tags?: string[]
          p_target_completion_date?: string
          p_timezone?: string
        }
        Returns: {
          archived_at: string | null
          client_business_id: string
          created_at: string
          custom_type_label: string | null
          default_currency: string
          export_language: string
          id: string
          internal_notes: string | null
          lifecycle_revision: number
          lifecycle_status: string
          project_name: string
          project_type: string
          readiness_status: string
          short_description: string | null
          start_date: string | null
          tags: string[]
          target_completion_date: string | null
          timezone: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project_target_actual: {
        Args: { p_actual?: number; p_project_id: string; p_target_id: string }
        Returns: {
          actual: number | null
          actual_source: string | null
          baseline: number | null
          created_at: string
          created_by: string | null
          id: string
          metric: string
          notes: string | null
          period_end: string
          period_start: string
          project_id: string
          target: number
          unit: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_targets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_project_answer: {
        Args: {
          p_next_readiness_status?: string
          p_project_id: string
          p_question_key: string
          p_questionnaire_version: number
          p_status: string
          p_value?: Json
        }
        Returns: {
          evidence_url: string | null
          id: string
          project_id: string
          question_key: string
          questionnaire_version: number
          status: string
          updated_at: string
          updated_by: string | null
          value: Json | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_answers"
          isOneToOne: true
          isSetofReturn: false
        }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
