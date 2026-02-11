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
      audit_log: {
        Row: {
          action: string
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
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bundle_items: {
        Row: {
          bundle_id: string
          created_at: string
          id: string
          is_length_item: boolean
          length_metres: number | null
          notes: string | null
          quantity: number
          sort_order: number
          supplier_product_id: string
        }
        Insert: {
          bundle_id: string
          created_at?: string
          id?: string
          is_length_item?: boolean
          length_metres?: number | null
          notes?: string | null
          quantity?: number
          sort_order?: number
          supplier_product_id: string
        }
        Update: {
          bundle_id?: string
          created_at?: string
          id?: string
          is_length_item?: boolean
          length_metres?: number | null
          notes?: string | null
          quantity?: number
          sort_order?: number
          supplier_product_id?: string
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
          secondary_phone: string | null
          status: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          area?: string | null
          city?: string | null
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
          secondary_phone?: string | null
          status?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          area?: string | null
          city?: string | null
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
          secondary_phone?: string | null
          status?: string | null
          updated_at?: string
          vat_number?: string | null
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
      installation_bundles: {
        Row: {
          ac_type: string | null
          btu_rating: number | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          pipe_size: string | null
          updated_at: string
        }
        Insert: {
          ac_type?: string | null
          btu_rating?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          pipe_size?: string | null
          updated_at?: string
        }
        Update: {
          ac_type?: string | null
          btu_rating?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
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
          unit_id: string | null
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
          unit_id?: string | null
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
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
          read?: boolean
          related_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          method: string
          payment_date: string
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          method: string
          payment_date?: string
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          method?: string
          payment_date?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
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
      profiles: {
        Row: {
          availability_status: string | null
          avatar_url: string | null
          created_at: string | null
          full_name: string
          home_base_lat: number | null
          home_base_lng: number | null
          id: string
          jobs_limit: number
          last_availability_update: string | null
          location_tracking_enabled: boolean | null
          onboarding_completed: boolean
          phone: string | null
          stripe_customer_id: string | null
          subscription_plan: string
          subscription_status: string
          trial_ends_at: string | null
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
          jobs_limit?: number
          last_availability_update?: string | null
          location_tracking_enabled?: boolean | null
          onboarding_completed?: boolean
          phone?: string | null
          stripe_customer_id?: string | null
          subscription_plan?: string
          subscription_status?: string
          trial_ends_at?: string | null
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
          jobs_limit?: number
          last_availability_update?: string | null
          location_tracking_enabled?: boolean | null
          onboarding_completed?: boolean
          phone?: string | null
          stripe_customer_id?: string | null
          subscription_plan?: string
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      quote_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          quantity: number
          quote_id: string
          service_id: string | null
          total: number | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          quantity: number
          quote_id: string
          service_id?: string | null
          total?: number | null
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          quantity?: number
          quote_id?: string
          service_id?: string | null
          total?: number | null
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
      quotes: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          accepted_signature: Json | null
          created_at: string
          customer_id: string | null
          declined_at: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          lead_id: string | null
          notes: string | null
          public_token: string | null
          quote_number: string
          reference_text: string | null
          sales_engineer_id: string
          sent_at: string | null
          status: string
          subtotal: number
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
          created_at?: string
          customer_id?: string | null
          declined_at?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          public_token?: string | null
          quote_number?: string
          reference_text?: string | null
          sales_engineer_id: string
          sent_at?: string | null
          status?: string
          subtotal?: number
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
          created_at?: string
          customer_id?: string | null
          declined_at?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          public_token?: string | null
          quote_number?: string
          reference_text?: string | null
          sales_engineer_id?: string
          sent_at?: string | null
          status?: string
          subtotal?: number
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
        ]
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
          unit_id: string | null
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
          unit_id?: string | null
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
          unit_id?: string | null
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
      supplier_products: {
        Row: {
          archived: boolean
          archived_at: string | null
          brand: string | null
          btu_rating: number | null
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
          inverter: boolean | null
          is_active: boolean
          is_pinned: boolean
          is_price_on_request: boolean
          last_quoted_at: string | null
          min_cut_length: number
          model_range: string | null
          pin_order: number
          pipe_size: string | null
          price_per_metre: number | null
          product_category: string
          product_code: string
          product_type: string
          quote_usage_count: number
          refrigerant_type: string | null
          rrp: number | null
          selling_price: number | null
          short_name: string | null
          sold_in_length: boolean
          subcategory: string | null
          supplier_discount_percent: number
          supplier_id: string
          unit_length: number | null
          unit_length_unit: string
          unit_type: string | null
          updated_at: string
          vat_rate: number
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          brand?: string | null
          btu_rating?: number | null
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
          inverter?: boolean | null
          is_active?: boolean
          is_pinned?: boolean
          is_price_on_request?: boolean
          last_quoted_at?: string | null
          min_cut_length?: number
          model_range?: string | null
          pin_order?: number
          pipe_size?: string | null
          price_per_metre?: number | null
          product_category?: string
          product_code: string
          product_type?: string
          quote_usage_count?: number
          refrigerant_type?: string | null
          rrp?: number | null
          selling_price?: number | null
          short_name?: string | null
          sold_in_length?: boolean
          subcategory?: string | null
          supplier_discount_percent?: number
          supplier_id: string
          unit_length?: number | null
          unit_length_unit?: string
          unit_type?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          brand?: string | null
          btu_rating?: number | null
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
          inverter?: boolean | null
          is_active?: boolean
          is_pinned?: boolean
          is_price_on_request?: boolean
          last_quoted_at?: string | null
          min_cut_length?: number
          model_range?: string | null
          pin_order?: number
          pipe_size?: string | null
          price_per_metre?: number | null
          product_category?: string
          product_code?: string
          product_type?: string
          quote_usage_count?: number
          refrigerant_type?: string | null
          rrp?: number | null
          selling_price?: number | null
          short_name?: string | null
          sold_in_length?: boolean
          subcategory?: string | null
          supplier_discount_percent?: number
          supplier_id?: string
          unit_length?: number | null
          unit_length_unit?: string
          unit_type?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
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
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          default_price_column: string | null
          default_vat_rate: number
          id: string
          is_active: boolean
          name: string
          notes: string | null
          price_includes_markup: boolean
          price_includes_vat: boolean
          supplier_discount_percent: number
          supplier_markup_percent: number
          supplier_type: string
          updated_at: string
          website: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          default_price_column?: string | null
          default_vat_rate?: number
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          price_includes_markup?: boolean
          price_includes_vat?: boolean
          supplier_discount_percent?: number
          supplier_markup_percent?: number
          supplier_type?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          default_price_column?: string | null
          default_vat_rate?: number
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          price_includes_markup?: boolean
          price_includes_vat?: boolean
          supplier_discount_percent?: number
          supplier_markup_percent?: number
          supplier_type?: string
          updated_at?: string
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
      accept_quote_by_token: {
        Args: { p_accepted_by: string; p_signature?: Json; p_token: string }
        Returns: boolean
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
      convert_time_to_invoice_items: {
        Args: {
          p_hourly_rate?: number
          p_invoice_id: string
          p_lead_id: string
        }
        Returns: number
      }
      decline_quote_by_token: { Args: { p_token: string }; Returns: boolean }
      generate_invoice_number: { Args: never; Returns: string }
      generate_maintenance_schedules: {
        Args: { months_ahead?: number }
        Returns: number
      }
      generate_quote_number: { Args: never; Returns: string }
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
      get_or_create_customer_token: {
        Args: { p_customer_id: string }
        Returns: string
      }
      get_overdue_maintenance_count: { Args: never; Returns: number }
      get_quote_by_public_token: { Args: { p_token: string }; Returns: string }
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
      job_profit_loss: {
        Args: { p_lead_id: string }
        Returns: {
          expenses: number
          profit: number
          revenue: number
        }[]
      }
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      validate_customer_token: { Args: { p_token: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "field_agent" | "dispatcher" | "viewer"
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
      app_role: ["admin", "field_agent", "dispatcher", "viewer"],
      availability_status: ["available", "busy", "offline"],
      equipment_type: ["ac", "heater", "vent", "heat_pump", "furnace", "other"],
    },
  },
} as const
