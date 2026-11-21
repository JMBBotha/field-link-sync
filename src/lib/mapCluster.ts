/** Read a Mapbox cluster click without assuming a broken GeoJSONFeature shape. */
export function clusterEaseTarget(feature: {
  properties?: { cluster_id?: unknown } | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
} | null | undefined): { clusterId: number; center: [number, number] } | null {
  const id = Number(feature?.properties?.cluster_id);
  const geometry = feature?.geometry;
  const coords = geometry?.type === "Point" && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  const lng = coords?.[0];
  const lat = coords?.[1];
  if (!Number.isFinite(id) || typeof lng !== "number" || typeof lat !== "number") return null;
  return { clusterId: id, center: [lng, lat] };
}
