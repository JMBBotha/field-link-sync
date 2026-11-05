import { describe, expect, it } from "vitest";
import { clusterEaseTarget } from "./mapCluster";

describe("clusterEaseTarget", () => {
  it("reads a point cluster", () => {
    expect(clusterEaseTarget({
      properties: { cluster_id: 7 },
      geometry: { type: "Point", coordinates: [18.4, -33.9] },
    })).toEqual({ clusterId: 7, center: [18.4, -33.9] });
  });
  it("rejects a feature that is not a point cluster", () => {
    expect(clusterEaseTarget(null)).toBeNull();
    expect(clusterEaseTarget({ properties: {}, geometry: { type: "LineString", coordinates: [] } })).toBeNull();
    expect(clusterEaseTarget({ properties: { cluster_id: "nope" }, geometry: { type: "Point", coordinates: [1, 2] } })).toBeNull();
  });
});
