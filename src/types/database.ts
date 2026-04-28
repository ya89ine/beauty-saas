export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      clinics: {
        Row: {
          id: string
          created_at: string
          name: string
          slug: string
          owner_id: string
          email: string | null
          phone: string | null
          address: string | null
          logo_url: string | null
          timezone: string
          booking_enabled: boolean
          subscription_status: 'trial' | 'active' | 'paused'
          admin_notes: string | null
          monthly_price: number | null
          billing_notes: string | null
          trial_started_at: string | null
          trial_ends_at: string | null
          current_period_end: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          name: string
          slug: string
          owner_id: string
          email?: string | null
          phone?: string | null
          address?: string | null
          logo_url?: string | null
          timezone?: string
          booking_enabled?: boolean
          subscription_status?: 'trial' | 'active' | 'paused'
          admin_notes?: string | null
          monthly_price?: number | null
          billing_notes?: string | null
          trial_started_at?: string | null
          trial_ends_at?: string | null
          current_period_end?: string | null
        }
        Update: Partial<Database['public']['Tables']['clinics']['Insert']>
        Relationships: []
      }
      staff: {
        Row: {
          id: string
          created_at: string
          clinic_id: string
          user_id: string | null
          name: string
          email: string
          phone: string | null
          role: 'owner' | 'manager' | 'staff'
          avatar_url: string | null
          is_active: boolean
        }
        Insert: {
          id?: string
          created_at?: string
          clinic_id: string
          user_id?: string | null
          name: string
          email: string
          phone?: string | null
          role?: 'owner' | 'manager' | 'staff'
          avatar_url?: string | null
          is_active?: boolean
        }
        Update: Partial<Database['public']['Tables']['staff']['Insert']>
        Relationships: []
      }
      services: {
        Row: {
          id: string
          created_at: string
          clinic_id: string
          name: string
          description: string | null
          duration_minutes: number
          price: number
          currency: string
          category: string | null
          is_active: boolean
          color: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          clinic_id: string
          name: string
          description?: string | null
          duration_minutes: number
          price: number
          currency?: string
          category?: string | null
          is_active?: boolean
          color?: string | null
        }
        Update: Partial<Database['public']['Tables']['services']['Insert']>
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          created_at: string
          clinic_id: string
          name: string
          email: string | null
          phone: string | null
          notes: string | null
          date_of_birth: string | null
          avatar_url: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          clinic_id: string
          name: string
          email?: string | null
          phone?: string | null
          notes?: string | null
          date_of_birth?: string | null
          avatar_url?: string | null
        }
        Update: Partial<Database['public']['Tables']['clients']['Insert']>
        Relationships: []
      }
      appointments: {
        Row: {
          id: string
          created_at: string
          clinic_id: string
          client_id: string | null
          staff_id: string | null
          service_id: string
          starts_at: string
          ends_at: string
          status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
          notes: string | null
          client_name: string
          client_email: string | null
          client_phone: string | null
          price: number | null
          is_paid: boolean
          package_id: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          clinic_id: string
          client_id?: string | null
          staff_id?: string | null
          service_id: string
          starts_at: string
          ends_at: string
          status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
          notes?: string | null
          client_name: string
          client_email?: string | null
          client_phone?: string | null
          price?: number | null
          is_paid?: boolean
          package_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['appointments']['Insert']>
        Relationships: []
      }
      treatment_packages: {
        Row: {
          id: string
          created_at: string
          clinic_id: string
          client_id: string
          service_id: string | null
          package_name: string
          total_price: number
          paid_amount: number
          total_sessions: number
          completed_sessions: number
          status: 'active' | 'completed' | 'cancelled'
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          clinic_id: string
          client_id: string
          service_id?: string | null
          package_name: string
          total_price?: number
          paid_amount?: number
          total_sessions?: number
          completed_sessions?: number
          status?: 'active' | 'completed' | 'cancelled'
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['treatment_packages']['Insert']>
        Relationships: []
      }
      package_payments: {
        Row: {
          id: string
          created_at: string
          package_id: string
          clinic_id: string
          amount: number
          paid_at: string
          payment_method: string
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          package_id: string
          clinic_id: string
          amount: number
          paid_at?: string
          payment_method?: string
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['package_payments']['Insert']>
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_clinic_with_owner: {
        Args: {
          p_name: string
          p_slug: string
          p_email?: string | null
          p_phone?: string | null
        }
        Returns: string
      }
      is_clinic_staff: {
        Args: { p_clinic_id: string }
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

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type Clinic = Tables<'clinics'>
export type Staff = Tables<'staff'>
export type Service = Tables<'services'>
export type Client = Tables<'clients'>
export type Appointment = Tables<'appointments'>
export type AppointmentStatus = Appointment['status']
export type TreatmentPackage = Tables<'treatment_packages'>
export type PackagePayment = Tables<'package_payments'>
