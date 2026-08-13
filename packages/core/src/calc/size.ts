import {
  shortCircuitLimitTemp,
  type AmpacityArrangement,
  type CableProduct,
  type CatalogueInstallation,
  type Formation,
} from "../model/cable.js";
import type { DeviceSelection, DeviceType, Route } from "../model/circuit.js";
import { hasNeutral, type Load } from "../model/load.js";
import type { StandardProfile } from "../standards/profile.js";
import { nextDeviceRating } from "../standards/profile.js";
import { checkMax, checkMin, notEvaluated, type RuleResult } from "../rules/rule.js";
import { step, trace, type CalculationTrace, type Citation } from "../trace/trace.js";
import { designCurrent, harmonicFactor } from "./current.js";
import { corrections, totalCorrection, type DeratingTables } from "./derating.js";
import { voltageDrop } from "./voltdrop.js";

/**
 * Circuit sizing.
 *
 * There is one entry point, `evaluate`, and both design modes go through it.
 * Automatic design searches the candidate space for the smallest cable that
 * satisfies every rule; manual design pins the engineer's choice and reports
 * which rules it fails and by how much. Because the rule set has exactly one
 * implementation, an automatic result and a manual result can never disagree
 * about whether a given cable is acceptable — and "change the cable and see the
 * new result" is simply `evaluate` run again.
 */

export interface SizingContext {
  readonly profile: StandardProfile;
  readonly products: readonly CableProduct[];
  readonly tables: DeratingTables;
  /** Derived LV reactance, ohm/km, keyed conductor → insulation → size. */
  readonly reactance: ReactanceTable;
  readonly datasetVersion: string;
}

export interface ReactanceTable {
  singleCore: Record<string, Record<string, Record<string, Record<string, number>>>>;
  multiCore: Record<string, Record<string, Record<string, Record<string, number>>>>;
}

export interface SizingInput {
  readonly load: Load;
  readonly route: Route;
  /** Nominal voltage the drop is measured against; the load's supply voltage. */
  readonly nominalVoltage: number;
  readonly deviceType: DeviceType;
  /** Prospective fault current at the circuit, amperes. Enables the withstand check. */
  readonly faultCurrent?: number;
  /** Protective device clearing time at that fault current, seconds. */
  readonly clearingTime?: number;
  /** Overrides the standard's voltage-drop limit for this circuit. */
  readonly voltageDropLimit?: number;
}

export interface Candidate {
  readonly product: CableProduct;
  readonly parallelRuns: number;
}

export interface SizingResult {
  readonly candidate: Candidate;
  readonly device: DeviceSelection;
  readonly designCurrent: number;
  readonly requiredTabulatedRating: number;
  readonly correctionFactor: number;
  readonly ampacity: number;
  readonly voltageDrop: { volts: number; percent: number };
  readonly rules: readonly RuleResult[];
  readonly compliant: boolean;
  readonly traces: readonly CalculationTrace[];
}

const CATALOGUE_CITE = (page: number, version: string, table?: string): Citation => ({
  kind: "catalogue",
  document: "Elsewedy Power Cables Catalogue",
  page,
  ...(table ? { table } : {}),
  datasetVersion: version,
});

/**
 * The published rating for a cable in a given installation and formation.
 *
 * Returns undefined when no rating is published for that combination — either
 * the catalogue never gave one, or ingest quarantined a defective value. That
 * must not be substituted from a neighbouring arrangement: a cable with no
 * rating for the way it is being installed simply cannot be selected, which is
 * the safe direction to fail in.
 */
export const publishedRating = (
  product: CableProduct,
  installation: CatalogueInstallation,
  formation: Formation,
): { value: number; arrangement: AmpacityArrangement } | undefined => {
  const group = product.ampacity[installation];
  if (!group) return undefined;

  const preference: AmpacityArrangement[] =
    formation === "trefoil"
      ? ["trefoil", "trefoilTouching", "default"]
      : ["flat", "flatTouching", "flatSpaced", "default"];

  for (const arrangement of preference) {
    const value = group[arrangement];
    if (value !== undefined) return { value, arrangement };
  }
  return undefined;
};

