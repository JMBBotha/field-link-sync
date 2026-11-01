import { linkParts } from "@/lib/mapPin";

/** Notes text with tappable links (open in a new tab / the Maps app). Taps on links don't trigger the parent edit tap. */
export default function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((p, i) =>
        p.url ? (
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="break-all text-[#1590D6] underline">{p.t}</a>
        ) : <span key={i}>{p.t}</span>,
      )}
    </>
  );
}
