/** Screenshot harness for Mandy's turn states. Dummy copy only — not a live session. */
import { useSearchParams } from "react-router-dom";
import { MandyDockView } from "@/components/mandy/MandyDockView";
import type { MandyPhase } from "@/lib/mandy/realtimeTurn";

const SHOTS: Record<string, { phase: MandyPhase; level: number; heard: string; reply: string }> = {
  listening: { phase: "listening", level: 0.72, heard: "", reply: "" },
  hearing: { phase: "hearing", level: 0, heard: "", reply: "" },
  thinking: { phase: "thinking", level: 0, heard: "Open the last quote", reply: "" },
  speaking: { phase: "speaking", level: 0, heard: "Open the last quote", reply: "Opened Q-2026-0056 for Smith." },
};

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
        choices={[]}
        confirm={null}
        typed=""
        muted={false}
        live={row.phase === "listening" || row.phase === "speaking"}
        onTyped={() => undefined}
        onClose={() => undefined}
        onToggleMute={() => undefined}
        onMic={() => undefined}
        onSend={() => undefined}
        onChoice={() => undefined}
        onConfirm={() => undefined}
        onCancelConfirm={() => undefined}
      />
    </div>
  );
}
