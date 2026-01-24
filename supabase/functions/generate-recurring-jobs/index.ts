import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get agreements due for service within the next 7 days
    const { data: dueAgreements, error: fetchError } = await supabase
      .rpc("get_agreements_due_for_service", { days_ahead: 7 });

    if (fetchError) {
      throw fetchError;
    }

    console.log(`Found ${dueAgreements?.length || 0} agreements due for service`);

    const createdLeads: string[] = [];
    const errors: string[] = [];

    for (const agreement of dueAgreements || []) {
      try {
        // Get contract type label
        const contractLabels: Record<string, string> = {
          annual_ac_maintenance: "Annual AC Maintenance",
          biannual_heater_check: "Bi-Annual Heater Check",
          quarterly_filter: "Quarterly Filter Service",
          monthly_checkup: "Monthly Checkup",
          custom: agreement.contract_type_custom || "Custom Maintenance",
        };
        
        const serviceDescription = contractLabels[agreement.contract_type] || agreement.contract_type;

        // Create lead from agreement
        const { data: lead, error: insertError } = await supabase
          .from("leads")
          .insert({
            customer_name: agreement.customer_name,
            customer_phone: agreement.customer_phone,
            customer_address: agreement.customer_address || "Address not specified",
            latitude: agreement.customer_lat || 0,
            longitude: agreement.customer_lng || 0,
            service_type: "Scheduled Maintenance",
            notes: `${serviceDescription} - Scheduled Maintenance\n\nThis is an automatically generated job from a service agreement.`,
            priority: "high", // Contract jobs are high priority
            status: "pending",
            agreement_id: agreement.agreement_id,
            scheduled_date: agreement.next_service_due,
            customer_id: agreement.customer_id,
            equipment_id: agreement.equipment_id,
          })
          .select()
          .single();

        if (insertError) {
          errors.push(`Agreement ${agreement.agreement_id}: ${insertError.message}`);
          continue;
        }

        // Calculate next service date based on frequency
        let nextDate: Date;
        const currentDue = new Date(agreement.next_service_due);
        
        switch (agreement.frequency) {
          case "monthly":
            nextDate = new Date(currentDue.setMonth(currentDue.getMonth() + 1));
            break;
          case "quarterly":
            nextDate = new Date(currentDue.setMonth(currentDue.getMonth() + 3));
            break;
          case "biannual":
            nextDate = new Date(currentDue.setMonth(currentDue.getMonth() + 6));
            break;
          case "annual":
          default:
            nextDate = new Date(currentDue.setFullYear(currentDue.getFullYear() + 1));
            break;
        }

        // Update agreement with new next_service_due
        const { error: updateError } = await supabase
          .from("service_agreements")
          .update({
            next_service_due: nextDate.toISOString().split("T")[0],
            updated_at: new Date().toISOString(),
          })
          .eq("id", agreement.agreement_id);

        if (updateError) {
          errors.push(`Failed to update agreement ${agreement.agreement_id}: ${updateError.message}`);
        }

        createdLeads.push(lead.id);
        console.log(`Created lead ${lead.id} for agreement ${agreement.agreement_id}`);
      } catch (err) {
        errors.push(`Agreement ${agreement.agreement_id}: ${err}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${dueAgreements?.length || 0} agreements`,
        leads_created: createdLeads.length,
        lead_ids: createdLeads,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in generate-recurring-jobs:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
