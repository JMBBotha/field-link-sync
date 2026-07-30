import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Image as ImageIcon,
} from "lucide-react";

interface Props {
  html: string;
  placeholder?: string;
  onChange: (html: string) => void;
  themeColor?: string;
}

const exec = (cmd: string, value?: string) => {
  document.execCommand(cmd, false, value);
};

/** Rich-text body with a minimal floating toolbar shown while focused. */
const RichTextBlock = ({ html, placeholder, onChange, themeColor = "#1B3A5C" }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Only sync from props when the editor isn't the source of the change.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html || "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const push = () => onChange(ref.current?.innerHTML || "");

  const run = (cmd: string, value?: string) => {
    ref.current?.focus();
    exec(cmd, value);
    push();
  };

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      ref.current?.focus();
      exec("insertImage", String(reader.result));
      push();
    };
    reader.readAsDataURL(file);
  };

  const isEmpty = !html || html === "<br>" || html.replace(/<[^>]*>/g, "").trim() === "";

  return (
    <div className="relative">
      {(focused || isEmpty) && (
        <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border bg-card p-1 shadow-sm">
          <ToolbarButton label="Bold" onClick={() => run("bold")}>
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label="Italic" onClick={() => run("italic")}>
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label="Underline" onClick={() => run("underline")}>
            <Underline className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-border" />
          <ToolbarButton label="Bullet list" onClick={() => run("insertUnorderedList")}>
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label="Numbered list" onClick={() => run("insertOrderedList")}>
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-border" />
          <ToolbarButton label="Insert image" onClick={() => fileRef.current?.click()}>
            <ImageIcon className="h-4 w-4" />
          </ToolbarButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) insertImage(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <div className="relative">
        {isEmpty && !focused && placeholder && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            {placeholder}
          </p>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Section body"
          className="proposal-rte min-h-[110px] rounded-md border border-transparent px-3 py-2 text-sm leading-relaxed outline-none focus:border-border focus:bg-muted/30"
          style={{ ["--proposal-accent" as string]: themeColor }}
          onInput={push}
          onBlur={() => {
            setFocused(false);
            push();
          }}
          onFocus={() => setFocused(true)}
        />
      </div>
    </div>
  );
};

const ToolbarButton = ({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);

export default RichTextBlock;
