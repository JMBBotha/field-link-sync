#!/usr/bin/env python3
"""HVAC Design drawings outbox -> Field Lynk quote_drawings (option B, Johan 26 Oct 2026 19:36).

  python3 outbox.py                       # check only: validate names, sizes, PDF pages; no network writes
  python3 outbox.py --approved Q-2026-0047  # upload ONLY that quote's files, after Johan's go for that quote

Upload needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (never commit or save the key).
Without --approved nothing is uploaded. Files go to quote-drawings/{company_id}/{quote_id}/{uuid}.{ext};
the client never appears in the path. Uploaded files move to ./uploaded/.
"""
import argparse, json, os, re, shutil, sys, urllib.request, urllib.parse, uuid

OUTBOX = os.path.dirname(os.path.abspath(__file__))
NAME_RE = re.compile(r"^(Q-\d{4}-\d{3,5})_([A-Za-z0-9-]+)_(?:([A-Za-z0-9-]+)_)?(Rev[A-Z0-9]{1,3})\.(pdf|png|csv)$")
MAX = 10 * 1024 * 1024
MIME = {"pdf": "application/pdf", "png": "image/png", "boq_csv": "text/csv"}
A3_LANDSCAPE = (1190.55, 841.89)


def parse(name):
    m = NAME_RE.match(name)
    if not m:
        return None, "name must be Q-xxxx-xxxx_Area_drawing_RevX.pdf/.png or Q-xxxx-xxxx_Area_BOQ_RevX.csv"
    q, area, label, rev, ext = m.groups()
    if ext == "csv" and label != "BOQ":
        return None, "CSV must be named ..._BOQ_RevX.csv"
    if ext != "csv" and not label:
        return None, "drawing needs a label, e.g. _mechanical_"
    return {"quote_number": q, "area": area, "revision": rev, "kind": "boq_csv" if ext == "csv" else ext}, None


def pdf_warnings(path):
    warn = []
    try:
        from pypdf import PdfReader  # optional
        r = PdfReader(path)
        for i, p in enumerate(r.pages, 1):
            w, h = float(p.mediabox.width), float(p.mediabox.height)
            if w < h:
                warn.append(f"page {i} is portrait")
            if abs(max(w, h) - A3_LANDSCAPE[0]) > 15 or abs(min(w, h) - A3_LANDSCAPE[1]) > 15:
                warn.append(f"page {i} is not A3 ({w:.0f}x{h:.0f}pt)")
            if "/XObject" in (p.get("/Resources") or {}) and not p.extract_text().strip():
                warn.append(f"page {i} looks raster-only (want vector)")
    except ImportError:
        warn.append("pypdf not installed: page size not checked")
    except Exception as e:  # noqa
        return [f"unreadable PDF: {e}"]
    with open(path, "rb") as f:
        if not f.read(5).startswith(b"%PDF"):
            return ["not a PDF file"]
    return warn


def scan():
    items = []
    for n in sorted(os.listdir(OUTBOX)):
        p = os.path.join(OUTBOX, n)
        if not os.path.isfile(p) or n.startswith(".") or n in ("README.md", "outbox.py"):
            continue
        meta, err = parse(n)
        errs = [err] if err else []
        warns = []
        if os.path.getsize(p) > MAX:
            errs.append("over 10 MB")
        if meta and meta["kind"] == "pdf" and not errs:
            w = pdf_warnings(p)
            errs += [x for x in w if x.startswith(("unreadable", "not a PDF"))]
            warns += [x for x in w if x not in errs]
        if meta and meta["kind"] == "png":
            with open(p, "rb") as f:
                if f.read(8) != b"\x89PNG\r\n\x1a\n":
                    errs.append("not a PNG file")
        items.append({"file": n, "path": p, "meta": meta, "errors": errs, "warnings": warns})
    return items


def api(method, path, key, url, body=None, headers=None, raw=None):
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    h.update(headers or {})
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    if body is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url.rstrip("/") + path, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read()
        return json.loads(t) if t else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--approved", metavar="Q-NUMBER", help="upload this quote's files (only after Johan's go)")
    a = ap.parse_args()
    items = scan()
    if not items:
        print("Outbox is empty.")
    for it in items:
        tag = "ERROR" if it["errors"] else ("WARN " if it["warnings"] else "OK   ")
        q = it["meta"]["quote_number"] if it["meta"] else "-"
        print(f"{tag} {q:<14} {it['file']}  {'; '.join(it['errors'] + it['warnings'])}")
    if not a.approved:
        print("\nCheck only. Nothing uploaded. Upload needs --approved Q-xxxx-xxxx after Johan's go.")
        return 1 if any(i["errors"] for i in items) else 0

    if not re.fullmatch(r"Q-\d{4}-\d{3,5}", a.approved):
        sys.exit("--approved must be a quote number like Q-2026-0047")
    batch = [i for i in items if i["meta"] and i["meta"]["quote_number"] == a.approved]
    if not batch:
        sys.exit(f"No files for {a.approved} in the outbox.")
    if any(i["errors"] for i in batch):
        sys.exit("Fix the errors above first; nothing uploaded.")
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment; nothing uploaded.")

    qs = api("GET", "/rest/v1/quotes?select=id,company_id,quote_number&quote_number=eq." + urllib.parse.quote(a.approved), key, url)
    if len(qs or []) != 1:
        sys.exit(f"{a.approved}: expected exactly one quote, found {len(qs or [])}; nothing uploaded.")
    quote = qs[0]
    existing = {r["filename"] for r in api("GET", f"/rest/v1/quote_drawings?select=filename&quote_id=eq.{quote['id']}", key, url) or []}
    os.makedirs(os.path.join(OUTBOX, "uploaded"), exist_ok=True)
    for it in batch:
        m = it["meta"]
        if it["file"] in existing:
            print(f"SKIP {it['file']} (already on the quote)")
            continue
        ext = {"boq_csv": "csv"}.get(m["kind"], m["kind"])
        spath = f"{quote['company_id']}/{quote['id']}/{uuid.uuid4()}.{ext}"
        with open(it["path"], "rb") as f:
            api("POST", f"/storage/v1/object/quote-drawings/{spath}", key, url, raw=f.read(), headers={"Content-Type": MIME[m["kind"]]})
        try:
            api("POST", "/rest/v1/quote_drawings", key, url, body={
                "quote_id": quote["id"], "company_id": quote["company_id"], "storage_path": spath,
                "filename": it["file"], "kind": m["kind"], "area": m["area"], "revision": m["revision"],
                "size_bytes": os.path.getsize(it["path"]), "include_in_client_pdf": m["kind"] != "boq_csv"},
                headers={"Prefer": "return=minimal"})
        except Exception:
            api("DELETE", f"/storage/v1/object/quote-drawings/{spath}", key, url)
            raise
        shutil.move(it["path"], os.path.join(OUTBOX, "uploaded", it["file"]))
        print(f"UPLOADED {it['file']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
