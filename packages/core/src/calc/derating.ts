import type { CatalogueInstallation, Insulation } from "../model/cable.js";
import type { Route } from "../model/circuit.js";
import { step, type TraceStep } from "../trace/trace.js";

/**
 * Correction factors applied to a tabulated current rating.
 *
 * A published ampacity is only valid under the reference conditions it was
 * computed for. Every departure from those conditions — hotter air, deeper
 * burial, drier soil, cables bunched together — reduces the rating, and the
 * factors multiply. Sizing a buried cable on its tabulated figure while
 * ignoring soil resistivity and grouping is the most common way a design that
 * looks correct overheats in service.
 *
 * The tables here come from the catalogue itself rather than from a standard,
 * because they are the factors matching its own IEC 60287 ratings.
 */

/** One correction factor with its justification. */
export interface Correction {
  readonly name: string;
  readonly value: number;
  readonly step: TraceStep;
}

/** The tables this module needs, as parsed from the catalogue. */
export interface DeratingTables {
  temperatureDerating: {
    air: Record<string, Record<string, number>>;
    ground: Record<string, Record<string, number>>;
  };
  burialDepth: Record<string, Record<string, Record<string, number>>>;
  soilResistivity: Record<string, number>;
  groupingInGround: Record<string, Record<string, Record<string, Record<string, number>>>>;
}

/**
 * Interpolate within a table keyed by numeric strings.
 *
 * Correction tables are published at discrete steps, but a site does not have a
 * discrete ambient temperature. Linear interpolation between the neighbouring
 * entries is both more accurate and less arbitrary than rounding to whichever
 * tabulated value happens to be nearer.
 */
export const interpolate = (table: Record<string, number>, at: number): number | undefined => {
  const points = Object.entries(table)
    .map(([key, value]) => [Number(key), value] as const)
    .filter(([key]) => Number.isFinite(key))
    .sort((a, b) => a[0] - b[0]);

  if (points.length === 0) return undefined;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  // Clamp rather than extrapolate: beyond the published range the underlying
  // physics is no longer what the table describes.
  if (at <= first[0]) return first[1];
  if (at >= last[0]) return last[1];

  for (let index = 1; index < points.length; index += 1) {
    const upper = points[index]!;
    const lower = points[index - 1]!;
    if (at <= upper[0]) {
      const span = upper[0] - lower[0];
      if (span === 0) return lower[1];
      return lower[1] + ((at - lower[0]) * (upper[1] - lower[1])) / span;
    }
  }
  return last[1];
};

const insulationKey = (insulation: Insulation): "pvc" | "xlpe" =>
  insulation === "pvc" ? "pvc" : "xlpe";

/**
 * Every correction factor that applies to a route, with the reasoning for each.
 *
 * Factors that do not apply to the chosen installation condition are omitted
 * rather than set to 1, so the calculation report shows only the corrections
 * that were actually relevant.
 */
export const corrections = (input: {
  route: Route;
  installation: CatalogueInstallation;
  insulation: Insulation;
  cores: number;
  tables: DeratingTables;
}): Correction[] => {
  const { route, installation, insulation, cores, tables } = input;
  const found: Correction[] = [];
  const compound = insulationKey(insulation);
  const inAir = installation === "freeAir";

  const temperatureTable = inAir
    ? tables.temperatureDerating.air[compound]
    : tables.temperatureDerating.ground[compound];
  const temperature = inAir ? route.ambientAirTemp : route.groundTemp;
  const temperatureFactor = temperatureTable
    ? interpolate(temperatureTable, temperature)
    : undefined;

  if (temperatureFactor !== undefined && temperatureFactor !== 1) {
    found.push({
      name: inAir ? "Ambient air temperature" : "Ground temperature",
      value: temperatureFactor,
      step: step({
        label: inAir ? "Ambient temperature correction" : "Ground temperature correction",
        inputs: { temperature, insulation: compound },
        value: temperatureFactor,
        unit: "",
        citation: {
          kind: "catalogue",
          document: "Elsewedy Power Cables Catalogue",
          page: 17,
          table: inAir ? "Table 3" : "Table 4",
          datasetVersion: "1.0.0",
        },
        note: `Ratings are published for ${inAir ? "30 °C air" : "20 °C ground"}.`,
      }),
    });
  }

  if (installation === "ground") {
    const depthGroup = tables.burialDepth["directBuried"];
    const column = cores === 1 ? "singleCoreUpTo185" : "threeCore";
    const depthTable = depthGroup?.[column];
    const depthFactor = depthTable ? interpolate(depthTable, route.burialDepth) : undefined;
    if (depthFactor !== undefined && depthFactor !== 1) {
      found.push({
        name: "Burial depth",
        value: depthFactor,
        step: step({
          label: "Burial depth correction",
          inputs: { depth: route.burialDepth, cores },
          value: depthFactor,
          unit: "",
          citation: {
            kind: "catalogue",
            document: "Elsewedy Power Cables Catalogue",
            page: 18,
            table: "Table 5",
            datasetVersion: "1.0.0",
          },
          note: "Ratings are published for 0.5 m burial depth.",
        }),
      });
    }

    const soilFactor = interpolate(tables.soilResistivity, route.soilResistivity);
    if (soilFactor !== undefined && soilFactor !== 1) {
      found.push({
        name: "Soil thermal resistivity",
        value: soilFactor,
        step: step({
          label: "Soil thermal resistivity correction",
          inputs: { resistivity: route.soilResistivity },
          value: soilFactor,
          unit: "",
          citation: {
            kind: "catalogue",
            document: "Elsewedy Power Cables Catalogue",
            page: 18,
            table: "Table 6",
            datasetVersion: "1.0.0",
          },
          note:
            "Ratings are published for 1.0 K·m/W. Dry sand reaches 2.5 and " +
            "costs about a third of the rating.",
        }),
      });
    }

    if (route.groupedCircuits > 1) {
      const family = cores === 1 ? "singleCore" : "multiCore";
      const spacingKey = route.spacing <= 0 ? "touching" : route.spacing < 0.225 ? "0.15" : "0.30";
      const entry = tables.groupingInGround[family]?.[String(route.groupedCircuits)]?.[spacingKey];
      const groupFactor = entry?.[route.formation];
      if (groupFactor !== undefined && groupFactor !== 1) {
        found.push({
          name: "Grouping",
          value: groupFactor,
          step: step({
            label: "Grouping correction",
            inputs: {
              circuits: route.groupedCircuits,
              spacing: spacingKey,
              formation: route.formation,
            },
            value: groupFactor,
            unit: "",
            citation: {
              kind: "catalogue",
              document: "Elsewedy Power Cables Catalogue",
              page: family === "singleCore" ? 18 : 19,
              table: family === "singleCore" ? "Table 8" : "Table 9",
              datasetVersion: "1.0.0",
            },
            note: "Adjacent circuits warm each other, reducing each one's rating.",
          }),
        });
      }
    }
  }

  return found;
};

/** Product of all correction factors. */
export const totalCorrection = (found: readonly Correction[]): number =>
  found.reduce((total, correction) => total * correction.value, 1);
