import { Fragment, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntityEditor } from "@/hooks/useEntityEditor";
import type { EntityType, EntityFieldConfig } from "@/lib/entityRegistry";
import {
  EditableField,
  EditableSelect,
  EditableDateTime,
  EditableNotes,
} from "./EditableFields";

interface EntityDetailsFormProps {
  entityType: EntityType;
  entityId: string | null | undefined;
  /** Row the caller already has (board/list), used as instant seed data. */
  initialData?: Record<string, any> | null;
  /** Restrict + order the fields this popup shows. Defaults to the full registry. */
  visibleFields?: string[];
  readOnly?: boolean;
  className?: string;
}

/**
 * The one editable body every job/lead/client popup renders.
 * Popups only choose the entity and which fields to show.
 */
const EntityDetailsForm = ({
  entityType,
  entityId,
  initialData,
  visibleFields,
  readOnly,
  className,
}: EntityDetailsFormProps) => {
  const { config, data, isLoading, savingField, updateField } = useEntityEditor(
    entityType,
    entityId,
    { initialData },
  );

  const needsAgents = config.fields.some((f) => f.optionSource === "agents");
  const { data: agents = [] } = useQuery({
    queryKey: ["entity-form-agents"],
    enabled: needsAgents,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const needsContacts = config.fields.some((f) => f.optionSource === "fb_contacts");
  const { data: contacts = [] } = useQuery({
    queryKey: ["entity-form-fb-contacts"],
    enabled: needsContacts,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fb_contacts")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const fields = useMemo(() => {
    if (!visibleFields) return config.fields;
    return visibleFields
      .map((key) => config.fields.find((f) => f.key === key))
      .filter(Boolean) as EntityFieldConfig[];
  }, [config.fields, visibleFields]);

  const optionsFor = (field: EntityFieldConfig) => {
    if (field.optionSource === "agents") {
      return agents.map((a: any) => ({
        value: a.id,
        label: a.full_name || "Unnamed",
      }));
    }
    if (field.optionSource === "fb_contacts") {
      return contacts.map((c: any) => ({ value: c.id, label: c.name || "Unnamed" }));
    }
    return field.options ?? [];
  };


  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Record not found or you don't have access.
      </p>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-3", className)}>
      {fields.map((field) => {
        const shared = {
          label: field.label,
          value: data[field.key],
          saving: savingField === field.key,
          disabled: readOnly,
          onSave: (v: any) => updateField(field.key, v),
          className: field.wide ? "col-span-2" : undefined,
        };

        const render = () => {
          switch (field.kind) {
            case "select":
              return <EditableSelect {...shared} options={optionsFor(field)} />;
            case "textarea":
              return <EditableNotes {...shared} placeholder={field.placeholder} />;
            case "datetime":
              return <EditableDateTime {...shared} />;
            case "date":
              return <EditableField {...shared} type="date" />;
            case "time":
              return <EditableField {...shared} type="time" />;
            case "email":
              return <EditableField {...shared} type="email" />;
            case "tel":
              return <EditableField {...shared} type="tel" />;
            case "number":
              return <EditableField {...shared} type="number" />;

            default:
              return <EditableField {...shared} placeholder={field.placeholder} />;
          }
        };

        return <Fragment key={field.key}>{render()}</Fragment>;
      })}
    </div>
  );
};

export default EntityDetailsForm;
