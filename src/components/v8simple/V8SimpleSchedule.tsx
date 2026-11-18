import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { V8_DEMO_JOBS } from "@/lib/v8simple/demoJobs";
import { V8_QUOTE_OPTIONS } from "@/lib/v8simple/quote";
import { v8AssignTech, v8ScheduleBoard, v8SchedulePack, v8TechCanSee } from "@/lib/v8simple/schedule";
import { usePreviewRole } from "./V8SimpleShell";

const DAYS = ["Mon 16", "Tue 17", "Wed 18", "Thu 19", "Fri 20"];

export function V8SimpleSchedule() {
  const role = usePreviewRole();
  const [sp] = useSearchParams();
  const [rows, setRows] = useState(() => sp.get("assigned") === "1" ? V8_DEMO_JOBS.map((row) => row.id === "ready-1" ? v8AssignTech(row, "tech-a") : row) : V8_DEMO_JOBS);
  const board = v8ScheduleBoard(rows);
  const mine = board.filter((row) => v8TechCanSee(row.input, "tech-a"));
  const pack = v8SchedulePack(V8_QUOTE_OPTIONS[0].lines);
  if (role === "tech") {
    return (
      <section className="rh-card" data-testid="v8-tech-day">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <p className="rh-eyebrow">Tuesday 17 Nov</p>
          <h1 className="v8s-h1">My day</h1>
          {mine.length === 0 && <p className="rh-muted">Nothing assigned yet.</p>}
          {mine.map((row) => (
            <div key={row.id}>
              <strong>{row.work}</strong>
              <p className="rh-muted">{row.area}. No client name on this list.</p>
              <ul>{pack.map((line) => <li key={line.name}>{line.qty} × {line.name}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <div data-testid="v8-schedule">
      <div className="v8s-week">{DAYS.map((day) => <div key={day} className={day.startsWith("Tue") ? "is-today" : ""}>{day}</div>)}</div>
      <section className="rh-card">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h2>Ready to book</h2>
          <p className="rh-muted">Deposit-paid installs and call-outs. A quote that is not accepted stays off this board.</p>
          <ul data-testid="v8-ready-panel">
            {board.map((row) => (
              <li key={row.id}>
                {row.client} · {row.work} · {row.area}
                {!row.input.techId && (
                  <button type="button" data-testid={`v8-assign-${row.id}`} onClick={() => setRows((all) => all.map((item) => item.id === row.id ? v8AssignTech(item, "tech-a") : item))}>
                    Assign Tech A
                  </button>
                )}
                {row.input.techId === "tech-a" && <span> Tech A</span>}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
