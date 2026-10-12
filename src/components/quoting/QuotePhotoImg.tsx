import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { resolveQuotePhotoSrc } from "@/lib/quotePhotos";

/** <img> that signs private quote-photos refs before display. */
export default function QuotePhotoImg({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    resolveQuotePhotoSrc(src).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [src]);
  if (!url) return <div className={rest.className} aria-busy="true" />;
  return <img src={url} {...rest} />;
}
