import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import type { JobPin } from "@/lib/jobPins";
import { formatBookingWhen } from "@/lib/leadBooking";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Renders open-job pins (blue squares) on an existing Mapbox map. */
export default function JobPinsLayer({ getMap, jobs, visible, jobPath = (id) => `/admin/jobs/${id}` }: { getMap: () => mapboxgl.Map | null; jobs: JobPin[]; visible: boolean; jobPath?: (id: string) => string }) {
  const markers = useRef<mapboxgl.Marker[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const draw = () => {
      if (cancelled) return;
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      if (!visible) return;
      const map = getMap();
      if (!map) { if (tries++ < 150) setTimeout(draw, 200); return; }
      for (const j of jobs) {
        const el = document.createElement("div");
        el.setAttribute("data-job-pin", j.id);
        el.style.cssText = "width:22px;height:22px;border-radius:6px;background:#2563eb;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font:700 11px sans-serif";
        el.textContent = "J";
        const when = j.scheduled_for ? new Date(j.scheduled_for).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not booked";
        const html = `<div style="min-width:180px"><div style="font-weight:600">${esc(j.customer_name || j.title)}</div>
          <div style="font-size:12px;color:#64748b">${esc(j.title)}</div>
          ${j.booking ? `<div data-booked-info style="margin-top:6px;padding:5px 7px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px">
            <div style="font-size:10px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.03em">Booked</div>
            <div style="font-size:12px;font-weight:600;color:#1e3a8a">${esc(j.booking.techName || "Tech assigned")}</div>
            <div style="font-size:11px;color:#1e40af">${esc(formatBookingWhen(j.booking.when) || when)}</div></div>`
          : `<div style="font-size:12px;margin-top:4px">${esc(when)} · ${esc(j.status.replace(/_/g, " "))}</div>`}
          ${j.address ? `<div style="font-size:11px;color:#64748b">${esc(j.address)}</div>` : ""}
          <button data-open-job="${j.id}" style="margin-top:6px;font-size:12px;color:#2563eb;background:none;border:none;padding:0;cursor:pointer;font-weight:600">Open job →</button></div>`;
        const popup = new mapboxgl.Popup({ offset: 14 }).setHTML(html);
        popup.on("open", () => {
          const b = popup.getElement()?.querySelector(`[data-open-job="${j.id}"]`);
          b?.addEventListener("click", () => navigate(jobPath(j.id)));
        });
        markers.current.push(new mapboxgl.Marker({ element: el }).setLngLat([j.lng, j.lat]).setPopup(popup).addTo(map));
      }
    };
    draw();
    return () => { cancelled = true; markers.current.forEach((m) => m.remove()); markers.current = []; };
  }, [jobs, visible, getMap, navigate, jobPath]);

  return null;
}
