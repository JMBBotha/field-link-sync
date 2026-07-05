import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, CreditCard, Wrench, Users, MapPin, Database, BarChart3, Palette } from "lucide-react";
import AppearanceTab from "@/components/settings/AppearanceTab";
import CompanyProfileTab from "@/components/settings/CompanyProfileTab";
import BillingTab from "@/components/settings/BillingTab";
import ServicesTab from "@/components/settings/ServicesTab";
import AgentManagementTab from "@/components/settings/AgentManagementTab";
import { useBroadcastSettings } from "@/hooks/useBroadcastSettings";
import GeofenceSettings from "@/components/GeofenceSettings";
import SampleDataLoader from "@/components/settings/SampleDataLoader";
import AppUsageTab from "@/components/settings/AppUsageTab";

const AdminSettingsPage = () => {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Settings</h2>
      <Tabs defaultValue="company">
        <TabsList className="grid grid-cols-4 md:grid-cols-8 w-full max-w-4xl">
          <TabsTrigger value="company" className="gap-1 text-xs md:text-sm">
            <Building2 className="h-4 w-4 hidden sm:block" />Company
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-1 text-xs md:text-sm">
            <CreditCard className="h-4 w-4 hidden sm:block" />Billing
          </TabsTrigger>
          <TabsTrigger value="services" className="gap-1 text-xs md:text-sm">
            <Wrench className="h-4 w-4 hidden sm:block" />Services
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1 text-xs md:text-sm">
            <Users className="h-4 w-4 hidden sm:block" />Agents
          </TabsTrigger>
          <TabsTrigger value="geofence" className="gap-1 text-xs md:text-sm">
            <MapPin className="h-4 w-4 hidden sm:block" />Geofence
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-1 text-xs md:text-sm">
            <Database className="h-4 w-4 hidden sm:block" />Data
          </TabsTrigger>
          <TabsTrigger value="usage" className="gap-1 text-xs md:text-sm">
            <BarChart3 className="h-4 w-4 hidden sm:block" />Usage
          </TabsTrigger>
          <TabsTrigger value="appearance" className="gap-1 text-xs md:text-sm">
            <Palette className="h-4 w-4 hidden sm:block" />Appearance
          </TabsTrigger>
        </TabsList>
        <TabsContent value="company"><CompanyProfileTab /></TabsContent>
        <TabsContent value="billing"><BillingTab /></TabsContent>
        <TabsContent value="services"><ServicesTab /></TabsContent>
        <TabsContent value="agents"><AgentManagementTab /></TabsContent>
        <TabsContent value="geofence"><GeofenceSettings /></TabsContent>
        <TabsContent value="data"><SampleDataLoader /></TabsContent>
        <TabsContent value="usage"><AppUsageTab /></TabsContent>
        <TabsContent value="appearance"><AppearanceTab /></TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminSettingsPage;
