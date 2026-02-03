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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          created_at: string
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          setting_key: string
          setting_value?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
        }
        Relationships: []
      }
      agent_locations: {
        Row: {
          agent_id: string
          id: string
          is_available: boolean | null
          last_updated: string | null
          latitude: number
          longitude: number
        }
        Insert: {
          agent_id: string
          id?: string
          is_available?: boolean | null
          last_updated?: string | null
          latitude: number
          longitude: number
        }
        Update: {
          agent_id?: string
          id?: string
          is_available?: boolean | null
          last_updated?: string | null
          latitude?: number
          longitude?: number
        }
        Relationships: []
      }
      customer_feedback: {
        Row: {
          agent_id: string
          comment: string | null
          created_at: string
          customer_id: string
          id: string
          lead_id: string | null
          rating: number
        }
        Insert: {
          agent_id: string
          comment?: string | null
          created_at?: string
          customer_id: string
          id?: string
          lead_id?: string | null
          rating: number
        }
        Update: {
          agent_id?: string
          comment?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          lead_id?: string | null
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_feedback_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_feedback_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tokens: {
        Row: {
          created_at: string
          customer_id: string
          expires_at: string | null
          id: string
          last_accessed_at: string | null
          token: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          token?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          email: string | null
          email_verified: boolean | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          notes: string | null
          notification_opt_in: boolean | null
          phone: string
          phone_verified: boolean | null
          preferred_contact_method: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_verified?: boolean | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          notes?: string | null
          notification_opt_in?: boolean | null
          phone: string
          phone_verified?: boolean | null
          preferred_contact_method?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_verified?: boolean | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          notes?: string | null
          notification_opt_in?: boolean | null
          phone?: string
          phone_verified?: boolean | null
          preferred_contact_method?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          brand: string | null
          created_at: string
          customer_id: string
          id: string
          install_date: string | null
          last_service_date: string | null
          location: string | null
          model: string | null
          notes: string | null
          serial_number: string | null
          type: Database["public"]["Enums"]["equipment_type"]
          updated_at: string
          warranty_expiry: string | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          customer_id: string
          id?: string
          install_date?: string | null
          last_service_date?: string | null
          location?: string | null
          model?: string | null
          notes?: string | null
          serial_number?: string | null
          type?: Database["public"]["Enums"]["equipment_type"]
          updated_at?: string
          warranty_expiry?: string | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          install_date?: string | null
          last_service_date?: string | null
          location?: string | null
          model?: string | null
          notes?: string | null
          serial_number?: string | null
          type?: Database["public"]["Enums"]["equipment_type"]
          updated_at?: string
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          agent_id: string
          created_at: string
          customer_address: string | null
          customer_name: string
          customer_phone: string | null
          equipment_id: string | null
          grand_total: number
          id: string
          invoice_number: string
          lead_id: string
          line_items: Json
          notes: string | null
          payment_method: string | null
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          customer_address?: string | null
          customer_name: string
          customer_phone?: string | null
          equipment_id?: string | null
          grand_total?: number
          id?: string
          invoice_number: string
          lead_id: string
          line_items?: Json
          notes?: string | null
          payment_method?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          customer_address?: string | null
          customer_name?: string
          customer_phone?: string | null
          equipment_id?: string | null
          grand_total?: number
          id?: string
          invoice_number?: string
          lead_id?: string
          line_items?: Json
          notes?: string | null
          payment_method?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      job_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          lead_id: string
          photo_type: string | null
          storage_path: string
          synced_from_offline: boolean | null
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          lead_id: string
          photo_type?: string | null
          storage_path: string
          synced_from_offline?: boolean | null
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          photo_type?: string | null
          storage_path?: string
          synced_from_offline?: boolean | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      lead_change_requests: {
        Row: {
          created_at: string
          current_value: string | null
          id: string
          lead_id: string
          reason: string | null
          request_type: string
          requested_by: string
          requested_value: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_value?: string | null
          id?: string
          lead_id: string
          reason?: string | null
          request_type: string
          requested_by: string
          requested_value: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_value?: string | null
          id?: string
          lead_id?: string
          reason?: string | null
          request_type?: string
          requested_by?: string
          requested_value?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_change_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          accepted_at: string | null
          actual_start_time: string | null
          agreement_id: string | null
          assigned_agent_id: string | null
          broadcast_radius_km: number | null
          completed_at: string | null
          created_at: string | null
          customer_address: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          equipment_id: string | null
          estimated_duration_minutes: number | null
          estimated_end_time: string | null
          id: string
          latitude: number
          longitude: number
          notes: string | null
          priority: string
          scheduled_date: string | null
          scheduled_time: string | null
          service_type: string
          started_at: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          actual_start_time?: string | null
          agreement_id?: string | null
          assigned_agent_id?: string | null
          broadcast_radius_km?: number | null
          completed_at?: string | null
          created_at?: string | null
          customer_address: string
          customer_id?: string | null
          customer_name: string
          customer_phone: string
          equipment_id?: string | null
          estimated_duration_minutes?: number | null
          estimated_end_time?: string | null
          id?: string
          latitude: number
          longitude: number
          notes?: string | null
          priority?: string
          scheduled_date?: string | null
          scheduled_time?: string | null
          service_type: string
          started_at?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          actual_start_time?: string | null
          agreement_id?: string | null
          assigned_agent_id?: string | null
          broadcast_radius_km?: number | null
          completed_at?: string | null
          created_at?: string | null
          customer_address?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          equipment_id?: string | null
          estimated_duration_minutes?: number | null
          estimated_end_time?: string | null
          id?: string
          latitude?: number
          longitude?: number
          notes?: string | null
          priority?: string
          scheduled_date?: string | null
          scheduled_time?: string | null
          service_type?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "service_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          channel: string
          customer_id: string
          error_message: string | null
          id: string
          notification_queue_id: string | null
          notification_type: string
          recipient: string
          sent_at: string
          status: string
          subject: string | null
        }
        Insert: {
          channel: string
          customer_id: string
          error_message?: string | null
          id?: string
          notification_queue_id?: string | null
          notification_type: string
          recipient: string
          sent_at?: string
          status: string
          subject?: string | null
        }
        Update: {
          channel?: string
          customer_id?: string
          error_message?: string | null
          id?: string
          notification_queue_id?: string | null
          notification_type?: string
          recipient?: string
          sent_at?: string
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_notification_queue_id_fkey"
            columns: ["notification_queue_id"]
            isOneToOne: false
            referencedRelation: "notification_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_queue: {
        Row: {
          attempts: number
          body: string
          channel: string
          created_at: string
          customer_id: string
          error_message: string | null
          id: string
          invoice_id: string | null
          lead_id: string | null
          max_attempts: number
          notification_type: string
          recipient_email: string | null
          recipient_phone: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          subject: string | null
          variables: Json
        }
        Insert: {
          attempts?: number
          body: string
          channel?: string
          created_at?: string
          customer_id: string
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          lead_id?: string | null
          max_attempts?: number
          notification_type: string
          recipient_email?: string | null
          recipient_phone?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          variables?: Json
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          created_at?: string
          customer_id?: string
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          lead_id?: string | null
          max_attempts?: number
          notification_type?: string
          recipient_email?: string | null
          recipient_phone?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_queue_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          channels: string[]
          created_at: string
          enabled: boolean
          id: string
          setting_key: string
          template_body: string
          template_subject: string | null
          updated_at: string
          variables: string[]
        }
        Insert: {
          channels?: string[]
          created_at?: string
          enabled?: boolean
          id?: string
          setting_key: string
          template_body: string
          template_subject?: string | null
          updated_at?: string
          variables?: string[]
        }
        Update: {
          channels?: string[]
          created_at?: string
          enabled?: boolean
          id?: string
          setting_key?: string
          template_body?: string
          template_subject?: string | null
          updated_at?: string
          variables?: string[]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          availability_status: string | null
          avatar_url: string | null
          created_at: string | null
          full_name: string
          home_base_lat: number | null
          home_base_lng: number | null
          id: string
          last_availability_update: string | null
          location_tracking_enabled: boolean | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          availability_status?: string | null
          avatar_url?: string | null
          created_at?: string | null
          full_name: string
          home_base_lat?: number | null
          home_base_lng?: number | null
          id: string
          last_availability_update?: string | null
          location_tracking_enabled?: boolean | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          availability_status?: string | null
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string
          home_base_lat?: number | null
          home_base_lng?: number | null
          id?: string
          last_availability_update?: string | null
          location_tracking_enabled?: boolean | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      service_agreements: {
        Row: {
          auto_generate_jobs: boolean
          contract_type: string
          contract_type_custom: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          end_date: string
          equipment_id: string | null
          frequency: string
          id: string
          last_service_date: string | null
          next_service_due: string | null
          notes: string | null
          price: number
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          auto_generate_jobs?: boolean
          contract_type?: string
          contract_type_custom?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          end_date: string
          equipment_id?: string | null
          frequency?: string
          id?: string
          last_service_date?: string | null
          next_service_due?: string | null
          notes?: string | null
          price?: number
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          auto_generate_jobs?: boolean
          contract_type?: string
          contract_type_custom?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          end_date?: string
          equipment_id?: string | null
          frequency?: string
          id?: string
          last_service_date?: string | null
          next_service_due?: string | null
          notes?: string | null
          price?: number
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_agreements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_agreements_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_distance_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      generate_invoice_number: { Args: never; Returns: string }
      get_agents_within_radius: {
        Args: { lead_lat: number; lead_lng: number; radius_km: number }
        Returns: {
          agent_id: string
          distance_km: number
          full_name: string
          is_available: boolean
        }[]
      }
      get_agreements_due_for_service: {
        Args: { days_ahead?: number }
        Returns: {
          agreement_id: string
          contract_type: string
          contract_type_custom: string
          customer_address: string
          customer_id: string
          customer_lat: number
          customer_lng: number
          customer_name: string
          customer_phone: string
          equipment_id: string
          frequency: string
          next_service_due: string
        }[]
      }
      get_or_create_customer_token: {
        Args: { p_customer_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      validate_customer_token: { Args: { p_token: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "field_agent"
      availability_status: "available" | "busy" | "offline"
      equipment_type:
        | "ac"
        | "heater"
        | "vent"
        | "heat_pump"
        | "furnace"
        | "other"
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
    Enums: {
      app_role: ["admin", "field_agent"],
      availability_status: ["available", "busy", "offline"],
      equipment_type: ["ac", "heater", "vent", "heat_pump", "furnace", "other"],
    },
  },
} as const
