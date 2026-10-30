// Embed every remote https <img> as a CID attachment (Johan 22 Oct + 30 Oct 20:46: Gmail / mail apps that
// block remote pictures showed no logo). Shared by every client email sender.
export async function inlineEmailImages(html: string, max = 12): Promise<{ html: string; attachments: Array<{ filename: string; content: string; content_id: string }> }> {
  const attachments: Array<{ filename: string; content: string; content_id: string }> = [];
  let out = html;
  const urls = [...new Set([...html.matchAll(/<img[^>]+src="(https:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))].slice(0, max);
  let n = 0;
  for (const url of urls) {
    try {
      const r = await fetch(url);
      const ct = r.headers.get("content-type") || "";
      if (!r.ok || !ct.startsWith("image/")) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 1.5 * 1024 * 1024) continue;
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const cid = `img${++n}@becool`;
      const ext = (ct.split("/")[1] || "png").split(";")[0].replace("jpeg", "jpg");
      attachments.push({ filename: `image${n}.${ext}`, content: btoa(bin), content_id: cid });
      const escUrl = url.replace(/&/g, "&amp;");
      out = out.split(`src="${escUrl}"`).join(`src="cid:${cid}"`).split(`src="${url}"`).join(`src="cid:${cid}"`);
    } catch { /* keep the remote link */ }
  }
  return { html: out, attachments };
}
