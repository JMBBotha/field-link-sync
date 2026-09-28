export type AddBarTarget =
  | { kind: "existing"; areaId: string }
  | { kind: "new" }
  | { kind: "pick"; defaultAreaId: string };

export interface AddBarArea {
  id: string;
}

export interface AddBarLine {
  areaId: string | null;
  isUnit: boolean;
}

/** Pure routing for the single quote-level add bar. */
export function decideAddTarget(
  areas: AddBarArea[],
  lines: AddBarLine[],
  isUnit: boolean,
): AddBarTarget {
  const lastArea = areas.at(-1);
  if (!lastArea) return { kind: "new" };

  if (isUnit) {
    const lastHasUnit = lines.some((line) => line.areaId === lastArea.id && line.isUnit);
    return lastHasUnit ? { kind: "new" } : { kind: "existing", areaId: lastArea.id };
  }

  if (areas.length === 1) return { kind: "existing", areaId: lastArea.id };
  return { kind: "pick", defaultAreaId: lastArea.id };
}