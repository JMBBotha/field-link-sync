import DOMPurify from "dompurify";

/**
 * Sanitizes rich-text/markdown-derived HTML before it is injected with
 * dangerouslySetInnerHTML. Public proposal/quote links are viewable by
 * anonymous customers, so stored HTML must never be trusted.
 */
export const sanitizeHtml = (html: string): string =>
  DOMPurify.sanitize(html ?? "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "link"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "formaction", "srcdoc"],
  });

export default sanitizeHtml;
