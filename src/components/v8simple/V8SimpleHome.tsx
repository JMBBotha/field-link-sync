import { v8SimpleAllPages } from "@/lib/v8simple/allPages";
import { Link } from "react-router-dom";
import { usePreviewRole } from "./V8SimpleShell";

const COPY = {
  admin: {
    title: "Home",
    line: "Money waiting, jobs ready to book, and leads sitting too long will sit on this page.",
  },
  sales: {
    title: "Home",
    line: "A new lead offer, then quotes to chase, will sit on this page. A site visit stays free.",
  },
  tech: {
    title: "Today",
    line: "Your next job will sit here, with a Start job button. This screen shows no money totals.",
  },
} as const;

export function V8SimpleHome() {
  const role = usePreviewRole();
  const copy = COPY[role];
  return (
    <section className="rh-intro" data-testid="v8-simple-home">
      <div className="rh-frost" aria-hidden />
      <div className="rh-body">
        <p className="rh-eyebrow">Tuesday, 17 Nov</p>
        <h1 className="v8s-h1">{copy.title}</h1>
        <p className="rh-muted">{copy.line}</p>
      </div>
    </section>
  );
}

export function V8SimpleSoon({ title, line }: { title: string; line: string }) {
  return (
    <section className="rh-card" data-testid="v8-simple-soon">
      <div className="rh-frost" aria-hidden />
      <div className="rh-body">
        <p className="rh-eyebrow">Coming in this preview</p>
        <h1 className="v8s-h1">{title}</h1>
        <p className="rh-muted">{line}</p>
      </div>
    </section>
  );
}

export function V8SimpleMe() {
  const role = usePreviewRole();
  const groups = v8SimpleAllPages(role);
  return (
    <div data-testid="v8-simple-me">
      <section className="rh-intro">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <p className="rh-eyebrow">Settings</p>
          <h1 className="v8s-h1">All pages</h1>
          <p className="rh-muted">
            {role === "tech"
              ? "Your own pages. Money totals and booking a new sale stay off this menu."
              : "Every page that already exists. Nothing here was removed from its old address."}
          </p>
        </div>
      </section>
      {groups.map((group) => (
        <section key={group.title} className="rh-card" data-testid="v8-simple-page-group">
          <div className="rh-frost" aria-hidden />
          <div className="rh-body">
            <h2>{group.title}</h2>
            {group.links.map((link) => (
              <Link key={link.path} to={link.path} className="v8s-page-link">
                {link.label}
                <span>{link.path}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
