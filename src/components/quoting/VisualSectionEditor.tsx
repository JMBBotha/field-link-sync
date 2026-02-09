import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import browserImageCompression from "browser-image-compression";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ImagePlus,
  X,
  Loader2,
  Layers,
} from "lucide-react";

export interface VisualSection {
  heading: string;
  description: string;
  features: string[];
  images: string[]; // public URLs
}

interface VisualSectionEditorProps {
  sections: VisualSection[];
  onChange: (sections: VisualSection[]) => void;
  quoteId: string | null;
}

const VisualSectionEditor = ({
  sections,
  onChange,
  quoteId,
}: VisualSectionEditorProps) => {
  const { toast } = useToast();
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const addSection = () => {
    onChange([
      ...sections,
      { heading: "", description: "", features: [""], images: [] },
    ]);
  };

  const removeSection = (idx: number) => {
    onChange(sections.filter((_, i) => i !== idx));
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= sections.length) return;
    const updated = [...sections];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    onChange(updated);
  };

  const updateSection = (
    idx: number,
    field: keyof VisualSection,
    value: any
  ) => {
    onChange(sections.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const addFeature = (sectionIdx: number) => {
    const updated = [...sections];
    updated[sectionIdx].features.push("");
    onChange(updated);
  };

  const updateFeature = (
    sectionIdx: number,
    featureIdx: number,
    value: string
  ) => {
    const updated = [...sections];
    updated[sectionIdx].features[featureIdx] = value;
    onChange(updated);
  };

  const removeFeature = (sectionIdx: number, featureIdx: number) => {
    const updated = [...sections];
    updated[sectionIdx].features = updated[sectionIdx].features.filter(
      (_, i) => i !== featureIdx
    );
    onChange(updated);
  };

  const handleImageUpload = async (
    sectionIdx: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!e.target.files?.length) return;
    setUploadingIdx(sectionIdx);
    try {
      const urls: string[] = [];
      for (const file of Array.from(e.target.files)) {
        const compressed = await browserImageCompression(file, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });
        const path = `sections/${quoteId || "unsaved"}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("quote-photos")
          .upload(path, compressed);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage
          .from("quote-photos")
          .getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
      const updated = [...sections];
      updated[sectionIdx].images = [
        ...updated[sectionIdx].images,
        ...urls,
      ];
      onChange(updated);
      toast({ title: "Images uploaded" });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setUploadingIdx(null);
      e.target.value = "";
    }
  };

  const removeImage = (sectionIdx: number, imgIdx: number) => {
    const updated = [...sections];
    updated[sectionIdx].images = updated[sectionIdx].images.filter(
      (_, i) => i !== imgIdx
    );
    onChange(updated);
  };

  if (sections.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <Layers className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground mb-3">
            Add visual content sections to showcase products, specs, and images
          </p>
          <Button type="button" variant="outline" size="sm" onClick={addSection}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Section
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Layers className="h-4 w-4" /> Visual Content Sections
        </h3>
        <Button type="button" variant="outline" size="sm" onClick={addSection}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Section
        </Button>
      </div>

      {sections.map((section, idx) => (
        <Card key={idx} className="border-l-4 border-l-primary/40">
          <CardHeader className="py-2 px-4">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs">
                Section {idx + 1}
              </Badge>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => moveSection(idx, -1)}
                  disabled={idx === 0}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => moveSection(idx, 1)}
                  disabled={idx === sections.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => removeSection(idx)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {/* Heading */}
            <Input
              placeholder="Section heading (e.g. SAMSUNG AR40 18K BTU INVERTER)"
              value={section.heading}
              onChange={(e) => updateSection(idx, "heading", e.target.value)}
              className="font-semibold"
            />

            {/* Description */}
            <Textarea
              placeholder="Rich description — specs, features, benefits..."
              value={section.description}
              onChange={(e) =>
                updateSection(idx, "description", e.target.value)
              }
              rows={4}
              className="text-sm"
            />

            {/* Features */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Key Features
              </p>
              {section.features.map((feat, fi) => (
                <div key={fi} className="flex items-center gap-2">
                  <span className="text-primary text-xs">•</span>
                  <Input
                    placeholder="Feature point..."
                    value={feat}
                    onChange={(e) => updateFeature(idx, fi, e.target.value)}
                    className="h-7 text-sm flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => removeFeature(idx, fi)}
                    disabled={section.features.length <= 1}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addFeature(idx)}
                className="text-xs h-6"
              >
                <Plus className="h-3 w-3 mr-1" /> Add Feature
              </Button>
            </div>

            {/* Images */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Product Images
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={uploadingIdx === idx}
                  asChild
                >
                  <label className="cursor-pointer">
                    {uploadingIdx === idx ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <ImagePlus className="h-3 w-3 mr-1" />
                    )}
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleImageUpload(idx, e)}
                    />
                  </label>
                </Button>
              </div>
              {section.images.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {section.images.map((url, imgIdx) => (
                    <div
                      key={imgIdx}
                      className="relative group rounded-md overflow-hidden border aspect-video"
                    >
                      <img
                        src={url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(idx, imgIdx)}
                        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default VisualSectionEditor;
