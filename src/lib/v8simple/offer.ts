/** Rep offers start off. A push never includes the client's name. */
export const V8_REP_OFFERS_DEFAULT = false;
export const V8_OFFER_SECONDS = 5 * 60;

export interface V8LeadOffer {
  work: string;
  area: string;
  seconds: number;
  clock: string;
  push: string;
}

export function v8OfferClock(seconds = V8_OFFER_SECONDS): string {
  const safe = Math.max(0, Math.floor(seconds));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

/** Null when offers are off. The returned text never uses a client name. */
export function v8LeadOffer(enabled: boolean, offer: { work: string; area: string; clientName?: string | null } | null): V8LeadOffer | null {
  if (!enabled || !offer) return null;
  const work = offer.work.trim();
  const area = offer.area.trim();
  return {
    work,
    area,
    seconds: V8_OFFER_SECONDS,
    clock: v8OfferClock(V8_OFFER_SECONDS),
    push: `${work} lead · ${area} · tap to view`,
  };
}
