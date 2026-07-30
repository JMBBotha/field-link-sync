import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { FileText, Plus, X } from "lucide-react";
import { ProposalSection, ProposalAttachment, newId } from "@/types/visualProposal";

interface Props {
  section: ProposalSection;
  onChange: (patch: Partial<ProposalSection>) => void;
  themeColor: string;
}

const AttachmentsBlock = ({ section, onChange, themeColor }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const files = section.attachments || [];

  const addFiles = (list: FileList) => {
    const readers = Array.from(list).map(
      (f) =>
        new Promise<ProposalAttachment>((resolve) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({ id: newId(), name: f.name, url: String(reader.result), mime: f.type });
          reader.readAsDataURL(f);
        }),
    );
    Promise.all(readers).then((next) => onChange({ attachments: [...files, ...next] }));
  };

  return (
    <div className="space-y-3">
      <Input
        className="border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
        placeholder="Attachments"
        value={section.title || ""}
        onChange={(e) => onChange({ title: e.target.value })}
        style={{ color: themeColor }}
      />

      <div className="flex gap-3 overflow-x-auto pb-2">
        {files.map((f) => (
          <div
            key={f.id}
            className="group relative flex h-32 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border bg-muted/30 p-2"
          >
            {f.mime?.startsWith("image/") ? (
              <img
                src={f.url}
                alt={f.name}
                className="h-20 w-full rounded object-cover"
                loading="lazy"
              />
            ) : (
              <FileText className="h-10 w-10 text-muted-foreground" />
            )}
            <span className="w-full truncate text-center text-[11px]">{f.name}</span>
            <button
              type="button"
              aria-label={`Remove ${f.name}`}
              className="absolute right-1 top-1 hidden rounded-full bg-background p-1 text-destructive shadow group-hover:block"
              onClick={() =>
                onChange({ attachments: files.filter((x) => x.id !== f.id) })
              }
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <button
          type="button"
          className="flex h-32 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs text-muted-foreground hover:bg-muted/40"
          onClick={() => inputRef.current?.click()}
        >
          <Plus className="h-6 w-6" />
          Add an attachment
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
};

export default AttachmentsBlock;
