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
      agent_affiliations: {
        Row: {
          affiliation_type: string
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string | null
          id: string
          profile_id: string
          status: string | null
        }
        Insert: {
          affiliation_type: string
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string | null
          id?: string
          profile_id: string
          status?: string | null
        }
        Update: {
          affiliation_type?: string
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          profile_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_affiliations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_affiliations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_affiliations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "agent_affiliations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_availability: {
        Row: {
          agent_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_available: boolean
          start_time: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          day_of_week: number
          end_time?: string
          id?: string
          is_available?: boolean
          start_time?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_available?: boolean
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_availability_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      app_usage_events: {
        Row: {
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      assignments: {
        Row: {
          assigned_by: string | null
          assignment_type: string | null
          completed_at: string | null
          created_at: string | null
          eta: string | null
          id: string
          job_id: string
          notes: string | null
          optimized_at: string | null
          profile_id: string
          route_id: string | null
          route_order: number | null
          started_at: string | null
          status: string | null
          travel_meters: number | null
          travel_seconds: number | null
        }
        Insert: {
          assigned_by?: string | null
          assignment_type?: string | null
          completed_at?: string | null
          created_at?: string | null
          eta?: string | null
          id?: string
          job_id: string
          notes?: string | null
          optimized_at?: string | null
          profile_id: string
          route_id?: string | null
          route_order?: number | null
          started_at?: string | null
          status?: string | null
          travel_meters?: number | null
          travel_seconds?: number | null
        }
        Update: {
          assigned_by?: string | null
          assignment_type?: string | null
          completed_at?: string | null
          created_at?: string | null
          eta?: string | null
          id?: string
          job_id?: string
          notes?: string | null
          optimized_at?: string | null
          profile_id?: string
          route_id?: string | null
          route_order?: number | null
          started_at?: string | null
          status?: string | null
          travel_meters?: number | null
          travel_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_audit_logs: {
        Row: {
          channel: string
          company_id: string | null
          created_at: string
          error_code: string | null
          id: string
          input: Json
          outcome: string
          resolved_role: string
          result_count: number | null
          session_id: string | null
          tool_name: string
          user_id: string
        }
        Insert: {
          channel?: string
          company_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          input?: Json
          outcome: string
          resolved_role?: string
          result_count?: number | null
          session_id?: string | null
          tool_name: string
          user_id: string
        }
        Update: {
          channel?: string
          company_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          input?: Json
          outcome?: string
          resolved_role?: string
          result_count?: number | null
          session_id?: string | null
          tool_name?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          company_id: string | null
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      brand_discounts: {
        Row: {
          applied_at: string
          brand: string
          discount_percentage: number
          id: string
          markup_percent: number | null
        }
        Insert: {
          applied_at?: string
          brand: string
          discount_percentage?: number
          id?: string
          markup_percent?: number | null
        }
        Update: {
          applied_at?: string
          brand?: string
          discount_percentage?: number
          id?: string
          markup_percent?: number | null
        }
        Relationships: []
      }
      bundle_items: {
        Row: {
          allows_decimal_qty: boolean
          bundle_id: string
          created_at: string
          id: string
          is_length_item: boolean
          is_optional: boolean
          length_metres: number | null
          min_qty: number
          notes: string | null
          price_per_unit_label: string
          price_per_unit_qty: number
          qty_step: number
          quantity: number
          sort_order: number
          supplier_product_id: string
          unit_type: Database["public"]["Enums"]["pricing_unit_type"]
        }
        Insert: {
          allows_decimal_qty?: boolean
          bundle_id: string
          created_at?: string
          id?: string
          is_length_item?: boolean
          is_optional?: boolean
          length_metres?: number | null
          min_qty?: number
          notes?: string | null
          price_per_unit_label?: string
          price_per_unit_qty?: number
          qty_step?: number
          quantity?: number
          sort_order?: number
          supplier_product_id: string
          unit_type?: Database["public"]["Enums"]["pricing_unit_type"]
        }
        Update: {
          allows_decimal_qty?: boolean
          bundle_id?: string
          created_at?: string
          id?: string
          is_length_item?: boolean
          is_optional?: boolean
          length_metres?: number | null
          min_qty?: number
          notes?: string | null
          price_per_unit_label?: string
          price_per_unit_qty?: number
          qty_step?: number
          quantity?: number
          sort_order?: number
          supplier_product_id?: string
          unit_type?: Database["public"]["Enums"]["pricing_unit_type"]
        }
        Relationships: [
          {
            foreignKeyName: "bundle_items_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "installation_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_items_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      change_order_line_items: {
        Row: {
          change_order_id: string
          created_at: string
          description: string
          id: string
          original_line_item_id: string | null
          quantity: number
          sort_order: number
          total: number
          type: string
          unit_price: number
        }
        Insert: {
          change_order_id: string
          created_at?: string
          description: string
          id?: string
          original_line_item_id?: string | null
          quantity?: number
          sort_order?: number
          total?: number
          type: string
          unit_price?: number
        }
        Update: {
          change_order_id?: string
          created_at?: string
          description?: string
          id?: string
          original_line_item_id?: string | null
          quantity?: number
          sort_order?: number
          total?: number
          type?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "change_order_line_items_change_order_id_fkey"
            columns: ["change_order_id"]
            isOneToOne: false
            referencedRelation: "change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_order_line_items_original_line_item_id_fkey"
            columns: ["original_line_item_id"]
            isOneToOne: false
            referencedRelation: "quote_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      change_orders: {
        Row: {
          accepted_at: string | null
          accepted_quote_version_id: string
          created_at: string
          created_by: string | null
          id: string
          job_id: string | null
          owner_id: string | null
          quote_id: string
          reason: string | null
          requested_by: string | null
          status: string
          total_impact_ex_vat: number
          total_impact_incl_vat: number
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_quote_version_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          owner_id?: string | null
          quote_id: string
          reason?: string | null
          requested_by?: string | null
          status?: string
          total_impact_ex_vat?: number
          total_impact_incl_vat?: number
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_quote_version_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          owner_id?: string | null
          quote_id?: string
          reason?: string | null
          requested_by?: string | null
          status?: string
          total_impact_ex_vat?: number
          total_impact_incl_vat?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_orders_accepted_quote_version_id_fkey"
            columns: ["accepted_quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_log: {
        Row: {
          agent_id: string
          body: string | null
          created_at: string
          customer_id: string | null
          id: string
          lead_id: string | null
          subject: string | null
          type: string
        }
        Insert: {
          agent_id: string
          body?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          lead_id?: string | null
          subject?: string | null
          type: string
        }
        Update: {
          agent_id?: string
          body?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          lead_id?: string | null
          subject?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          default_rate: number | null
          id: string
          logo_url: string | null
          name: string
          onboarding_completed: boolean | null
          services: string[] | null
          slug: string
          status: string
          updated_at: string | null
          vat_rate: number | null
        }
        Insert: {
          created_at?: string
          default_rate?: number | null
          id?: string
          logo_url?: string | null
          name: string
          onboarding_completed?: boolean | null
          services?: string[] | null
          slug?: string
          status?: string
          updated_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          created_at?: string
          default_rate?: number | null
          id?: string
          logo_url?: string | null
          name?: string
          onboarding_completed?: boolean | null
          services?: string[] | null
          slug?: string
          status?: string
          updated_at?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      company_invoices: {
        Row: {
          amount_paid: number
          company_id: string
          contact_id: string | null
          created_at: string | null
          customer_id: string | null
          due_date: string | null
          id: string
          invoice_number: string
          items: Json | null
          notes: string | null
          quote_id: string | null
          quote_number: string | null
          recurrence: Json | null
          status: string
          subtotal: number
          tax: number
          total_amount: number
          updated_at: string | null
          vat_amount: number
        }
        Insert: {
          amount_paid?: number
          company_id: string
          contact_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_number: string
          items?: Json | null
          notes?: string | null
          quote_id?: string | null
          quote_number?: string | null
          recurrence?: Json | null
          status?: string
          subtotal?: number
          tax?: number
          total_amount?: number
          updated_at?: string | null
          vat_amount?: number
        }
        Update: {
          amount_paid?: number
          company_id?: string
          contact_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          items?: Json | null
          notes?: string | null
          quote_id?: string | null
          quote_number?: string | null
          recurrence?: Json | null
          status?: string
          subtotal?: number
          tax?: number
          total_amount?: number
          updated_at?: string | null
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fb_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_invoices_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_quote_counters: {
        Row: {
          company_id: string
          last_value: number
          updated_at: string
          year: number
        }
        Insert: {
          company_id: string
          last_value?: number
          updated_at?: string
          year: number
        }
        Update: {
          company_id?: string
          last_value?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_quote_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_quote_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_settings: {
        Row: {
          banking_details: Json | null
          company_name: string
          created_at: string
          default_deposit_percentage: number | null
          default_hourly_rate: number | null
          default_payment_terms_days: number | null
          id: string
          logo_storage_path: string | null
          payfast_merchant_id: string | null
          payfast_merchant_key: string | null
          physical_address: string | null
          postal_address: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          banking_details?: Json | null
          company_name?: string
          created_at?: string
          default_deposit_percentage?: number | null
          default_hourly_rate?: number | null
          default_payment_terms_days?: number | null
          id?: string
          logo_storage_path?: string | null
          payfast_merchant_id?: string | null
          payfast_merchant_key?: string | null
          physical_address?: string | null
          postal_address?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          banking_details?: Json | null
          company_name?: string
          created_at?: string
          default_deposit_percentage?: number | null
          default_hourly_rate?: number | null
          default_payment_terms_days?: number | null
          id?: string
          logo_storage_path?: string | null
          payfast_merchant_id?: string | null
          payfast_merchant_key?: string | null
          physical_address?: string | null
          postal_address?: string | null
          updated_at?: string
          vat_number?: string | null
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
      customer_locations: {
        Row: {
          address: string
          company_id: string
          created_at: string
          customer_id: string
          id: string
          is_primary: boolean
          label: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          address: string
          company_id: string
          created_at?: string
          customer_id: string
          id?: string
          is_primary?: boolean
          label?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          company_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_primary?: boolean
          label?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_locations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
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
      customer_units: {
        Row: {
          created_at: string
          customer_id: string
          full_address: string | null
          id: string
          label: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          full_address?: string | null
          id?: string
          label: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          full_address?: string | null
          id?: string
          label?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_units_customer_id_fkey"
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
          area: string | null
          city: string | null
          company_id: string | null
          company_name: string | null
          created_at: string
          created_by: string | null
          data_consent: boolean | null
          data_consent_date: string | null
          email: string | null
          email_verified: boolean | null
          first_name: string | null
          id: string
          is_company: boolean | null
          last_name: string | null
          latitude: number | null
          lead_source: string | null
          longitude: number | null
          name: string
          normalized_email: string | null
          normalized_phone: string | null
          notes: string | null
          notification_opt_in: boolean | null
          phone: string
          phone_verified: boolean | null
          postal_code: string | null
          preferred_contact_method: string | null
          primary_address_line1: string | null
          primary_address_line2: string | null
          search_aliases: string[] | null
          secondary_phone: string | null
          status: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          area?: string | null
          city?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          data_consent?: boolean | null
          data_consent_date?: string | null
          email?: string | null
          email_verified?: boolean | null
          first_name?: string | null
          id?: string
          is_company?: boolean | null
          last_name?: string | null
          latitude?: number | null
          lead_source?: string | null
          longitude?: number | null
          name: string
          normalized_email?: string | null
          normalized_phone?: string | null
          notes?: string | null
          notification_opt_in?: boolean | null
          phone: string
          phone_verified?: boolean | null
          postal_code?: string | null
          preferred_contact_method?: string | null
          primary_address_line1?: string | null
          primary_address_line2?: string | null
          search_aliases?: string[] | null
          secondary_phone?: string | null
          status?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          area?: string | null
          city?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          data_consent?: boolean | null
          data_consent_date?: string | null
          email?: string | null
          email_verified?: boolean | null
          first_name?: string | null
          id?: string
          is_company?: boolean | null
          last_name?: string | null
          latitude?: number | null
          lead_source?: string | null
          longitude?: number | null
          name?: string
          normalized_email?: string | null
          normalized_phone?: string | null
          notes?: string | null
          notification_opt_in?: boolean | null
          phone?: string
          phone_verified?: boolean | null
          postal_code?: string | null
          preferred_contact_method?: string | null
          primary_address_line1?: string | null
          primary_address_line2?: string | null
          search_aliases?: string[] | null
          secondary_phone?: string | null
          status?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      dismissed_pdf_regions: {
        Row: {
          created_at: string
          dismiss_key: string
          id: string
        }
        Insert: {
          created_at?: string
          dismiss_key: string
          id?: string
        }
        Update: {
          created_at?: string
          dismiss_key?: string
          id?: string
        }
        Relationships: []
      }
      email_events: {
        Row: {
          created_at: string | null
          email_id: string
          event_data: Json | null
          event_type: string
          id: string
          processed: boolean | null
          quote_number: string | null
          recipient_email: string
        }
        Insert: {
          created_at?: string | null
          email_id: string
          event_data?: Json | null
          event_type: string
          id?: string
          processed?: boolean | null
          quote_number?: string | null
          recipient_email: string
        }
        Update: {
          created_at?: string | null
          email_id?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          processed?: boolean | null
          quote_number?: string | null
          recipient_email?: string
        }
        Relationships: []
      }
      email_preferences: {
        Row: {
          bounce_or_complaint: boolean | null
          created_at: string | null
          email: string
          id: string
          unsubscribe_token: string | null
          unsubscribed: boolean | null
          unsubscribed_at: string | null
          updated_at: string | null
        }
        Insert: {
          bounce_or_complaint?: boolean | null
          created_at?: string | null
          email: string
          id?: string
          unsubscribe_token?: string | null
          unsubscribed?: boolean | null
          unsubscribed_at?: string | null
          updated_at?: string | null
        }
        Update: {
          bounce_or_complaint?: boolean | null
          created_at?: string | null
          email?: string
          id?: string
          unsubscribe_token?: string | null
          unsubscribed?: boolean | null
          unsubscribed_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      entity_outbox: {
        Row: {
          attempts: number
          company_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          company_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          event_type: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          company_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          brand: string | null
          company_id: string | null
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
          company_id?: string | null
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
          company_id?: string | null
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
            foreignKeyName: "equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "equipment_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_contacts: {
        Row: {
          address: Json | null
          company_id: string
          company_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          address?: Json | null
          company_id: string
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          address?: Json | null
          company_id?: string
          company_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      fb_estimates: {
        Row: {
          amount: number
          company_id: string
          contact_id: string | null
          created_at: string
          due_date: string | null
          estimate_number: string
          id: string
          items: Json
          notes: string | null
          status: string
          tax: number
        }
        Insert: {
          amount?: number
          company_id: string
          contact_id?: string | null
          created_at?: string
          due_date?: string | null
          estimate_number: string
          id?: string
          items?: Json
          notes?: string | null
          status?: string
          tax?: number
        }
        Update: {
          amount?: number
          company_id?: string
          contact_id?: string | null
          created_at?: string
          due_date?: string | null
          estimate_number?: string
          id?: string
          items?: Json
          notes?: string | null
          status?: string
          tax?: number
        }
        Relationships: [
          {
            foreignKeyName: "fb_estimates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_estimates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fb_estimates_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fb_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_expenses: {
        Row: {
          amount: number
          category: string
          company_id: string
          created_at: string
          date: string
          id: string
          notes: string | null
          receipt_url: string | null
          vendor: string | null
        }
        Insert: {
          amount?: number
          category?: string
          company_id: string
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: string
          company_id?: string
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_expenses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_expenses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      fb_invoices: {
        Row: {
          amount: number
          company_id: string
          contact_id: string | null
          created_at: string
          due_date: string | null
          id: string
          invoice_number: string
          items: Json
          notes: string | null
          recurrence: Json | null
          status: string
          tax: number
        }
        Insert: {
          amount?: number
          company_id: string
          contact_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number: string
          items?: Json
          notes?: string | null
          recurrence?: Json | null
          status?: string
          tax?: number
        }
        Update: {
          amount?: number
          company_id?: string
          contact_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          items?: Json
          notes?: string | null
          recurrence?: Json | null
          status?: string
          tax?: number
        }
        Relationships: [
          {
            foreignKeyName: "fb_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fb_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "fb_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_payments: {
        Row: {
          amount: number
          company_id: string
          company_invoice_id: string | null
          created_at: string
          date: string
          id: string
          invoice_id: string | null
          method: string
        }
        Insert: {
          amount?: number
          company_id: string
          company_invoice_id?: string | null
          created_at?: string
          date?: string
          id?: string
          invoice_id?: string | null
          method?: string
        }
        Update: {
          amount?: number
          company_id?: string
          company_invoice_id?: string | null
          created_at?: string
          date?: string
          id?: string
          invoice_id?: string | null
          method?: string
        }
        Relationships: [
          {
            foreignKeyName: "fb_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fb_payments_company_invoice_id_fkey"
            columns: ["company_invoice_id"]
            isOneToOne: false
            referencedRelation: "company_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "fb_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_projects: {
        Row: {
          budget: number | null
          client_id: string | null
          company_id: string
          created_at: string
          id: string
          name: string
          status: string
        }
        Insert: {
          budget?: number | null
          client_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          name: string
          status?: string
        }
        Update: {
          budget?: number | null
          client_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fb_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "fb_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      fb_time_entries: {
        Row: {
          billable: boolean
          company_id: string
          created_at: string
          date: string
          duration: string
          id: string
          notes: string | null
          project_id: string | null
          user_id: string
        }
        Insert: {
          billable?: boolean
          company_id: string
          created_at?: string
          date?: string
          duration?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          user_id: string
        }
        Update: {
          billable?: boolean
          company_id?: string
          created_at?: string
          date?: string
          duration?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fb_time_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_time_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fb_time_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "fb_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flat_rate_items: {
        Row: {
          category: string
          created_at: string
          description: string | null
          estimated_hours: number | null
          id: string
          is_active: boolean | null
          name: string
          parts: Json | null
          standard_price: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          estimated_hours?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          parts?: Json | null
          standard_price: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          estimated_hours?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          parts?: Json | null
          standard_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      hvac_services: {
        Row: {
          category: string
          created_at: string
          default_price: number
          id: string
          is_active: boolean
          name: string
          unit: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          default_price: number
          id?: string
          is_active?: boolean
          name: string
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          default_price?: number
          id?: string
          is_active?: boolean
          name?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_audit_log: {
        Row: {
          action: string
          created_at: string | null
          file_name: string | null
          id: string
          import_settings: Json | null
          pdfs_deleted: number | null
          products_deleted: number | null
          products_imported: number | null
          supplier_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          file_name?: string | null
          id?: string
          import_settings?: Json | null
          pdfs_deleted?: number | null
          products_deleted?: number | null
          products_imported?: number | null
          supplier_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          file_name?: string | null
          id?: string
          import_settings?: Json | null
          pdfs_deleted?: number | null
          products_deleted?: number | null
          products_imported?: number | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_audit_log_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      installation_bundles: {
        Row: {
          ac_type: string | null
          btu_rating: number | null
          bundle_type: string | null
          compatible_brands: string[] | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_favorite: boolean
          max_btu: number | null
          min_btu: number | null
          name: string
          pipe_size: string | null
          updated_at: string
        }
        Insert: {
          ac_type?: string | null
          btu_rating?: number | null
          bundle_type?: string | null
          compatible_brands?: string[] | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_favorite?: boolean
          max_btu?: number | null
          min_btu?: number | null
          name: string
          pipe_size?: string | null
          updated_at?: string
        }
        Update: {
          ac_type?: string | null
          btu_rating?: number | null
          bundle_type?: string | null
          compatible_brands?: string[] | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_favorite?: boolean
          max_btu?: number | null
          min_btu?: number | null
          name?: string
          pipe_size?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inventory_adjustments: {
        Row: {
          changed_at: string
          id: string
          new_quantity: number
          old_quantity: number
          reason: string | null
          stock_id: string
          user_id: string | null
        }
        Insert: {
          changed_at?: string
          id?: string
          new_quantity: number
          old_quantity: number
          reason?: string | null
          stock_id: string
          user_id?: string | null
        }
        Update: {
          changed_at?: string
          id?: string
          new_quantity?: number
          old_quantity?: number
          reason?: string | null
          stock_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "inventory_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string | null
          created_at: string
          id: string
          min_stock_level: number
          name: string
          quantity_in_stock: number
          sku: string | null
          supplier: string | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          min_stock_level?: number
          name: string
          quantity_in_stock?: number
          sku?: string | null
          supplier?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          min_stock_level?: number
          name?: string
          quantity_in_stock?: number
          sku?: string | null
          supplier?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      inventory_stock: {
        Row: {
          created_at: string
          id: string
          low_stock_threshold: number
          product_id: string
          quantity: number
          stock_mode: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          low_stock_threshold?: number
          product_id: string
          quantity?: number
          stock_mode?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          low_stock_threshold?: number
          product_id?: string
          quantity?: number
          stock_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          quantity: number
          service_id: string | null
          unit_price: number
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          service_id?: string | null
          unit_price?: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          service_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_templates: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          agent_id: string
          company_id: string | null
          created_at: string
          customer_address: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          due_date: string | null
          equipment_id: string | null
          grand_total: number
          id: string
          invoice_number: string
          issue_date: string
          lead_id: string | null
          line_items: Json
          location_id: string | null
          notes: string | null
          paid_date: string | null
          payfast_payment_id: string | null
          payfast_url: string | null
          payment_method: string | null
          pdf_url: string | null
          quote_id: string | null
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          company_id?: string | null
          created_at?: string
          customer_address?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          due_date?: string | null
          equipment_id?: string | null
          grand_total?: number
          id?: string
          invoice_number: string
          issue_date?: string
          lead_id?: string | null
          line_items?: Json
          location_id?: string | null
          notes?: string | null
          paid_date?: string | null
          payfast_payment_id?: string | null
          payfast_url?: string | null
          payment_method?: string | null
          pdf_url?: string | null
          quote_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          company_id?: string | null
          created_at?: string
          customer_address?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          due_date?: string | null
          equipment_id?: string | null
          grand_total?: number
          id?: string
          invoice_number?: string
          issue_date?: string
          lead_id?: string | null
          line_items?: Json
          location_id?: string | null
          notes?: string | null
          paid_date?: string | null
          payfast_payment_id?: string | null
          payfast_url?: string | null
          payment_method?: string | null
          pdf_url?: string | null
          quote_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "invoices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "customer_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "invoice_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      job_activity_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          job_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          job_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          job_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_activity_log_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_completions: {
        Row: {
          company_id: string | null
          completed_at: string
          created_at: string
          customer_email: string | null
          customer_name: string | null
          id: string
          job_id: string | null
          labour_minutes: number
          lead_id: string | null
          parts_total: number
          photo_count: number
          signature_data_url: string | null
          signed_at: string | null
          status: string
          technician_id: string
          updated_at: string
          work_summary: string | null
        }
        Insert: {
          company_id?: string | null
          completed_at?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          job_id?: string | null
          labour_minutes?: number
          lead_id?: string | null
          parts_total?: number
          photo_count?: number
          signature_data_url?: string | null
          signed_at?: string | null
          status?: string
          technician_id: string
          updated_at?: string
          work_summary?: string | null
        }
        Update: {
          company_id?: string | null
          completed_at?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          job_id?: string | null
          labour_minutes?: number
          lead_id?: string | null
          parts_total?: number
          photo_count?: number
          signature_data_url?: string | null
          signed_at?: string | null
          status?: string
          technician_id?: string
          updated_at?: string
          work_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_completions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_completions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      job_expenses: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          description: string
          expense_date: string
          id: string
          lead_id: string
          receipt_path: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          description: string
          expense_date?: string
          id?: string
          lead_id: string
          receipt_path?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          description?: string
          expense_date?: string
          id?: string
          lead_id?: string
          receipt_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_expenses_lead_id_fkey"
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
      job_schedules: {
        Row: {
          agent_id: string
          created_at: string
          end_time: string
          id: string
          lead_id: string
          notes: string | null
          optimized_at: string | null
          route_id: string | null
          route_order: number | null
          scheduled_date: string
          start_time: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          end_time: string
          id?: string
          lead_id: string
          notes?: string | null
          optimized_at?: string | null
          route_id?: string | null
          route_order?: number | null
          scheduled_date: string
          start_time: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          end_time?: string
          id?: string
          lead_id?: string
          notes?: string | null
          optimized_at?: string | null
          route_id?: string | null
          route_order?: number | null
          scheduled_date?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_schedules_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      job_time_entries: {
        Row: {
          agent_id: string
          created_at: string
          end_time: string
          hours_onsite: number | null
          id: string
          is_billable: boolean
          lead_id: string
          notes: string | null
          start_time: string
          travel_hours: number
          work_date: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          end_time: string
          hours_onsite?: number | null
          id?: string
          is_billable?: boolean
          lead_id: string
          notes?: string | null
          start_time: string
          travel_hours?: number
          work_date?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          end_time?: string
          hours_onsite?: number | null
          id?: string
          is_billable?: boolean
          lead_id?: string
          notes?: string | null
          start_time?: string
          travel_hours?: number
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_time_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      job_used_parts: {
        Row: {
          added_by: string
          created_at: string
          id: string
          lead_id: string
          line_total: number | null
          product_code: string
          product_id: string
          product_name: string
          quantity: number
          unit_cost: number
        }
        Insert: {
          added_by: string
          created_at?: string
          id?: string
          lead_id: string
          line_total?: number | null
          product_code: string
          product_id: string
          product_name: string
          quantity?: number
          unit_cost?: number
        }
        Update: {
          added_by?: string
          created_at?: string
          id?: string
          lead_id?: string
          line_total?: number | null
          product_code?: string
          product_id?: string
          product_name?: string
          quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_used_parts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_used_parts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          address: string | null
          company_id: string
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          description: string | null
          estimated_duration: string | null
          id: string
          invoice_id: string | null
          job_type: string | null
          lat: number | null
          lead_id: string | null
          lng: number | null
          location_id: string | null
          priority: string | null
          quote_id: string | null
          scheduled_for: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          estimated_duration?: string | null
          id?: string
          invoice_id?: string | null
          job_type?: string | null
          lat?: number | null
          lead_id?: string | null
          lng?: number | null
          location_id?: string | null
          priority?: string | null
          quote_id?: string | null
          scheduled_for?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          estimated_duration?: string | null
          id?: string
          invoice_id?: string | null
          job_type?: string | null
          lat?: number | null
          lead_id?: string | null
          lng?: number | null
          location_id?: string | null
          priority?: string | null
          quote_id?: string | null
          scheduled_for?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "jobs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "customer_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_change_requests: {
        Row: {
          created_at: string
          current_value: string | null
          customer_message: string | null
          id: string
          lead_id: string
          reason: string | null
          request_type: string
          requested_by: string | null
          requested_value: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_value?: string | null
          customer_message?: string | null
          id?: string
          lead_id: string
          reason?: string | null
          request_type: string
          requested_by?: string | null
          requested_value: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_value?: string | null
          customer_message?: string | null
          id?: string
          lead_id?: string
          reason?: string | null
          request_type?: string
          requested_by?: string | null
          requested_value?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
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
          assignment_method: string | null
          assignment_score: number | null
          broadcast_radius_km: number | null
          cancellation_reason: string | null
          classified_by: Database["public"]["Enums"]["lead_classifier"] | null
          company_id: string | null
          company_name: string | null
          completed_at: string | null
          confidence: number | null
          converted_at: string | null
          created_at: string | null
          customer_address: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          deleted_at: string | null
          email: string | null
          equipment_id: string | null
          estimated_duration_minutes: number | null
          estimated_end_time: string | null
          external_id: string | null
          id: string
          idempotency_key: string | null
          intents: string[]
          interaction_history: Json
          last_activity_at: string
          latitude: number
          lead_priority: Database["public"]["Enums"]["lead_priority_level"]
          lead_score: number | null
          lead_status: Database["public"]["Enums"]["lead_lifecycle_status"]
          location: unknown
          longitude: number
          merge_history: Json
          merged_into_id: string | null
          needs_manual_assignment: boolean
          normalized_address: string | null
          notes: string | null
          offer_count: number | null
          order_status: string | null
          parts_status: string | null
          phone: string | null
          primary_intent: Database["public"]["Enums"]["lead_intent"] | null
          priority: string
          raw_payload: Json | null
          scheduled_date: string | null
          scheduled_time: string | null
          service_type: string
          sla_breached_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          started_at: string | null
          status: string
          technician_eta: string | null
          technician_name: string | null
          unit_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          actual_start_time?: string | null
          agreement_id?: string | null
          assigned_agent_id?: string | null
          assignment_method?: string | null
          assignment_score?: number | null
          broadcast_radius_km?: number | null
          cancellation_reason?: string | null
          classified_by?: Database["public"]["Enums"]["lead_classifier"] | null
          company_id?: string | null
          company_name?: string | null
          completed_at?: string | null
          confidence?: number | null
          converted_at?: string | null
          created_at?: string | null
          customer_address: string
          customer_id?: string | null
          customer_name: string
          customer_phone: string
          deleted_at?: string | null
          email?: string | null
          equipment_id?: string | null
          estimated_duration_minutes?: number | null
          estimated_end_time?: string | null
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          intents?: string[]
          interaction_history?: Json
          last_activity_at?: string
          latitude: number
          lead_priority?: Database["public"]["Enums"]["lead_priority_level"]
          lead_score?: number | null
          lead_status?: Database["public"]["Enums"]["lead_lifecycle_status"]
          location?: unknown
          longitude: number
          merge_history?: Json
          merged_into_id?: string | null
          needs_manual_assignment?: boolean
          normalized_address?: string | null
          notes?: string | null
          offer_count?: number | null
          order_status?: string | null
          parts_status?: string | null
          phone?: string | null
          primary_intent?: Database["public"]["Enums"]["lead_intent"] | null
          priority?: string
          raw_payload?: Json | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          service_type: string
          sla_breached_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          started_at?: string | null
          status?: string
          technician_eta?: string | null
          technician_name?: string | null
          unit_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          actual_start_time?: string | null
          agreement_id?: string | null
          assigned_agent_id?: string | null
          assignment_method?: string | null
          assignment_score?: number | null
          broadcast_radius_km?: number | null
          cancellation_reason?: string | null
          classified_by?: Database["public"]["Enums"]["lead_classifier"] | null
          company_id?: string | null
          company_name?: string | null
          completed_at?: string | null
          confidence?: number | null
          converted_at?: string | null
          created_at?: string | null
          customer_address?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          deleted_at?: string | null
          email?: string | null
          equipment_id?: string | null
          estimated_duration_minutes?: number | null
          estimated_end_time?: string | null
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          intents?: string[]
          interaction_history?: Json
          last_activity_at?: string
          latitude?: number
          lead_priority?: Database["public"]["Enums"]["lead_priority_level"]
          lead_score?: number | null
          lead_status?: Database["public"]["Enums"]["lead_lifecycle_status"]
          location?: unknown
          longitude?: number
          merge_history?: Json
          merged_into_id?: string | null
          needs_manual_assignment?: boolean
          normalized_address?: string | null
          notes?: string | null
          offer_count?: number | null
          order_status?: string | null
          parts_status?: string | null
          phone?: string | null
          primary_intent?: Database["public"]["Enums"]["lead_intent"] | null
          priority?: string
          raw_payload?: Json | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          service_type?: string
          sla_breached_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          started_at?: string | null
          status?: string
          technician_eta?: string | null
          technician_name?: string | null
          unit_id?: string | null
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
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
          {
            foreignKeyName: "leads_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "customer_units"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_schedules: {
        Row: {
          agreement_id: string
          created_at: string
          customer_id: string
          due_date: string
          equipment_id: string | null
          id: string
          lead_id: string | null
          notes: string | null
          reminder_2d_sent: boolean
          reminder_7d_sent: boolean
          status: string
          updated_at: string
        }
        Insert: {
          agreement_id: string
          created_at?: string
          customer_id: string
          due_date: string
          equipment_id?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          reminder_2d_sent?: boolean
          reminder_7d_sent?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          agreement_id?: string
          created_at?: string
          customer_id?: string
          due_date?: string
          equipment_id?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          reminder_2d_sent?: boolean
          reminder_7d_sent?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_schedules_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "service_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedules_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nl_audit_log: {
        Row: {
          access_granted: boolean | null
          args: Json
          company_id: string | null
          created_at: string
          id: string
          resource_id: string | null
          resource_type: string | null
          result: Json | null
          status: string
          tool_name: string
          user_id: string
        }
        Insert: {
          access_granted?: boolean | null
          args?: Json
          company_id?: string | null
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_type?: string | null
          result?: Json | null
          status?: string
          tool_name: string
          user_id: string
        }
        Update: {
          access_granted?: boolean | null
          args?: Json
          company_id?: string | null
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_type?: string | null
          result?: Json | null
          status?: string
          tool_name?: string
          user_id?: string
        }
        Relationships: []
      }
      nl_request_log: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
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
            foreignKeyName: "notification_queue_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "notification_queue_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json | null
          read: boolean
          related_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          related_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          related_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      offers: {
        Row: {
          company_id: string | null
          created_at: string
          distance_km: number | null
          expires_at: string
          id: string
          lead_id: string
          offer_type: string
          responded_at: string | null
          sequence: number
          staff_id: string
          status: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          distance_km?: number | null
          expires_at?: string
          id?: string
          lead_id: string
          offer_type?: string
          responded_at?: string | null
          sequence?: number
          staff_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          distance_km?: number | null
          expires_at?: string
          id?: string
          lead_id?: string
          offer_type?: string
          responded_at?: string | null
          sequence?: number
          staff_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      overlay_audit_config: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          supplier_name: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          supplier_name: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          supplier_name?: string
        }
        Relationships: []
      }
      overlay_audit_findings: {
        Row: {
          actual_bbox: Json | null
          created_at: string
          details: string | null
          expected_bbox: Json | null
          expected_page_number: number | null
          id: string
          issue_type: string
          page_number: number | null
          product_code: string | null
          product_id: string | null
          run_id: string
          severity: string
          short_name: string | null
          supplier_id: string | null
          supplier_name: string | null
        }
        Insert: {
          actual_bbox?: Json | null
          created_at?: string
          details?: string | null
          expected_bbox?: Json | null
          expected_page_number?: number | null
          id?: string
          issue_type: string
          page_number?: number | null
          product_code?: string | null
          product_id?: string | null
          run_id: string
          severity?: string
          short_name?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
        }
        Update: {
          actual_bbox?: Json | null
          created_at?: string
          details?: string | null
          expected_bbox?: Json | null
          expected_page_number?: number | null
          id?: string
          issue_type?: string
          page_number?: number | null
          product_code?: string | null
          product_id?: string | null
          run_id?: string
          severity?: string
          short_name?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "overlay_audit_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "overlay_audit_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      overlay_audit_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
          suppliers_scanned: string[]
          total_findings: number
          total_products: number
          triggered_by: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          suppliers_scanned?: string[]
          total_findings?: number
          total_products?: number
          triggered_by?: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          suppliers_scanned?: string[]
          total_findings?: number
          total_products?: number
          triggered_by?: string
        }
        Relationships: []
      }
      overlay_mismatch_reports: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          page_number: number | null
          product_code: string | null
          reported_by: string | null
          reviewed_at: string | null
          status: string
          stored_page_number: number | null
          stored_row_bbox: Json | null
          supplier_id: string | null
          supplier_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          page_number?: number | null
          product_code?: string | null
          reported_by?: string | null
          reviewed_at?: string | null
          status?: string
          stored_page_number?: number | null
          stored_row_bbox?: Json | null
          supplier_id?: string | null
          supplier_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          page_number?: number | null
          product_code?: string | null
          reported_by?: string | null
          reviewed_at?: string | null
          status?: string
          stored_page_number?: number | null
          stored_row_bbox?: Json | null
          supplier_id?: string | null
          supplier_name?: string | null
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          company_id: string | null
          created_at: string
          environment: string
          error_message: string | null
          event_id: string | null
          event_type: string | null
          gateway: string
          id: string
          invoice_id: string | null
          payload: Json | null
          payment_id: string | null
          processed: boolean
          result_code: string | null
          signature_valid: boolean
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          environment?: string
          error_message?: string | null
          event_id?: string | null
          event_type?: string | null
          gateway: string
          id?: string
          invoice_id?: string | null
          payload?: Json | null
          payment_id?: string | null
          processed?: boolean
          result_code?: string | null
          signature_valid?: boolean
        }
        Update: {
          company_id?: string | null
          created_at?: string
          environment?: string
          error_message?: string | null
          event_id?: string | null
          event_type?: string | null
          gateway?: string
          id?: string
          invoice_id?: string | null
          payload?: Json | null
          payment_id?: string | null
          processed?: boolean
          result_code?: string | null
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          checkout_id: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          environment: string
          gateway: string
          gateway_reference: string | null
          id: string
          invoice_id: string
          method: string
          payment_date: string
          raw_payload: Json | null
          reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          checkout_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          environment?: string
          gateway?: string
          gateway_reference?: string | null
          id?: string
          invoice_id: string
          method: string
          payment_date?: string
          raw_payload?: Json | null
          reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          checkout_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          environment?: string
          gateway?: string
          gateway_reference?: string | null
          id?: string
          invoice_id?: string
          method?: string
          payment_date?: string
          raw_payload?: Json | null
          reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      pdf_product_regions: {
        Row: {
          auto_matched: boolean | null
          id: string
          label: string | null
          pdf_page_id: string
          product_code: string | null
          product_id: string | null
          region_height: number | null
          region_width: number | null
          region_x: number | null
          region_y: number | null
        }
        Insert: {
          auto_matched?: boolean | null
          id?: string
          label?: string | null
          pdf_page_id: string
          product_code?: string | null
          product_id?: string | null
          region_height?: number | null
          region_width?: number | null
          region_x?: number | null
          region_y?: number | null
        }
        Update: {
          auto_matched?: boolean | null
          id?: string
          label?: string | null
          pdf_page_id?: string
          product_code?: string | null
          product_id?: string | null
          region_height?: number | null
          region_width?: number | null
          region_x?: number | null
          region_y?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pdf_product_regions_pdf_page_id_fkey"
            columns: ["pdf_page_id"]
            isOneToOne: false
            referencedRelation: "supplier_pdf_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_product_regions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_uploads: {
        Row: {
          created_at: string | null
          file_name: string
          file_path: string | null
          file_url: string | null
          id: string
          markup_percent: number | null
          page_count: number | null
          price_includes_vat: boolean | null
          price_list_type: string | null
          status: string | null
          storage_path: string | null
          supplier_id: string
          trade_discount_percent: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_path?: string | null
          file_url?: string | null
          id?: string
          markup_percent?: number | null
          page_count?: number | null
          price_includes_vat?: boolean | null
          price_list_type?: string | null
          status?: string | null
          storage_path?: string | null
          supplier_id: string
          trade_discount_percent?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_path?: string | null
          file_url?: string | null
          id?: string
          markup_percent?: number | null
          page_count?: number | null
          price_includes_vat?: boolean | null
          price_list_type?: string | null
          status?: string | null
          storage_path?: string | null
          supplier_id?: string
          trade_discount_percent?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdf_uploads_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list_uploads: {
        Row: {
          created_at: string
          error_message: string | null
          file_name: string
          file_type: string
          id: string
          products_archived: number
          products_imported: number
          products_skipped: number
          products_updated: number
          status: string
          supplier_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          file_name: string
          file_type?: string
          id?: string
          products_archived?: number
          products_imported?: number
          products_skipped?: number
          products_updated?: number
          status?: string
          supplier_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          file_name?: string
          file_type?: string
          id?: string
          products_archived?: number
          products_imported?: number
          products_skipped?: number
          products_updated?: number
          status?: string
          supplier_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_uploads_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_brochures: {
        Row: {
          brand: string
          category: string | null
          created_at: string | null
          file_name: string
          file_url: string
          id: string
          is_active: boolean | null
          linked_product_ids: string[] | null
          model_match_prefixes: string[]
          name: string
          page_count: number | null
          product_family_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          brand: string
          category?: string | null
          created_at?: string | null
          file_name: string
          file_url: string
          id?: string
          is_active?: boolean | null
          linked_product_ids?: string[] | null
          model_match_prefixes?: string[]
          name: string
          page_count?: number | null
          product_family_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          brand?: string
          category?: string | null
          created_at?: string | null
          file_name?: string
          file_url?: string
          id?: string
          is_active?: boolean | null
          linked_product_ids?: string[] | null
          model_match_prefixes?: string[]
          name?: string
          page_count?: number | null
          product_family_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      product_favorites: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: []
      }
      product_usage_stats: {
        Row: {
          id: string
          last_used_at: string
          product_id: string
          usage_count: number
          user_id: string
        }
        Insert: {
          id?: string
          last_used_at?: string
          product_id: string
          usage_count?: number
          user_id: string
        }
        Update: {
          id?: string
          last_used_at?: string
          product_id?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          availability_status: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string | null
          dispatch_active: boolean
          dispatch_role: string | null
          full_name: string
          home_base_lat: number | null
          home_base_lng: number | null
          home_lat: number | null
          home_lng: number | null
          home_location: unknown
          home_radius_m: number | null
          id: string
          jobs_limit: number
          last_availability_update: string | null
          location_tracking_enabled: boolean | null
          max_travel_km: number | null
          network_status: string | null
          onboarding_completed: boolean
          participant_type: string
          phone: string | null
          search_aliases: string[] | null
          skills: string[] | null
          stripe_customer_id: string | null
          subscription_plan: string
          subscription_status: string
          trial_ends_at: string | null
          updated_at: string | null
          whatsapp_notifications: boolean | null
          workshop_address: string | null
          workshop_lat: number | null
          workshop_lng: number | null
        }
        Insert: {
          availability_status?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string | null
          dispatch_active?: boolean
          dispatch_role?: string | null
          full_name: string
          home_base_lat?: number | null
          home_base_lng?: number | null
          home_lat?: number | null
          home_lng?: number | null
          home_location?: unknown
          home_radius_m?: number | null
          id: string
          jobs_limit?: number
          last_availability_update?: string | null
          location_tracking_enabled?: boolean | null
          max_travel_km?: number | null
          network_status?: string | null
          onboarding_completed?: boolean
          participant_type?: string
          phone?: string | null
          search_aliases?: string[] | null
          skills?: string[] | null
          stripe_customer_id?: string | null
          subscription_plan?: string
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          whatsapp_notifications?: boolean | null
          workshop_address?: string | null
          workshop_lat?: number | null
          workshop_lng?: number | null
        }
        Update: {
          availability_status?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string | null
          dispatch_active?: boolean
          dispatch_role?: string | null
          full_name?: string
          home_base_lat?: number | null
          home_base_lng?: number | null
          home_lat?: number | null
          home_lng?: number | null
          home_location?: unknown
          home_radius_m?: number | null
          id?: string
          jobs_limit?: number
          last_availability_update?: string | null
          location_tracking_enabled?: boolean | null
          max_travel_km?: number | null
          network_status?: string | null
          onboarding_completed?: boolean
          participant_type?: string
          phone?: string | null
          search_aliases?: string[] | null
          skills?: string[] | null
          stripe_customer_id?: string | null
          subscription_plan?: string
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          whatsapp_notifications?: boolean | null
          workshop_address?: string | null
          workshop_lat?: number | null
          workshop_lng?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      proposal_items: {
        Row: {
          created_at: string
          description: string
          id: string
          line_total: number
          proposal_id: string
          quantity: number
          rate: number
          service_id: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          line_total?: number
          proposal_id: string
          quantity?: number
          rate?: number
          service_id?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          line_total?: number
          proposal_id?: string
          quantity?: number
          rate?: number
          service_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposal_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_sections: {
        Row: {
          content: string | null
          created_at: string
          id: string
          photos: Json | null
          quote_id: string
          section_type: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          photos?: Json | null
          quote_id: string
          section_type: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          photos?: Json | null
          quote_id?: string
          section_type?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_sections_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_templates: {
        Row: {
          created_at: string
          default_content: string
          default_title: string
          id: string
          name: string
          section_type: string
        }
        Insert: {
          created_at?: string
          default_content: string
          default_title: string
          id?: string
          name: string
          section_type: string
        }
        Update: {
          created_at?: string
          default_content?: string
          default_title?: string
          id?: string
          name?: string
          section_type?: string
        }
        Relationships: []
      }
      proposals: {
        Row: {
          areas: Json | null
          company_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount_amount: number
          discount_type: string | null
          discount_value: number
          due_date: string | null
          id: string
          issue_date: string
          lead_id: string | null
          notes: string | null
          proposal_number: string
          quote_id: string | null
          reference: string | null
          source: string | null
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          terms: string | null
          total: number
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          areas?: Json | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number
          due_date?: string | null
          id?: string
          issue_date?: string
          lead_id?: string | null
          notes?: string | null
          proposal_number?: string
          quote_id?: string | null
          reference?: string | null
          source?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          terms?: string | null
          total?: number
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          areas?: Json | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number
          due_date?: string | null
          id?: string
          issue_date?: string
          lead_id?: string | null
          notes?: string | null
          proposal_number?: string
          quote_id?: string | null
          reference?: string | null
          source?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          terms?: string | null
          total?: number
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "proposals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_areas: {
        Row: {
          created_at: string
          id: string
          name: string
          quote_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          quote_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          quote_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_areas_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_attachments: {
        Row: {
          annotation: Json | null
          caption: string | null
          created_at: string
          filename: string | null
          id: string
          quote_id: string
          storage_path: string
          taken_at: string | null
        }
        Insert: {
          annotation?: Json | null
          caption?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          quote_id: string
          storage_path: string
          taken_at?: string | null
        }
        Update: {
          annotation?: Json | null
          caption?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          quote_id?: string
          storage_path?: string
          taken_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_attachments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_brochures: {
        Row: {
          brochure_id: string
          created_at: string | null
          id: string
          is_auto_matched: boolean | null
          quote_id: string
          sort_order: number | null
        }
        Insert: {
          brochure_id: string
          created_at?: string | null
          id?: string
          is_auto_matched?: boolean | null
          quote_id: string
          sort_order?: number | null
        }
        Update: {
          brochure_id?: string
          created_at?: string | null
          id?: string
          is_auto_matched?: boolean | null
          quote_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_brochures_brochure_id_fkey"
            columns: ["brochure_id"]
            isOneToOne: false
            referencedRelation: "product_brochures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_brochures_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          allows_decimal_qty: boolean
          area_id: string | null
          created_at: string
          description: string | null
          id: string
          is_bundle: boolean
          item_name: string
          item_number: string | null
          item_type: string | null
          length: number | null
          metadata: Json
          min_qty: number
          notes: string | null
          parent_item_id: string | null
          price_per_unit_label: string
          price_per_unit_qty: number
          product_id: string | null
          qty_step: number
          quantity: number
          quote_id: string | null
          sort_order: number
          source: string
          supplier: string | null
          total_price: number | null
          unit_price: number
          unit_type: Database["public"]["Enums"]["pricing_unit_type"]
          updated_at: string
        }
        Insert: {
          allows_decimal_qty?: boolean
          area_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_bundle?: boolean
          item_name: string
          item_number?: string | null
          item_type?: string | null
          length?: number | null
          metadata?: Json
          min_qty?: number
          notes?: string | null
          parent_item_id?: string | null
          price_per_unit_label?: string
          price_per_unit_qty?: number
          product_id?: string | null
          qty_step?: number
          quantity?: number
          quote_id?: string | null
          sort_order?: number
          source?: string
          supplier?: string | null
          total_price?: number | null
          unit_price?: number
          unit_type?: Database["public"]["Enums"]["pricing_unit_type"]
          updated_at?: string
        }
        Update: {
          allows_decimal_qty?: boolean
          area_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_bundle?: boolean
          item_name?: string
          item_number?: string | null
          item_type?: string | null
          length?: number | null
          metadata?: Json
          min_qty?: number
          notes?: string | null
          parent_item_id?: string | null
          price_per_unit_label?: string
          price_per_unit_qty?: number
          product_id?: string | null
          qty_step?: number
          quantity?: number
          quote_id?: string | null
          sort_order?: number
          source?: string
          supplier?: string | null
          total_price?: number | null
          unit_price?: number
          unit_type?: Database["public"]["Enums"]["pricing_unit_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "quote_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "quote_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          quantity: number
          quote_id: string
          quote_version_id: string | null
          service_id: string | null
          sort_order: number
          total: number | null
          unit: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          quantity: number
          quote_id: string
          quote_version_id?: string | null
          service_id?: string | null
          sort_order?: number
          total?: number | null
          unit?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          quantity?: number
          quote_id?: string
          quote_version_id?: string | null
          service_id?: string | null
          sort_order?: number
          total?: number | null
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_items_quote_version_id_fkey"
            columns: ["quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "hvac_services"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_template_items: {
        Row: {
          created_at: string
          description: string
          id: string
          quantity: number
          service_id: string | null
          template_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          quantity?: number
          service_id?: string | null
          template_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          quantity?: number
          service_id?: string | null
          template_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_template_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "hvac_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "quote_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_templates: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          line_items: Json
          name: string
          sections: Json | null
          terms_text: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          line_items?: Json
          name: string
          sections?: Json | null
          terms_text?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          line_items?: Json
          name?: string
          sections?: Json | null
          terms_text?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      quote_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          quote_id: string
          terms: string | null
          total_ex_vat: number
          total_incl_vat: number
          valid_until: string | null
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          quote_id: string
          terms?: string | null
          total_ex_vat?: number
          total_incl_vat?: number
          valid_until?: string | null
          version_number: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          quote_id?: string
          terms?: string | null
          total_ex_vat?: number
          total_incl_vat?: number
          valid_until?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_versions_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          accepted_signature: Json | null
          accepted_version_id: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          customer_id: string | null
          customer_name: string | null
          declined_at: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          lead_id: string | null
          legacy_original_total: number | null
          location_id: string | null
          notes: string | null
          owner_id: string | null
          public_token: string | null
          quote_number: string | null
          reference_text: string | null
          sales_engineer_id: string
          sent_at: string | null
          site_id: string | null
          status: string
          subtotal: number
          superseded_by: string | null
          terms_text: string | null
          total: number
          updated_at: string
          valid_until: string | null
          vat_amount: number
          vat_rate: number
          viewed_at: string | null
          visual_sections: Json | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_signature?: Json | null
          accepted_version_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          declined_at?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          lead_id?: string | null
          legacy_original_total?: number | null
          location_id?: string | null
          notes?: string | null
          owner_id?: string | null
          public_token?: string | null
          quote_number?: string | null
          reference_text?: string | null
          sales_engineer_id: string
          sent_at?: string | null
          site_id?: string | null
          status?: string
          subtotal?: number
          superseded_by?: string | null
          terms_text?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number
          vat_rate?: number
          viewed_at?: string | null
          visual_sections?: Json | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_signature?: Json | null
          accepted_version_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          declined_at?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          lead_id?: string | null
          legacy_original_total?: number | null
          location_id?: string | null
          notes?: string | null
          owner_id?: string | null
          public_token?: string | null
          quote_number?: string | null
          reference_text?: string | null
          sales_engineer_id?: string
          sent_at?: string | null
          site_id?: string | null
          status?: string
          subtotal?: number
          superseded_by?: string | null
          terms_text?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number
          vat_rate?: number
          viewed_at?: string | null
          visual_sections?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_accepted_version_id_fkey"
            columns: ["accepted_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "quotes_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "customer_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      service_agreements: {
        Row: {
          auto_generate_jobs: boolean
          company_id: string | null
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
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          auto_generate_jobs?: boolean
          company_id?: string | null
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
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_generate_jobs?: boolean
          company_id?: string | null
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
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_agreements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_agreements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
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
          {
            foreignKeyName: "service_agreements_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "customer_units"
            referencedColumns: ["id"]
          },
        ]
      }
      service_templates: {
        Row: {
          category: string
          created_at: string
          default_rate: number
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          default_rate?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          default_rate?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      status_change_log: {
        Row: {
          changed_by: string | null
          company_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          field_name: string
          id: string
          new_status: string | null
          old_status: string | null
        }
        Insert: {
          changed_by?: string | null
          company_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          field_name?: string
          id?: string
          new_status?: string | null
          old_status?: string | null
        }
        Update: {
          changed_by?: string | null
          company_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          field_name?: string
          id?: string
          new_status?: string | null
          old_status?: string | null
        }
        Relationships: []
      }
      stock_documents: {
        Row: {
          file_name: string
          file_path: string
          file_type: string
          id: string
          receipt_id: string
          uploaded_at: string
        }
        Insert: {
          file_name: string
          file_path: string
          file_type?: string
          id?: string
          receipt_id: string
          uploaded_at?: string
        }
        Update: {
          file_name?: string
          file_path?: string
          file_type?: string
          id?: string
          receipt_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_documents_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "stock_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_receipts: {
        Row: {
          created_at: string
          id: string
          items_received: Json
          notes: string | null
          receipt_date: string
          supplier_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          items_received?: Json
          notes?: string | null
          receipt_date?: string
          supplier_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          items_received?: Json
          notes?: string | null
          receipt_date?: string
          supplier_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_contacts: {
        Row: {
          contact_name: string
          created_at: string
          department: string | null
          direct_phone: string | null
          email: string | null
          extension: string | null
          id: string
          is_primary: boolean
          location_branch: string | null
          location_id: string | null
          mobile: string | null
          phone: string | null
          role_title: string | null
          supplier_id: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          contact_name: string
          created_at?: string
          department?: string | null
          direct_phone?: string | null
          email?: string | null
          extension?: string | null
          id?: string
          is_primary?: boolean
          location_branch?: string | null
          location_id?: string | null
          mobile?: string | null
          phone?: string | null
          role_title?: string | null
          supplier_id: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          contact_name?: string
          created_at?: string
          department?: string | null
          direct_phone?: string | null
          email?: string | null
          extension?: string | null
          id?: string
          is_primary?: boolean
          location_branch?: string | null
          location_id?: string | null
          mobile?: string | null
          phone?: string | null
          role_title?: string | null
          supplier_id?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_contacts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "supplier_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_contacts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_documents: {
        Row: {
          created_at: string
          file_name: string
          file_type: string | null
          id: string
          storage_path: string
          supplier_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_type?: string | null
          id?: string
          storage_path: string
          supplier_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_type?: string | null
          id?: string
          storage_path?: string
          supplier_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_locations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string | null
          email: string | null
          id: string
          is_head_office: boolean | null
          location_name: string
          notes: string | null
          phone: string | null
          province: string | null
          supplier_id: string
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_head_office?: boolean | null
          location_name: string
          notes?: string | null
          phone?: string | null
          province?: string | null
          supplier_id: string
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_head_office?: boolean | null
          location_name?: string
          notes?: string | null
          phone?: string | null
          province?: string | null
          supplier_id?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_locations_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_pdf_pages: {
        Row: {
          brand: string | null
          id: string
          page_image_url: string
          page_number: number
          pdf_filename: string
          pdf_storage_path: string | null
          price_column_bbox: Json | null
          supplier_id: string
          uploaded_at: string
        }
        Insert: {
          brand?: string | null
          id?: string
          page_image_url: string
          page_number: number
          pdf_filename: string
          pdf_storage_path?: string | null
          price_column_bbox?: Json | null
          supplier_id: string
          uploaded_at?: string
        }
        Update: {
          brand?: string | null
          id?: string
          page_image_url?: string
          page_number?: number
          pdf_filename?: string
          pdf_storage_path?: string | null
          price_column_bbox?: Json | null
          supplier_id?: string
          uploaded_at?: string
        }
        Relationships: []
      }
      supplier_products: {
        Row: {
          allows_decimal_qty: boolean
          archived: boolean
          archived_at: string | null
          brand: string | null
          btu_rating: number | null
          calculated_price: number | null
          capacity_btu: number | null
          category: string
          cost_excl_vat: number | null
          cost_incl_vat: number | null
          cost_price: number
          created_at: string
          default_markup_percent: number
          description: string
          id: string
          image_url: string | null
          import_confidence: string | null
          import_flags: string[] | null
          inverter: boolean | null
          is_active: boolean
          is_material_favorite: boolean
          is_pinned: boolean
          is_price_on_request: boolean
          kw: number | null
          last_quoted_at: string | null
          list_price_raw: number | null
          markup_percent: number | null
          min_cut_length: number
          min_qty: number
          model: string | null
          model_range: string | null
          name: string | null
          original_cost_excl_vat: number | null
          pack_qty: number | null
          page_number: number | null
          pdf_page_id: string | null
          pdf_upload_id: string | null
          phase: string | null
          pin_order: number
          pipe_gas: string | null
          pipe_liquid: string | null
          pipe_size: string | null
          price_bbox: Json | null
          price_excl_vat: number | null
          price_includes_vat: boolean | null
          price_per_metre: number | null
          price_per_unit_label: string
          price_per_unit_qty: number
          pricing_mode: string
          product_category: string
          product_code: string
          product_type: string
          qty_step: number
          quote_usage_count: number
          refrigerant_type: string | null
          row_bbox: Json | null
          search_aliases: string[] | null
          sell_price_incl_vat: number | null
          selling_price: number | null
          short_name: string | null
          sold_in_length: boolean
          subcategory: string | null
          suggested_consumables: Json | null
          supplier_discount_percent: number
          supplier_id: string
          unit_length: number | null
          unit_length_unit: string
          unit_type: string | null
          updated_at: string
          vat_amount: number | null
          vat_rate: number
        }
        Insert: {
          allows_decimal_qty?: boolean
          archived?: boolean
          archived_at?: string | null
          brand?: string | null
          btu_rating?: number | null
          calculated_price?: number | null
          capacity_btu?: number | null
          category?: string
          cost_excl_vat?: number | null
          cost_incl_vat?: number | null
          cost_price?: number
          created_at?: string
          default_markup_percent?: number
          description: string
          id?: string
          image_url?: string | null
          import_confidence?: string | null
          import_flags?: string[] | null
          inverter?: boolean | null
          is_active?: boolean
          is_material_favorite?: boolean
          is_pinned?: boolean
          is_price_on_request?: boolean
          kw?: number | null
          last_quoted_at?: string | null
          list_price_raw?: number | null
          markup_percent?: number | null
          min_cut_length?: number
          min_qty?: number
          model?: string | null
          model_range?: string | null
          name?: string | null
          original_cost_excl_vat?: number | null
          pack_qty?: number | null
          page_number?: number | null
          pdf_page_id?: string | null
          pdf_upload_id?: string | null
          phase?: string | null
          pin_order?: number
          pipe_gas?: string | null
          pipe_liquid?: string | null
          pipe_size?: string | null
          price_bbox?: Json | null
          price_excl_vat?: number | null
          price_includes_vat?: boolean | null
          price_per_metre?: number | null
          price_per_unit_label?: string
          price_per_unit_qty?: number
          pricing_mode?: string
          product_category?: string
          product_code: string
          product_type?: string
          qty_step?: number
          quote_usage_count?: number
          refrigerant_type?: string | null
          row_bbox?: Json | null
          search_aliases?: string[] | null
          sell_price_incl_vat?: number | null
          selling_price?: number | null
          short_name?: string | null
          sold_in_length?: boolean
          subcategory?: string | null
          suggested_consumables?: Json | null
          supplier_discount_percent?: number
          supplier_id: string
          unit_length?: number | null
          unit_length_unit?: string
          unit_type?: string | null
          updated_at?: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Update: {
          allows_decimal_qty?: boolean
          archived?: boolean
          archived_at?: string | null
          brand?: string | null
          btu_rating?: number | null
          calculated_price?: number | null
          capacity_btu?: number | null
          category?: string
          cost_excl_vat?: number | null
          cost_incl_vat?: number | null
          cost_price?: number
          created_at?: string
          default_markup_percent?: number
          description?: string
          id?: string
          image_url?: string | null
          import_confidence?: string | null
          import_flags?: string[] | null
          inverter?: boolean | null
          is_active?: boolean
          is_material_favorite?: boolean
          is_pinned?: boolean
          is_price_on_request?: boolean
          kw?: number | null
          last_quoted_at?: string | null
          list_price_raw?: number | null
          markup_percent?: number | null
          min_cut_length?: number
          min_qty?: number
          model?: string | null
          model_range?: string | null
          name?: string | null
          original_cost_excl_vat?: number | null
          pack_qty?: number | null
          page_number?: number | null
          pdf_page_id?: string | null
          pdf_upload_id?: string | null
          phase?: string | null
          pin_order?: number
          pipe_gas?: string | null
          pipe_liquid?: string | null
          pipe_size?: string | null
          price_bbox?: Json | null
          price_excl_vat?: number | null
          price_includes_vat?: boolean | null
          price_per_metre?: number | null
          price_per_unit_label?: string
          price_per_unit_qty?: number
          pricing_mode?: string
          product_category?: string
          product_code?: string
          product_type?: string
          qty_step?: number
          quote_usage_count?: number
          refrigerant_type?: string | null
          row_bbox?: Json | null
          search_aliases?: string[] | null
          sell_price_incl_vat?: number | null
          selling_price?: number | null
          short_name?: string | null
          sold_in_length?: boolean
          subcategory?: string | null
          suggested_consumables?: Json | null
          supplier_discount_percent?: number
          supplier_id?: string
          unit_length?: number | null
          unit_length_unit?: string
          unit_type?: string | null
          updated_at?: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_pdf_page_id_fkey"
            columns: ["pdf_page_id"]
            isOneToOne: false
            referencedRelation: "supplier_pdf_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_pdf_upload_id_fkey"
            columns: ["pdf_upload_id"]
            isOneToOne: false
            referencedRelation: "pdf_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          company_name: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          default_markup_percent: number | null
          default_price_column: string | null
          default_trade_discount: number | null
          default_vat_rate: number
          head_office_address: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          main_email: string | null
          main_phone: string | null
          main_whatsapp: string | null
          name: string
          notes: string | null
          physical_address: string | null
          postal_address: string | null
          price_includes_markup: boolean
          price_includes_vat: boolean
          price_list_type: string | null
          registration_number: string | null
          supplier_discount_percent: number
          supplier_markup_percent: number
          supplier_type: string
          trading_name: string | null
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          default_markup_percent?: number | null
          default_price_column?: string | null
          default_trade_discount?: number | null
          default_vat_rate?: number
          head_office_address?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          main_email?: string | null
          main_phone?: string | null
          main_whatsapp?: string | null
          name: string
          notes?: string | null
          physical_address?: string | null
          postal_address?: string | null
          price_includes_markup?: boolean
          price_includes_vat?: boolean
          price_list_type?: string | null
          registration_number?: string | null
          supplier_discount_percent?: number
          supplier_markup_percent?: number
          supplier_type?: string
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          default_markup_percent?: number | null
          default_price_column?: string | null
          default_trade_discount?: number | null
          default_vat_rate?: number
          head_office_address?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          main_email?: string | null
          main_phone?: string | null
          main_whatsapp?: string | null
          name?: string
          notes?: string | null
          physical_address?: string | null
          postal_address?: string | null
          price_includes_markup?: boolean
          price_includes_vat?: boolean
          price_list_type?: string | null
          registration_number?: string | null
          supplier_discount_percent?: number
          supplier_markup_percent?: number
          supplier_type?: string
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: []
      }
      sync_conflicts: {
        Row: {
          agent_id: string
          conflict_type: string
          created_at: string
          id: string
          lead_id: string
          local_data: Json | null
          resolution: string
          resolved_at: string | null
          server_data: Json | null
        }
        Insert: {
          agent_id: string
          conflict_type?: string
          created_at?: string
          id?: string
          lead_id: string
          local_data?: Json | null
          resolution?: string
          resolved_at?: string | null
          server_data?: Json | null
        }
        Update: {
          agent_id?: string
          conflict_type?: string
          created_at?: string
          id?: string
          lead_id?: string
          local_data?: Json | null
          resolution?: string
          resolved_at?: string | null
          server_data?: Json | null
        }
        Relationships: []
      }
      unassigned_queue: {
        Row: {
          company_id: string | null
          created_at: string
          escalate_at: string
          escalated: boolean
          escalated_at: string | null
          id: string
          lead_id: string
          priority: string
          reason: string
          resolved: boolean
          resolved_at: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          escalate_at?: string
          escalated?: boolean
          escalated_at?: string | null
          id?: string
          lead_id: string
          priority?: string
          reason: string
          resolved?: boolean
          resolved_at?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          escalate_at?: string
          escalated?: boolean
          escalated_at?: string | null
          id?: string
          lead_id?: string
          priority?: string
          reason?: string
          resolved?: boolean
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unassigned_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      upgrade_paths: {
        Row: {
          from_participant_type: string | null
          id: string
          metadata: Json | null
          performed_at: string | null
          performed_by: string | null
          profile_id: string
          to_company_id: string | null
          to_participant_type: string | null
          upgrade_reason: string | null
        }
        Insert: {
          from_participant_type?: string | null
          id?: string
          metadata?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          profile_id: string
          to_company_id?: string | null
          to_participant_type?: string | null
          upgrade_reason?: string | null
        }
        Update: {
          from_participant_type?: string | null
          id?: string
          metadata?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          profile_id?: string
          to_company_id?: string | null
          to_participant_type?: string | null
          upgrade_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upgrade_paths_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upgrade_paths_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upgrade_paths_to_company_id_fkey"
            columns: ["to_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upgrade_paths_to_company_id_fkey"
            columns: ["to_company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
      vapi_calls: {
        Row: {
          business_phone: string | null
          call_category: string | null
          caller_name: string | null
          caller_phone: string | null
          company_id: string | null
          created_at: string
          customer_id: string | null
          direction: string
          duration_seconds: number
          ended_at: string | null
          ended_reason: string | null
          error_reason: string | null
          id: string
          is_existing_client: boolean
          lead_id: string | null
          metadata: Json
          outcome: string | null
          provider: string
          provider_call_id: string | null
          quote_id: string | null
          recording_url: string | null
          service_type: string | null
          started_at: string | null
          summary: string | null
          transcript: string | null
          updated_at: string
          urgency: string | null
        }
        Insert: {
          business_phone?: string | null
          call_category?: string | null
          caller_name?: string | null
          caller_phone?: string | null
          company_id?: string | null
          created_at?: string
          customer_id?: string | null
          direction?: string
          duration_seconds?: number
          ended_at?: string | null
          ended_reason?: string | null
          error_reason?: string | null
          id?: string
          is_existing_client?: boolean
          lead_id?: string | null
          metadata?: Json
          outcome?: string | null
          provider?: string
          provider_call_id?: string | null
          quote_id?: string | null
          recording_url?: string | null
          service_type?: string | null
          started_at?: string | null
          summary?: string | null
          transcript?: string | null
          updated_at?: string
          urgency?: string | null
        }
        Update: {
          business_phone?: string | null
          call_category?: string | null
          caller_name?: string | null
          caller_phone?: string | null
          company_id?: string | null
          created_at?: string
          customer_id?: string | null
          direction?: string
          duration_seconds?: number
          ended_at?: string | null
          ended_reason?: string | null
          error_reason?: string | null
          id?: string
          is_existing_client?: boolean
          lead_id?: string | null
          metadata?: Json
          outcome?: string | null
          provider?: string
          provider_call_id?: string | null
          quote_id?: string | null
          recording_url?: string | null
          service_type?: string | null
          started_at?: string | null
          summary?: string | null
          transcript?: string | null
          updated_at?: string
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vapi_calls_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vapi_calls_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "vapi_calls_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vapi_calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vapi_calls_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_proposal_templates: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          sections: Json
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          sections?: Json
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          sections?: Json
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      visual_proposals: {
        Row: {
          accepted_at: string | null
          accepted_by_name: string | null
          client_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          proposal_date: string
          proposal_number: string | null
          public_token: string | null
          reference: string | null
          require_signature: boolean
          sections: Json
          sent_at: string | null
          status: string
          style: Json
          title: string
          total: number
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_name?: string | null
          client_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          proposal_date?: string
          proposal_number?: string | null
          public_token?: string | null
          reference?: string | null
          require_signature?: boolean
          sections?: Json
          sent_at?: string | null
          status?: string
          style?: Json
          title?: string
          total?: number
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by_name?: string | null
          client_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          proposal_date?: string
          proposal_number?: string | null
          public_token?: string | null
          reference?: string | null
          require_signature?: boolean
          sections?: Json
          sent_at?: string | null
          status?: string
          style?: Json
          title?: string
          total?: number
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visual_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_session_context: {
        Row: {
          company_id: string
          context: Json
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          context?: Json
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          context?: Json
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      webhook_dead_letters: {
        Row: {
          company_id: string | null
          created_at: string
          error_detail: Json | null
          error_message: string | null
          external_id: string | null
          id: string
          idempotency_key: string | null
          payload: Json | null
          resolved_at: string | null
          retry_count: number
          source: string
          stage: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          error_detail?: Json | null
          error_message?: string | null
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          payload?: Json | null
          resolved_at?: string | null
          retry_count?: number
          source: string
          stage?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          error_detail?: Json | null
          error_message?: string | null
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          payload?: Json | null
          resolved_at?: string | null
          retry_count?: number
          source?: string
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_conversation_state: {
        Row: {
          context: Json
          created_at: string
          customer_id: string | null
          expires_at: string
          id: string
          job_id: string | null
          lead_id: string | null
          phone: string
          state: string
          updated_at: string
        }
        Insert: {
          context?: Json
          created_at?: string
          customer_id?: string | null
          expires_at?: string
          id?: string
          job_id?: string | null
          lead_id?: string | null
          phone: string
          state: string
          updated_at?: string
        }
        Update: {
          context?: Json
          created_at?: string
          customer_id?: string | null
          expires_at?: string
          id?: string
          job_id?: string | null
          lead_id?: string | null
          phone?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_state_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_state_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: string | null
          created_at: string
          customer_id: string | null
          direction: string
          environment: string
          error_message: string | null
          from_number: string
          id: string
          lead_id: string | null
          media_urls: Json
          provider_sid: string | null
          raw: Json
          status: string | null
          to_number: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          customer_id?: string | null
          direction: string
          environment?: string
          error_message?: string | null
          from_number: string
          id?: string
          lead_id?: string | null
          media_urls?: Json
          provider_sid?: string | null
          raw?: Json
          status?: string | null
          to_number: string
        }
        Update: {
          body?: string | null
          created_at?: string
          customer_id?: string | null
          direction?: string
          environment?: string
          error_message?: string | null
          from_number?: string
          id?: string
          lead_id?: string | null
          media_urls?: Json
          provider_sid?: string | null
          raw?: Json
          status?: string | null
          to_number?: string
        }
        Relationships: []
      }
    }
    Views: {
      company_stats: {
        Row: {
          company_id: string | null
          expenses_total: number | null
          overdue_count: number | null
          revenue: number | null
        }
        Relationships: []
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      v_accounts_aging: {
        Row: {
          aging_bucket: string | null
          balance_due: number | null
          company_id: string | null
          customer_id: string | null
          customer_name: string | null
          effective_due_date: string | null
          grand_total: number | null
          invoice_id: string | null
          invoice_number: string | null
          issue_date: string | null
          paid_amount: number | null
          stored_due_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sales_by_client: {
        Row: {
          customer_id: string | null
          customer_name: string | null
          invoice_count: number | null
          total_excl_vat: number | null
          total_outstanding: number | null
          total_paid: number | null
          total_sales: number | null
          total_vat: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sales_by_product: {
        Row: {
          invoice_count: number | null
          product_description: string | null
          total_quantity: number | null
          total_sales: number | null
        }
        Relationships: []
      }
      v_sales_by_product_detail: {
        Row: {
          customer_id: string | null
          invoice_id: string | null
          invoice_number: string | null
          issue_date: string | null
          line_amount: number | null
          product_description: string | null
          quantity: number | null
          status: string | null
          unit_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_vat_summary: {
        Row: {
          invoice_count: number | null
          period_month: string | null
          total_excl_vat: number | null
          total_incl_vat: number | null
          total_vat_collected: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      accept_quote_by_token: {
        Args: { p_accepted_by: string; p_signature?: Json; p_token: string }
        Returns: boolean
      }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      agent_performance_scores: {
        Args: never
        Returns: {
          agent_name: string
          avg_completion_days: number
          jobs_completed: number
          performance_score: number
          total_revenue: number
        }[]
      }
      backfill_leads_to_customers: { Args: never; Returns: Json }
      broadcast_lead_to_agents: {
        Args: { p_lead_id: string; p_radius_km?: number }
        Returns: {
          agent_id: string
          distance_km: number
          offer_method: string
        }[]
      }
      calculate_distance_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      check_customer_duplicates: {
        Args: {
          p_address?: string
          p_email?: string
          p_first_name?: string
          p_last_name?: string
          p_phone?: string
        }
        Returns: {
          email: string
          first_name: string
          id: string
          last_name: string
          match_score: number
          match_type: string
          phone: string
          primary_address_line1: string
        }[]
      }
      claim_offer: {
        Args: { p_offer_id: string; p_staff_id: string }
        Returns: Json
      }
      convert_lead_to_customer: { Args: { p_lead_id: string }; Returns: string }
      convert_time_to_invoice_items: {
        Args: {
          p_hourly_rate?: number
          p_invoice_id: string
          p_lead_id: string
        }
        Returns: number
      }
      create_portal_booking: {
        Args: { p_notes?: string; p_service_type: string; p_token: string }
        Returns: string
      }
      decline_quote_by_token: { Args: { p_token: string }; Returns: boolean }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      find_dispatch_candidates: {
        Args: {
          p_lead_id: string
          p_radius_km?: number
          p_role: string
          p_skill?: string
        }
        Returns: {
          distance_km: number
          full_name: string
          staff_id: string
        }[]
      }
      find_dispatch_candidates_multi: {
        Args: {
          p_lead_id: string
          p_radius_km: number
          p_role: string
          p_skills?: string[]
        }
        Returns: {
          distance_km: number
          full_name: string
          staff_id: string
        }[]
      }
      fuzzy_digits: { Args: { p_text: string }; Returns: string }
      fuzzy_normalize: { Args: { p_text: string }; Returns: string }
      fuzzy_score: {
        Args: { p_haystacks: string[]; p_query: string }
        Returns: number
      }
      generate_invoice_number: { Args: never; Returns: string }
      generate_maintenance_schedules: {
        Args: { months_ahead?: number }
        Returns: number
      }
      generate_proposal_number: { Args: never; Returns: string }
      generate_quote_number:
        | { Args: never; Returns: string }
        | { Args: { p_company_id?: string }; Returns: string }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
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
      get_completed_jobs: {
        Args: {
          p_agent_ids?: string[]
          p_center_lat?: number
          p_center_lng?: number
          p_end_date?: string
          p_radius_km?: number
          p_search?: string
          p_start_date?: string
        }
        Returns: {
          accepted_at: string | null
          actual_start_time: string | null
          agreement_id: string | null
          assigned_agent_id: string | null
          assignment_method: string | null
          assignment_score: number | null
          broadcast_radius_km: number | null
          cancellation_reason: string | null
          classified_by: Database["public"]["Enums"]["lead_classifier"] | null
          company_id: string | null
          company_name: string | null
          completed_at: string | null
          confidence: number | null
          converted_at: string | null
          created_at: string | null
          customer_address: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          deleted_at: string | null
          email: string | null
          equipment_id: string | null
          estimated_duration_minutes: number | null
          estimated_end_time: string | null
          external_id: string | null
          id: string
          idempotency_key: string | null
          intents: string[]
          interaction_history: Json
          last_activity_at: string
          latitude: number
          lead_priority: Database["public"]["Enums"]["lead_priority_level"]
          lead_score: number | null
          lead_status: Database["public"]["Enums"]["lead_lifecycle_status"]
          location: unknown
          longitude: number
          merge_history: Json
          merged_into_id: string | null
          needs_manual_assignment: boolean
          normalized_address: string | null
          notes: string | null
          offer_count: number | null
          order_status: string | null
          parts_status: string | null
          phone: string | null
          primary_intent: Database["public"]["Enums"]["lead_intent"] | null
          priority: string
          raw_payload: Json | null
          scheduled_date: string | null
          scheduled_time: string | null
          service_type: string
          sla_breached_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          started_at: string | null
          status: string
          technician_eta: string | null
          technician_name: string | null
          unit_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_invoice_aging_report: {
        Args: never
        Returns: {
          bracket: string
          invoice_count: number
          total_outstanding: number
        }[]
      }
      get_job_billable_hours: { Args: { p_lead_id: string }; Returns: number }
      get_my_assigned_jobs: {
        Args: { p_profile_id: string }
        Returns: {
          assignment_id: string
          assignment_notes: string
          assignment_status: string
          created_at: string
          customer_name: string
          customer_phone: string
          job_address: string
          job_description: string
          job_id: string
          job_priority: string
          job_scheduled_for: string
          job_status: string
          job_title: string
        }[]
      }
      get_or_create_customer_token: {
        Args: { p_customer_id: string }
        Returns: string
      }
      get_overdue_maintenance_count: { Args: never; Returns: number }
      get_public_quote: { Args: { p_token: string }; Returns: Json }
      get_quote_by_public_token: { Args: { p_token: string }; Returns: string }
      get_recently_active_customers: {
        Args: { p_company_id: string; p_limit?: number }
        Returns: {
          email: string
          id: string
          lead_source: string
          name: string
          phone: string
          status: string
          updated_at: string
        }[]
      }
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
      gettransactionid: { Args: never; Returns: unknown }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_product_usage: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      is_agent_available_now: { Args: { p_agent_id: string }; Returns: boolean }
      is_company_admin: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_ops_user: { Args: { _user_id: string }; Returns: boolean }
      job_profit_loss: {
        Args: { p_lead_id: string }
        Returns: {
          expenses: number
          profit: number
          revenue: number
        }[]
      }
      log_entity_resolution: {
        Args: {
          p_candidates?: Json
          p_channel?: string
          p_chosen_id?: string
          p_chosen_label?: string
          p_decision: string
          p_entity_type: string
          p_query: string
          p_score?: number
        }
        Returns: string
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      mark_overdue_maintenance: { Args: never; Returns: number }
      normalize_phone: { Args: { phone: string }; Returns: string }
      past_quote_analytics: {
        Args: { p_job_type?: string }
        Returns: {
          avg_quantity: number
          avg_unit_price: number
          description: string
          usage_count: number
        }[]
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      quote_conversion_funnel: {
        Args: never
        Returns: {
          count: number
          status: string
        }[]
      }
      revenue_by_agent: {
        Args: never
        Returns: {
          agent_name: string
          total_revenue: number
        }[]
      }
      revenue_by_service_type: {
        Args: never
        Returns: {
          service_category: string
          total: number
        }[]
      }
      revenue_trend_monthly: {
        Args: never
        Returns: {
          month: string
          revenue: number
        }[]
      }
      search_customers: {
        Args: { max_results?: number; search_term: string }
        Returns: {
          city: string
          company_name: string
          email: string
          first_name: string
          id: string
          is_company: boolean
          last_name: string
          phone: string
          primary_address_line1: string
          relevance: number
          status: string
        }[]
      }
      search_entities_fuzzy: {
        Args: {
          p_company_id?: string
          p_entity_type: string
          p_limit?: number
          p_min_score?: number
          p_query: string
        }
        Returns: {
          entity_type: string
          id: string
          label: string
          reference: string
          score: number
          sublabel: string
        }[]
      }
      search_supplier_products:
        | {
            Args: {
              p_category?: string
              p_include_archived?: boolean
              p_limit?: number
              p_query?: string
              p_supplier_id?: string
            }
            Returns: {
              brand: string
              btu_rating: number
              category: string
              cost_excl_vat: number
              cost_incl_vat: number
              cost_price: number
              default_markup_percent: number
              description: string
              id: string
              image_url: string
              is_pinned: boolean
              is_price_on_request: boolean
              last_quoted_at: string
              pin_order: number
              pipe_size: string
              product_category: string
              product_code: string
              quote_usage_count: number
              refrigerant_type: string
              rrp: number
              search_rank: number
              selling_price: number
              short_name: string
              subcategory: string
              supplier_id: string
              supplier_name: string
            }[]
          }
        | {
            Args: {
              p_category?: string
              p_limit?: number
              p_query: string
              p_supplier_id?: string
            }
            Returns: {
              btu_rating: number
              category: string
              cost_price: number
              default_markup_percent: number
              description: string
              id: string
              image_url: string
              is_price_on_request: boolean
              last_quoted_at: string
              pipe_size: string
              product_code: string
              quote_usage_count: number
              refrigerant_type: string
              search_rank: number
              selling_price: number
              subcategory: string
              supplier_id: string
              supplier_name: string
            }[]
          }
        | {
            Args: {
              brand_filter?: string
              category_filter?: string
              max_results?: number
              search_term?: string
              sort_by?: string
            }
            Returns: {
              archived: boolean
              brand: string
              category: string
              cost_excl_vat: number
              cost_incl_vat: number
              default_markup_percent: number
              description: string
              discounted_cost: number
              id: string
              is_pinned: boolean
              pin_order: number
              product_category: string
              product_code: string
              rrp: number
              selling_price: number
              short_name: string
              supplier_discount_percent: number
              supplier_id: string
              supplier_name: string
            }[]
          }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unconvert_lead: { Args: { p_lead_id: string }; Returns: undefined }
      unlockrows: { Args: { "": string }; Returns: number }
      update_entity: {
        Args: { p_entity_id: string; p_entity_type: string; p_patch: Json }
        Returns: Json
      }
      update_overdue_invoices: { Args: never; Returns: undefined }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      user_can_access_job_company: {
        Args: { _job_id: string; _user_id: string }
        Returns: boolean
      }
      user_can_update_assigned_job: {
        Args: { _job_id: string; _user_id: string }
        Returns: boolean
      }
      user_is_assigned_to_job: {
        Args: { _job_id: string; _user_id: string }
        Returns: boolean
      }
      validate_customer_token: { Args: { p_token: string }; Returns: string }
    }
    Enums: {
      app_role:
        | "admin"
        | "field_agent"
        | "dispatcher"
        | "viewer"
        | "platform_super_admin"
        | "platform_ops"
      availability_status: "available" | "busy" | "offline"
      equipment_type:
        | "ac"
        | "heater"
        | "vent"
        | "heat_pump"
        | "furnace"
        | "other"
      lead_classifier: "rule" | "ai" | "human"
      lead_intent: "sales" | "service"
      lead_lifecycle_status:
        | "new"
        | "classified"
        | "routed"
        | "in_progress"
        | "completed"
        | "lost"
        | "cancelled"
      lead_priority_level: "emergency" | "same_day" | "standard"
      lead_source:
        | "vapi_call"
        | "website_form"
        | "facebook_lead_ads"
        | "google_lsa"
        | "manual"
        | "other"
      pricing_unit_type:
        | "each"
        | "m"
        | "g"
        | "kg"
        | "l"
        | "ml"
        | "roll"
        | "box"
        | "pack"
        | "custom"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
      app_role: [
        "admin",
        "field_agent",
        "dispatcher",
        "viewer",
        "platform_super_admin",
        "platform_ops",
      ],
      availability_status: ["available", "busy", "offline"],
      equipment_type: ["ac", "heater", "vent", "heat_pump", "furnace", "other"],
      lead_classifier: ["rule", "ai", "human"],
      lead_intent: ["sales", "service"],
      lead_lifecycle_status: [
        "new",
        "classified",
        "routed",
        "in_progress",
        "completed",
        "lost",
        "cancelled",
      ],
      lead_priority_level: ["emergency", "same_day", "standard"],
      lead_source: [
        "vapi_call",
        "website_form",
        "facebook_lead_ads",
        "google_lsa",
        "manual",
        "other",
      ],
      pricing_unit_type: [
        "each",
        "m",
        "g",
        "kg",
        "l",
        "ml",
        "roll",
        "box",
        "pack",
        "custom",
      ],
    },
  },
} as const