/** Derived reactance for an LV product, ohm/km. */
const derivedReactance = (
  context: SizingContext,
  product: CableProduct,
  formation: Formation,
): number | undefined => {
  const family = product.cores === 1 ? "singleCore" : "multiCore";
  const sizes = context.reactance[family]?.[product.conductor]?.[product.insulation];
  if (!sizes) return undefined;

  const key = String(product.csa);
  const exact = sizes[key];
  if (exact) return product.cores === 1 ? (exact[formation] ?? exact["default"]) : exact["default"];

  // Below the smallest well-conditioned size the reactive term is under 3% of
  // the drop, so carrying the nearest derived value costs well under 1%.
  const available = Object.keys(sizes)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const nearest = available.find((size) => size >= product.csa) ?? available[available.length - 1];
  if (nearest === undefined) return undefined;
  const entry = sizes[String(nearest)];
  if (!entry) return undefined;
  return product.cores === 1 ? (entry[formation] ?? entry["default"]) : entry["default"];
};

/**
 * Evaluate one candidate against every rule.
 *
 * This is the whole of the design judgement. Automatic mode calls it in a loop;
 * manual mode calls it once.
 */
export const evaluate = (
  context: SizingContext,
  input: SizingInput,
  candidate: Candidate,
): SizingResult => {
  const { profile, tables, datasetVersion } = context;
  const { load, route, nominalVoltage, deviceType } = input;
  const { product, parallelRuns } = candidate;

  const installation = route.catalogueInstallation ?? "freeAir";
  const formation = route.formation;
  const rules: RuleResult[] = [];
  const traces: CalculationTrace[] = [];

  const ib = designCurrent(load);
  traces.push(ib.trace);

  // --- Protective device ------------------------------------------------
  const rating = nextDeviceRating(profile, ib.value);
  const device: DeviceSelection = {
    type: deviceType,
    rating: rating ?? ib.value,
  };

  // --- Corrections ------------------------------------------------------
  const found = corrections({
    route,
    installation,
    insulation: product.insulation,
    cores: product.cores,
    tables,
  });
  const harmonic = harmonicFactor(load.thirdHarmonic);
  if (harmonic.factor !== 1 && hasNeutral(load.connection)) {
    found.push({
      name: "Harmonic content",
      value: harmonic.factor,
      step: step({
        label: "Harmonic correction",
        inputs: { "3rd harmonic": `${(load.thirdHarmonic * 100).toFixed(0)}%` },
        value: harmonic.factor,
        unit: "",
        citation: { kind: "standard", standard: "IEC 60364-5-52", clause: "Annex E" },
        note: harmonic.sizedOnNeutral
          ? "Neutral current exceeds the line current and sets the cable size."
          : "Triplen harmonics add in the neutral instead of cancelling.",
      }),
    });
  }

  const correctionFactor = totalCorrection(found);
  const requiredTabulatedRating = device.rating / correctionFactor;

  traces.push(
    trace(
      "Correction factors",
      found
        .map((correction) => correction.step)
        .concat(
          step({
            label: "Total correction factor",
            formula: found.map((c) => c.name).join(" × ") || "no corrections apply",
            value: correctionFactor,
            unit: "",
            citation: { kind: "derived", reason: "Product of all applicable corrections" },
          }),
          step({
            label: "Required tabulated rating",
            formula: "It ≥ In / (product of corrections)",
            inputs: { In: device.rating, corrections: correctionFactor },
            value: requiredTabulatedRating,
            unit: "A",
            citation: { kind: "standard", standard: "IEC 60364-5-52", clause: "523" },
          }),
        ),
    ),
  );

  // --- Ampacity ---------------------------------------------------------
  const published = publishedRating(product, installation, formation);

  if (!published) {
    rules.push(
      notEvaluated({
        id: "ampacity.published",
        label: "Published current rating",
        reason:
          `The catalogue publishes no rating for ${product.productCode} installed ` +
          `${installation} in ${formation} formation, so it cannot be selected here.`,
        citation: CATALOGUE_CITE(product.sourcePage, datasetVersion),
      }),
    );
    return {
      candidate,
      device,
      designCurrent: ib.value,
      requiredTabulatedRating,
      correctionFactor,
      ampacity: 0,
      voltageDrop: { volts: 0, percent: 0 },
      rules,
      compliant: false,
      traces,
    };
  }

  const iz = published.value * correctionFactor * parallelRuns;

  traces.push(
    trace("Current-carrying capacity", [
      step({
        label: "Published rating",
        inputs: { installation, arrangement: published.arrangement },
        value: published.value,
        unit: "A",
        citation: CATALOGUE_CITE(product.sourcePage, datasetVersion),
      }),
      step({
        label: "Corrected rating",
        formula: "Iz = It × corrections × parallel runs",
        inputs: {
          It: published.value,
          corrections: correctionFactor,
          runs: parallelRuns,
        },
        value: iz,
        unit: "A",
        citation: { kind: "derived", reason: "Tabulated rating after corrections" },
      }),
    ]),
  );

  // Rule 1: Ib ≤ In ≤ Iz — the device must carry the load without tripping,
  // and the cable must carry whatever the device will let through.
  rules.push(
    checkMin({
      id: "coordination.inGeIb",
      label: "In ≥ Ib",
      actual: device.rating,
      limit: ib.value,
      unit: "A",
      citation: { kind: "standard", standard: "IEC 60364-4-43", clause: "433.1.1" },
      message: (verdict) =>
        verdict === "pass"
          ? `Device rating ${device.rating} A carries the design current ${ib.value.toFixed(1)} A.`
          : `Device rating ${device.rating} A is below the design current ${ib.value.toFixed(1)} A.`,
    }),
  );

  rules.push(
    checkMin({
      id: "coordination.izGeIn",
      label: "Iz ≥ In",
      actual: iz,
      limit: device.rating,
      unit: "A",
      citation: { kind: "standard", standard: "IEC 60364-4-43", clause: "433.1.1" },
      message: (verdict) =>
        verdict === "pass"
          ? `Cable capacity ${iz.toFixed(1)} A covers the device rating ${device.rating} A.`
          : `Cable capacity ${iz.toFixed(1)} A is below the device rating ${device.rating} A, ` +
            `so the device would allow a sustained overload the cable cannot carry.`,
    }),
  );

  // Rule 2: I2 ≤ 1.45 Iz — the cable must survive the current at which the
  // device is only *conventionally* guaranteed to trip, not merely its rating.
  const i2 = profile.i2Factor(deviceType) * device.rating;
  rules.push(
    checkMax({
      id: "coordination.i2",
      label: "I₂ ≤ 1.45 Iz",
      actual: i2,
      limit: 1.45 * iz,
      unit: "A",
      citation: { kind: "standard", standard: "IEC 60364-4-43", clause: "433.1.1" },
      message: (verdict) =>
        verdict === "pass"
          ? `Conventional tripping current ${i2.toFixed(1)} A is within 1.45 Iz.`
          : `Conventional tripping current ${i2.toFixed(1)} A exceeds 1.45 Iz ` +
            `(${(1.45 * iz).toFixed(1)} A). A ${profile.i2Factor(deviceType)}·In device needs ` +
            `a cable rated above it.`,
    }),
  );

  // --- Voltage drop -----------------------------------------------------
  const reactanceValue = derivedReactance(context, product, formation);
  const drop = voltageDrop({
    product,
    current: ib.value,
    length: route.length,
    connection: load.connection,
    powerFactor: load.powerFactor,
    nominalVoltage,
    formation,
    parallelRuns,
    reactanceOverride: reactanceValue,
    reactanceCitation: {
      kind: "derived",
      reason:
        "Back-solved from the catalogue's single-core voltage-drop table " +
        "(Table 18) at the compound's rated temperature",
    },
  });
  traces.push(drop.trace);

  const limit = input.voltageDropLimit ?? profile.voltageDropLimit(load.type);
  rules.push(
    checkMax({
      id: "voltageDrop.limit",
      label: "Voltage drop",
      actual: drop.percent * 100,
      limit: limit * 100,
      unit: "%",
      citation: { kind: "standard", standard: "IEC 60364-5-52", clause: "Annex G" },
      message: (verdict) =>
        verdict === "pass"
          ? `Voltage drop ${(drop.percent * 100).toFixed(2)}% is within the ` +
            `${(limit * 100).toFixed(0)}% limit for ${load.type} loads.`
          : `Voltage drop ${(drop.percent * 100).toFixed(2)}% exceeds the ` +
            `${(limit * 100).toFixed(0)}% limit for ${load.type} loads.`,
    }),
  );

  // --- Short-circuit withstand -----------------------------------------
  if (input.faultCurrent !== undefined && input.clearingTime !== undefined) {
    const k = profile.adiabaticK(product.conductor, product.insulation);
    const totalCsa = product.csa * parallelRuns;
    const permittedTime = (k * k * totalCsa * totalCsa) / (input.faultCurrent * input.faultCurrent);
    rules.push(
      checkMax({
        id: "shortCircuit.adiabatic",
        label: "Short-circuit withstand",
        actual: input.clearingTime,
        limit: permittedTime,
        unit: "s",
        citation: { kind: "standard", standard: "IEC 60364-5-54", clause: "543.1.2" },
        message: (verdict) =>
          verdict === "pass"
            ? `Cable withstands ${input.faultCurrent} A for ${permittedTime.toFixed(3)} s; ` +
              `the device clears in ${input.clearingTime} s.`
            : `Cable withstands ${input.faultCurrent} A for only ` +
              `${permittedTime.toFixed(3)} s but the device takes ${input.clearingTime} s, ` +
              `so the conductor would exceed ` +
              `${shortCircuitLimitTemp(product.insulation, product.csa)} °C.`,
      }),
    );
    traces.push(
      trace("Short-circuit withstand", [
        step({
          label: "Permitted fault duration",
          formula: "t ≤ k²S²/I²",
          inputs: { k, "S (mm²)": totalCsa, "I (A)": input.faultCurrent },
          value: permittedTime,
          unit: "s",
          citation: { kind: "standard", standard: "IEC 60364-5-54", clause: "Table 43.1" },
        }),
      ]),
    );
  } else {
    rules.push(
      notEvaluated({
        id: "shortCircuit.adiabatic",
        label: "Short-circuit withstand",
        reason:
          "Not evaluated: no prospective fault current supplied. " +
          "Run the short-circuit study to enable this check.",
        citation: { kind: "standard", standard: "IEC 60364-5-54", clause: "543.1.2" },
      }),
    );
  }

  return {
    candidate,
    device,
    designCurrent: ib.value,
    requiredTabulatedRating,
    correctionFactor,
    ampacity: iz,
    voltageDrop: { volts: drop.volts, percent: drop.percent },
    rules,
    compliant: rules.every((rule) => rule.status !== "fail"),
    traces,
  };
};

