/** Johan 3 Nov 14:24: header pills said little and did nothing. Plain labels; tap explains and says where to change it.
 * Job type change itself is owned by feat/job-type-choice; this only links to it via onRequestTypeChange when provided. */
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const STATUS_TEXT: Record<string, [string, string]> = {
  pending: ["Not booked yet", "No date or tech yet. Use Edit or Assign tech to book it."],
  scheduled: ["Booked", "Date and tech are set. It changes to On site when the tech taps Start Job."],
  dispatched: ["On the way", "The tech has been sent. It changes to On site when he taps Start Job."],
  in_progress: ["On site", "The tech has started. Tap Mark done when the work is finished."],
  on_hold: ["On hold", "Paused. Open More to resume it."],
  completed: ["Done", "Work is finished. Next step is the final invoice."],
  cancelled: ["Cancelled", "This job won't go ahead."],
  invoiced: ["Invoiced", "Final invoice sent."],
};
export const statusText = (s?: string | null) => STATUS_TEXT[s || ""] ?? [(s || "Unknown").replace(/_/g, " "), "Job stage."];
export const priorityText = (p?: string | null) => `${(p || "normal").replace(/^./, (c) => c.toUpperCase())} priority`;

type Props = { status?: string | null; priority?: string | null; typeLabel?: string | null; statusClass?: string; onRequestTypeChange?: () => void };
const pill = "rounded-full px-2.5 py-1 text-xs font-semibold underline decoration-dotted underline-offset-2 active:opacity-70";

export default function JobHeaderPills({ status, priority, typeLabel, statusClass, onRequestTypeChange }: Props) {
  const [label, help] = statusText(status);
  const Item = ({ text, title, body, cls, children, id }: { text: string; title: string; body: string; cls: string; children?: React.ReactNode; id: string }) => (
    <Popover>
      <PopoverTrigger asChild><button type="button" className={`${pill} ${cls}`} data-testid={id} aria-label={`${title}: ${text}`}>{text}</button></PopoverTrigger>
      <PopoverContent className="w-72 rounded-xl text-sm"><p className="font-semibold">{title}: {text}</p><p className="mt-1 text-muted-foreground">{body}</p>{children}</PopoverContent>
    </Popover>
  );
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="job-header-pills">
      <Item id="pill-status" text={label} title="Stage" body={help} cls={statusClass || "bg-white/15 text-white"} />
      {priority && <Item id="pill-priority" text={priorityText(priority)} title="Priority" body="How urgent the office marked it. Urgent and high jobs show first on the dispatch board." cls="bg-white/15 text-white" />}
      {typeLabel && (
        <Item id="pill-type" text={typeLabel} title="Job type" body="What kind of work this is. It decides which checklist and technicians fit the job." cls="bg-white/15 text-white">
          {onRequestTypeChange && <button type="button" className="mt-2 text-sm font-semibold text-[#1590D6]" onClick={onRequestTypeChange}>Request type change</button>}
        </Item>
      )}
    </div>
  );
}
