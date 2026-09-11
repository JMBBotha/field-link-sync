export const PUBLISHED_APP_ORIGIN = "https://field-link-sync.lovable.app";

const isPreviewOrDevelopmentHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host.includes("id-preview") ||
    host.includes("lovableproject.com") || host.includes("gptengineer") ||
    (host.endsWith(".lovable.app") && host !== "field-link-sync.lovable.app");
};

export function getPublicAppOrigin(): string {
  if (typeof window === "undefined") return PUBLISHED_APP_ORIGIN;
  return isPreviewOrDevelopmentHost(window.location.hostname) ? PUBLISHED_APP_ORIGIN : window.location.origin;
}

export const publicQuoteUrl = (token: string) =>
  `${getPublicAppOrigin()}/quote/${encodeURIComponent(token)}`;

export const publicCustomerUrl = (token?: string | null, suffix = "") => {
  const tokenPath = token ? `/${encodeURIComponent(token)}` : "";
  const cleanSuffix = suffix ? `/${suffix.replace(/^\/+/, "")}` : "";
  return `${getPublicAppOrigin()}/customer${tokenPath}${cleanSuffix}`;
};