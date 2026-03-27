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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      answer_feedback: {
        Row: {
          created_at: string
          expected_source: string | null
          feedback_text: string | null
          id: string
          message_id: string | null
          rating: string | null
          thread_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expected_source?: string | null
          feedback_text?: string | null
          id?: string
          message_id?: string | null
          rating?: string | null
          thread_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expected_source?: string | null
          feedback_text?: string | null
          id?: string
          message_id?: string | null
          rating?: string | null
          thread_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chat_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          request_payload: Json
          response_content: string | null
          status: string
          thread_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          request_payload: Json
          response_content?: string | null
          status?: string
          thread_id: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          request_payload?: Json
          response_content?: string | null
          status?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_jobs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          folder_id: string | null
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          folder_id?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          folder_id?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "chat_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_scopes: {
        Row: {
          created_at: string
          default_included: boolean
          doc_types: string[]
          id: string
          keywords: string[]
          scope_name: string
        }
        Insert: {
          created_at?: string
          default_included?: boolean
          doc_types?: string[]
          id?: string
          keywords?: string[]
          scope_name: string
        }
        Update: {
          created_at?: string
          default_included?: boolean
          doc_types?: string[]
          id?: string
          keywords?: string[]
          scope_name?: string
        }
        Relationships: []
      }
      dd_checklists: {
        Row: {
          checklist_item: string
          completed_date: string | null
          confidence: number | null
          created_at: string
          id: string
          notes: string | null
          project_name: string
          source_file_name: string | null
          source_file_path: string | null
          status: string
          updated_at: string
        }
        Insert: {
          checklist_item: string
          completed_date?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          project_name: string
          source_file_name?: string | null
          source_file_path?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          checklist_item?: string
          completed_date?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          project_name?: string
          source_file_name?: string | null
          source_file_path?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          file_name: string | null
          file_path: string | null
          id: string
          metadata: Json | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          metadata?: Json | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          metadata?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      dropbox_files: {
        Row: {
          content_hash: string | null
          created_at: string
          discovered_at: string
          dropbox_id: string | null
          dropbox_modified_at: string | null
          file_extension: string | null
          file_name: string | null
          file_path: string
          file_size_bytes: number | null
          id: string
          last_seen_at: string
          updated_at: string
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          discovered_at?: string
          dropbox_id?: string | null
          dropbox_modified_at?: string | null
          file_extension?: string | null
          file_name?: string | null
          file_path: string
          file_size_bytes?: number | null
          id?: string
          last_seen_at?: string
          updated_at?: string
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          discovered_at?: string
          dropbox_id?: string | null
          dropbox_modified_at?: string | null
          file_extension?: string | null
          file_name?: string | null
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          last_seen_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      indexing_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          started_at: string
          stats: Json
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          started_at?: string
          stats?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          started_at?: string
          stats?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      indexing_status: {
        Row: {
          chunks_created: number | null
          created_at: string
          error_message: string | null
          file_name: string | null
          file_path: string
          id: string
          indexed_at: string | null
          metadata: Json | null
          status: string
          structured_extracted: boolean
          updated_at: string
        }
        Insert: {
          chunks_created?: number | null
          created_at?: string
          error_message?: string | null
          file_name?: string | null
          file_path: string
          id?: string
          indexed_at?: string | null
          metadata?: Json | null
          status?: string
          structured_extracted?: boolean
          updated_at?: string
        }
        Update: {
          chunks_created?: number | null
          created_at?: string
          error_message?: string | null
          file_name?: string | null
          file_path?: string
          id?: string
          indexed_at?: string | null
          metadata?: Json | null
          status?: string
          structured_extracted?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          created_at: string
          file_name: string | null
          id: string
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          file_name?: string | null
          id?: string
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          file_name?: string | null
          id?: string
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      permits_tracking: {
        Row: {
          confidence: number | null
          created_at: string
          description: string | null
          expiration_date: string | null
          id: string
          issued_date: string | null
          permit_no: string | null
          permit_type: string
          project_name: string
          raw_text: string | null
          source_file_name: string | null
          source_file_path: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          description?: string | null
          expiration_date?: string | null
          id?: string
          issued_date?: string | null
          permit_no?: string | null
          permit_type: string
          project_name: string
          raw_text?: string | null
          source_file_name?: string | null
          source_file_path?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          description?: string | null
          expiration_date?: string | null
          id?: string
          issued_date?: string | null
          permit_no?: string | null
          permit_type?: string
          project_name?: string
          raw_text?: string | null
          source_file_name?: string | null
          source_file_path?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_aliases: {
        Row: {
          alias_name: string
          alias_type: string | null
          canonical_project_name: string
          created_at: string
          id: string
          notes: string | null
        }
        Insert: {
          alias_name: string
          alias_type?: string | null
          canonical_project_name: string
          created_at?: string
          id?: string
          notes?: string | null
        }
        Update: {
          alias_name?: string
          alias_type?: string | null
          canonical_project_name?: string
          created_at?: string
          id?: string
          notes?: string | null
        }
        Relationships: []
      }
      project_data: {
        Row: {
          category: string
          confidence: number | null
          created_at: string
          date: string | null
          id: string
          metric_name: string
          project_name: string
          raw_text: string | null
          source_file_name: string | null
          source_file_path: string | null
          unit: string | null
          updated_at: string
          value: number
        }
        Insert: {
          category: string
          confidence?: number | null
          created_at?: string
          date?: string | null
          id?: string
          metric_name: string
          project_name: string
          raw_text?: string | null
          source_file_name?: string | null
          source_file_path?: string | null
          unit?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          category?: string
          confidence?: number | null
          created_at?: string
          date?: string | null
          id?: string
          metric_name?: string
          project_name?: string
          raw_text?: string | null
          source_file_name?: string | null
          source_file_path?: string | null
          unit?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      retrieval_logs: {
        Row: {
          answer_message_id: string | null
          archive_included: boolean | null
          created_at: string
          id: string
          normalized_project: string | null
          query_type: string | null
          question: string | null
          source_type_breakdown: Json | null
          thread_id: string | null
          top_sources: Json | null
          user_id: string | null
        }
        Insert: {
          answer_message_id?: string | null
          archive_included?: boolean | null
          created_at?: string
          id?: string
          normalized_project?: string | null
          query_type?: string | null
          question?: string | null
          source_type_breakdown?: Json | null
          thread_id?: string | null
          top_sources?: Json | null
          user_id?: string | null
        }
        Update: {
          answer_message_id?: string | null
          archive_included?: boolean | null
          created_at?: string
          id?: string
          normalized_project?: string | null
          query_type?: string | null
          question?: string | null
          source_type_breakdown?: Json | null
          thread_id?: string | null
          top_sources?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_profiles_extended: {
        Row: {
          company_context_summary: string | null
          created_at: string
          display_name: string | null
          drafting_preferences: string | null
          id: string
          notes_for_ai: string | null
          preferred_projects: string[] | null
          role_title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_context_summary?: string | null
          created_at?: string
          display_name?: string | null
          drafting_preferences?: string | null
          id?: string
          notes_for_ai?: string | null
          preferred_projects?: string[] | null
          role_title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_context_summary?: string | null
          created_at?: string
          display_name?: string | null
          drafting_preferences?: string | null
          id?: string
          notes_for_ai?: string | null
          preferred_projects?: string[] | null
          role_title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_uploads: {
        Row: {
          created_at: string
          extracted_text: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          status: string | null
          thread_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          extracted_text?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          status?: string | null
          thread_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          extracted_text?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          status?: string | null
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_uploads_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_filter_options: { Args: never; Returns: Json }
      get_unindexed_dropbox_files: {
        Args: {
          p_extension_filter?: string
          p_limit?: number
          p_offset?: number
          p_path_prefix?: string
        }
        Returns: {
          content_hash: string
          discovered_at: string
          dropbox_id: string
          dropbox_modified_at: string
          file_extension: string
          file_name: string
          file_path: string
          file_size_bytes: number
          last_seen_at: string
        }[]
      }
      match_documents: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          file_name: string
          file_path: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      match_documents_filtered_v2: {
        Args: {
          filter_date_from?: string
          filter_date_to?: string
          filter_doc_type?: string
          filter_file_type?: string
          filter_project?: string
          match_count?: number
          match_threshold?: number
          query_embedding_text?: string
        }
        Returns: {
          content: string
          file_name: string
          file_path: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      match_documents_text: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding_text: string
        }
        Returns: {
          content: string
          file_name: string
          file_path: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      match_documents_with_filters: {
        Args: {
          filter_date_from?: string
          filter_date_to?: string
          filter_file_type?: string
          filter_project?: string
          match_count?: number
          match_threshold?: number
          query_embedding_text: string
        }
        Returns: {
          content: string
          file_name: string
          file_path: string
          id: string
          metadata: Json
          similarity: number
        }[]
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
