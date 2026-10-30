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
      _acct_backups: {
        Row: {
          definition: string | null
          id: number
          object: string
          saved_at: string
          step: string
        }
        Insert: {
          definition?: string | null
          id?: number
          object: string
          saved_at?: string
          step: string
        }
        Update: {
          definition?: string | null
          id?: number
          object?: string
          saved_at?: string
          step?: string
        }
        Relationships: []
      }
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
          listed_as_staff: boolean
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
          listed_as_staff?: boolean
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
          listed_as_staff?: boolean
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
      agreement_contracts: {
        Row: {
          client_snapshot: Json
          company_id: string
          contract_number: string
          created_at: string
          created_by: string | null
          customer_id: string
          frequency: string | null
          id: string
          notes: string | null
          plan: string | null
          sections: Json
          service_agreement_id: string | null
          source_invoice_ids: string[]
          source_job_ids: string[]
          start_date: string | null
          status: string
          template_id: string | null
          template_name: string | null
          template_version: number | null
          title: string
          units: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_snapshot?: Json
          company_id: string
          contract_number: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          frequency?: string | null
          id?: string
          notes?: string | null
          plan?: string | null
          sections?: Json
          service_agreement_id?: string | null
          source_invoice_ids?: string[]
          source_job_ids?: string[]
          start_date?: string | null
          status?: string
          template_id?: string | null
          template_name?: string | null
          template_version?: number | null
          title?: string
          units?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_snapshot?: Json
          company_id?: string
          contract_number?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          frequency?: string | null
          id?: string
          notes?: string | null
          plan?: string | null
          sections?: Json
          service_agreement_id?: string | null
          source_invoice_ids?: string[]
          source_job_ids?: string[]
          start_date?: string | null
          status?: string
          template_id?: string | null
          template_name?: string | null
          template_version?: number | null
          title?: string
          units?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "agreement_contracts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_contracts_service_agreement_id_fkey"
            columns: ["service_agreement_id"]
            isOneToOne: false
            referencedRelation: "service_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_contracts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_template_sections: {
        Row: {
          body: string
          created_at: string
          doc_kind: string
          heading: string
          id: string
          kind: string
          position: number
          template_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          doc_kind: string
          heading?: string
          id?: string
          kind?: string
          position: number
          template_id: string
        }
        Update: {
          body?: string
          created_at?: string
          doc_kind?: string
          heading?: string
          id?: string
          kind?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_template_sections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          snapshot: Json
          template_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          snapshot: Json
          template_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          snapshot?: Json
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agreement_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_templates: {
        Row: {
          company_id: string
          contract_docx_path: string | null
          contract_pdf_path: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          sla_docx_path: string | null
          sla_pdf_path: string | null
          status: string
          tier: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          company_id: string
          contract_docx_path?: string | null
          contract_pdf_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          sla_docx_path?: string | null
          sla_pdf_path?: string | null
          status?: string
          tier?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          company_id?: string
          contract_docx_path?: string | null
          contract_pdf_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          sla_docx_path?: string | null
          sla_pdf_path?: string | null
          status?: string
          tier?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agreement_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
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
      app_webhook_config: {
        Row: {
          call_report_token: string | null
          created_at: string
          email_webhook_token: string
          id: number
          lead_call_token: string | null
        }
        Insert: {
          call_report_token?: string | null
          created_at?: string
          email_webhook_token?: string
          id?: number
          lead_call_token?: string | null
        }
        Update: {
          call_report_token?: string | null
          created_at?: string
          email_webhook_token?: string
          id?: number
          lead_call_token?: string | null
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
      bank_lines: {
        Row: {
          account_label: string
          amount: number
          balance: number | null
          company_id: string
          created_record: boolean
          description: string | null
          id: string
          import_batch: string
          imported_at: string
          imported_by: string
          line_hash: string
          matched_at: string | null
          matched_bill_payment_id: string | null
          matched_by: string | null
          matched_expense_id: string | null
          matched_payment_id: string | null
          note: string | null
          reference: string | null
          status: string
          txn_date: string
        }
        Insert: {
          account_label?: string
          amount: number
          balance?: number | null
          company_id: string
          created_record?: boolean
          description?: string | null
          id?: string
          import_batch: string
          imported_at?: string
          imported_by: string
          line_hash: string
          matched_at?: string | null
          matched_bill_payment_id?: string | null
          matched_by?: string | null
          matched_expense_id?: string | null
          matched_payment_id?: string | null
          note?: string | null
          reference?: string | null
          status?: string
          txn_date: string
        }
        Update: {
          account_label?: string
          amount?: number
          balance?: number | null
          company_id?: string
          created_record?: boolean
          description?: string | null
          id?: string
          import_batch?: string
          imported_at?: string
          imported_by?: string
          line_hash?: string
          matched_at?: string | null
          matched_bill_payment_id?: string | null
          matched_by?: string | null
          matched_expense_id?: string | null
          matched_payment_id?: string | null
          note?: string | null
          reference?: string | null
          status?: string
          txn_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_lines_matched_bill_payment_id_fkey"
            columns: ["matched_bill_payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_bill_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_lines_matched_expense_id_fkey"
            columns: ["matched_expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_lines_matched_payment_id_fkey"
            columns: ["matched_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
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
          match_status: string | null
          min_qty: number
          model_number: string | null
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
          match_status?: string | null
          min_qty?: number
          model_number?: string | null
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
          match_status?: string | null
          min_qty?: number
          model_number?: string | null
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
            referencedRelation: "live_supplier_products"
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
      call_reports: {
        Row: {
          address: string | null
          address_confirmed: boolean | null
          breakdown: string | null
          call_id: string
          caller_name: string | null
          caller_phone: string | null
          company_id: string | null
          created_at: string
          customer_id: string | null
          email_sent_at: string | null
          email_status: string | null
          email_to: string | null
          error: string | null
          id: string
          is_test: boolean
          lead_id: string | null
          lead_level: string | null
          model: string | null
          next_action: string | null
          score: number | null
          service_type: string | null
          status: string
          updated_at: string
          urgency: string | null
        }
        Insert: {
          address?: string | null
          address_confirmed?: boolean | null
          breakdown?: string | null
          call_id: string
          caller_name?: string | null
          caller_phone?: string | null
          company_id?: string | null
          created_at?: string
          customer_id?: string | null
          email_sent_at?: string | null
          email_status?: string | null
          email_to?: string | null
          error?: string | null
          id?: string
          is_test?: boolean
          lead_id?: string | null
          lead_level?: string | null
          model?: string | null
          next_action?: string | null
          score?: number | null
          service_type?: string | null
          status?: string
          updated_at?: string
          urgency?: string | null
        }
        Update: {
          address?: string | null
          address_confirmed?: boolean | null
          breakdown?: string | null
          call_id?: string
          caller_name?: string | null
          caller_phone?: string | null
          company_id?: string | null
          created_at?: string
          customer_id?: string | null
          email_sent_at?: string | null
          email_status?: string | null
          email_to?: string | null
          error?: string | null
          id?: string
          is_test?: boolean
          lead_id?: string | null
          lead_level?: string | null
          model?: string | null
          next_action?: string | null
          score?: number | null
          service_type?: string | null
          status?: string
          updated_at?: string
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_reports_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: true
            referencedRelation: "vapi_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_services: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          origin: string
          owner_company_id: string
          promoted_at: string | null
          promoted_by: string | null
          search_aliases: string[] | null
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          origin?: string
          owner_company_id: string
          promoted_at?: string | null
          promoted_by?: string | null
          search_aliases?: string[] | null
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          origin?: string
          owner_company_id?: string
          promoted_at?: string | null
          promoted_by?: string | null
          search_aliases?: string[] | null
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_services_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_services_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      catalogue_delete_audit: {
        Row: {
          action: string
          actor: string | null
          at: string
          id: number
          product_code: string | null
          product_id: string
          row_snapshot: Json
          supplier_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          at?: string
          id?: number
          product_code?: string | null
          product_id: string
          row_snapshot: Json
          supplier_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          at?: string
          id?: number
          product_code?: string | null
          product_id?: string
          row_snapshot?: Json
          supplier_id?: string | null
        }
        Relationships: []
      }
      cf_bank_accounts: {
        Row: {
          account_ref: string | null
          company_id: string
          created_at: string
          id: string
          include: boolean
          label: string
          sort: number
        }
        Insert: {
          account_ref?: string | null
          company_id: string
          created_at?: string
          id?: string
          include?: boolean
          label: string
          sort?: number
        }
        Update: {
          account_ref?: string | null
          company_id?: string
          created_at?: string
          id?: string
          include?: boolean
          label?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "cf_bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      cf_bank_balances: {
        Row: {
          account_id: string
          as_of: string
          balance: number
          company_id: string
          created_at: string
          entered_by: string | null
          id: string
        }
        Insert: {
          account_id: string
          as_of?: string
          balance: number
          company_id: string
          created_at?: string
          entered_by?: string | null
          id?: string
        }
        Update: {
          account_id?: string
          as_of?: string
          balance?: number
          company_id?: string
          created_at?: string
          entered_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cf_bank_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "cf_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_bank_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_bank_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      cf_commitments: {
        Row: {
          company_id: string
          created_at: string
          edited: boolean
          id: string
          invoice_id: string | null
          item: string
          job_id: string | null
          kind: string
          note: string | null
          pay_date: string | null
          project: string
          qty: number
          quote_id: string | null
          source_key: string | null
          status: string
          supplier: string | null
          unit_cost_excl: number
          updated_at: string
          vat_rate: number
        }
        Insert: {
          company_id: string
          created_at?: string
          edited?: boolean
          id?: string
          invoice_id?: string | null
          item: string
          job_id?: string | null
          kind?: string
          note?: string | null
          pay_date?: string | null
          project?: string
          qty?: number
          quote_id?: string | null
          source_key?: string | null
          status?: string
          supplier?: string | null
          unit_cost_excl?: number
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          edited?: boolean
          id?: string
          invoice_id?: string | null
          item?: string
          job_id?: string | null
          kind?: string
          note?: string | null
          pay_date?: string | null
          project?: string
          qty?: number
          quote_id?: string | null
          source_key?: string | null
          status?: string
          supplier?: string | null
          unit_cost_excl?: number
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "cf_commitments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_commitments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cf_commitments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_commitments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "cf_commitments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "cf_commitments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "cf_commitments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_commitments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "cf_commitments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      cf_overheads: {
        Row: {
          active: boolean
          amount: number
          category: string
          company_id: string
          created_at: string
          end_date: string | null
          frequency: string
          id: string
          name: string
          note: string | null
          pay_date: string | null
          pay_day: number | null
          sort: number
          start_date: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount?: number
          category?: string
          company_id: string
          created_at?: string
          end_date?: string | null
          frequency?: string
          id?: string
          name: string
          note?: string | null
          pay_date?: string | null
          pay_day?: number | null
          sort?: number
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string
          company_id?: string
          created_at?: string
          end_date?: string | null
          frequency?: string
          id?: string
          name?: string
          note?: string | null
          pay_date?: string | null
          pay_day?: number | null
          sort?: number
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cf_overheads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_overheads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      cf_receipts: {
        Row: {
          amount_incl: number
          client: string | null
          company_id: string
          conf_edited: boolean
          confidence: number
          created_at: string
          dates_edited: boolean
          expected_date: string | null
          id: string
          invoice_id: string | null
          leeway_days: number
          note: string | null
          part: string
          quote_id: string | null
          received_amount: number | null
          received_date: string | null
          ref: string
          source: string
          source_key: string | null
          status: string
          updated_at: string
          vat_incl: number
        }
        Insert: {
          amount_incl?: number
          client?: string | null
          company_id: string
          conf_edited?: boolean
          confidence?: number
          created_at?: string
          dates_edited?: boolean
          expected_date?: string | null
          id?: string
          invoice_id?: string | null
          leeway_days?: number
          note?: string | null
          part?: string
          quote_id?: string | null
          received_amount?: number | null
          received_date?: string | null
          ref?: string
          source?: string
          source_key?: string | null
          status?: string
          updated_at?: string
          vat_incl?: number
        }
        Update: {
          amount_incl?: number
          client?: string | null
          company_id?: string
          conf_edited?: boolean
          confidence?: number
          created_at?: string
          dates_edited?: boolean
          expected_date?: string | null
          id?: string
          invoice_id?: string | null
          leeway_days?: number
          note?: string | null
          part?: string
          quote_id?: string | null
          received_amount?: number | null
          received_date?: string | null
          ref?: string
          source?: string
          source_key?: string | null
          status?: string
          updated_at?: string
          vat_incl?: number
        }
        Relationships: [
          {
            foreignKeyName: "cf_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cf_receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "cf_receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "cf_receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "cf_receipts_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "cf_receipts_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      cf_settings: {
        Row: {
          buffer_amount: number
          buffer_mode: string
          company_id: string
          conf_draft: number
          conf_final_before_install: number
          conf_overdue: number
          conf_sent: number
          default_leeway_days: number
          enabled: boolean
          forecast_start: string | null
          unit_cost_factor: number
          updated_at: string
          vat_basis: string
          vat_due_day: number
          vat_number: string | null
          vat_period_end: string | null
          vat_period_months: number
          vat_rate: number
        }
        Insert: {
          buffer_amount?: number
          buffer_mode?: string
          company_id: string
          conf_draft?: number
          conf_final_before_install?: number
          conf_overdue?: number
          conf_sent?: number
          default_leeway_days?: number
          enabled?: boolean
          forecast_start?: string | null
          unit_cost_factor?: number
          updated_at?: string
          vat_basis?: string
          vat_due_day?: number
          vat_number?: string | null
          vat_period_end?: string | null
          vat_period_months?: number
          vat_rate?: number
        }
        Update: {
          buffer_amount?: number
          buffer_mode?: string
          company_id?: string
          conf_draft?: number
          conf_final_before_install?: number
          conf_overdue?: number
          conf_sent?: number
          default_leeway_days?: number
          enabled?: boolean
          forecast_start?: string | null
          unit_cost_factor?: number
          updated_at?: string
          vat_basis?: string
          vat_due_day?: number
          vat_number?: string | null
          vat_period_end?: string | null
          vat_period_months?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "cf_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      cf_stock_allocations: {
        Row: {
          commitment_id: string
          company_id: string
          created_at: string
          created_by: string | null
          drawn_at: string | null
          id: string
          qty: number
          stock_item_id: string
        }
        Insert: {
          commitment_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          drawn_at?: string | null
          id?: string
          qty: number
          stock_item_id: string
        }
        Update: {
          commitment_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          drawn_at?: string | null
          id?: string
          qty?: number
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cf_stock_allocations_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "cf_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_stock_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_stock_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cf_stock_allocations_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "cf_stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      cf_stock_items: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          item: string
          last_counted_at: string | null
          location: string | null
          model_code: string | null
          qty_on_hand: number
          unit_cost_excl: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          id?: string
          item: string
          last_counted_at?: string | null
          location?: string | null
          model_code?: string | null
          qty_on_hand?: number
          unit_cost_excl?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          item?: string
          last_counted_at?: string | null
          location?: string | null
          model_code?: string | null
          qty_on_hand?: number
          unit_cost_excl?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cf_stock_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cf_stock_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
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
      client_contacts: {
        Row: {
          client_id: string
          company_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_primary: boolean
          name: string
          notes: string | null
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      client_sites: {
        Row: {
          address: string | null
          client_id: string
          company_id: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          address?: string | null
          client_id: string
          company_id?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
        }
        Update: {
          address?: string | null
          client_id?: string
          company_id?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
          accounts_email: string | null
          billing_live: boolean
          contract_ends_at: string | null
          contract_signed_at: string | null
          contract_signed_by: string | null
          created_at: string
          custom_service_limit: number
          default_rate: number | null
          gp_target_percent: number
          id: string
          install_handoff_default: string
          is_master: boolean
          labour_cost_per_hour: number | null
          labour_tech_share_percent: number
          logo_url: string | null
          mandy_enabled: boolean
          materials_markup_percent: number
          materials_waste_percent: number
          name: string
          office_address: string | null
          office_lat: number | null
          office_lng: number | null
          onboarding_completed: boolean | null
          plan_base_price_zar: number
          plan_code: string
          plan_contract_months: number
          plan_extra_user_price_zar: number
          plan_grace_until: string | null
          plan_included_users: number
          plan_status: string
          sales_commission_percent: number
          services: string[] | null
          slug: string
          status: string
          tech_holdback_days: number
          tech_holdback_pct: number
          tech_paid_on_completion_pct: number
          tech_split_mode: string
          tools_retained_pct: number
          units_markup_percent: number
          updated_at: string | null
          vat_rate: number | null
          work_days: number[]
          work_end: string
          work_start: string
        }
        Insert: {
          accounts_email?: string | null
          billing_live?: boolean
          contract_ends_at?: string | null
          contract_signed_at?: string | null
          contract_signed_by?: string | null
          created_at?: string
          custom_service_limit?: number
          default_rate?: number | null
          gp_target_percent?: number
          id?: string
          install_handoff_default?: string
          is_master?: boolean
          labour_cost_per_hour?: number | null
          labour_tech_share_percent?: number
          logo_url?: string | null
          mandy_enabled?: boolean
          materials_markup_percent?: number
          materials_waste_percent?: number
          name: string
          office_address?: string | null
          office_lat?: number | null
          office_lng?: number | null
          onboarding_completed?: boolean | null
          plan_base_price_zar?: number
          plan_code?: string
          plan_contract_months?: number
          plan_extra_user_price_zar?: number
          plan_grace_until?: string | null
          plan_included_users?: number
          plan_status?: string
          sales_commission_percent?: number
          services?: string[] | null
          slug?: string
          status?: string
          tech_holdback_days?: number
          tech_holdback_pct?: number
          tech_paid_on_completion_pct?: number
          tech_split_mode?: string
          tools_retained_pct?: number
          units_markup_percent?: number
          updated_at?: string | null
          vat_rate?: number | null
          work_days?: number[]
          work_end?: string
          work_start?: string
        }
        Update: {
          accounts_email?: string | null
          billing_live?: boolean
          contract_ends_at?: string | null
          contract_signed_at?: string | null
          contract_signed_by?: string | null
          created_at?: string
          custom_service_limit?: number
          default_rate?: number | null
          gp_target_percent?: number
          id?: string
          install_handoff_default?: string
          is_master?: boolean
          labour_cost_per_hour?: number | null
          labour_tech_share_percent?: number
          logo_url?: string | null
          mandy_enabled?: boolean
          materials_markup_percent?: number
          materials_waste_percent?: number
          name?: string
          office_address?: string | null
          office_lat?: number | null
          office_lng?: number | null
          onboarding_completed?: boolean | null
          plan_base_price_zar?: number
          plan_code?: string
          plan_contract_months?: number
          plan_extra_user_price_zar?: number
          plan_grace_until?: string | null
          plan_included_users?: number
          plan_status?: string
          sales_commission_percent?: number
          services?: string[] | null
          slug?: string
          status?: string
          tech_holdback_days?: number
          tech_holdback_pct?: number
          tech_paid_on_completion_pct?: number
          tech_split_mode?: string
          tools_retained_pct?: number
          units_markup_percent?: number
          updated_at?: string | null
          vat_rate?: number | null
          work_days?: number[]
          work_end?: string
          work_start?: string
        }
        Relationships: []
      }
      company_assistant_config: {
        Row: {
          bot_name: string
          company_id: string
          updated_at: string
          updated_by: string | null
          voice_id: string
        }
        Insert: {
          bot_name?: string
          company_id: string
          updated_at?: string
          updated_by?: string | null
          voice_id?: string
        }
        Update: {
          bot_name?: string
          company_id?: string
          updated_at?: string
          updated_by?: string | null
          voice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_assistant_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_assistant_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_contracts: {
        Row: {
          accepted_at: string
          accepted_by: string
          base_price_zar: number
          company_id: string
          contract_version: string
          ends_on: string
          extra_user_price_zar: number
          id: string
          included_users: number
          months: number
          signer_name: string
          starts_on: string
          user_agent: string | null
        }
        Insert: {
          accepted_at?: string
          accepted_by: string
          base_price_zar: number
          company_id: string
          contract_version: string
          ends_on: string
          extra_user_price_zar: number
          id?: string
          included_users: number
          months: number
          signer_name: string
          starts_on: string
          user_agent?: string | null
        }
        Update: {
          accepted_at?: string
          accepted_by?: string
          base_price_zar?: number
          company_id?: string
          contract_version?: string
          ends_on?: string
          extra_user_price_zar?: number
          id?: string
          included_users?: number
          months?: number
          signer_name?: string
          starts_on?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
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
          is_owner: boolean
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_owner?: boolean
          role?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_owner?: boolean
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
      company_network_members: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          master_company_id: string
          member_company_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          master_company_id: string
          member_company_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          master_company_id?: string
          member_company_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_network_members_master_company_id_fkey"
            columns: ["master_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_network_members_master_company_id_fkey"
            columns: ["master_company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_network_members_member_company_id_fkey"
            columns: ["member_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_network_members_member_company_id_fkey"
            columns: ["member_company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          account_name: string | null
          account_number: string | null
          account_type: string | null
          address_lines: string[]
          archived_at: string | null
          bank_name: string | null
          branch_code: string | null
          company_id: string
          created_at: string
          document_style: string
          email: string | null
          id: string
          invoice_prefix: string
          is_default: boolean
          legal_name: string
          logo_url: string | null
          next_invoice_no: number
          number_pad: number
          phone: string | null
          terms_text: string | null
          trading_name: string | null
          updated_at: string
          use_shared_sequence: boolean
          vat_number: string | null
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          account_type?: string | null
          address_lines?: string[]
          archived_at?: string | null
          bank_name?: string | null
          branch_code?: string | null
          company_id: string
          created_at?: string
          document_style?: string
          email?: string | null
          id?: string
          invoice_prefix?: string
          is_default?: boolean
          legal_name: string
          logo_url?: string | null
          next_invoice_no?: number
          number_pad?: number
          phone?: string | null
          terms_text?: string | null
          trading_name?: string | null
          updated_at?: string
          use_shared_sequence?: boolean
          vat_number?: string | null
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          account_type?: string | null
          address_lines?: string[]
          archived_at?: string | null
          bank_name?: string | null
          branch_code?: string | null
          company_id?: string
          created_at?: string
          document_style?: string
          email?: string | null
          id?: string
          invoice_prefix?: string
          is_default?: boolean
          legal_name?: string
          logo_url?: string | null
          next_invoice_no?: number
          number_pad?: number
          phone?: string | null
          terms_text?: string | null
          trading_name?: string | null
          updated_at?: string
          use_shared_sequence?: boolean
          vat_number?: string | null
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
          company_id: string | null
          company_name: string
          created_at: string
          dashboard_goals: Json | null
          default_deposit_percentage: number | null
          default_hourly_rate: number | null
          default_install_labour_hours: number
          default_payment_terms_days: number | null
          id: string
          invoice_auto_send_minutes: number
          is_primary: boolean
          logo_storage_path: string | null
          payfast_merchant_id: string | null
          payfast_merchant_key: string | null
          physical_address: string | null
          postal_address: string | null
          sales_stage_limits: Json | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          banking_details?: Json | null
          company_id?: string | null
          company_name?: string
          created_at?: string
          dashboard_goals?: Json | null
          default_deposit_percentage?: number | null
          default_hourly_rate?: number | null
          default_install_labour_hours?: number
          default_payment_terms_days?: number | null
          id?: string
          invoice_auto_send_minutes?: number
          is_primary?: boolean
          logo_storage_path?: string | null
          payfast_merchant_id?: string | null
          payfast_merchant_key?: string | null
          physical_address?: string | null
          postal_address?: string | null
          sales_stage_limits?: Json | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          banking_details?: Json | null
          company_id?: string | null
          company_name?: string
          created_at?: string
          dashboard_goals?: Json | null
          default_deposit_percentage?: number | null
          default_hourly_rate?: number | null
          default_install_labour_hours?: number
          default_payment_terms_days?: number | null
          id?: string
          invoice_auto_send_minutes?: number
          is_primary?: boolean
          logo_storage_path?: string | null
          payfast_merchant_id?: string | null
          payfast_merchant_key?: string | null
          physical_address?: string | null
          postal_address?: string | null
          sales_stage_limits?: Json | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_terms: {
        Row: {
          company_id: string
          relocation_clause: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          relocation_clause: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          relocation_clause?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_terms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_terms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_number: string
          customer_id: string | null
          description: string | null
          id: string
          invoice_id: string
          issue_date: string
          reason: string
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          credit_note_number: string
          customer_id?: string | null
          description?: string | null
          id?: string
          invoice_id: string
          issue_date?: string
          reason: string
          status?: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          credit_note_number?: string
          customer_id?: string | null
          description?: string | null
          id?: string
          invoice_id?: string
          issue_date?: string
          reason?: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
          },
        ]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
      customer_notes: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          author_id: string
          body: string
          company_id: string
          created_at: string
          customer_id: string
          id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          author_id?: string
          body: string
          company_id: string
          created_at?: string
          customer_id: string
          id?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          author_id?: string
          body?: string
          company_id?: string
          created_at?: string
          customer_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
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
          assigned_rep_id: string | null
          city: string | null
          client_type: string | null
          company_id: string | null
          company_name: string | null
          created_at: string
          created_by: string | null
          data_consent: boolean | null
          data_consent_date: string | null
          email: string | null
          email_verified: boolean | null
          final_after_days: number | null
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
          owner_rep_id: string | null
          owner_rep_set_at: string | null
          owner_rep_source: string | null
          payment_terms_basis: string | null
          payment_terms_days: number | null
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
          assigned_rep_id?: string | null
          city?: string | null
          client_type?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          data_consent?: boolean | null
          data_consent_date?: string | null
          email?: string | null
          email_verified?: boolean | null
          final_after_days?: number | null
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
          owner_rep_id?: string | null
          owner_rep_set_at?: string | null
          owner_rep_source?: string | null
          payment_terms_basis?: string | null
          payment_terms_days?: number | null
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
          assigned_rep_id?: string | null
          city?: string | null
          client_type?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          data_consent?: boolean | null
          data_consent_date?: string | null
          email?: string | null
          email_verified?: boolean | null
          final_after_days?: number | null
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
          owner_rep_id?: string | null
          owner_rep_set_at?: string | null
          owner_rep_source?: string | null
          payment_terms_basis?: string | null
          payment_terms_days?: number | null
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
            foreignKeyName: "customers_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          claimed_at: string | null
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
          claimed_at?: string | null
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
          claimed_at?: string | null
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
      expenses: {
        Row: {
          amount_excl: number
          amount_incl: number
          archived_at: string | null
          archived_by: string | null
          category: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          expense_date: string
          id: string
          job_id: string | null
          payment_method: string | null
          receipt_path: string | null
          reference: string | null
          source: string
          source_id: string | null
          status: string
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string
          vat_amount: number
          vat_claimable: boolean
          vat_rate: number
        }
        Insert: {
          amount_excl?: number
          amount_incl: number
          archived_at?: string | null
          archived_by?: string | null
          category?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          job_id?: string | null
          payment_method?: string | null
          receipt_path?: string | null
          reference?: string | null
          source?: string
          source_id?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
          vat_amount?: number
          vat_claimable?: boolean
          vat_rate?: number
        }
        Update: {
          amount_excl?: number
          amount_incl?: number
          archived_at?: string | null
          archived_by?: string | null
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          job_id?: string | null
          payment_method?: string | null
          receipt_path?: string | null
          reference?: string | null
          source?: string
          source_id?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
          vat_amount?: number
          vat_claimable?: boolean
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
      install_template_items: {
        Row: {
          bundle_id: string | null
          created_at: string
          default_length_m: number | null
          default_qty: number
          id: string
          included: boolean
          product_code: string | null
          role: string
          sort_order: number
          template_id: string
          updated_at: string
        }
        Insert: {
          bundle_id?: string | null
          created_at?: string
          default_length_m?: number | null
          default_qty?: number
          id?: string
          included?: boolean
          product_code?: string | null
          role: string
          sort_order?: number
          template_id: string
          updated_at?: string
        }
        Update: {
          bundle_id?: string | null
          created_at?: string
          default_length_m?: number | null
          default_qty?: number
          id?: string
          included?: boolean
          product_code?: string | null
          role?: string
          sort_order?: number
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "install_template_items_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "installation_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "install_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "install_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      install_templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          max_btu: number
          min_btu: number
          name: string
          sort_order: number
          unit_kind: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_btu: number
          min_btu: number
          name: string
          sort_order?: number
          unit_kind?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_btu?: number
          min_btu?: number
          name?: string
          sort_order?: number
          unit_kind?: string | null
          updated_at?: string
        }
        Relationships: []
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
      internal_skus: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          family: string
          id: string
          is_active: boolean
          name: string
          size_code: string | null
          sku_code: string
          type_code: string | null
          unit: string
          updated_at: string
          variant: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          family: string
          id?: string
          is_active?: boolean
          name: string
          size_code?: string | null
          sku_code: string
          type_code?: string | null
          unit?: string
          updated_at?: string
          variant?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          family?: string
          id?: string
          is_active?: boolean
          name?: string
          size_code?: string | null
          sku_code?: string
          type_code?: string | null
          unit?: string
          updated_at?: string
          variant?: string | null
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_name: string | null
          line_type: string
          product_id: string | null
          quantity: number
          room_label: string | null
          service_id: string | null
          sort_order: number
          unit_price: number
          vat_amount: number | null
          vat_rate: number
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_name?: string | null
          line_type?: string
          product_id?: string | null
          quantity?: number
          room_label?: string | null
          service_id?: string | null
          sort_order?: number
          unit_price?: number
          vat_amount?: number | null
          vat_rate?: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_name?: string | null
          line_type?: string
          product_id?: string | null
          quantity?: number
          room_label?: string | null
          service_id?: string | null
          sort_order?: number
          unit_price?: number
          vat_amount?: number | null
          vat_rate?: number
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
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
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "live_supplier_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          as_quoted: boolean
          company_id: string
          created_at: string
          customer_name: string | null
          extra_hours: number | null
          extra_items: Json
          finished_at: string | null
          id: string
          invoice_id: string | null
          job_id: string | null
          lead_id: string
          note: string | null
          quote_id: string | null
          started_at: string | null
          status: string
          technician_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          as_quoted?: boolean
          company_id: string
          created_at?: string
          customer_name?: string | null
          extra_hours?: number | null
          extra_items?: Json
          finished_at?: string | null
          id?: string
          invoice_id?: string | null
          job_id?: string | null
          lead_id: string
          note?: string | null
          quote_id?: string | null
          started_at?: string | null
          status?: string
          technician_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          as_quoted?: boolean
          company_id?: string
          created_at?: string
          customer_name?: string | null
          extra_hours?: number | null
          extra_items?: Json
          finished_at?: string | null
          id?: string
          invoice_id?: string | null
          job_id?: string | null
          lead_id?: string
          note?: string | null
          quote_id?: string | null
          started_at?: string | null
          status?: string
          technician_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "invoice_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_send_approvals: {
        Row: {
          attempts: number
          client_name: string | null
          company_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          deposit_amount: number | null
          due_at: string | null
          hold_reason: string | null
          id: string
          invoice_id: string
          invoice_number: string | null
          last_error: string | null
          quote_id: string | null
          quote_number: string | null
          rep_id: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          client_name?: string | null
          company_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          deposit_amount?: number | null
          due_at?: string | null
          hold_reason?: string | null
          id?: string
          invoice_id: string
          invoice_number?: string | null
          last_error?: string | null
          quote_id?: string | null
          quote_number?: string | null
          rep_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          client_name?: string | null
          company_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          deposit_amount?: number | null
          due_at?: string | null
          hold_reason?: string | null
          id?: string
          invoice_id?: string
          invoice_number?: string | null
          last_error?: string | null
          quote_id?: string | null
          quote_number?: string | null
          rep_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_send_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_send_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_send_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_send_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      invoice_send_events: {
        Row: {
          action: string
          actor_id: string | null
          approval_id: string | null
          created_at: string
          id: number
          invoice_id: string
          note: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          approval_id?: string | null
          created_at?: string
          id?: number
          invoice_id: string
          note?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          approval_id?: string | null
          created_at?: string
          id?: number
          invoice_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_send_events_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "invoice_send_approvals"
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
          final_sent_at: string | null
          final_sent_by: string | null
          final_sent_channel: string | null
          agent_id: string
          archived_at: string | null
          billed_to_vat_number: string | null
          company_id: string | null
          company_profile_id: string | null
          created_at: string
          customer_address: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          deposit_amount: number | null
          deposit_type: string | null
          deposit_value: number | null
          discount_amount: number
          discount_type: string | null
          discount_value: number | null
          due_date: string | null
          duplicated_from: string | null
          equipment_id: string | null
          expected_deposit_date: string | null
          expected_final_date: string | null
          final_after_days: number | null
          final_unscheduled: boolean
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
          payment_terms_basis: string | null
          payment_terms_days: number | null
          pdf_url: string | null
          profile_snapshot: Json | null
          project_house_id: string | null
          quote_id: string | null
          sent_at: string | null
          sent_by: string | null
          sent_channel: string | null
          sent_method: string | null
          sent_note: string | null
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          final_sent_at?: string | null
          final_sent_by?: string | null
          final_sent_channel?: string | null
          agent_id: string
          archived_at?: string | null
          billed_to_vat_number?: string | null
          company_id?: string | null
          company_profile_id?: string | null
          created_at?: string
          customer_address?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          deposit_amount?: number | null
          deposit_type?: string | null
          deposit_value?: number | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number | null
          due_date?: string | null
          duplicated_from?: string | null
          equipment_id?: string | null
          expected_deposit_date?: string | null
          expected_final_date?: string | null
          final_after_days?: number | null
          final_unscheduled?: boolean
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
          payment_terms_basis?: string | null
          payment_terms_days?: number | null
          pdf_url?: string | null
          profile_snapshot?: Json | null
          project_house_id?: string | null
          quote_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_channel?: string | null
          sent_method?: string | null
          sent_note?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          final_sent_at?: string | null
          final_sent_by?: string | null
          final_sent_channel?: string | null
          agent_id?: string
          archived_at?: string | null
          billed_to_vat_number?: string | null
          company_id?: string | null
          company_profile_id?: string | null
          created_at?: string
          customer_address?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          deposit_amount?: number | null
          deposit_type?: string | null
          deposit_value?: number | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number | null
          due_date?: string | null
          duplicated_from?: string | null
          equipment_id?: string | null
          expected_deposit_date?: string | null
          expected_final_date?: string | null
          final_after_days?: number | null
          final_unscheduled?: boolean
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
          payment_terms_basis?: string | null
          payment_terms_days?: number | null
          pdf_url?: string | null
          profile_snapshot?: Json | null
          project_house_id?: string | null
          quote_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_channel?: string | null
          sent_method?: string | null
          sent_note?: string | null
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
            foreignKeyName: "invoices_company_profile_id_fkey"
            columns: ["company_profile_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_duplicated_from_fkey"
            columns: ["duplicated_from"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_duplicated_from_fkey"
            columns: ["duplicated_from"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoices_duplicated_from_fkey"
            columns: ["duplicated_from"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoices_duplicated_from_fkey"
            columns: ["duplicated_from"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
            foreignKeyName: "invoices_project_house_id_fkey"
            columns: ["project_house_id"]
            isOneToOne: false
            referencedRelation: "project_houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
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
      job_alerts: {
        Row: {
          company_id: string
          created_at: string
          id: string
          job_id: string
          message: string
          profile_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          rule: string
          severity: string
          work_date: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          job_id: string
          message: string
          profile_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rule: string
          severity?: string
          work_date?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          job_id?: string
          message?: string
          profile_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rule?: string
          severity?: string
          work_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_alerts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_client_messages: {
        Row: {
          alert_id: string | null
          approved_at: string | null
          approved_by: string | null
          body: string
          channel: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          job_id: string
          net_request_id: number | null
          sent_via: string | null
          status: string
          subject: string | null
          to_address: string | null
        }
        Insert: {
          alert_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          body: string
          channel: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          job_id: string
          net_request_id?: number | null
          sent_via?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
        }
        Update: {
          alert_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          channel?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string
          net_request_id?: number | null
          sent_via?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_client_messages_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "job_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_client_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_client_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "job_client_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_completions: {
        Row: {
          after_photo_count: number | null
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
          tech_signature_data_url: string | null
          tech_signoff_at: string | null
          tech_signoff_name: string | null
          technician_id: string
          updated_at: string
          work_summary: string | null
        }
        Insert: {
          after_photo_count?: number | null
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
          tech_signature_data_url?: string | null
          tech_signoff_at?: string | null
          tech_signoff_name?: string | null
          technician_id: string
          updated_at?: string
          work_summary?: string | null
        }
        Update: {
          after_photo_count?: number | null
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
          tech_signature_data_url?: string | null
          tech_signoff_at?: string | null
          tech_signoff_name?: string | null
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "job_expenses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      job_overruns: {
        Row: {
          actual_hours: number | null
          created_at: string
          created_by: string
          extra_items: Json
          id: string
          job_id: string | null
          lead_id: string | null
          notes: string | null
          quote_id: string | null
        }
        Insert: {
          actual_hours?: number | null
          created_at?: string
          created_by?: string
          extra_items?: Json
          id?: string
          job_id?: string | null
          lead_id?: string | null
          notes?: string | null
          quote_id?: string | null
        }
        Update: {
          actual_hours?: number | null
          created_at?: string
          created_by?: string
          extra_items?: Json
          id?: string
          job_id?: string | null
          lead_id?: string | null
          notes?: string | null
          quote_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_overruns_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_overruns_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "job_overruns_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_overruns_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "job_overruns_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_photos: {
        Row: {
          annotated_path: string | null
          annotation: Json | null
          caption: string | null
          client_visible: boolean
          created_at: string
          id: string
          lead_id: string
          photo_type: string | null
          storage_path: string
          synced_from_offline: boolean | null
          uploaded_by: string | null
        }
        Insert: {
          annotated_path?: string | null
          annotation?: Json | null
          caption?: string | null
          client_visible?: boolean
          created_at?: string
          id?: string
          lead_id: string
          photo_type?: string | null
          storage_path: string
          synced_from_offline?: boolean | null
          uploaded_by?: string | null
        }
        Update: {
          annotated_path?: string | null
          annotation?: Json | null
          caption?: string | null
          client_visible?: boolean
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
      job_rule_rollouts: {
        Row: {
          effective_at: string
          rule: string
        }
        Insert: {
          effective_at?: string
          rule: string
        }
        Update: {
          effective_at?: string
          rule?: string
        }
        Relationships: []
      }
      job_schedules: {
        Row: {
          agent_id: string | null
          created_at: string
          day_count: number | null
          day_index: number | null
          end_time: string
          id: string
          job_id: string | null
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
          agent_id?: string | null
          created_at?: string
          day_count?: number | null
          day_index?: number | null
          end_time: string
          id?: string
          job_id?: string | null
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
          agent_id?: string | null
          created_at?: string
          day_count?: number | null
          day_index?: number | null
          end_time?: string
          id?: string
          job_id?: string | null
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
            foreignKeyName: "job_schedules_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_schedules_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "job_schedules_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      job_site_checks: {
        Row: {
          checklist: Json
          company_id: string | null
          created_at: string
          id: string
          job_id: string
          notes: string | null
          quote_id: string | null
          result: string
          source: string
          tech_id: string | null
          variation_quote_id: string | null
        }
        Insert: {
          checklist?: Json
          company_id?: string | null
          created_at?: string
          id?: string
          job_id: string
          notes?: string | null
          quote_id?: string | null
          result: string
          source?: string
          tech_id?: string | null
          variation_quote_id?: string | null
        }
        Update: {
          checklist?: Json
          company_id?: string | null
          created_at?: string
          id?: string
          job_id?: string
          notes?: string | null
          quote_id?: string | null
          result?: string
          source?: string
          tech_id?: string | null
          variation_quote_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_site_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_site_checks_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "job_site_checks_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_site_checks_variation_quote_id_fkey"
            columns: ["variation_quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "job_site_checks_variation_quote_id_fkey"
            columns: ["variation_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_time_entries: {
        Row: {
          after_photo_count: number | null
          agent_id: string
          checked_in_at: string | null
          checked_out_at: string | null
          client_name: string | null
          client_signature_data_url: string | null
          created_at: string
          en_route_at: string | null
          end_time: string
          hours_auto: number | null
          hours_edit_note: string | null
          hours_onsite: number | null
          hours_worked: number | null
          id: string
          is_billable: boolean
          job_id: string | null
          lead_id: string
          notes: string | null
          schedule_id: string | null
          signed_off_at: string | null
          signed_off_by: string | null
          signed_off_name: string | null
          start_time: string
          tech_signature_data_url: string | null
          travel_hours: number
          work_date: string
        }
        Insert: {
          after_photo_count?: number | null
          agent_id: string
          checked_in_at?: string | null
          checked_out_at?: string | null
          client_name?: string | null
          client_signature_data_url?: string | null
          created_at?: string
          en_route_at?: string | null
          end_time: string
          hours_auto?: number | null
          hours_edit_note?: string | null
          hours_onsite?: number | null
          hours_worked?: number | null
          id?: string
          is_billable?: boolean
          job_id?: string | null
          lead_id: string
          notes?: string | null
          schedule_id?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          signed_off_name?: string | null
          start_time: string
          tech_signature_data_url?: string | null
          travel_hours?: number
          work_date?: string
        }
        Update: {
          after_photo_count?: number | null
          agent_id?: string
          checked_in_at?: string | null
          checked_out_at?: string | null
          client_name?: string | null
          client_signature_data_url?: string | null
          created_at?: string
          en_route_at?: string | null
          end_time?: string
          hours_auto?: number | null
          hours_edit_note?: string | null
          hours_onsite?: number | null
          hours_worked?: number | null
          id?: string
          is_billable?: boolean
          job_id?: string | null
          lead_id?: string
          notes?: string | null
          schedule_id?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          signed_off_name?: string | null
          start_time?: string
          tech_signature_data_url?: string | null
          travel_hours?: number
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_time_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_time_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "job_time_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_time_entries_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "job_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_time_entries_signed_off_by_fkey"
            columns: ["signed_off_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
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
            referencedRelation: "live_supplier_products"
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
      job_variations: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          id: string
          items: Json
          job_id: string
          needs_pricing: boolean
          original_quote_id: string | null
          site_check_id: string | null
          source: string
          status: string
          unit_swaps: Json
          variation_quote_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          items?: Json
          job_id: string
          needs_pricing?: boolean
          original_quote_id?: string | null
          site_check_id?: string | null
          source?: string
          status?: string
          unit_swaps?: Json
          variation_quote_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          items?: Json
          job_id?: string
          needs_pricing?: boolean
          original_quote_id?: string | null
          site_check_id?: string | null
          source?: string
          status?: string
          unit_swaps?: Json
          variation_quote_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_variations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_variations_original_quote_id_fkey"
            columns: ["original_quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "job_variations_original_quote_id_fkey"
            columns: ["original_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_variations_site_check_id_fkey"
            columns: ["site_check_id"]
            isOneToOne: false
            referencedRelation: "job_site_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_variations_variation_quote_id_fkey"
            columns: ["variation_quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "job_variations_variation_quote_id_fkey"
            columns: ["variation_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_watch_settings: {
        Row: {
          company_id: string
          en_route_buffer_minutes: number
          en_route_fallback_minutes: number
          en_route_floor_minutes: number
          late_checkin_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          en_route_buffer_minutes?: number
          en_route_fallback_minutes?: number
          en_route_floor_minutes?: number
          late_checkin_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          en_route_buffer_minutes?: number
          en_route_fallback_minutes?: number
          en_route_floor_minutes?: number
          late_checkin_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_watch_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_watch_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      jobs: {
        Row: {
          address: string | null
          awaiting_stock: boolean
          company_id: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          description: string | null
          en_route_at: string | null
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
          scheduled_until: string | null
          site_check_status: string | null
          started_at: string | null
          status: string | null
          title: string
          updated_at: string | null
          variation_quote_id: string | null
        }
        Insert: {
          address?: string | null
          awaiting_stock?: boolean
          company_id: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          en_route_at?: string | null
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
          scheduled_until?: string | null
          site_check_status?: string | null
          started_at?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
          variation_quote_id?: string | null
        }
        Update: {
          address?: string | null
          awaiting_stock?: boolean
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          en_route_at?: string | null
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
          scheduled_until?: string | null
          site_check_status?: string | null
          started_at?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
          variation_quote_id?: string | null
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "jobs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_variation_quote_id_fkey"
            columns: ["variation_quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "jobs_variation_quote_id_fkey"
            columns: ["variation_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_norms: {
        Row: {
          hours: number
          id: string
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          hours: number
          id?: string
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          hours?: number
          id?: string
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      lead_assignment_log: {
        Row: {
          assigned_by: string
          by_role: string
          company_id: string
          created_at: string
          end_time: string | null
          id: string
          lead_id: string
          previous_agent_id: string | null
          scheduled_date: string | null
          start_time: string | null
          tech_id: string
        }
        Insert: {
          assigned_by: string
          by_role: string
          company_id: string
          created_at?: string
          end_time?: string | null
          id?: string
          lead_id: string
          previous_agent_id?: string | null
          scheduled_date?: string | null
          start_time?: string | null
          tech_id: string
        }
        Update: {
          assigned_by?: string
          by_role?: string
          company_id?: string
          created_at?: string
          end_time?: string | null
          id?: string
          lead_id?: string
          previous_agent_id?: string | null
          scheduled_date?: string | null
          start_time?: string | null
          tech_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignment_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_assignment_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_call_attempts: {
        Row: {
          company_id: string
          created_at: string
          digits: string | null
          dry_run: boolean
          id: string
          km: number | null
          lead_id: string
          minutes: number | null
          person_name: string | null
          phone: string | null
          position: number
          profile_id: string | null
          reason: string | null
          slot_date: string | null
          slot_start: string | null
          status: string
          twilio_call_sid: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          digits?: string | null
          dry_run?: boolean
          id?: string
          km?: number | null
          lead_id: string
          minutes?: number | null
          person_name?: string | null
          phone?: string | null
          position?: number
          profile_id?: string | null
          reason?: string | null
          slot_date?: string | null
          slot_start?: string | null
          status?: string
          twilio_call_sid?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          digits?: string | null
          dry_run?: boolean
          id?: string
          km?: number | null
          lead_id?: string
          minutes?: number | null
          person_name?: string | null
          phone?: string | null
          position?: number
          profile_id?: string | null
          reason?: string | null
          slot_date?: string | null
          slot_start?: string | null
          status?: string
          twilio_call_sid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_call_attempts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_call_attempts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_call_settings: {
        Row: {
          allowlist: string[]
          call_days: number[]
          call_end: string
          call_start: string
          company_id: string
          enabled: boolean
          from_number: string | null
          max_people: number
          mode: string
          ring_seconds: number
          test_only: boolean
          updated_at: string
        }
        Insert: {
          allowlist?: string[]
          call_days?: number[]
          call_end?: string
          call_start?: string
          company_id: string
          enabled?: boolean
          from_number?: string | null
          max_people?: number
          mode?: string
          ring_seconds?: number
          test_only?: boolean
          updated_at?: string
        }
        Update: {
          allowlist?: string[]
          call_days?: number[]
          call_end?: string
          call_start?: string
          company_id?: string
          enabled?: boolean
          from_number?: string | null
          max_people?: number
          mode?: string
          ring_seconds?: number
          test_only?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_call_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_call_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_change_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_reassign_requests: {
        Row: {
          company_id: string
          created_at: string
          id: string
          lead_id: string
          preferred_tech_id: string | null
          reason: string | null
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          lead_id: string
          preferred_tech_id?: string | null
          reason?: string | null
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          preferred_tech_id?: string | null
          reason?: string | null
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_reassign_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_reassign_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_routing_log: {
        Row: {
          area_id: string | null
          created_at: string
          decided_by: string | null
          from_company: string | null
          id: string
          km: number | null
          lead_id: string
          mode: string
          reason: string | null
          to_company: string | null
        }
        Insert: {
          area_id?: string | null
          created_at?: string
          decided_by?: string | null
          from_company?: string | null
          id?: string
          km?: number | null
          lead_id: string
          mode: string
          reason?: string | null
          to_company?: string | null
        }
        Update: {
          area_id?: string | null
          created_at?: string
          decided_by?: string | null
          from_company?: string | null
          id?: string
          km?: number | null
          lead_id?: string
          mode?: string
          reason?: string | null
          to_company?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_routing_log_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_routing_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "lead_routing_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sla_settings: {
        Row: {
          close_time: string
          company_id: string
          contact_minutes: number
          enabled: boolean
          live_from: string
          open_time: string
          quote_amber_time: string
          updated_at: string
          updated_by: string | null
          work_days: number[]
        }
        Insert: {
          close_time?: string
          company_id: string
          contact_minutes?: number
          enabled?: boolean
          live_from?: string
          open_time?: string
          quote_amber_time?: string
          updated_at?: string
          updated_by?: string | null
          work_days?: number[]
        }
        Update: {
          close_time?: string
          company_id?: string
          contact_minutes?: number
          enabled?: boolean
          live_from?: string
          open_time?: string
          quote_amber_time?: string
          updated_at?: string
          updated_by?: string | null
          work_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "lead_sla_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_sla_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      leads: {
        Row: {
          accepted_at: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          actual_start_time: string | null
          agreement_id: string | null
          assigned_agent_id: string | null
          assignment_method: string | null
          assignment_score: number | null
          broadcast_radius_km: number | null
          call_area: string | null
          call_next_action: string | null
          call_summary: string | null
          call_summary_at: string | null
          call_summary_model: string | null
          call_urgency: string | null
          cancellation_reason: string | null
          classified_by: Database["public"]["Enums"]["lead_classifier"] | null
          close_note: string | null
          close_outcome: string | null
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string | null
          company_name: string | null
          completed_at: string | null
          confidence: number | null
          contact_attempts: number
          converted_at: string | null
          created_at: string | null
          created_by: string | null
          customer_address: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          deleted_at: string | null
          dismiss_reason: string | null
          dismissed_at: string | null
          dismissed_by: string | null
          dup_ok: boolean
          email: string | null
          equipment_id: string | null
          estimated_duration_minutes: number | null
          estimated_end_time: string | null
          external_id: string | null
          first_contact_at: string | null
          first_contact_channel: string | null
          id: string
          idempotency_key: string | null
          intents: string[]
          interaction_history: Json
          job_info: string | null
          job_types: string[] | null
          last_activity_at: string
          last_contact_attempt_at: string | null
          last_contact_outcome: string | null
          latitude: number
          lead_priority: Database["public"]["Enums"]["lead_priority_level"]
          lead_score: number | null
          lead_status: Database["public"]["Enums"]["lead_lifecycle_status"]
          location: unknown
          longitude: number
          marketing_followup: boolean
          merge_history: Json
          merged_into_id: string | null
          needs_manual_assignment: boolean
          normalized_address: string | null
          notes: string | null
          offer_count: number | null
          order_status: string | null
          parts_status: string | null
          phone: string | null
          pre_close_lead_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          pre_close_status: string | null
          primary_intent: Database["public"]["Enums"]["lead_intent"] | null
          priority: string
          quote_sla_breached_at: string | null
          raw_payload: Json | null
          scheduled_date: string | null
          scheduled_time: string | null
          second_visit_of: string | null
          service_type: string
          sla_breached_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          stage2_done_at: string | null
          started_at: string | null
          status: string
          technician_eta: string | null
          technician_name: string | null
          unit_id: string | null
          visit_booked_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_start_time?: string | null
          agreement_id?: string | null
          assigned_agent_id?: string | null
          assignment_method?: string | null
          assignment_score?: number | null
          broadcast_radius_km?: number | null
          call_area?: string | null
          call_next_action?: string | null
          call_summary?: string | null
          call_summary_at?: string | null
          call_summary_model?: string | null
          call_urgency?: string | null
          cancellation_reason?: string | null
          classified_by?: Database["public"]["Enums"]["lead_classifier"] | null
          close_note?: string | null
          close_outcome?: string | null
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string | null
          company_name?: string | null
          completed_at?: string | null
          confidence?: number | null
          contact_attempts?: number
          converted_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_address: string
          customer_id?: string | null
          customer_name: string
          customer_phone: string
          deleted_at?: string | null
          dismiss_reason?: string | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          dup_ok?: boolean
          email?: string | null
          equipment_id?: string | null
          estimated_duration_minutes?: number | null
          estimated_end_time?: string | null
          external_id?: string | null
          first_contact_at?: string | null
          first_contact_channel?: string | null
          id?: string
          idempotency_key?: string | null
          intents?: string[]
          interaction_history?: Json
          job_info?: string | null
          job_types?: string[] | null
          last_activity_at?: string
          last_contact_attempt_at?: string | null
          last_contact_outcome?: string | null
          latitude: number
          lead_priority?: Database["public"]["Enums"]["lead_priority_level"]
          lead_score?: number | null
          lead_status?: Database["public"]["Enums"]["lead_lifecycle_status"]
          location?: unknown
          longitude: number
          marketing_followup?: boolean
          merge_history?: Json
          merged_into_id?: string | null
          needs_manual_assignment?: boolean
          normalized_address?: string | null
          notes?: string | null
          offer_count?: number | null
          order_status?: string | null
          parts_status?: string | null
          phone?: string | null
          pre_close_lead_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          pre_close_status?: string | null
          primary_intent?: Database["public"]["Enums"]["lead_intent"] | null
          priority?: string
          quote_sla_breached_at?: string | null
          raw_payload?: Json | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          second_visit_of?: string | null
          service_type: string
          sla_breached_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage2_done_at?: string | null
          started_at?: string | null
          status?: string
          technician_eta?: string | null
          technician_name?: string | null
          unit_id?: string | null
          visit_booked_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_start_time?: string | null
          agreement_id?: string | null
          assigned_agent_id?: string | null
          assignment_method?: string | null
          assignment_score?: number | null
          broadcast_radius_km?: number | null
          call_area?: string | null
          call_next_action?: string | null
          call_summary?: string | null
          call_summary_at?: string | null
          call_summary_model?: string | null
          call_urgency?: string | null
          cancellation_reason?: string | null
          classified_by?: Database["public"]["Enums"]["lead_classifier"] | null
          close_note?: string | null
          close_outcome?: string | null
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string | null
          company_name?: string | null
          completed_at?: string | null
          confidence?: number | null
          contact_attempts?: number
          converted_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_address?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          deleted_at?: string | null
          dismiss_reason?: string | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          dup_ok?: boolean
          email?: string | null
          equipment_id?: string | null
          estimated_duration_minutes?: number | null
          estimated_end_time?: string | null
          external_id?: string | null
          first_contact_at?: string | null
          first_contact_channel?: string | null
          id?: string
          idempotency_key?: string | null
          intents?: string[]
          interaction_history?: Json
          job_info?: string | null
          job_types?: string[] | null
          last_activity_at?: string
          last_contact_attempt_at?: string | null
          last_contact_outcome?: string | null
          latitude?: number
          lead_priority?: Database["public"]["Enums"]["lead_priority_level"]
          lead_score?: number | null
          lead_status?: Database["public"]["Enums"]["lead_lifecycle_status"]
          location?: unknown
          longitude?: number
          marketing_followup?: boolean
          merge_history?: Json
          merged_into_id?: string | null
          needs_manual_assignment?: boolean
          normalized_address?: string | null
          notes?: string | null
          offer_count?: number | null
          order_status?: string | null
          parts_status?: string | null
          phone?: string | null
          pre_close_lead_status?:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          pre_close_status?: string | null
          primary_intent?: Database["public"]["Enums"]["lead_intent"] | null
          priority?: string
          quote_sla_breached_at?: string | null
          raw_payload?: Json | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          second_visit_of?: string | null
          service_type?: string
          sla_breached_at?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage2_done_at?: string | null
          started_at?: string | null
          status?: string
          technician_eta?: string | null
          technician_name?: string | null
          unit_id?: string | null
          visit_booked_at?: string | null
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "leads_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_second_visit_of_fkey"
            columns: ["second_visit_of"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "leads_second_visit_of_fkey"
            columns: ["second_visit_of"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
      mandy_undo_snapshots: {
        Row: {
          action: string
          created_at: string
          id: string
          label: string | null
          quote_id: string
          quote_updated_at_after: string | null
          snapshot: Json
          state_hash_after: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          label?: string | null
          quote_id: string
          quote_updated_at_after?: string | null
          snapshot: Json
          state_hash_after?: string | null
          used_at?: string | null
          user_id?: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          label?: string | null
          quote_id?: string
          quote_updated_at_after?: string | null
          snapshot?: Json
          state_hash_after?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mandy_undo_snapshots_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "mandy_undo_snapshots_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      mandy_usage: {
        Row: {
          commands: number
          company_id: string
          day: string
          mandy: string
          tts_calls: number
          tts_chars: number
          user_id: string
        }
        Insert: {
          commands?: number
          company_id: string
          day?: string
          mandy?: string
          tts_calls?: number
          tts_chars?: number
          user_id: string
        }
        Update: {
          commands?: number
          company_id?: string
          day?: string
          mandy?: string
          tts_calls?: number
          tts_chars?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mandy_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandy_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      mandy_voice_logs: {
        Row: {
          channel: string
          company_id: string | null
          created_at: string
          id: string
          matches: Json | null
          plan: Json | null
          quote_id: string | null
          result: Json | null
          status: string
          transcript: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          company_id?: string | null
          created_at?: string
          id?: string
          matches?: Json | null
          plan?: Json | null
          quote_id?: string | null
          result?: Json | null
          status?: string
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          channel?: string
          company_id?: string | null
          created_at?: string
          id?: string
          matches?: Json | null
          plan?: Json | null
          quote_id?: string | null
          result?: Json | null
          status?: string
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
          job_id: string | null
          lead_id: string
          offer_type: string
          respond_by: string | null
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
          job_id?: string | null
          lead_id: string
          offer_type?: string
          respond_by?: string | null
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
          job_id?: string | null
          lead_id?: string
          offer_type?: string
          respond_by?: string | null
          responded_at?: string | null
          sequence?: number
          staff_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
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
      parent_mandy_users: {
        Row: {
          added_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          added_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          added_at?: string
          note?: string | null
          user_id?: string
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
      payment_followups: {
        Row: {
          amount_due: number
          approved_message: string | null
          channel: string
          company_id: string
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          days_late: number | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          due_date: string | null
          id: string
          invoice_id: string
          invoice_number: string | null
          proposed_message: string
          requested_by: string | null
          sent_at: string | null
          sent_by: string | null
          stage: number
          status: string
          step: string | null
          subject: string | null
        }
        Insert: {
          amount_due?: number
          approved_message?: string | null
          channel?: string
          company_id: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          days_late?: number | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          due_date?: string | null
          id?: string
          invoice_id: string
          invoice_number?: string | null
          proposed_message: string
          requested_by?: string | null
          sent_at?: string | null
          sent_by?: string | null
          stage?: number
          status?: string
          step?: string | null
          subject?: string | null
        }
        Update: {
          amount_due?: number
          approved_message?: string | null
          channel?: string
          company_id?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          days_late?: number | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string
          invoice_number?: string | null
          proposed_message?: string
          requested_by?: string | null
          sent_at?: string | null
          sent_by?: string | null
          stage?: number
          status?: string
          step?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_followups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_followups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payment_followups_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_followups_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payment_followups_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payment_followups_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
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
      pdf_activity: {
        Row: {
          action: string
          company_id: string
          created_at: string
          id: string
          quote_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          company_id?: string
          created_at?: string
          id?: string
          quote_id?: string | null
          user_id?: string
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          id?: string
          quote_id?: string | null
          user_id?: string
        }
        Relationships: []
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
            referencedRelation: "live_supplier_products"
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
          activated_at: string | null
          brand: string | null
          category: string
          created_at: string | null
          file_name: string
          file_path: string | null
          file_url: string | null
          id: string
          is_active: boolean
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
          activated_at?: string | null
          brand?: string | null
          category?: string
          created_at?: string | null
          file_name: string
          file_path?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean
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
          activated_at?: string | null
          brand?: string | null
          category?: string
          created_at?: string | null
          file_name?: string
          file_path?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean
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
      phone_company_routes: {
        Row: {
          business_phone: string | null
          company_id: string
          created_at: string
          id: string
          is_default: boolean
          vapi_assistant_id: string | null
        }
        Insert: {
          business_phone?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          vapi_assistant_id?: string | null
        }
        Update: {
          business_phone?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          vapi_assistant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_company_routes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_company_routes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
      product_media: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand: string | null
          bullets: string[]
          created_at: string
          display_name: string | null
          family: string | null
          feature_highlight: Json | null
          fetch_error: string | null
          fetched_at: string | null
          id: string
          image_path: string | null
          image_source_url: string | null
          image_status: string
          image_url: string | null
          model_code: string
          model_key: string
          notes: string | null
          product_url: string | null
          source_label: string | null
          specs: Json
          status: string
          subtitle: string | null
          support_url: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand?: string | null
          bullets?: string[]
          created_at?: string
          display_name?: string | null
          family?: string | null
          feature_highlight?: Json | null
          fetch_error?: string | null
          fetched_at?: string | null
          id?: string
          image_path?: string | null
          image_source_url?: string | null
          image_status?: string
          image_url?: string | null
          model_code: string
          model_key: string
          notes?: string | null
          product_url?: string | null
          source_label?: string | null
          specs?: Json
          status?: string
          subtitle?: string | null
          support_url?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand?: string | null
          bullets?: string[]
          created_at?: string
          display_name?: string | null
          family?: string | null
          feature_highlight?: Json | null
          fetch_error?: string | null
          fetched_at?: string | null
          id?: string
          image_path?: string | null
          image_source_url?: string | null
          image_status?: string
          image_url?: string | null
          model_code?: string
          model_key?: string
          notes?: string | null
          product_url?: string | null
          source_label?: string | null
          specs?: Json
          status?: string
          subtitle?: string | null
          support_url?: string | null
          updated_at?: string
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
          archived_at: string | null
          availability_choice: string | null
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
          job_title: string | null
          jobs_limit: number
          last_availability_update: string | null
          lead_contact_pref: string
          location_tracking_enabled: boolean | null
          max_travel_km: number | null
          network_status: string | null
          office_address: string | null
          office_lat: number | null
          office_lng: number | null
          onboarding_completed: boolean
          participant_type: string
          pay_type: string
          phone: string | null
          search_aliases: string[] | null
          signature_email: string | null
          signature_enabled: boolean
          signature_phone: string | null
          signup_company: string | null
          signup_role: string | null
          skills: string[] | null
          start_from: string | null
          stripe_customer_id: string | null
          subscription_plan: string
          subscription_status: string
          trial_ends_at: string | null
          updated_at: string | null
          welcome_tour_auto_count: number
          welcome_tour_dismissed: boolean
          whatsapp_notifications: boolean | null
          workshop_address: string | null
          workshop_lat: number | null
          workshop_lng: number | null
        }
        Insert: {
          archived_at?: string | null
          availability_choice?: string | null
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
          job_title?: string | null
          jobs_limit?: number
          last_availability_update?: string | null
          lead_contact_pref?: string
          location_tracking_enabled?: boolean | null
          max_travel_km?: number | null
          network_status?: string | null
          office_address?: string | null
          office_lat?: number | null
          office_lng?: number | null
          onboarding_completed?: boolean
          participant_type?: string
          pay_type?: string
          phone?: string | null
          search_aliases?: string[] | null
          signature_email?: string | null
          signature_enabled?: boolean
          signature_phone?: string | null
          signup_company?: string | null
          signup_role?: string | null
          skills?: string[] | null
          start_from?: string | null
          stripe_customer_id?: string | null
          subscription_plan?: string
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          welcome_tour_auto_count?: number
          welcome_tour_dismissed?: boolean
          whatsapp_notifications?: boolean | null
          workshop_address?: string | null
          workshop_lat?: number | null
          workshop_lng?: number | null
        }
        Update: {
          archived_at?: string | null
          availability_choice?: string | null
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
          job_title?: string | null
          jobs_limit?: number
          last_availability_update?: string | null
          lead_contact_pref?: string
          location_tracking_enabled?: boolean | null
          max_travel_km?: number | null
          network_status?: string | null
          office_address?: string | null
          office_lat?: number | null
          office_lng?: number | null
          onboarding_completed?: boolean
          participant_type?: string
          pay_type?: string
          phone?: string | null
          search_aliases?: string[] | null
          signature_email?: string | null
          signature_enabled?: boolean
          signature_phone?: string | null
          signup_company?: string | null
          signup_role?: string | null
          skills?: string[] | null
          start_from?: string | null
          stripe_customer_id?: string | null
          subscription_plan?: string
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          welcome_tour_auto_count?: number
          welcome_tour_dismissed?: boolean
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
      project_house_steps: {
        Row: {
          company_id: string
          done: boolean
          done_at: string | null
          house_id: string
          id: string
          label: string
          paid: boolean
          paid_at: string | null
          rate: number
          sort_order: number
          step_key: string
          updated_at: string
        }
        Insert: {
          company_id: string
          done?: boolean
          done_at?: string | null
          house_id: string
          id?: string
          label: string
          paid?: boolean
          paid_at?: string | null
          rate?: number
          sort_order?: number
          step_key: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          done?: boolean
          done_at?: string | null
          house_id?: string
          id?: string
          label?: string
          paid?: boolean
          paid_at?: string | null
          rate?: number
          sort_order?: number
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_house_steps_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "project_houses"
            referencedColumns: ["id"]
          },
        ]
      }
      project_houses: {
        Row: {
          company_id: string
          created_at: string
          house_no: string
          id: string
          make: string | null
          notes: string | null
          phase_id: string | null
          po_number: string | null
          project_id: string
          ready_for_aircon: boolean
          ready_for_aircon_at: string | null
          status_override: string | null
          unit_sizes: string | null
          units_ordered: number
          units_received: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          house_no: string
          id?: string
          make?: string | null
          notes?: string | null
          phase_id?: string | null
          po_number?: string | null
          project_id: string
          ready_for_aircon?: boolean
          ready_for_aircon_at?: string | null
          status_override?: string | null
          unit_sizes?: string | null
          units_ordered?: number
          units_received?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          house_no?: string
          id?: string
          make?: string | null
          notes?: string | null
          phase_id?: string | null
          po_number?: string | null
          project_id?: string
          ready_for_aircon?: boolean
          ready_for_aircon_at?: string | null
          status_override?: string | null
          unit_sizes?: string | null
          units_ordered?: number
          units_received?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_houses_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "project_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_houses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_phases: {
        Row: {
          company_id: string
          created_at: string
          house_from: number | null
          house_to: number | null
          id: string
          name: string
          project_id: string
          sort_order: number
        }
        Insert: {
          company_id: string
          created_at?: string
          house_from?: number | null
          house_to?: number | null
          id?: string
          name: string
          project_id: string
          sort_order?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          house_from?: number | null
          house_to?: number | null
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          code: string | null
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          default_make: string | null
          id: string
          name: string
          notes: string | null
          po_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          default_make?: string | null
          id?: string
          name: string
          notes?: string | null
          po_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          default_make?: string | null
          id?: string
          name?: string
          notes?: string | null
          po_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
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
      public_holidays: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          holiday_date: string
          id: string
          kind: string
          name: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          holiday_date: string
          id?: string
          kind?: string
          name: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          id?: string
          kind?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_holidays_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_holidays_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      purchase_order_documents: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string | null
          doc_type: string
          file_name: string | null
          id: string
          internal_only: boolean
          job_id: string | null
          po_id: string
          storage_path: string
          supplier_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_id?: string | null
          doc_type: string
          file_name?: string | null
          id?: string
          internal_only?: boolean
          job_id?: string | null
          po_id: string
          storage_path: string
          supplier_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string | null
          doc_type?: string
          file_name?: string | null
          id?: string
          internal_only?: boolean
          job_id?: string | null
          po_id?: string
          storage_path?: string
          supplier_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "purchase_order_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_documents_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          description: string | null
          id: string
          invoice_item_id: string | null
          line_total_excl_vat: number
          model_code: string | null
          po_id: string
          product_id: string | null
          qty: number
          sort_order: number
          unit_cost_excl_vat: number
        }
        Insert: {
          description?: string | null
          id?: string
          invoice_item_id?: string | null
          line_total_excl_vat: number
          model_code?: string | null
          po_id: string
          product_id?: string | null
          qty: number
          sort_order?: number
          unit_cost_excl_vat: number
        }
        Update: {
          description?: string | null
          id?: string
          invoice_item_id?: string | null
          line_total_excl_vat?: number
          model_code?: string | null
          po_id?: string
          product_id?: string | null
          qty?: number
          sort_order?: number
          unit_cost_excl_vat?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "live_supplier_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          client_name: string | null
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          deliver_to: string | null
          id: string
          invoice_id: string | null
          job_id: string | null
          job_reference: string | null
          notes: string | null
          po_number: string
          seq: number
          status: string
          subtotal: number
          supplier_account_number: string | null
          supplier_emails: string[]
          supplier_id: string
          total: number
          updated_at: string
          vat_amount: number
        }
        Insert: {
          client_name?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deliver_to?: string | null
          id?: string
          invoice_id?: string | null
          job_id?: string | null
          job_reference?: string | null
          notes?: string | null
          po_number: string
          seq: number
          status?: string
          subtotal?: number
          supplier_account_number?: string | null
          supplier_emails?: string[]
          supplier_id: string
          total?: number
          updated_at?: string
          vat_amount?: number
        }
        Update: {
          client_name?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deliver_to?: string | null
          id?: string
          invoice_id?: string | null
          job_id?: string | null
          job_reference?: string | null
          notes?: string | null
          po_number?: string
          seq?: number
          status?: string
          subtotal?: number
          supplier_account_number?: string | null
          supplier_emails?: string[]
          supplier_id?: string
          total?: number
          updated_at?: string
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "purchase_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "purchase_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_accounts_aging"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "purchase_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_sales_by_product_detail"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "purchase_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_areas: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          quote_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          quote_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
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
      quote_bundles: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          quote_ids: string[]
          sent_at: string | null
          sent_to: string | null
          token: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          quote_ids: string[]
          sent_at?: string | null
          sent_to?: string | null
          token?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          quote_ids?: string[]
          sent_at?: string | null
          sent_to?: string | null
          token?: string
        }
        Relationships: []
      }
      quote_change_requests: {
        Row: {
          company_id: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          message: string
          quote_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          company_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          message: string
          quote_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          company_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          message?: string
          quote_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_change_requests_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quote_change_requests_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_client_revisions: {
        Row: {
          client_note: string | null
          company_id: string | null
          contact_name: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          discount_amount: number
          id: string
          lines: Json
          original_items: Json | null
          original_total: number | null
          original_totals: Json | null
          quote_id: string
          status: string
          subtotal: number
          total: number
          vat_amount: number
        }
        Insert: {
          client_note?: string | null
          company_id?: string | null
          contact_name?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          discount_amount?: number
          id?: string
          lines: Json
          original_items?: Json | null
          original_total?: number | null
          original_totals?: Json | null
          quote_id: string
          status?: string
          subtotal: number
          total: number
          vat_amount: number
        }
        Update: {
          client_note?: string | null
          company_id?: string | null
          contact_name?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          discount_amount?: number
          id?: string
          lines?: Json
          original_items?: Json | null
          original_total?: number | null
          original_totals?: Json | null
          quote_id?: string
          status?: string
          subtotal?: number
          total?: number
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_client_revisions_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quote_client_revisions_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_documents: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          filename: string
          id: string
          quote_id: string
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          filename: string
          id?: string
          quote_id: string
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          quote_id?: string
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_documents_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quote_documents_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_drawings: {
        Row: {
          area: string | null
          company_id: string
          created_at: string
          created_by: string | null
          filename: string
          id: string
          include_in_client_pdf: boolean
          kind: string
          quote_id: string
          revision: string | null
          size_bytes: number | null
          sort_order: number
          storage_path: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          filename: string
          id?: string
          include_in_client_pdf?: boolean
          kind: string
          quote_id: string
          revision?: string | null
          size_bytes?: number | null
          sort_order?: number
          storage_path: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          include_in_client_pdf?: boolean
          kind?: string
          quote_id?: string
          revision?: string | null
          size_bytes?: number | null
          sort_order?: number
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_drawings_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quote_drawings_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_drawings_deleted_files: {
        Row: {
          company_id: string | null
          deleted_at: string
          storage_path: string
        }
        Insert: {
          company_id?: string | null
          deleted_at?: string
          storage_path: string
        }
        Update: {
          company_id?: string | null
          deleted_at?: string
          storage_path?: string
        }
        Relationships: []
      }
      quote_email_sends: {
        Row: {
          attempts: number
          cc: string[] | null
          company_id: string
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          quote_id: string
          recipient: string
          resend_id: string | null
          retry_of: string | null
          send_id: string
          started_at: string
          status: string
        }
        Insert: {
          attempts?: number
          cc?: string[] | null
          company_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          quote_id: string
          recipient: string
          resend_id?: string | null
          retry_of?: string | null
          send_id: string
          started_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          cc?: string[] | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          quote_id?: string
          recipient?: string
          resend_id?: string | null
          retry_of?: string | null
          send_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_email_sends_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quote_email_sends_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_email_sends_retry_of_fkey"
            columns: ["retry_of"]
            isOneToOne: false
            referencedRelation: "quote_email_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_followups: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          next_at: string | null
          note: string | null
          quote_id: string
          result: string
          seq: number
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          next_at?: string | null
          note?: string | null
          quote_id: string
          result: string
          seq: number
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          next_at?: string | null
          note?: string | null
          quote_id?: string
          result?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_followups_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quote_followups_quote_id_fkey"
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
            referencedRelation: "live_supplier_products"
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
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
        ]
      }
      quote_lock_events: {
        Row: {
          action: string
          actor: string | null
          company_id: string | null
          created_at: string
          id: string
          quote_id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          quote_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          quote_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_lock_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quote_lock_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_stage_events: {
        Row: {
          actor: string | null
          company_id: string | null
          created_at: string
          from_status: string | null
          id: string
          kind: string
          quote_id: string
          reason: string | null
          to_status: string | null
        }
        Insert: {
          actor?: string | null
          company_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          kind?: string
          quote_id: string
          reason?: string | null
          to_status?: string | null
        }
        Update: {
          actor?: string | null
          company_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          kind?: string
          quote_id?: string
          reason?: string | null
          to_status?: string | null
        }
        Relationships: []
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
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
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          client_summary: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          customer_id: string | null
          customer_name: string | null
          declined_at: string | null
          discount_type: string | null
          discount_value: number | null
          followup_count: number
          followup_kind: string | null
          followup_next_at: string | null
          followup_state: string | null
          id: string
          is_variation: boolean
          labour_included: boolean
          labour_mode: string
          lead_id: string | null
          legacy_original_total: number | null
          location_id: string | null
          locked_at: string | null
          locked_by: string | null
          locked_reason: string | null
          materials_markup_percent: number | null
          materials_waste_percent: number | null
          notes: string | null
          option_chosen_id: string | null
          option_group_id: string | null
          option_label: string | null
          owner_id: string | null
          parent_quote_id: string | null
          payment_plan: Json | null
          public_token: string | null
          quote_number: string | null
          reference_text: string | null
          relocation_clause: string | null
          remote_quote: boolean
          remote_quote_source: string | null
          sales_engineer_id: string
          sent_at: string | null
          sent_by: string | null
          sent_channel: string | null
          sent_method: string | null
          sent_note: string | null
          show_unit_cards: boolean
          site_id: string | null
          status: string
          subtotal: number
          superseded_by: string | null
          terms_text: string | null
          total: number
          units_markup_percent: number | null
          updated_at: string
          valid_until: string | null
          variation_job_id: string | null
          variation_summary: Json | null
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
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          client_summary?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          declined_at?: string | null
          discount_type?: string | null
          discount_value?: number | null
          followup_count?: number
          followup_kind?: string | null
          followup_next_at?: string | null
          followup_state?: string | null
          id?: string
          is_variation?: boolean
          labour_included?: boolean
          labour_mode?: string
          lead_id?: string | null
          legacy_original_total?: number | null
          location_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          locked_reason?: string | null
          materials_markup_percent?: number | null
          materials_waste_percent?: number | null
          notes?: string | null
          option_chosen_id?: string | null
          option_group_id?: string | null
          option_label?: string | null
          owner_id?: string | null
          parent_quote_id?: string | null
          payment_plan?: Json | null
          public_token?: string | null
          quote_number?: string | null
          reference_text?: string | null
          relocation_clause?: string | null
          remote_quote?: boolean
          remote_quote_source?: string | null
          sales_engineer_id: string
          sent_at?: string | null
          sent_by?: string | null
          sent_channel?: string | null
          sent_method?: string | null
          sent_note?: string | null
          show_unit_cards?: boolean
          site_id?: string | null
          status?: string
          subtotal?: number
          superseded_by?: string | null
          terms_text?: string | null
          total?: number
          units_markup_percent?: number | null
          updated_at?: string
          valid_until?: string | null
          variation_job_id?: string | null
          variation_summary?: Json | null
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
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          client_summary?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          declined_at?: string | null
          discount_type?: string | null
          discount_value?: number | null
          followup_count?: number
          followup_kind?: string | null
          followup_next_at?: string | null
          followup_state?: string | null
          id?: string
          is_variation?: boolean
          labour_included?: boolean
          labour_mode?: string
          lead_id?: string | null
          legacy_original_total?: number | null
          location_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          locked_reason?: string | null
          materials_markup_percent?: number | null
          materials_waste_percent?: number | null
          notes?: string | null
          option_chosen_id?: string | null
          option_group_id?: string | null
          option_label?: string | null
          owner_id?: string | null
          parent_quote_id?: string | null
          payment_plan?: Json | null
          public_token?: string | null
          quote_number?: string | null
          reference_text?: string | null
          relocation_clause?: string | null
          remote_quote?: boolean
          remote_quote_source?: string | null
          sales_engineer_id?: string
          sent_at?: string | null
          sent_by?: string | null
          sent_channel?: string | null
          sent_method?: string | null
          sent_note?: string | null
          show_unit_cards?: boolean
          site_id?: string | null
          status?: string
          subtotal?: number
          superseded_by?: string | null
          terms_text?: string | null
          total?: number
          units_markup_percent?: number | null
          updated_at?: string
          valid_until?: string | null
          variation_job_id?: string | null
          variation_summary?: Json | null
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
            foreignKeyName: "quotes_parent_quote_id_fkey"
            columns: ["parent_quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quotes_parent_quote_id_fkey"
            columns: ["parent_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "quotes_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_variation_job_id_fkey"
            columns: ["variation_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      request_events: {
        Row: {
          actor_id: string | null
          company_id: string | null
          created_at: string
          event: string
          id: string
          new_value: string | null
          note: string | null
          old_value: string | null
          request_id: string
        }
        Insert: {
          actor_id?: string | null
          company_id?: string | null
          created_at?: string
          event: string
          id?: string
          new_value?: string | null
          note?: string | null
          old_value?: string | null
          request_id: string
        }
        Update: {
          actor_id?: string | null
          company_id?: string | null
          created_at?: string
          event?: string
          id?: string
          new_value?: string | null
          note?: string | null
          old_value?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_keywords: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          keyword: string
          type: Database["public"]["Enums"]["request_type"]
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          keyword: string
          type: Database["public"]["Enums"]["request_type"]
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          keyword?: string
          type?: Database["public"]["Enums"]["request_type"]
        }
        Relationships: []
      }
      requests: {
        Row: {
          area: string | null
          assigned_at: string | null
          assigned_to: string | null
          company_id: string | null
          contact_channel: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          done_at: string | null
          first_contact_at: string | null
          id: string
          job_id: string | null
          lead_id: string | null
          phone: string | null
          routed_to: string | null
          scheduled_for: string | null
          sort_reason: string | null
          sorted_by: string | null
          source: string
          status: string
          suggested_type: Database["public"]["Enums"]["request_type"] | null
          summary: string | null
          task_due_at: string | null
          type: Database["public"]["Enums"]["request_type"] | null
          type_confidence: number | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          company_id?: string | null
          contact_channel?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          done_at?: string | null
          first_contact_at?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          phone?: string | null
          routed_to?: string | null
          scheduled_for?: string | null
          sort_reason?: string | null
          sorted_by?: string | null
          source?: string
          status?: string
          suggested_type?: Database["public"]["Enums"]["request_type"] | null
          summary?: string | null
          task_due_at?: string | null
          type?: Database["public"]["Enums"]["request_type"] | null
          type_confidence?: number | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          company_id?: string | null
          contact_channel?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          done_at?: string | null
          first_contact_at?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          phone?: string | null
          routed_to?: string | null
          scheduled_for?: string | null
          sort_reason?: string | null
          sorted_by?: string | null
          source?: string
          status?: string
          suggested_type?: Database["public"]["Enums"]["request_type"] | null
          summary?: string | null
          task_due_at?: string | null
          type?: Database["public"]["Enums"]["request_type"] | null
          type_confidence?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sales_commission_snapshots: {
        Row: {
          commission: number
          company_id: string
          created_at: string
          earned_at: string
          id: string
          invoice_paid_date: string | null
          items_cost: number
          items_profit: number
          items_sell_ex_vat: number
          paid_at: string | null
          paid_by: string | null
          paid_marked_at: string | null
          percent: number
          quote_id: string
          quote_number: string | null
          rep_id: string
          rule: Json | null
          status: string
          unknown_cost_count: number
        }
        Insert: {
          commission: number
          company_id: string
          created_at?: string
          earned_at?: string
          id?: string
          invoice_paid_date?: string | null
          items_cost: number
          items_profit: number
          items_sell_ex_vat: number
          paid_at?: string | null
          paid_by?: string | null
          paid_marked_at?: string | null
          percent: number
          quote_id: string
          quote_number?: string | null
          rep_id: string
          rule?: Json | null
          status?: string
          unknown_cost_count?: number
        }
        Update: {
          commission?: number
          company_id?: string
          created_at?: string
          earned_at?: string
          id?: string
          invoice_paid_date?: string | null
          items_cost?: number
          items_profit?: number
          items_sell_ex_vat?: number
          paid_at?: string | null
          paid_by?: string | null
          paid_marked_at?: string | null
          percent?: number
          quote_id?: string
          quote_number?: string | null
          rep_id?: string
          rule?: Json | null
          status?: string
          unknown_cost_count?: number
        }
        Relationships: []
      }
      sales_escalations: {
        Row: {
          company_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          level: number
          message: string | null
          notified_user_ids: string[]
          stage: string
        }
        Insert: {
          company_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          level?: number
          message?: string | null
          notified_user_ids?: string[]
          stage: string
        }
        Update: {
          company_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          level?: number
          message?: string | null
          notified_user_ids?: string[]
          stage?: string
        }
        Relationships: []
      }
      service_agreements: {
        Row: {
          attached_file_path: string | null
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
          template_id: string | null
          template_version: number | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          attached_file_path?: string | null
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
          template_id?: string | null
          template_version?: number | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          attached_file_path?: string | null
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
          template_id?: string | null
          template_version?: number | null
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
            foreignKeyName: "service_agreements_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
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
      service_area_staff: {
        Row: {
          area_id: string
          created_at: string
          profile_id: string
        }
        Insert: {
          area_id: string
          created_at?: string
          profile_id: string
        }
        Update: {
          area_id?: string
          created_at?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_area_staff_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_area_staff_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_areas: {
        Row: {
          active: boolean
          center_lat: number
          center_lng: number
          company_id: string
          created_at: string
          id: string
          name: string
          priority: number
          radius_km: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          center_lat: number
          center_lng: number
          company_id?: string
          created_at?: string
          id?: string
          name: string
          priority?: number
          radius_km?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          center_lat?: number
          center_lng?: number
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          priority?: number
          radius_km?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      shop_orders: {
        Row: {
          company_id: string
          contact: Json
          created_at: string
          customer_id: string | null
          email_sent_at: string | null
          environment: string
          error: string | null
          expires_at: string
          finalized_at: string | null
          id: string
          invoice_id: string | null
          ip_hash: string | null
          job_id: string | null
          last_event: Json | null
          lead_id: string | null
          lines: Json
          notes: string | null
          order_ref: string
          paid_at: string | null
          payment_id: string | null
          preferred: Json | null
          quote_id: string | null
          rooms: Json
          status: string
          subtotal_ex: number
          terms_accepted_at: string
          terms_version: string
          total_incl: number
          vat_amount: number
          yoco_checkout_id: string | null
          yoco_payment_id: string | null
        }
        Insert: {
          company_id: string
          contact: Json
          created_at?: string
          customer_id?: string | null
          email_sent_at?: string | null
          environment: string
          error?: string | null
          expires_at?: string
          finalized_at?: string | null
          id?: string
          invoice_id?: string | null
          ip_hash?: string | null
          job_id?: string | null
          last_event?: Json | null
          lead_id?: string | null
          lines: Json
          notes?: string | null
          order_ref: string
          paid_at?: string | null
          payment_id?: string | null
          preferred?: Json | null
          quote_id?: string | null
          rooms: Json
          status?: string
          subtotal_ex: number
          terms_accepted_at: string
          terms_version: string
          total_incl: number
          vat_amount: number
          yoco_checkout_id?: string | null
          yoco_payment_id?: string | null
        }
        Update: {
          company_id?: string
          contact?: Json
          created_at?: string
          customer_id?: string | null
          email_sent_at?: string | null
          environment?: string
          error?: string | null
          expires_at?: string
          finalized_at?: string | null
          id?: string
          invoice_id?: string | null
          ip_hash?: string | null
          job_id?: string | null
          last_event?: Json | null
          lead_id?: string | null
          lines?: Json
          notes?: string | null
          order_ref?: string
          paid_at?: string | null
          payment_id?: string | null
          preferred?: Json | null
          quote_id?: string | null
          rooms?: Json
          status?: string
          subtotal_ex?: number
          terms_accepted_at?: string
          terms_version?: string
          total_incl?: number
          vat_amount?: number
          yoco_checkout_id?: string | null
          yoco_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      shop_tier_map: {
        Row: {
          active: boolean
          btu: number
          company_id: string
          id: string
          product_id: string
          tier: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          btu: number
          company_id: string
          id?: string
          product_id: string
          tier: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          btu?: number
          company_id?: string
          id?: string
          product_id?: string
          tier?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_tier_map_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_tier_map_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "shop_tier_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "live_supplier_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_tier_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      site_survey_media: {
        Row: {
          annotated_path: string | null
          annotation: Json | null
          archived_at: string | null
          audio_purged_at: string | null
          bytes: number | null
          caption: string | null
          company_id: string
          created_at: string
          created_by: string
          duration_s: number | null
          id: string
          kind: string
          parent_media_id: string | null
          room_id: string | null
          sort: number
          storage_path: string | null
          survey_id: string
          taken_at: string | null
          transcript: string | null
          transcript_status: string
        }
        Insert: {
          annotated_path?: string | null
          annotation?: Json | null
          archived_at?: string | null
          audio_purged_at?: string | null
          bytes?: number | null
          caption?: string | null
          company_id: string
          created_at?: string
          created_by?: string
          duration_s?: number | null
          id?: string
          kind: string
          parent_media_id?: string | null
          room_id?: string | null
          sort?: number
          storage_path?: string | null
          survey_id: string
          taken_at?: string | null
          transcript?: string | null
          transcript_status?: string
        }
        Update: {
          annotated_path?: string | null
          annotation?: Json | null
          archived_at?: string | null
          audio_purged_at?: string | null
          bytes?: number | null
          caption?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          duration_s?: number | null
          id?: string
          kind?: string
          parent_media_id?: string | null
          room_id?: string | null
          sort?: number
          storage_path?: string | null
          survey_id?: string
          taken_at?: string | null
          transcript?: string | null
          transcript_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_survey_media_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_survey_media_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "site_survey_media_parent_media_id_fkey"
            columns: ["parent_media_id"]
            isOneToOne: false
            referencedRelation: "site_survey_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_survey_media_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "site_survey_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_survey_media_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "site_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      site_survey_rooms: {
        Row: {
          company_id: string
          core_holes: number | null
          created_at: string
          electrical: string | null
          flags: Json
          floor_level: string | null
          id: string
          name: string
          note: string | null
          pipe_run_m: number | null
          sort: number
          survey_id: string
          unit_size_btu: number | null
          updated_at: string
          wall_type: string | null
        }
        Insert: {
          company_id: string
          core_holes?: number | null
          created_at?: string
          electrical?: string | null
          flags?: Json
          floor_level?: string | null
          id?: string
          name?: string
          note?: string | null
          pipe_run_m?: number | null
          sort?: number
          survey_id: string
          unit_size_btu?: number | null
          updated_at?: string
          wall_type?: string | null
        }
        Update: {
          company_id?: string
          core_holes?: number | null
          created_at?: string
          electrical?: string | null
          flags?: Json
          floor_level?: string | null
          id?: string
          name?: string
          note?: string | null
          pipe_run_m?: number | null
          sort?: number
          survey_id?: string
          unit_size_btu?: number | null
          updated_at?: string
          wall_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_survey_rooms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_survey_rooms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "site_survey_rooms_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "site_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      site_surveys: {
        Row: {
          access_flags: Json
          access_note: string | null
          address_confirmed_at: string | null
          archived_at: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          id: string
          lat: number | null
          lead_id: string
          lng: number | null
          quote_id: string | null
          report_no: string | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          access_flags?: Json
          access_note?: string | null
          address_confirmed_at?: string | null
          archived_at?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          lat?: number | null
          lead_id: string
          lng?: number | null
          quote_id?: string | null
          report_no?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          access_flags?: Json
          access_note?: string | null
          address_confirmed_at?: string | null
          archived_at?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          lat?: number | null
          lead_id?: string
          lng?: number | null
          quote_id?: string | null
          report_no?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_surveys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_surveys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "site_surveys_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "site_surveys_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_surveys_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
          },
          {
            foreignKeyName: "site_surveys_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
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
      staff_blocked_time: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string | null
          created_by: string | null
          ends_at: string
          id: string
          kind: string
          profile_id: string
          reason: string | null
          starts_at: string
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string | null
          created_by?: string | null
          ends_at: string
          id?: string
          kind?: string
          profile_id: string
          reason?: string | null
          starts_at: string
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          ends_at?: string
          id?: string
          kind?: string
          profile_id?: string
          reason?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_blocked_time_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_home_bases: {
        Row: {
          address: string | null
          lat: number | null
          lng: number | null
          profile_id: string
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          lat?: number | null
          lng?: number | null
          profile_id: string
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          lat?: number | null
          lng?: number | null
          profile_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_home_bases_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_work_hours: {
        Row: {
          company_id: string
          day_of_week: number
          end_time: string | null
          id: string
          is_working: boolean
          profile_id: string
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          day_of_week: number
          end_time?: string | null
          id?: string
          is_working?: boolean
          profile_id: string
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          day_of_week?: number
          end_time?: string | null
          id?: string
          is_working?: boolean
          profile_id?: string
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_work_hours_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      statement_links: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          customer_id: string
          expires_at: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          customer_id: string
          expires_at?: string
          revoked_at?: string | null
          token?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          customer_id?: string
          expires_at?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "statement_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
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
      supplier_bill_payments: {
        Row: {
          amount: number
          bank_line_id: string | null
          bill_id: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          method: string
          paid_date: string
          reference: string | null
        }
        Insert: {
          amount: number
          bank_line_id?: string | null
          bill_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          paid_date?: string
          reference?: string | null
        }
        Update: {
          amount?: number
          bank_line_id?: string | null
          bill_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          paid_date?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bill_payments_bank_line_id_fkey"
            columns: ["bank_line_id"]
            isOneToOne: false
            referencedRelation: "bank_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      supplier_bills: {
        Row: {
          amount_excl: number
          amount_incl: number
          amount_paid: number
          bill_date: string
          bill_number: string | null
          company_id: string
          created_at: string
          created_by: string | null
          document_path: string | null
          due_date: string | null
          id: string
          job_id: string | null
          notes: string | null
          po_id: string | null
          status: string
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string
          vat_amount: number
        }
        Insert: {
          amount_excl?: number
          amount_incl?: number
          amount_paid?: number
          bill_date?: string
          bill_number?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          due_date?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          po_id?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
          vat_amount?: number
        }
        Update: {
          amount_excl?: number
          amount_incl?: number
          amount_paid?: number
          bill_date?: string
          bill_number?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          due_date?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          po_id?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "supplier_bills_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_supplier_id_fkey"
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
          pdf_upload_id: string | null
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
          pdf_upload_id?: string | null
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
          pdf_upload_id?: string | null
          price_column_bbox?: Json | null
          supplier_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_pdf_pages_pdf_upload_id_fkey"
            columns: ["pdf_upload_id"]
            isOneToOne: false
            referencedRelation: "pdf_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_products: {
        Row: {
          ai_sales_description: string | null
          ai_sales_description_generated_at: string | null
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
          pipe_sizes_manual: boolean
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
          search_tags: string | null
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
          ai_sales_description?: string | null
          ai_sales_description_generated_at?: string | null
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
          pipe_sizes_manual?: boolean
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
          search_tags?: string | null
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
          ai_sales_description?: string | null
          ai_sales_description_generated_at?: string | null
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
          pipe_sizes_manual?: boolean
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
          search_tags?: string | null
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
      supplier_sku_map: {
        Row: {
          active_from: string
          active_to: string | null
          created_at: string
          created_by: string | null
          id: string
          sku_id: string
          source: string
          supplier_code: string | null
          supplier_id: string
          supplier_product_id: string | null
        }
        Insert: {
          active_from?: string
          active_to?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          sku_id: string
          source?: string
          supplier_code?: string | null
          supplier_id: string
          supplier_product_id?: string | null
        }
        Update: {
          active_from?: string
          active_to?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          sku_id?: string
          source?: string
          supplier_code?: string | null
          supplier_id?: string
          supplier_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_sku_map_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "internal_skus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_sku_map_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_sku_map_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "live_supplier_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_sku_map_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_specials: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          ending_reminder_for: string | null
          id: string
          is_active: boolean
          model_number: string
          notes: string | null
          special_cost: number
          specials_pdf_path: string | null
          start_date: string
          supplier_id: string | null
          supplier_product_id: string | null
          units_left: number | null
          updated_at: string
          while_stocks_last: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          ending_reminder_for?: string | null
          id?: string
          is_active?: boolean
          model_number: string
          notes?: string | null
          special_cost: number
          specials_pdf_path?: string | null
          start_date: string
          supplier_id?: string | null
          supplier_product_id?: string | null
          units_left?: number | null
          updated_at?: string
          while_stocks_last?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          ending_reminder_for?: string | null
          id?: string
          is_active?: boolean
          model_number?: string
          notes?: string | null
          special_cost?: number
          specials_pdf_path?: string | null
          start_date?: string
          supplier_id?: string | null
          supplier_product_id?: string | null
          units_left?: number | null
          updated_at?: string
          while_stocks_last?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "supplier_specials_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "live_supplier_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_specials_supplier_product_id_fkey"
            columns: ["supplier_product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
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
          order_emails: string[]
          our_account_number: string | null
          payment_terms_days: number | null
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
          order_emails?: string[]
          our_account_number?: string | null
          payment_terms_days?: number | null
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
          order_emails?: string[]
          our_account_number?: string | null
          payment_terms_days?: number | null
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
      team_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          company_id: string
          created_at: string
          dispatch_role: string | null
          email: string
          id: string
          invited_by: string | null
          password_set_at: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          company_id: string
          created_at?: string
          dispatch_role?: string | null
          email: string
          id?: string
          invited_by?: string | null
          password_set_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          company_id?: string
          created_at?: string
          dispatch_role?: string | null
          email?: string
          id?: string
          invited_by?: string | null
          password_set_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      tech_earnings_ledger: {
        Row: {
          amount: number
          bucket: string
          callback_job_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          id: string
          job_id: string
          labour_base: number | null
          note: string | null
          paid_at: string | null
          percent: number
          quote_id: string | null
          quote_number: string | null
          reduction_amount: number
          release_after: string | null
          rule: Json | null
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          tech_id: string
        }
        Insert: {
          amount: number
          bucket: string
          callback_job_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          job_id: string
          labour_base?: number | null
          note?: string | null
          paid_at?: string | null
          percent: number
          quote_id?: string | null
          quote_number?: string | null
          reduction_amount?: number
          release_after?: string | null
          rule?: Json | null
          status: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          tech_id: string
        }
        Update: {
          amount?: number
          bucket?: string
          callback_job_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          job_id?: string
          labour_base?: number | null
          note?: string | null
          paid_at?: string | null
          percent?: number
          quote_id?: string | null
          quote_number?: string | null
          reduction_amount?: number
          release_after?: string | null
          rule?: Json | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          tech_id?: string
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "unassigned_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_mockups: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          image_url: string
          label: string | null
          model_key: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          image_url: string
          label?: string | null
          model_key: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string
          label?: string | null
          model_key?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_mockups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_mockups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["quote_id"]
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
      variation_rates: {
        Row: {
          active: boolean
          code: string
          company_id: string
          cost_excl: number | null
          created_at: string
          id: string
          label: string
          labour_hours: number | null
          labour_rate: number | null
          material_price_excl: number | null
          material_product_id: string | null
          notes: string | null
          price_excl: number | null
          sort_order: number
          unit: string
        }
        Insert: {
          active?: boolean
          code: string
          company_id: string
          cost_excl?: number | null
          created_at?: string
          id?: string
          label: string
          labour_hours?: number | null
          labour_rate?: number | null
          material_price_excl?: number | null
          material_product_id?: string | null
          notes?: string | null
          price_excl?: number | null
          sort_order?: number
          unit?: string
        }
        Update: {
          active?: boolean
          code?: string
          company_id?: string
          cost_excl?: number | null
          created_at?: string
          id?: string
          label?: string
          labour_hours?: number | null
          labour_rate?: number | null
          material_price_excl?: number | null
          material_product_id?: string | null
          notes?: string | null
          price_excl?: number | null
          sort_order?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "variation_rates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variation_rates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
          },
        ]
      }
      variation_settings: {
        Row: {
          company_id: string
          discount_pct: number
          threshold_excl: number
          updated_at: string
        }
        Insert: {
          company_id: string
          discount_pct?: number
          threshold_excl?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          discount_pct?: number
          threshold_excl?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "variation_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variation_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "company_stats"
            referencedColumns: ["company_id"]
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
      website_rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: number
          ip_hash: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: number
          ip_hash: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: number
          ip_hash?: string
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
            referencedRelation: "lead_invoice_status"
            referencedColumns: ["lead_id"]
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
      lead_invoice_status: {
        Row: {
          assigned_agent_id: string | null
          company_id: string | null
          completed_at: string | null
          created_by: string | null
          customer_address: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          invoice_id: string | null
          invoice_number: string | null
          invoice_state: string | null
          invoice_status: string | null
          invoice_total: number | null
          lead_id: string | null
          quote_id: string | null
          quote_number: string | null
          quote_status: string | null
          quote_total: number | null
          service_type: string | null
        }
        Relationships: [
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
        ]
      }
      live_supplier_products: {
        Row: {
          ai_sales_description: string | null
          ai_sales_description_generated_at: string | null
          allows_decimal_qty: boolean | null
          archived: boolean | null
          archived_at: string | null
          brand: string | null
          btu_rating: number | null
          calculated_price: number | null
          capacity_btu: number | null
          category: string | null
          cost_excl_vat: number | null
          cost_incl_vat: number | null
          cost_price: number | null
          created_at: string | null
          default_markup_percent: number | null
          description: string | null
          id: string | null
          image_url: string | null
          import_confidence: string | null
          import_flags: string[] | null
          inverter: boolean | null
          is_active: boolean | null
          is_material_favorite: boolean | null
          is_pinned: boolean | null
          is_price_on_request: boolean | null
          kw: number | null
          last_quoted_at: string | null
          list_price_raw: number | null
          markup_percent: number | null
          min_cut_length: number | null
          min_qty: number | null
          model: string | null
          model_range: string | null
          name: string | null
          original_cost_excl_vat: number | null
          pack_qty: number | null
          page_number: number | null
          pdf_page_id: string | null
          pdf_upload_id: string | null
          phase: string | null
          pin_order: number | null
          pipe_gas: string | null
          pipe_liquid: string | null
          pipe_size: string | null
          pipe_sizes_manual: boolean | null
          price_bbox: Json | null
          price_excl_vat: number | null
          price_includes_vat: boolean | null
          price_per_metre: number | null
          price_per_unit_label: string | null
          price_per_unit_qty: number | null
          pricing_mode: string | null
          product_category: string | null
          product_code: string | null
          product_type: string | null
          qty_step: number | null
          quote_usage_count: number | null
          refrigerant_type: string | null
          row_bbox: Json | null
          search_aliases: string[] | null
          search_tags: string | null
          sell_price_incl_vat: number | null
          selling_price: number | null
          short_name: string | null
          sold_in_length: boolean | null
          subcategory: string | null
          suggested_consumables: Json | null
          supplier_discount_percent: number | null
          supplier_id: string | null
          unit_length: number | null
          unit_length_unit: string | null
          unit_type: string | null
          updated_at: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          ai_sales_description?: string | null
          ai_sales_description_generated_at?: string | null
          allows_decimal_qty?: boolean | null
          archived?: boolean | null
          archived_at?: string | null
          brand?: string | null
          btu_rating?: number | null
          calculated_price?: number | null
          capacity_btu?: number | null
          category?: string | null
          cost_excl_vat?: number | null
          cost_incl_vat?: number | null
          cost_price?: number | null
          created_at?: string | null
          default_markup_percent?: number | null
          description?: string | null
          id?: string | null
          image_url?: string | null
          import_confidence?: string | null
          import_flags?: string[] | null
          inverter?: boolean | null
          is_active?: boolean | null
          is_material_favorite?: boolean | null
          is_pinned?: boolean | null
          is_price_on_request?: boolean | null
          kw?: number | null
          last_quoted_at?: string | null
          list_price_raw?: number | null
          markup_percent?: number | null
          min_cut_length?: number | null
          min_qty?: number | null
          model?: string | null
          model_range?: string | null
          name?: string | null
          original_cost_excl_vat?: number | null
          pack_qty?: number | null
          page_number?: number | null
          pdf_page_id?: string | null
          pdf_upload_id?: string | null
          phase?: string | null
          pin_order?: number | null
          pipe_gas?: string | null
          pipe_liquid?: string | null
          pipe_size?: string | null
          pipe_sizes_manual?: boolean | null
          price_bbox?: Json | null
          price_excl_vat?: number | null
          price_includes_vat?: boolean | null
          price_per_metre?: number | null
          price_per_unit_label?: string | null
          price_per_unit_qty?: number | null
          pricing_mode?: string | null
          product_category?: string | null
          product_code?: string | null
          product_type?: string | null
          qty_step?: number | null
          quote_usage_count?: number | null
          refrigerant_type?: string | null
          row_bbox?: Json | null
          search_aliases?: string[] | null
          search_tags?: string | null
          sell_price_incl_vat?: number | null
          selling_price?: number | null
          short_name?: string | null
          sold_in_length?: boolean | null
          subcategory?: string | null
          suggested_consumables?: Json | null
          supplier_discount_percent?: number | null
          supplier_id?: string | null
          unit_length?: number | null
          unit_length_unit?: string | null
          unit_type?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          ai_sales_description?: string | null
          ai_sales_description_generated_at?: string | null
          allows_decimal_qty?: boolean | null
          archived?: boolean | null
          archived_at?: string | null
          brand?: string | null
          btu_rating?: number | null
          calculated_price?: number | null
          capacity_btu?: number | null
          category?: string | null
          cost_excl_vat?: number | null
          cost_incl_vat?: number | null
          cost_price?: number | null
          created_at?: string | null
          default_markup_percent?: number | null
          description?: string | null
          id?: string | null
          image_url?: string | null
          import_confidence?: string | null
          import_flags?: string[] | null
          inverter?: boolean | null
          is_active?: boolean | null
          is_material_favorite?: boolean | null
          is_pinned?: boolean | null
          is_price_on_request?: boolean | null
          kw?: number | null
          last_quoted_at?: string | null
          list_price_raw?: number | null
          markup_percent?: number | null
          min_cut_length?: number | null
          min_qty?: number | null
          model?: string | null
          model_range?: string | null
          name?: string | null
          original_cost_excl_vat?: number | null
          pack_qty?: number | null
          page_number?: number | null
          pdf_page_id?: string | null
          pdf_upload_id?: string | null
          phase?: string | null
          pin_order?: number | null
          pipe_gas?: string | null
          pipe_liquid?: string | null
          pipe_size?: string | null
          pipe_sizes_manual?: boolean | null
          price_bbox?: Json | null
          price_excl_vat?: number | null
          price_includes_vat?: boolean | null
          price_per_metre?: number | null
          price_per_unit_label?: string | null
          price_per_unit_qty?: number | null
          pricing_mode?: string | null
          product_category?: string | null
          product_code?: string | null
          product_type?: string | null
          qty_step?: number | null
          quote_usage_count?: number | null
          refrigerant_type?: string | null
          row_bbox?: Json | null
          search_aliases?: string[] | null
          search_tags?: string | null
          sell_price_incl_vat?: number | null
          selling_price?: number | null
          short_name?: string | null
          sold_in_length?: boolean | null
          subcategory?: string | null
          suggested_consumables?: Json | null
          supplier_discount_percent?: number | null
          supplier_id?: string | null
          unit_length?: number | null
          unit_length_unit?: string | null
          unit_type?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
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
      pdf_activity_daily: {
        Row: {
          company_id: string | null
          day: string | null
          distinct_quotes: number | null
          downloads: number | null
          flagged: boolean | null
          full_name: string | null
          prints: number | null
          sends: number | null
          total: number | null
          user_id: string | null
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
      _acct_is_office: { Args: { p_company: string }; Returns: boolean }
      _acct_office_check: { Args: { p_company: string }; Returns: undefined }
      _acct_receipt_ok: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      _apply_commission_snapshot: { Args: { e: Json }; Returns: Json }
      _bank_norm: { Args: { t: string }; Returns: string }
      _cf_check: { Args: { p_company: string }; Returns: undefined }
      _cf_is_unit_line: {
        Args: {
          p_category: string
          p_is_bundle: boolean
          p_item_type: string
          p_name: string
          p_product_category: string
          p_product_code: string
          p_quote_category: string
          p_supplier_type: string
        }
        Returns: boolean
      }
      _cf_name_is_accessory: { Args: { p_name: string }; Returns: boolean }
      _cf_ok: { Args: { p_company: string }; Returns: boolean }
      _cf_sync_core: { Args: { p_company: string }; Returns: Json }
      _client_open_bookings: {
        Args: {
          p_address: string
          p_company: string
          p_customer: string
          p_email: string
          p_exclude: string
          p_name: string
          p_phone: string
        }
        Returns: {
          booked: boolean
          customer_name: string
          dup_ok: boolean
          lead_id: string
          match: string
          scheduled_date: string
          scheduled_time: string
          second_visit_of: string
          status: string
          tech_id: string
          tech_name: string
        }[]
      }
      _company_tech_ok: {
        Args: { p_company: string; p_tech: string }
        Returns: boolean
      }
      _create_balance_invoice: { Args: { p_quote_id: string }; Returns: string }
      _create_tech_ledger_for_job: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      _customer_statement_build: {
        Args: { p_customer: string; p_from: string; p_to: string }
        Returns: Json
      }
      _earnings_for_quote: {
        Args: { p_quote_id: string; p_viewer: string }
        Returns: Json
      }
      _first_fit: {
        Args: {
          p_after: number
          p_b: Json
          p_m: number
          p_we: number
          p_ws: number
        }
        Returns: number
      }
      _hb_admins: { Args: { p_company: string }; Returns: string[] }
      _hb_dispatch: { Args: { p_company: string }; Returns: string[] }
      _hb_limit: {
        Args: { p_company: string; p_default: number; p_key: string }
        Returns: number
      }
      _hb_nudge: {
        Args: {
          p_body: string
          p_company: string
          p_id: string
          p_level: number
          p_stage: string
          p_title: string
          p_type: string
          p_users: string[]
        }
        Returns: undefined
      }
      _hb_sales: { Args: { p_company: string }; Returns: string[] }
      _holiday_on: {
        Args: { p_company: string; p_date: string }
        Returns: string
      }
      _inv_cancel_waiting_drafts: {
        Args: { p_company: string }
        Returns: number
      }
      _inv_due: {
        Args: { p_created: string; p_due: string; p_issue: string }
        Returns: string
      }
      _inv_due_eff: { Args: { p_invoice: string }; Returns: string }
      _inv_job_done: { Args: { p_invoice: string }; Returns: string }
      _inv_message: {
        Args: {
          p_amount: number
          p_company: string
          p_due: string
          p_name: string
          p_no: string
          p_step: string
        }
        Returns: string
      }
      _inv_pay_schedule: {
        Args: { p_invoice: string }
        Returns: {
          deposit_amount: number
          deposit_date: string
          deposit_date_auto: boolean
          deposit_outstanding: number
          deposit_paid: number
          deposit_status: string
          final_after_days: number
          final_amount: number
          final_date: string
          final_date_auto: boolean
          final_outstanding: number
          final_paid: number
          final_status: string
          has_deposit: boolean
          invoice_id: string
          terms_days: number
        }[]
      }
      _inv_rep: { Args: { p_invoice: string }; Returns: string }
      _inv_step: {
        Args: { p_company: string; p_days: number }
        Returns: string
      }
      _inv_subject: { Args: { p_no: string; p_step: string }; Returns: string }
      _inv_terms: {
        Args: { p_invoice: string }
        Returns: Record<string, unknown>
      }
      _isa_send: {
        Args: { p_actor: string; p_decision: string; p_invoice_id: string }
        Returns: string
      }
      _job_after_photos: {
        Args: { p_lead_id: string; p_since: string }
        Returns: number
      }
      _job_alert_office: {
        Args: { _company: string; _uid: string }
        Returns: boolean
      }
      _job_client_email_post: {
        Args: {
          p_html: string
          p_sender: string
          p_subject: string
          p_to: string
        }
        Returns: number
      }
      _job_day_actor: {
        Args: { p_job_id: string }
        Returns: Record<string, unknown>
      }
      _job_day_time: { Args: { p_at: string }; Returns: string }
      _job_days_apply: {
        Args: { p_job: string; p_plan: Json; p_tech: string }
        Returns: undefined
      }
      _job_days_plan: {
        Args: {
          p_company: string
          p_days: number
          p_end: string
          p_job: string
          p_start: string
          p_tech: string
          p_with_clashes: boolean
        }
        Returns: Json
      }
      _job_stage: {
        Args: {
          j: Database["public"]["Tables"]["jobs"]["Row"]
          l: Database["public"]["Tables"]["leads"]["Row"]
        }
        Returns: string
      }
      _job_work_day: {
        Args: { p_company: string; p_date: string; p_profile: string }
        Returns: {
          end_time: string
          is_working: boolean
          reason: string
          start_time: string
        }[]
      }
      _km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      _lead_move_owner_rep: {
        Args: {
          p_is_move: boolean
          p_lead: Database["public"]["Tables"]["leads"]["Row"]
        }
        Returns: string
      }
      _lead_office: {
        Args: { p_company: string; p_uid: string }
        Returns: boolean
      }
      _lead_staff_ok: { Args: never; Returns: boolean }
      _mins_time: { Args: { p: number }; Returns: string }
      _norm_addr: { Args: { a: string }; Returns: string }
      _notify_rep_followers: {
        Args: { p_job: string; p_lead: string; p_stage: string }
        Returns: undefined
      }
      _p3_handoff_role: {
        Args: { _quote: string; _uid: string }
        Returns: string
      }
      _p3_is_tech: {
        Args: { _company: string; _pid: string }
        Returns: boolean
      }
      _p3_notify_unclaimed: { Args: { p_job: string }; Returns: undefined }
      _p3_offer_round: {
        Args: { p_job: string; p_round: number }
        Returns: number
      }
      _p3_suburb: { Args: { _addr: string }; Returns: string }
      _p6_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      _person_bookings: {
        Args: { p_date: string; p_profile_id: string }
        Returns: {
          agent_id: string
          customer_name: string
          end_time: string
          job_id: string
          lead_id: string
          schedule_id: string
          start_time: string
        }[]
      }
      _pf_amount_due: { Args: { p_invoice: string }; Returns: number }
      _pf_default_message: {
        Args: {
          p_amount: number
          p_company: string
          p_due: string
          p_name: string
          p_no: string
        }
        Returns: string
      }
      _pf_invoice_sent: {
        Args: { p_sent_at: string; p_sent_method: string; p_status: string }
        Returns: boolean
      }
      _pf_notify_owners: {
        Args: {
          p_body: string
          p_company: string
          p_id: string
          p_title: string
        }
        Returns: undefined
      }
      _pf_office: { Args: { p_company: string }; Returns: boolean }
      _pf_owner: { Args: { p_company: string }; Returns: boolean }
      _pf_tone_ok: { Args: { p_text: string }; Returns: boolean }
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
      _quote_admin_row: {
        Args: { p_quote: string }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          accepted_signature: Json | null
          accepted_version_id: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          client_summary: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          customer_id: string | null
          customer_name: string | null
          declined_at: string | null
          discount_type: string | null
          discount_value: number | null
          followup_count: number
          followup_kind: string | null
          followup_next_at: string | null
          followup_state: string | null
          id: string
          is_variation: boolean
          labour_included: boolean
          labour_mode: string
          lead_id: string | null
          legacy_original_total: number | null
          location_id: string | null
          locked_at: string | null
          locked_by: string | null
          locked_reason: string | null
          materials_markup_percent: number | null
          materials_waste_percent: number | null
          notes: string | null
          option_chosen_id: string | null
          option_group_id: string | null
          option_label: string | null
          owner_id: string | null
          parent_quote_id: string | null
          payment_plan: Json | null
          public_token: string | null
          quote_number: string | null
          reference_text: string | null
          relocation_clause: string | null
          remote_quote: boolean
          remote_quote_source: string | null
          sales_engineer_id: string
          sent_at: string | null
          sent_by: string | null
          sent_channel: string | null
          sent_method: string | null
          sent_note: string | null
          show_unit_cards: boolean
          site_id: string | null
          status: string
          subtotal: number
          superseded_by: string | null
          terms_text: string | null
          total: number
          units_markup_percent: number | null
          updated_at: string
          valid_until: string | null
          variation_job_id: string | null
          variation_summary: Json | null
          vat_amount: number
          vat_rate: number
          viewed_at: string | null
          visual_sections: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "quotes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _quote_delete_facts: {
        Args: { p_lead: string; p_quote: string }
        Returns: Json
      }
      _quote_is_visit: { Args: { p_quote: string }; Returns: boolean }
      _quote_snapshot: { Args: { p_quote: string }; Returns: Json }
      _rank_core: {
        Args: {
          p_date: string
          p_exclude_job: string
          p_exclude_lead: string
          p_lane: string
          p_lat: number
          p_lng: number
          p_minutes: number
          p_start: string
        }
        Returns: {
          best_start: string
          blocks: Json
          booked_minutes: number
          full_name: string
          km: number
          next_free: string
          profile_id: string
          reason: string
          sort_key: number
          status: string
          tier: number
          work_end: string
          work_start: string
        }[]
      }
      _rep_is_active: {
        Args: { p_company: string; p_rep: string }
        Returns: boolean
      }
      _rep_lead_fit: {
        Args: { p_lead: string; p_profile: string }
        Returns: {
          best_start: string
          fits: boolean
          km: number
          label: string
          reason: string
        }[]
      }
      _req_can_act: { Args: { p_req: string }; Returns: boolean }
      _req_event: {
        Args: {
          p_event: string
          p_new: string
          p_note?: string
          p_old: string
          p_req: string
        }
        Returns: undefined
      }
      _request_route: { Args: { p_req: string }; Returns: undefined }
      _same_client_booked: { Args: { p_lead: string }; Returns: boolean }
      _sb_recalc: { Args: { p_bill: string }; Returns: undefined }
      _slot_fits: {
        Args: {
          p_b: Json
          p_m: number
          p_s: number
          p_we: number
          p_ws: number
        }
        Returns: boolean
      }
      _slot_travel_eval: {
        Args: {
          b: Json
          p_lat: number
          p_lng: number
          v_bl: string
          v_blat: number
          v_blng: number
          v_m: number
          v_req: number
          we: number
          ws: number
        }
        Returns: {
          fits: boolean
          km: number
          label: string
          reason: string
        }[]
      }
      _snapshot_sales_commission: {
        Args: { p_quote_id: string }
        Returns: undefined
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
      _staff_slot_fit: {
        Args: {
          p_after?: string
          p_date: string
          p_exclude_lead: string
          p_lat: number
          p_lng: number
          p_minutes: number
          p_profile: string
          p_start: string
        }
        Returns: {
          best_start: string
          fits: boolean
          km: number
          label: string
          reason: string
        }[]
      }
      _tech_offer_fit: {
        Args: { p_lead: string; p_profile: string }
        Returns: {
          fits: boolean
          km: number
          label: string
          minutes: number
          minutes_source: string
          reason: string
          slot_date: string
          slot_start: string
        }[]
      }
      _tech_offer_minutes: {
        Args: { p_lead: string }
        Returns: {
          minutes: number
          source: string
        }[]
      }
      accept_company_contract: {
        Args: {
          p_signer_name: string
          p_user_agent?: string
          p_version?: string
        }
        Returns: Json
      }
      accept_quote: {
        Args: { p_quote_id: string; p_version_id: string }
        Returns: string
      }
      accept_quote_by_token: {
        Args: { p_accepted_by: string; p_signature?: Json; p_token: string }
        Returns: boolean
      }
      acknowledge_lead: { Args: { p_lead: string }; Returns: string }
      activate_pdf_book_gate: {
        Args: { p_pdf_upload_id: string; p_sample_n?: number }
        Returns: {
          brand: string
          cost_delta: number
          cost_ex: number
          discount_used: number
          expected_cost: number
          expected_sell: number
          gate_flag: string
          list_ex: number
          markup_used: number
          page_number: number
          product_code: string
          sell_minus_list: number
          selling_price: number
        }[]
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
      admin_correct_client_details: {
        Args: { p_changes: Json; p_quote_id: string; p_reason: string }
        Returns: Json
      }
      admin_create_quote_variation: {
        Args: { p_quote_id: string; p_reason: string }
        Returns: Json
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
      agreement_frequency_label: { Args: { _f: string }; Returns: string }
      apply_team_invite: {
        Args: { p_email: string; p_user: string }
        Returns: string
      }
      approve_client_job_message: {
        Args: { p_body: string; p_id: string; p_subject: string; p_to: string }
        Returns: {
          alert_id: string | null
          approved_at: string | null
          approved_by: string | null
          body: string
          channel: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          job_id: string
          net_request_id: number | null
          sent_via: string | null
          status: string
          subject: string | null
          to_address: string | null
        }
        SetofOptions: {
          from: "*"
          to: "job_client_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_company_signup: {
        Args: { p_approve: boolean; p_company?: string; p_user: string }
        Returns: string
      }
      approve_invoice_request: { Args: { p_id: string }; Returns: string }
      archive_customer_note: { Args: { p_id: string }; Returns: undefined }
      archive_void_invoice: {
        Args: { p_archive?: boolean; p_invoice_id: string }
        Returns: boolean
      }
      area_slot_suggestions: {
        Args: { p_date: string; p_lead: string; p_minutes?: number }
        Returns: Json
      }
      assign_lead_to_tech: {
        Args: {
          p_date: string
          p_end: string
          p_job_info?: string
          p_job_types?: string[]
          p_lead_id: string
          p_start: string
          p_tech_id: string
        }
        Returns: Json
      }
      backfill_leads_to_customers: { Args: never; Returns: Json }
      bank_match_suggestions: { Args: { p_line: string }; Returns: Json }
      booking_clashes: {
        Args: {
          p_date: string
          p_end: string
          p_exclude_job_id?: string
          p_exclude_lead_id?: string
          p_profile_id: string
          p_start: string
        }
        Returns: {
          end_time: string
          job_id: string
          kind: string
          label: string
          lead_id: string
          start_time: string
        }[]
      }
      booking_end_time: {
        Args: { p_dur: string; p_start: string }
        Returns: string
      }
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
      caller_company_id: { Args: never; Returns: string }
      caller_sees_lead: { Args: { _lead: string }; Returns: boolean }
      can_access_receipt_folder: { Args: { _folder: string }; Returns: boolean }
      can_close_lead: { Args: { p_lead: string }; Returns: boolean }
      can_log_job_overrun: {
        Args: { _job_id: string; _uid: string }
        Returns: boolean
      }
      can_log_overrun: {
        Args: { _job_id: string; _lead_id: string; _uid: string }
        Returns: boolean
      }
      can_manage_agreement_templates: {
        Args: { _uid: string }
        Returns: boolean
      }
      can_manage_profile_access: {
        Args: { _target_company: string; _target_participant: string }
        Returns: boolean
      }
      can_read_agreement_doc: {
        Args: { _name: string; _uid: string }
        Returns: boolean
      }
      can_read_agreement_template: {
        Args: { _company: string; _status: string; _uid: string }
        Returns: boolean
      }
      can_read_agreement_template_id: {
        Args: { _template_id: string; _uid: string }
        Returns: boolean
      }
      can_read_master_catalog: { Args: { _uid: string }; Returns: boolean }
      can_read_specials: { Args: { _uid: string }; Returns: boolean }
      can_see_agreement_contract: {
        Args: { _company: string; _customer: string; _uid: string }
        Returns: boolean
      }
      can_view_company_overruns: {
        Args: { _job_id: string; _uid: string }
        Returns: boolean
      }
      can_view_overrun: {
        Args: { _job_id: string; _lead_id: string; _uid: string }
        Returns: boolean
      }
      can_write_master_catalog: { Args: { _uid: string }; Returns: boolean }
      can_write_specials: { Args: { _uid: string }; Returns: boolean }
      cashflow_data: { Args: { p_company: string }; Returns: Json }
      cf_allocate_stock: {
        Args: { p_commitment: string; p_qty: number; p_stock_item: string }
        Returns: string
      }
      cf_stock_take: {
        Args: { p_clean?: boolean; p_company: string; p_rows: Json }
        Returns: number
      }
      cf_sync: { Args: { p_company: string }; Returns: Json }
      cf_unallocate_stock: {
        Args: { p_allocation: string }
        Returns: undefined
      }
      cf_vat_actuals: {
        Args: { p_company: string; p_from: string; p_to: string }
        Returns: Json
      }
      change_quote_client: {
        Args: { p_customer_id: string; p_quote_id: string }
        Returns: undefined
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
      check_lead_sla: { Args: never; Returns: number }
      claim_install_offer: { Args: { p_offer_id: string }; Returns: Json }
      claim_offer: {
        Args: { p_offer_id: string; p_staff_id: string }
        Returns: Json
      }
      classify_request: {
        Args: {
          p_ai_conf: number
          p_ai_intent: string
          p_company: string
          p_form_intent: string
          p_source: string
          p_text: string
        }
        Returns: Json
      }
      client_list_stats: {
        Args: never
        Returns: {
          customer_id: string
          last_activity: string
          sites: number
        }[]
      }
      client_open_bookings: {
        Args: {
          p_address?: string
          p_customer_id?: string
          p_email?: string
          p_exclude_lead?: string
          p_name?: string
          p_phone: string
        }
        Returns: {
          booked: boolean
          customer_name: string
          dup_ok: boolean
          lead_id: string
          match: string
          scheduled_date: string
          scheduled_time: string
          second_visit_of: string
          status: string
          tech_id: string
          tech_name: string
        }[]
      }
      close_lead: {
        Args: {
          p_lead: string
          p_note?: string
          p_outcome: string
          p_reason: string
        }
        Returns: string
      }
      company_profile_safe: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          default_deposit_percentage: number
          default_payment_terms_days: number
          logo_storage_path: string
          logo_url: string
          office_address: string
          physical_address: string
          postal_address: string
          vat_number: string
        }[]
      }
      company_profile_snapshot: { Args: { p_profile: string }; Returns: Json }
      confirm_bank_line: {
        Args: {
          p_category?: string
          p_kind: string
          p_line: string
          p_note?: string
          p_target?: string
          p_vat_claimable?: boolean
        }
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
      create_agreement_contract: {
        Args: {
          _customer_id: string
          _frequency?: string
          _invoice_ids?: string[]
          _job_ids?: string[]
          _service_agreement_id?: string
          _start_date?: string
          _template_id: string
        }
        Returns: string
      }
      create_balance_invoice_for_quote: {
        Args: { p_quote_id: string }
        Returns: string
      }
      create_change_order: { Args: { p_quote_id: string }; Returns: string }
      create_deposit_invoice_for_quote: {
        Args: { p_quote_id: string }
        Returns: string
      }
      create_draft_pos_for_invoice: {
        Args: { p_invoice: string }
        Returns: Json
      }
      create_portal_booking: {
        Args: { p_notes?: string; p_service_type: string; p_token: string }
        Returns: string
      }
      create_quote_bundle: {
        Args: { p_quote_ids: string[]; p_summaries?: Json }
        Returns: Json
      }
      create_quote_version: { Args: { p_quote_id: string }; Returns: string }
      create_stage_invoice_for_quote: {
        Args: { p_quote_id: string }
        Returns: string
      }
      create_statement_link: { Args: { p_customer: string }; Returns: string }
      customer_statement: {
        Args: { p_customer: string; p_from?: string; p_to?: string }
        Returns: Json
      }
      decide_client_revision: {
        Args: { p_approve: boolean; p_note?: string; p_revision_id: string }
        Returns: Json
      }
      decline_install_offer: { Args: { p_offer_id: string }; Returns: Json }
      decline_lead_reassignment: {
        Args: { p_request_id: string }
        Returns: Json
      }
      decline_quote_by_token: { Args: { p_token: string }; Returns: boolean }
      default_booking_minutes: { Args: { p_kind: string }; Returns: number }
      default_company_profile: { Args: { p_company: string }; Returns: string }
      delete_bill_payment: { Args: { p_payment: string }; Returns: undefined }
      delete_job_used_part: { Args: { p_id: string }; Returns: boolean }
      delete_or_archive_client: {
        Args: { p_customer_id: string; p_mode: string }
        Returns: Json
      }
      disablelongtransactions: { Args: never; Returns: string }
      discard_client_job_message: { Args: { p_id: string }; Returns: undefined }
      dismiss_lead: {
        Args: { p_lead: string; p_reason: string }
        Returns: string
      }
      dispatchable_technicians: {
        Args: { _company_id: string }
        Returns: {
          assignment_type: string
          full_name: string
          participant_type: string
          profile_id: string
        }[]
      }
      draft_client_job_message: {
        Args: { p_alert_id?: string; p_channel: string; p_job_id: string }
        Returns: {
          alert_id: string | null
          approved_at: string | null
          approved_by: string | null
          body: string
          channel: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          job_id: string
          net_request_id: number | null
          sent_via: string | null
          status: string
          subject: string | null
          to_address: string | null
        }
        SetofOptions: {
          from: "*"
          to: "job_client_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      drawing_admin_ok: { Args: { _company: string }; Returns: boolean }
      drawing_quote_ok: { Args: { _quote: string }; Returns: boolean }
      drive_minutes_estimate: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
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
      duplicate_invoice: { Args: { p_invoice: string }; Returns: string }
      duplicate_quote: {
        Args: { p_customer_id?: string; p_quote_id: string }
        Returns: string
      }
      earnings_sales_rule: { Args: { p_company_id: string }; Returns: Json }
      earnings_tech_rule: { Args: { p_company_id: string }; Returns: Json }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      expire_stale_quote_email_sends: {
        Args: { p_quote_id?: string }
        Returns: number
      }
      finalise_new_invoice: {
        Args: { p_invoice: string; p_status: string }
        Returns: undefined
      }
      finalise_variation_quote: { Args: { p_quote_id: string }; Returns: Json }
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
      fl_area_unit: {
        Args: { _area: string; _quote: string }
        Returns: Record<string, unknown>
      }
      fl_can_delete: { Args: { _uid: string }; Returns: boolean }
      fl_can_manage_quotes: {
        Args: { p_co: string; p_uid: string }
        Returns: boolean
      }
      fl_can_see_job: { Args: { _job: string; _uid: string }; Returns: boolean }
      fl_cancel_booking: {
        Args: {
          p_job_id?: string
          p_lead_id: string
          p_reason: string
          p_schedule_id?: string
        }
        Returns: Json
      }
      fl_company_unclaimed: { Args: { _co: string }; Returns: boolean }
      fl_create_job_variation: {
        Args: {
          p_actor: string
          p_items: Json
          p_job_id: string
          p_site_check_id?: string
          p_source: string
          p_unit_swaps: Json
        }
        Returns: Json
      }
      fl_customer_has_locked_work: {
        Args: { _customer: string }
        Returns: boolean
      }
      fl_end_of_sast_day: { Args: { p_at: string }; Returns: string }
      fl_found_company: {
        Args: {
          p_name: string
          p_rate: number
          p_services: string[]
          p_slug: string
        }
        Returns: string
      }
      fl_in_company: { Args: { _co: string; _u: string }; Returns: boolean }
      fl_inherit_sync_on: { Args: never; Returns: boolean }
      fl_inherited_terms: {
        Args: { _p: Database["public"]["Tables"]["company_profiles"]["Row"] }
        Returns: string
      }
      fl_is_company_office: {
        Args: { _company: string; _uid: string }
        Returns: boolean
      }
      fl_is_founder_approved: { Args: { _u: string }; Returns: boolean }
      fl_job_needs_site_check: { Args: { _job: string }; Returns: boolean }
      fl_lock_quote: {
        Args: { _actor: string; _quote: string; _reason: string }
        Returns: undefined
      }
      fl_master_company_id: { Args: never; Returns: string }
      fl_notify_job_techs: {
        Args: { _body: string; _job: string; _title: string; _type: string }
        Returns: undefined
      }
      fl_pipe_rate_code: {
        Args: { _area: string; _quote: string }
        Returns: string
      }
      fl_quote_admin: {
        Args: { _company: string; _uid: string }
        Returns: boolean
      }
      fl_quote_edit_block: { Args: { _quote: string }; Returns: string }
      fl_quote_has_install: { Args: { _quote: string }; Returns: boolean }
      fl_quote_issued_invoice: { Args: { _quote: string }; Returns: string }
      fl_reopen_booking: {
        Args: { p_job_id?: string; p_lead_id: string }
        Returns: Json
      }
      fl_sam_price_extras: { Args: { p_key: string }; Returns: Json }
      fl_shares_company: { Args: { _a: string; _b: string }; Returns: boolean }
      fl_shop_finalize: {
        Args: {
          p_amount_cents: number
          p_checkout_id: string
          p_environment: string
          p_gateway_payment_id: string
          p_order: string
          p_payload: Json
        }
        Returns: Json
      }
      fl_shop_item_public: { Args: { p_product: string }; Returns: Json }
      fl_shop_mark_emailed: { Args: { p_order: string }; Returns: undefined }
      fl_shop_order_create: {
        Args: {
          p_company: string
          p_contact: Json
          p_environment: string
          p_ip_hash: string
          p_notes: string
          p_preferred: Json
          p_rooms: Json
          p_terms_version: string
        }
        Returns: Json
      }
      fl_shop_order_note_event: {
        Args: { p_event: Json; p_order: string }
        Returns: undefined
      }
      fl_shop_order_set_checkout: {
        Args: { p_checkout_id: string; p_order: string }
        Returns: undefined
      }
      fl_shop_price_list: { Args: { p_company: string }; Returns: Json }
      fl_shop_quote: {
        Args: { p_company: string; p_internal?: boolean; p_rooms: Json }
        Returns: Json
      }
      fl_shop_sell_ex: {
        Args: { p_company: string; p_product: string }
        Returns: number
      }
      fl_shop_size_btu: { Args: { p_size: string }; Returns: number }
      fl_shop_tier_map_admin: { Args: { p_company: string }; Returns: Json }
      fl_shop_tier_map_set: {
        Args: {
          p_btu: number
          p_company: string
          p_product: string
          p_tier: string
        }
        Returns: undefined
      }
      fl_staff_manager: { Args: { _u: string }; Returns: boolean }
      fl_unschedule_booking: {
        Args: {
          p_job_id?: string
          p_lead_id: string
          p_reason?: string
          p_schedule_id?: string
        }
        Returns: Json
      }
      fl_variation_reprice: { Args: { _vq: string }; Returns: Json }
      fl_website_rate_hit: {
        Args: {
          p_endpoint: string
          p_ip_hash: string
          p_max: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      fl_working_minutes: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      fmt_rand_sql: { Args: { v: number }; Returns: string }
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
      get_applicant_email: { Args: { _id: string }; Returns: string }
      get_company_margin_settings: {
        Args: { p_company_id: string }
        Returns: {
          company_id: string
          gp_target_percent: number
          labour_cost_per_hour: number
          labour_tech_share_percent: number
          sales_commission_percent: number
        }[]
      }
      get_company_pricing_settings: {
        Args: { p_company_id: string }
        Returns: {
          company_id: string
          default_rate: number
          materials_markup_percent: number
          materials_waste_percent: number
          units_markup_percent: number
        }[]
      }
      get_company_quote_profit: {
        Args: { p_company_id: string }
        Returns: {
          commission: number
          company_profit: number
          cost: number
          full_view: boolean
          lines_costed: number
          lines_total: number
          quote_id: string
          rep_id: string
          sell_ex_vat: number
        }[]
      }
      get_company_tech_pay_settings: {
        Args: { p_company_id: string }
        Returns: Json
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
          acknowledged_at: string | null
          acknowledged_by: string | null
          actual_start_time: string | null
          agreement_id: string | null
          assigned_agent_id: string | null
          assignment_method: string | null
          assignment_score: number | null
          broadcast_radius_km: number | null
          call_area: string | null
          call_next_action: string | null
          call_summary: string | null
          call_summary_at: string | null
          call_summary_model: string | null
          call_urgency: string | null
          cancellation_reason: string | null
          classified_by: Database["public"]["Enums"]["lead_classifier"] | null
          close_note: string | null
          close_outcome: string | null
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string | null
          company_name: string | null
          completed_at: string | null
          confidence: number | null
          contact_attempts: number
          converted_at: string | null
          created_at: string | null
          created_by: string | null
          customer_address: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          deleted_at: string | null
          dismiss_reason: string | null
          dismissed_at: string | null
          dismissed_by: string | null
          dup_ok: boolean
          email: string | null
          equipment_id: string | null
          estimated_duration_minutes: number | null
          estimated_end_time: string | null
          external_id: string | null
          first_contact_at: string | null
          first_contact_channel: string | null
          id: string
          idempotency_key: string | null
          intents: string[]
          interaction_history: Json
          job_info: string | null
          job_types: string[] | null
          last_activity_at: string
          last_contact_attempt_at: string | null
          last_contact_outcome: string | null
          latitude: number
          lead_priority: Database["public"]["Enums"]["lead_priority_level"]
          lead_score: number | null
          lead_status: Database["public"]["Enums"]["lead_lifecycle_status"]
          location: unknown
          longitude: number
          marketing_followup: boolean
          merge_history: Json
          merged_into_id: string | null
          needs_manual_assignment: boolean
          normalized_address: string | null
          notes: string | null
          offer_count: number | null
          order_status: string | null
          parts_status: string | null
          phone: string | null
          pre_close_lead_status:
            | Database["public"]["Enums"]["lead_lifecycle_status"]
            | null
          pre_close_status: string | null
          primary_intent: Database["public"]["Enums"]["lead_intent"] | null
          priority: string
          quote_sla_breached_at: string | null
          raw_payload: Json | null
          scheduled_date: string | null
          scheduled_time: string | null
          second_visit_of: string | null
          service_type: string
          sla_breached_at: string | null
          source: Database["public"]["Enums"]["lead_source"]
          stage2_done_at: string | null
          started_at: string | null
          status: string
          technician_eta: string | null
          technician_name: string | null
          unit_id: string | null
          visit_booked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_customer_portal_data: { Args: { p_token: string }; Returns: Json }
      get_deposit_invoice_by_quote_token: {
        Args: { p_token: string }
        Returns: Json
      }
      get_field_deposit_chips: {
        Args: { p_lead_ids: string[] }
        Returns: {
          chip_state: string
          invoice_id: string
          lead_id: string
          remaining: number
        }[]
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
      get_job_packing_list: {
        Args: { p_job_id: string }
        Returns: {
          area_name: string
          area_sort: number
          item_code: string
          item_name: string
          kit_name: string
          line_sort: number
          qty_unit: string
          quantity: number
          supplier_length_m: number
        }[]
      }
      get_job_site_check: { Args: { p_job_id: string }; Returns: Json }
      get_job_used_parts: {
        Args: { p_lead_id: string }
        Returns: {
          created_at: string
          id: string
          line_total: number
          product_code: string
          product_id: string
          product_name: string
          quantity: number
          unit_cost: number
        }[]
      }
      get_lead_offer_flags: {
        Args: never
        Returns: {
          customer_name: string
          detail: string
          issue: string
          lead_id: string
          scheduled_date: string
          scheduled_time: string
        }[]
      }
      get_my_appointments: {
        Args: { p_days?: number }
        Returns: {
          address: string
          customer_id: string
          customer_name: string
          is_mine: boolean
          lead_id: string
          quote_id: string
          scheduled_date: string
          scheduled_time: string
          service_type: string
          source: string
          status: string
        }[]
      }
      get_my_assigned_jobs: {
        Args: { p_profile_id: string }
        Returns: {
          assignment_id: string
          assignment_notes: string
          assignment_status: string
          created_at: string
          customer_name: string
          customer_phone: string
          deposit_chip_state: string
          deposit_invoice_amount_paid: number
          deposit_invoice_grand_total: number
          deposit_invoice_id: string
          deposit_invoice_paid_date: string
          deposit_invoice_remaining: number
          deposit_invoice_status: string
          job_address: string
          job_description: string
          job_id: string
          job_priority: string
          job_quote_id: string
          job_scheduled_for: string
          job_status: string
          job_title: string
          job_type: string
        }[]
      }
      get_my_earnings: { Args: { p_quote_id?: string }; Returns: Json }
      get_my_pay_type: { Args: never; Returns: string }
      get_my_tech_earnings: {
        Args: never
        Returns: {
          amount: number
          hours: number
          job_date: string
          job_id: string
          job_name: string
          kind: string
          paid_at: string
          release_after: string
          row_key: string
          status: string
        }[]
      }
      get_my_visits: {
        Args: { p_days?: number }
        Returns: {
          address: string
          customer_id: string
          customer_name: string
          has_install_job: boolean
          is_mine: boolean
          lat: number
          lead_id: string
          lng: number
          notes: string
          offer_km: number
          offer_label: string
          phone: string
          primary_intent: string
          quote_accepted: boolean
          quote_id: string
          quote_number: string
          quote_status: string
          quote_total: number
          scheduled_date: string
          scheduled_time: string
          status: string
        }[]
      }
      get_or_create_customer_token: {
        Args: { p_customer_id: string }
        Returns: string
      }
      get_overdue_maintenance_count: { Args: never; Returns: number }
      get_owner_money_flow: { Args: { p_company_id?: string }; Returns: Json }
      get_product_sell_options: {
        Args: never
        Returns: {
          category: string
          description: string
          id: string
          is_pinned: boolean
          product_code: string
          sell_excl_vat: number
          short_name: string
        }[]
      }
      get_public_quote: { Args: { p_token: string }; Returns: Json }
      get_public_statement: { Args: { p_token: string }; Returns: Json }
      get_quote_by_public_token: { Args: { p_token: string }; Returns: string }
      get_quote_summary: {
        Args: { p_quote_id: string }
        Returns: {
          customer_name: string
          id: string
          quote_number: string
          status: string
          total: number
        }[]
      }
      get_quotes_for_lead: {
        Args: { p_lead_id: string }
        Returns: {
          created_at: string
          id: string
          public_token: string
          quote_number: string
          status: string
          total: number
        }[]
      }
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
      get_sales_tracker: { Args: { p_rep_id?: string }; Returns: Json }
      get_tech_catalogue: {
        Args: never
        Returns: {
          category: string
          id: string
          length: number
          length_unit: string
          model: string
          name: string
          unit: string
        }[]
      }
      get_tech_earnings: { Args: { p_tech_id?: string }; Returns: Json }
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
      gettransactionid: { Args: never; Returns: unknown }
      hand_to_technician: {
        Args: {
          p_date: string
          p_days?: number
          p_force?: boolean
          p_minutes: number
          p_mode: string
          p_quote_id: string
          p_reason?: string
          p_start: string
          p_tech_id?: string
        }
        Returns: Json
      }
      has_home_base: { Args: { p_profile_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_bank_lines: {
        Args: { p_account?: string; p_lines: Json }
        Returns: Json
      }
      increment_product_usage: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      install_handoff_status: { Args: { p_quote_id: string }; Returns: Json }
      invoice_amount_credited: {
        Args: { p_invoice_id: string }
        Returns: number
      }
      invoice_amount_paid: { Args: { p_invoice_id: string }; Returns: number }
      invoice_due_summary: {
        Args: never
        Returns: {
          amount_due: number
          customer_email: string
          customer_id: string
          customer_name: string
          days: number
          due: string
          followup_id: string
          followup_message: string
          followup_status: string
          followup_step: string
          followup_subject: string
          invoice_id: string
          invoice_number: string
          rep_id: string
          step: string
          terms_basis: string
          terms_days: number
          waiting: boolean
        }[]
      }
      invoice_email_preview: { Args: { p_invoice_id: string }; Returns: Json }
      invoice_payment_schedule: {
        Args: { p_invoice: string }
        Returns: {
          can_edit: boolean
          deposit_amount: number
          deposit_date: string
          deposit_date_auto: boolean
          deposit_outstanding: number
          deposit_paid: number
          deposit_status: string
          final_after_days: number
          final_amount: number
          final_date: string
          final_date_auto: boolean
          final_outstanding: number
          final_paid: number
          final_status: string
          has_deposit: boolean
          invoice_id: string
          terms_days: number
        }[]
      }
      invoice_send_hold: {
        Args: { p_invoice_id: string; p_reason?: string }
        Returns: Json
      }
      invoice_send_now: { Args: { p_invoice_id: string }; Returns: Json }
      is_agent_available_now: { Args: { p_agent_id: string }; Returns: boolean }
      is_approved_network_member: { Args: { _uid: string }; Returns: boolean }
      is_company_admin: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_company_owner: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_field_tech_only: { Args: { _uid: string }; Returns: boolean }
      is_master_company_user: { Args: { _uid: string }; Returns: boolean }
      is_my_company_owner: { Args: never; Returns: boolean }
      is_office_staff: { Args: { _uid: string }; Returns: boolean }
      is_ops_user: { Args: { _user_id: string }; Returns: boolean }
      is_parent_owner: { Args: { _uid: string }; Returns: boolean }
      is_platform_owner: { Args: never; Returns: boolean }
      is_sales_rep: { Args: { _uid: string }; Returns: boolean }
      is_staff_member: { Args: { _uid: string }; Returns: boolean }
      isa_assert_can_act: { Args: { p_invoice_id: string }; Returns: undefined }
      isa_can_act: {
        Args: { _company_id: string; _rep_id: string; _uid: string }
        Returns: boolean
      }
      isa_queue: { Args: { p_invoice_id: string }; Returns: string }
      isa_recipients: {
        Args: { _company_id: string; _rep_id: string }
        Returns: string[]
      }
      issue_credit_note: {
        Args: {
          p_amount?: number
          p_description?: string
          p_invoice_id: string
          p_issue_date?: string
          p_reason?: string
        }
        Returns: string
      }
      job_add_day: {
        Args: { p_force?: boolean; p_job_id: string; p_reason?: string }
        Returns: Json
      }
      job_day_en_route_plan: {
        Args: { p_date: string; p_job_id: string }
        Returns: Json
      }
      job_day_states: { Args: { p_from: string; p_to: string }; Returns: Json }
      job_days: { Args: { p_job_id: string }; Returns: Json }
      job_en_route_plan: { Args: { p_job_id: string }; Returns: Json }
      job_profit: {
        Args: { p_company: string; p_from: string; p_to: string }
        Returns: Json
      }
      job_profit_loss: {
        Args: { p_lead_id: string }
        Returns: {
          expenses: number
          profit: number
          revenue: number
        }[]
      }
      job_watch_cfg: {
        Args: { p_company_id: string }
        Returns: {
          company_id: string
          en_route_buffer_minutes: number
          en_route_fallback_minutes: number
          en_route_floor_minutes: number
          late_checkin_minutes: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "job_watch_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      job_watchdog_scan: { Args: never; Returns: number }
      lead_assign_options: {
        Args: { p_date?: string; p_lead_id: string }
        Returns: Json
      }
      lead_call_accept: { Args: { p_attempt: string }; Returns: Json }
      lead_call_candidates: {
        Args: { p_lead: string }
        Returns: {
          full_name: string
          km: number
          minutes: number
          phone: string
          pref: string
          profile_id: string
          role: string
          slot_date: string
          slot_start: string
        }[]
      }
      lead_call_statuses: {
        Args: never
        Returns: {
          at: string
          dry_run: boolean
          lead_id: string
          n_called: number
          n_no_answer: number
          n_passed: number
          person: string
          state: string
        }[]
      }
      lead_duplicate_flags: {
        Args: never
        Returns: {
          lead_id: string
          match: string
          n_others: number
          other_booked: boolean
          other_date: string
          other_lead_id: string
          other_status: string
          other_tech: string
          other_time: string
        }[]
      }
      lead_fill_call_summary: { Args: { p_lead: string }; Returns: boolean }
      lead_is_callout: {
        Args: { _intent: string; _service_type: string }
        Returns: boolean
      }
      lead_is_test: { Args: { p_name: string }; Returns: boolean }
      lead_lost_allowed: { Args: { p_lead: string }; Returns: boolean }
      lead_sla_next_open: {
        Args: {
          p_ts: string
          s: Database["public"]["Tables"]["lead_sla_settings"]["Row"]
        }
        Returns: string
      }
      link_products_to_pdf_book: {
        Args: { p_pdf_upload_id: string }
        Returns: {
          candidates: number
          linked: number
        }[]
      }
      link_quote_options: {
        Args: { p_labels?: Json; p_quote_ids: string[] }
        Returns: string
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
      log_lead_contact: {
        Args: { p_channel: string; p_lead_id: string; p_outcome: string }
        Returns: undefined
      }
      log_quote_followup: {
        Args: {
          p_next?: string
          p_note?: string
          p_quote: string
          p_result: string
        }
        Returns: string
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      mandy_usage_bump: {
        Args: {
          p_commands: number
          p_company: string
          p_mandy: string
          p_tts_calls: number
          p_tts_chars: number
          p_user: string
        }
        Returns: undefined
      }
      mark_document_sent: {
        Args: {
          p_channel: string
          p_id: string
          p_kind: string
          p_note?: string
        }
        Returns: Json
      }
      mark_overdue_maintenance: { Args: never; Returns: number }
      me_needs_password: { Args: never; Returns: boolean }
      my_company_contract_status: {
        Args: { p_company_id: string }
        Returns: {
          contract_signed_at: string
          name: string
          plan_base_price_zar: number
          plan_contract_months: number
          plan_extra_user_price_zar: number
          plan_included_users: number
          plan_status: string
        }[]
      }
      my_install_offers: { Args: never; Returns: Json }
      next_invoice_number: { Args: { p_profile: string }; Returns: string }
      normalize_model_code: { Args: { p: string }; Returns: string }
      normalize_phone: { Args: { phone: string }; Returns: string }
      notification_rep_allowed: {
        Args: { _related: string; _type: string; _uid: string }
        Returns: boolean
      }
      notify_quote_email_failed: {
        Args: { p_send: string }
        Returns: undefined
      }
      notify_specials_ending: { Args: never; Returns: number }
      open_double_bookings: {
        Args: { p_from: string; p_to: string }
        Returns: {
          a_end: string
          a_label: string
          a_start: string
          b_end: string
          b_label: string
          b_start: string
          booking_date: string
          full_name: string
          profile_id: string
        }[]
      }
      overrun_company_id: {
        Args: { _job_id: string; _lead_id: string }
        Returns: string
      }
      p4_co_ok: { Args: { _co: string }; Returns: boolean }
      p4_customer_ok: { Args: { _c: string }; Returns: boolean }
      p4_invoice_ok: { Args: { _i: string }; Returns: boolean }
      p4_is_ops: { Args: never; Returns: boolean }
      p4_is_platform: { Args: never; Returns: boolean }
      p4_job_ok: { Args: { _job: string }; Returns: boolean }
      p4_lead_ok: { Args: { _lead: string }; Returns: boolean }
      p4_quote_ok: { Args: { _q: string }; Returns: boolean }
      p4_user_ok: { Args: { _u: string }; Returns: boolean }
      p5_profile_visible: {
        Args: { _co: string; _p: string }
        Returns: boolean
      }
      p6_area_ok: { Args: { _admin: boolean; _area: string }; Returns: boolean }
      parent_overdue: { Args: { p_limit?: number }; Returns: Json }
      parent_overview: { Args: never; Returns: Json }
      past_quote_analytics: {
        Args: { p_job_type?: string }
        Returns: {
          avg_quantity: number
          avg_unit_price: number
          description: string
          usage_count: number
        }[]
      }
      payment_plan_ok: { Args: { p: Json }; Returns: boolean }
      pending_reassign_requests: {
        Args: never
        Returns: {
          created_at: string
          customer_name: string
          id: string
          lead_id: string
          requested_by_name: string
        }[]
      }
      pf_claim_send: { Args: { p_id: string }; Returns: Json }
      pf_decide: {
        Args: {
          p_approve: boolean
          p_id: string
          p_message?: string
          p_note?: string
          p_subject?: string
        }
        Returns: string
      }
      pf_flag_overdue: { Args: never; Returns: number }
      pf_request: {
        Args: { p_invoice: string; p_message?: string }
        Returns: string
      }
      phone_route_company: {
        Args: { p_assistant_id: string; p_business_phone: string }
        Returns: string
      }
      photo_folder_lead: { Args: { _name: string }; Returns: string }
      photo_lead_ok: { Args: { _lead: string }; Returns: boolean }
      photo_quote_ok: { Args: { _quote: string }; Returns: boolean }
      plan_admin_overview: { Args: never; Returns: Json }
      plan_admin_set: {
        Args: { p_company: string; p_mandy_enabled: boolean; p_status: string }
        Returns: Json
      }
      plan_enforce_daily: { Args: never; Returns: number }
      po_office_ok: { Args: { _company: string }; Returns: boolean }
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
      preview_job_days: {
        Args: {
          p_days?: number
          p_end_date?: string
          p_job_id?: string
          p_start_date: string
          p_tech_id: string
        }
        Returns: Json
      }
      process_due_invoice_sends: { Args: never; Returns: number }
      process_install_offers: { Args: never; Returns: number }
      process_invoice_followups: { Args: never; Returns: number }
      process_quote_followups: { Args: never; Returns: undefined }
      process_sales_escalations: { Args: never; Returns: undefined }
      project_admin_ok: { Args: { _company: string }; Returns: boolean }
      public_quote_adjust_data: { Args: { p_token: string }; Returns: Json }
      public_quote_bundle: { Args: { p_token: string }; Returns: Json }
      public_quote_change_state: { Args: { p_token: string }; Returns: Json }
      public_quote_documents: {
        Args: { p_token: string }
        Returns: {
          filename: string
          id: string
          size_bytes: number
        }[]
      }
      public_quote_drawings: {
        Args: { p_token: string }
        Returns: {
          filename: string
          id: string
          kind: string
        }[]
      }
      public_quote_show_unit_cards: {
        Args: { p_token: string }
        Returns: boolean
      }
      public_unit_brochure: {
        Args: { p_company?: string; p_model: string }
        Returns: Json
      }
      publish_inhouse_book: {
        Args: {
          p_file_name: string
          p_items: Json
          p_pages: Json
          p_pdf_url: string
          p_storage_path: string
          p_supplier_id: string
        }
        Returns: string
      }
      qa_notify_rep_and_admins: {
        Args: {
          p_body: string
          p_quote_id: string
          p_title: string
          p_type: string
        }
        Returns: undefined
      }
      qcr_drive: { Args: { p: string }; Returns: string }
      qcr_is_unit: {
        Args: {
          p_btu: number
          p_category: string
          p_has_product: boolean
          p_name: string
          p_type: string
        }
        Returns: boolean
      }
      qcr_items: {
        Args: { p_quote_id: string }
        Returns: {
          amount: number
          area_id: string
          area_name: string
          brand: string
          btu: number
          cost: number
          id: string
          image_url: string
          is_unit: boolean
          link: string
          name: string
          product_id: string
          qty: number
          sort: number
          unit_price: number
        }[]
      }
      qcr_pricing: { Args: { p_quote_id: string }; Returns: Json }
      qcr_revision_totals: { Args: { p_lines: Json; pr: Json }; Returns: Json }
      qcr_style: { Args: { p: string }; Returns: string }
      quote_archive: {
        Args: { p_quote: string; p_reason: string }
        Returns: Json
      }
      quote_auto_summary: { Args: { p_quote_id: string }; Returns: string }
      quote_bundle_preview: { Args: { p_quote_ids: string[] }; Returns: Json }
      quote_conversion_funnel: {
        Args: never
        Returns: {
          count: number
          status: string
        }[]
      }
      quote_delete: {
        Args: { p_delete_photos?: boolean; p_quote: string; p_reason: string }
        Returns: Json
      }
      quote_delete_check: { Args: { p_quote: string }; Returns: Json }
      quote_drawing_path_ok: {
        Args: { _admin_only: boolean; _name: string }
        Returns: boolean
      }
      quote_email_send_state: { Args: { p_quote_id: string }; Returns: Json }
      quote_lock_state: { Args: { p_quote_id: string }; Returns: Json }
      quote_move_back: {
        Args: { p_quote_id: string; p_reason: string }
        Returns: Json
      }
      quote_photo_ok: {
        Args: { _name: string; _read: boolean }
        Returns: boolean
      }
      quote_unarchive: { Args: { p_quote: string }; Returns: Json }
      quotes_followup_due_count: { Args: never; Returns: number }
      rank_booking_candidates: {
        Args: {
          p_date: string
          p_exclude_job?: string
          p_exclude_lead?: string
          p_lane: string
          p_lat: number
          p_lng: number
          p_minutes: number
          p_start: string
        }
        Returns: {
          blocks: Json
          booked_minutes: number
          full_name: string
          km: number
          next_free: string
          profile_id: string
          reason: string
          status: string
          tier: number
          work_end: string
          work_start: string
        }[]
      }
      reap_stuck_outbox: { Args: never; Returns: number }
      record_bill_payment: {
        Args: {
          p_amount: number
          p_bank_line?: string
          p_bill: string
          p_date?: string
          p_method?: string
          p_reference?: string
        }
        Returns: string
      }
      record_invoice_payment: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_method: string
          p_payment_date?: string
          p_reference?: string
        }
        Returns: string
      }
      relock_quote: { Args: { p_quote_id: string }; Returns: boolean }
      rep_can_see_customer: {
        Args: { _customer: string; _uid: string }
        Returns: boolean
      }
      rep_can_see_invoice: {
        Args: { _inv: string; _uid: string }
        Returns: boolean
      }
      rep_can_see_job: {
        Args: { _job: string; _uid: string }
        Returns: boolean
      }
      rep_can_see_lead: {
        Args: { _lead: string; _uid: string }
        Returns: boolean
      }
      rep_customer_ids: { Args: { _uid: string }; Returns: string[] }
      rep_follows_lead: {
        Args: { _lead: string; _uid: string }
        Returns: boolean
      }
      rep_offerable_leads: {
        Args: never
        Returns: {
          km: number
          label: string
          lead_id: string
        }[]
      }
      rep_owns_job: { Args: { _job: string; _uid: string }; Returns: boolean }
      rep_owns_lead: { Args: { _lead: string; _uid: string }; Returns: boolean }
      rep_owns_quote: {
        Args: { _quote: string; _uid: string }
        Returns: boolean
      }
      replace_quote_from_builder: {
        Args: {
          p_areas: Json
          p_items: Json
          p_quote_id: string
          p_subtotal: number
          p_total: number
          p_vat_amount: number
          p_vat_rate: number
        }
        Returns: undefined
      }
      request_add_keyword: {
        Args: {
          p_keyword: string
          p_type: Database["public"]["Enums"]["request_type"]
        }
        Returns: Json
      }
      request_call_report: {
        Args: { p_call_id: string; p_force?: boolean; p_test?: boolean }
        Returns: number
      }
      request_create: {
        Args: {
          p_area: string
          p_customer_id?: string
          p_name: string
          p_phone: string
          p_source?: string
          p_text: string
          p_type: Database["public"]["Enums"]["request_type"]
        }
        Returns: Json
      }
      request_lead_reassignment: {
        Args: {
          p_lead_id: string
          p_preferred_tech_id: string
          p_reason: string
        }
        Returns: Json
      }
      request_mark_contacted: {
        Args: { p_channel?: string; p_request_id: string }
        Returns: Json
      }
      request_mark_done: { Args: { p_request_id: string }; Returns: Json }
      request_quote_changes: {
        Args: {
          p_message: string
          p_name?: string
          p_phone?: string
          p_token: string
        }
        Returns: boolean
      }
      request_set_type: {
        Args: {
          p_request_id: string
          p_type: Database["public"]["Enums"]["request_type"]
        }
        Returns: Json
      }
      request_top_corrections: { Args: { p_days?: number }; Returns: Json }
      requests_inbox: { Args: { p_days?: number }; Returns: Json }
      requests_today_counts: { Args: never; Returns: Json }
      resolve_duplicate_lead: {
        Args: { p_action: string; p_lead: string; p_target: string }
        Returns: Json
      }
      respond_job_variation: {
        Args: { p_approve: boolean; p_name?: string; p_token: string }
        Returns: Json
      }
      restore_lead: { Args: { p_lead: string }; Returns: undefined }
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
      revoke_statement_links: { Args: { p_customer: string }; Returns: number }
      rh_assert: { Args: { _block_sales: boolean }; Returns: undefined }
      rh_ops_ok: { Args: { _company: string }; Returns: boolean }
      rh_photo_ok: { Args: { _name: string; _owner: string }; Returns: boolean }
      route_lead_to_company: {
        Args: { p_apply?: boolean; p_lead: string }
        Returns: Json
      }
      sales_my_jobs: { Args: { p_limit?: number }; Returns: Json }
      save_agreement_template: {
        Args: {
          _meta: Json
          _note?: string
          _sections: Json
          _template_id: string
        }
        Returns: number
      }
      save_lead_job_info: {
        Args: { p_job_info: string; p_job_types: string[]; p_lead_id: string }
        Returns: Json
      }
      schedule_in_user_company: {
        Args: { _job: string; _lead: string; _uid: string }
        Returns: boolean
      }
      schedule_job_days: {
        Args: {
          p_days?: number
          p_dry_run?: boolean
          p_end_date?: string
          p_force?: boolean
          p_job_id: string
          p_reason?: string
          p_start_date: string
          p_tech_id: string
        }
        Returns: Json
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
      set_commission_paid: {
        Args: { p_paid?: boolean; p_paid_at?: string; p_snapshot_id: string }
        Returns: Json
      }
      set_company_tech_pay_settings: {
        Args: {
          p_company_id: string
          p_holdback_days: number
          p_holdback_pct: number
          p_paid_pct: number
          p_tools_pct: number
        }
        Returns: Json
      }
      set_customer_final_after_days: {
        Args: { p_customer: string; p_days: number }
        Returns: undefined
      }
      set_customer_owner_rep: {
        Args: { p_customer_id: string; p_reason: string; p_rep_id: string }
        Returns: Json
      }
      set_customer_payment_terms: {
        Args: { p_basis: string; p_customer: string; p_days: number }
        Returns: undefined
      }
      set_install_handoff_default: { Args: { p_mode: string }; Returns: Json }
      set_invoice_final_unscheduled: {
        Args: { p_invoice: string; p_on: boolean }
        Returns: undefined
      }
      set_invoice_payment_dates: {
        Args: {
          p_deposit_date: string
          p_final_after_days: number
          p_final_date: string
          p_invoice: string
        }
        Returns: undefined
      }
      set_invoice_payment_terms: {
        Args: { p_basis: string; p_days: number; p_invoice: string }
        Returns: undefined
      }
      set_my_availability: {
        Args: { p_manual?: boolean; p_status: string }
        Returns: string
      }
      set_quote_labour_mode: {
        Args: {
          p_area_units?: Json
          p_mode: string
          p_per_unit_hours: number
          p_quote_id: string
        }
        Returns: undefined
      }
      set_tech_earning_status: {
        Args: {
          p_action: string
          p_callback_job_id?: string
          p_id: string
          p_note?: string
          p_paid_at?: string
          p_reduction?: number
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      ss_can_write: { Args: { _survey: string }; Returns: boolean }
      ss_folder_ok: { Args: { _name: string }; Returns: boolean }
      ss_folder_survey: { Args: { _name: string }; Returns: string }
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
      staff_busy_blocks: {
        Args: { p_from: string; p_to: string }
        Returns: {
          block_date: string
          end_time: string
          kind: string
          label: string
          profile_id: string
          start_time: string
        }[]
      }
      staff_is_available: { Args: { p_uid: string }; Returns: boolean }
      staff_work_window: {
        Args: { p_date: string; p_profile_id: string }
        Returns: {
          end_time: string
          is_working: boolean
          source: string
          start_time: string
        }[]
      }
      submit_client_revision: {
        Args: {
          p_lines: Json
          p_name?: string
          p_note?: string
          p_token: string
        }
        Returns: Json
      }
      submit_invoice_request: {
        Args: {
          p_extra_hours?: number
          p_extra_items?: Json
          p_finished_at?: string
          p_job_id?: string
          p_lead_id: string
          p_note?: string
          p_started_at?: string
        }
        Returns: string
      }
      submit_site_check: {
        Args: {
          p_checklist: Json
          p_items?: Json
          p_job_id: string
          p_notes?: string
          p_result: string
          p_unit_swaps?: Json
        }
        Returns: Json
      }
      suggest_booking_slots: {
        Args: {
          p_date: string
          p_exclude_job?: string
          p_exclude_lead?: string
          p_lane: string
          p_lat: number
          p_lng: number
          p_minutes: number
        }
        Returns: {
          full_name: string
          profile_id: string
          reason: string
          slot_date: string
          slot_start: string
        }[]
      }
      tech_accept_lead: {
        Args: {
          p_address?: string
          p_date: string
          p_description?: string
          p_end?: string
          p_lead: string
          p_location_id?: string
          p_minutes: number
          p_priority?: string
          p_time: string
          p_title?: string
        }
        Returns: Json
      }
      tech_can_see_customer: {
        Args: { _customer: string; _uid: string }
        Returns: boolean
      }
      tech_can_see_job: {
        Args: { _job: string; _uid: string }
        Returns: boolean
      }
      tech_can_see_lead: {
        Args: { _lead: string; _uid: string }
        Returns: boolean
      }
      tech_check_in: {
        Args: { p_at?: string; p_job_id: string }
        Returns: Json
      }
      tech_day_en_route: {
        Args: { p_at?: string; p_job_id: string }
        Returns: Json
      }
      tech_done_for_today: {
        Args: {
          p_at?: string
          p_client_name?: string
          p_client_signature?: string
          p_edit_note?: string
          p_hours?: number
          p_job_id: string
          p_notes?: string
          p_signoff_name?: string
          p_tech_signature?: string
        }
        Returns: Json
      }
      tech_offers: { Args: { p_profile?: string }; Returns: Json }
      tech_owns_lead: {
        Args: { _lead: string; _uid: string }
        Returns: boolean
      }
      tech_set_job_status: {
        Args: { p_job_id: string; p_status: string }
        Returns: string
      }
      unconvert_lead: { Args: { p_lead_id: string }; Returns: undefined }
      unlink_quote_option: { Args: { p_quote_id: string }; Returns: boolean }
      unlock_quote: {
        Args: { p_quote_id: string; p_reason: string }
        Returns: boolean
      }
      unlockrows: { Args: { "": string }; Returns: number }
      unmatch_bank_line: { Args: { p_line: string }; Returns: undefined }
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
      vat_rate_for: { Args: { p_date: string }; Returns: number }
      vat_report_lines: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      void_credit_note: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
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
        | "resolved_before_visit"
      lead_priority_level: "emergency" | "same_day" | "standard"
      lead_source:
        | "vapi_call"
        | "website_form"
        | "facebook_lead_ads"
        | "google_lsa"
        | "manual"
        | "other"
        | "website_shop"
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
      request_type: "new_sale" | "service" | "move" | "admin"
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
        "resolved_before_visit",
      ],
      lead_priority_level: ["emergency", "same_day", "standard"],
      lead_source: [
        "vapi_call",
        "website_form",
        "facebook_lead_ads",
        "google_lsa",
        "manual",
        "other",
        "website_shop",
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
      request_type: ["new_sale", "service", "move", "admin"],
    },
  },
} as const
