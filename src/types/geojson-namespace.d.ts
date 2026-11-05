/**
 * Mapbox's public types extend the global GeoJSON namespace.
 * @types/geojson is not installed; this is the subset those types and our map code use.
 */
declare namespace GeoJSON {
  type BBox = [number, number, number, number] | [number, number, number, number, number, number];
  type Position = number[];

  interface GeoJsonObject {
    type: GeoJsonTypes;
    bbox?: BBox | undefined;
  }

  type GeoJsonTypes =
    | "Point" | "MultiPoint" | "LineString" | "MultiLineString"
    | "Polygon" | "MultiPolygon" | "GeometryCollection" | "Feature" | "FeatureCollection";

  interface Point extends GeoJsonObject { type: "Point"; coordinates: Position }
  interface MultiPoint extends GeoJsonObject { type: "MultiPoint"; coordinates: Position[] }
  interface LineString extends GeoJsonObject { type: "LineString"; coordinates: Position[] }
  interface MultiLineString extends GeoJsonObject { type: "MultiLineString"; coordinates: Position[][] }
  interface Polygon extends GeoJsonObject { type: "Polygon"; coordinates: Position[][] }
  interface MultiPolygon extends GeoJsonObject { type: "MultiPolygon"; coordinates: Position[][][] }
  interface GeometryCollection extends GeoJsonObject { type: "GeometryCollection"; geometries: Geometry[] }

  type Geometry = Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon | GeometryCollection;
  type GeoJsonProperties = { [name: string]: unknown } | null;

  interface Feature<G extends Geometry | null = Geometry, P = GeoJsonProperties> extends GeoJsonObject {
    type: "Feature";
    geometry: G;
    id?: string | number | undefined;
    properties: P;
  }

  interface FeatureCollection<G extends Geometry | null = Geometry, P = GeoJsonProperties> extends GeoJsonObject {
    type: "FeatureCollection";
    features: Array<Feature<G, P>>;
  }
}
