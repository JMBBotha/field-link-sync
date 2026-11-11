/** Screenshot harness for Mandy's turn states. Dummy copy only — not a live session. */
import { useSearchParams } from "react-router-dom";
import { MandyDockView } from "@/components/mandy/MandyDockView";
import type { MandyChoice, MandyResult } from "@/lib/mandy/actions";
import type { MandyPhase } from "@/lib/mandy/realtimeTurn";

type Shot = {
  phase: MandyPhase;
  level: number;
  heard: string;
  reply: string;
  step?: string | null;
  choices?: MandyChoice[];
  confirm?: NonNullable<MandyResult["confirm"]> | null;
};

const COBUS: MandyChoice[] = [
  { label: "Cobus de Jager", action: "why_lead_waiting", args: { lead: "Cobus de Jager" } },
  { label: "Add new client", action: "add_new_client", args: {} },
];

const SHOTS: Record<string, Shot> = {
  listening: { phase: "listening", level: 0.72, heard: "", reply: "" },
  hearing: { phase: "hearing", level: 0, heard: "", reply: "" },
  thinking: {
    phase: "thinking",
    level: 0,
    heard: "Why is the new lead Quibus de Jager waiting",
    reply: "Looking up Cobus now…",
    step: "Looking up client…",
  },
  speaking: { phase: "speaking", level: 0, heard: "Open the last quote", reply: "Opened Q-2026-0056 for Smith." },
  confirm: { phase: "speaking", level: 0, heard: "Move Yaseen's lead from Johan to Almari", reply: "Move Yaseen's lead from Johan to Almari, yes? Tap the Confirm button in my chat panel." },
  choices: {
    phase: "speaking",
    level: 0,
    heard: "Why is the new lead Quibus de Jager waiting",
    reply: "The closest lead is Cobus de Jager. Tap the buttons in my chat panel, or say yes.",
    choices: COBUS,
  },
  disconnected: {
    phase: "disconnected",
    level: 0,
    heard: "Pass that on",
    reply: "I've logged that for Field Lynk Prototyper to look into.",
  },
};

const noop = () => undefined;

export default function MandyDockHarness() {
  const [params] = useSearchParams();
  const shot = params.get("shot") || "listening";
  const row = SHOTS[shot] ?? SHOTS.listening;
  return (
    <div className="flex min-h-screen items-end justify-end bg-[#eef6fb] p-6" data-testid="mandy-dock-harness">
      <MandyDockView
        embedded
        botName="Mandy"
        mode="default"
        phase={row.phase}
        level={row.level}
        heard={row.heard}
        reply={row.reply}
        choices={row.choices || []}
        confirm={shot === "confirm" ? { summary: "Move Yaseen's lead from Johan to Almari, yes? Tap the Confirm button in my chat panel.", run: async () => ({ ok: true, message: "Moved." }) } : row.confirm || null}
        typed=""
        muted={false}
        live={row.phase === "listening" || row.phase === "speaking" || row.phase === "thinking"}
        step={row.step}
        onTyped={noop}
        onClose={noop}
        onToggleMute={noop}
        onMic={noop}
        onSend={noop}
        onChoice={noop}
        onConfirm={noop}
        onCancelConfirm={noop}
        onStop={noop}
        onReconnect={noop}
      />
    </div>
  );
}