/**
 * Automatic sizing: the smallest compliant cable.
 *
 * Candidates are ordered by conductor size and then by parallel runs, so the
 * first compliant one is the cheapest that works. Rejected candidates are
 * returned alongside it, because "why not 16 mm²?" is a question an engineer
 * reviewing the design will ask, and the rule results answer it exactly.
 */
export const sizeCircuit = (
  context: SizingContext,
  input: SizingInput,
  filter: {
    conductor?: CableProduct["conductor"];
    insulation?: CableProduct["insulation"];
    armour?: CableProduct["armour"];
    voltageGrade?: CableProduct["voltageGrade"];
    cores?: number;
    maxParallelRuns?: number;
  } = {},
): { selected?: SizingResult; rejected: readonly SizingResult[] } => {
  const maxRuns = filter.maxParallelRuns ?? 1;

  const pool = context.products
    .filter((product) => {
      if (filter.conductor && product.conductor !== filter.conductor) return false;
      if (filter.insulation && product.insulation !== filter.insulation) return false;
      if (filter.armour && product.armour !== filter.armour) return false;
      if (filter.voltageGrade && product.voltageGrade !== filter.voltageGrade) return false;
      if (filter.cores && product.cores !== filter.cores) return false;
      if (product.reducedNeutralCsa !== undefined) return false;
      return true;
    })
    .sort((a, b) => a.csa - b.csa);

  const rejected: SizingResult[] = [];

  for (let runs = 1; runs <= maxRuns; runs += 1) {
    for (const product of pool) {
      const result = evaluate(context, input, { product, parallelRuns: runs });
      if (result.compliant) return { selected: result, rejected };
      rejected.push(result);
    }
  }

  return { rejected };
};
