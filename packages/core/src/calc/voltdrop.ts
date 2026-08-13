import {
  MAX_OPERATING_TEMP,
  resistanceAtTemperature,
  type CableProduct,
  type Formation,
} from "../model/cable.js";
import { isThreePhase, type Connection } from "../model/load.js";
import { step, trace, type CalculationTrace, type Citation } from "../trace/trace.js";

const SQRT3 = Math.sqrt(3);

/**
 * Steady-state voltage drop.
 *
 *   single phase   ΔU = 2 · I · L · (R cos φ + X sin φ)
 *   three phase    ΔU = √3 · I · L · (R cos φ + X sin φ)
 *
 * Computed from resistance and reactance rather than from the catalogue's
 * tabulated mV/A/m figures. Two reasons, both material:
 *
 *  - The tabulated values are fixed at power factor 0.8. Real loads are not,
 *    and a 0.95 power factor load sized against a 0.8 table is penalised for
 *    reactance it does not draw.
 *  - The multicore table is defective from 16 mm² upward, listing values below
 *    their own resistive term (see docs/engineering/dataset-findings.md).
 *
 * Resistance is corrected to the conductor's operating temperature, because a
 * cable at 70 °C has roughly 20% more resistance than the 20 °C figure — an
 * error that would otherwise flow straight into the result.
 */
export interface VoltageDropInput {
  readonly product: CableProduct;
  readonly current: number;
  /** Route length, metres. */
  readonly length: number;
  readonly connection: Connection;
  readonly powerFactor: number;
  readonly nominalVoltage: number;
  readonly formation: Formation;
  /** Cables in parallel per phase; each carries its share of the current. */
  readonly parallelRuns: number;
  /**
   * Reactance in ohm/km, when not published on the product itself.
   * Supplied by the standard profile from the derived reactance dataset.
   */
  readonly reactanceOverride?: number | undefined;
  readonly reactanceCitation?: Citation | undefined;
}

export interface VoltageDropResult {
  readonly volts: number;
  readonly percent: number;
  readonly resistance: number;
  readonly reactance: number;
  readonly trace: CalculationTrace;
}

export const voltageDrop = (input: VoltageDropInput): VoltageDropResult => {
  const {
    product,
    current,
    length,
    connection,
    powerFactor,
    nominalVoltage,
    formation,
    parallelRuns,
    reactanceOverride,
    reactanceCitation,
  } = input;

  const threePhase = isThreePhase(connection);
  const operatingTemp = MAX_OPERATING_TEMP[product.insulation];

  // Recomputed from the 20 °C DC value rather than read from the published
  // rAcMax column, which is on a 70 °C basis for XLPE below 16 mm² despite its
  // 90 °C heading.
  const resistancePerKm =
    resistanceAtTemperature(product.rDc20, product.conductor, operatingTemp) / parallelRuns;

  const published = product.reactance?.[formation] ?? product.reactance?.["default"];
  const reactancePerKm = (published ?? reactanceOverride ?? 0) / parallelRuns;

  const sinPhi = Math.sqrt(Math.max(0, 1 - powerFactor * powerFactor));
  const multiplier = threePhase ? SQRT3 : 2;
  const lengthKm = length / 1000;

  const volts =
    multiplier * current * lengthKm * (resistancePerKm * powerFactor + reactancePerKm * sinPhi);
  const percent = volts / nominalVoltage;

  const reactanceCite: Citation = published
    ? {
        kind: "catalogue",
        document: "Elsewedy Power Cables Catalogue",
        page: product.sourcePage,
        table: "Published inductance, X = 2πfL",
        datasetVersion: "1.0.0",
      }
    : (reactanceCitation ?? {
        kind: "assumed",
        reason: "No reactance available for this product; taken as zero.",
      });

  return {
    volts,
    percent,
    resistance: resistancePerKm,
    reactance: reactancePerKm,
    trace: trace("Voltage drop", [
      step({
        label: "Conductor resistance at operating temperature",
        formula: "R_θ = R₂₀ [1 + α(θ − 20)]",
        inputs: { "R₂₀": product.rDc20, θ: operatingTemp, conductor: product.conductor },
        value: resistancePerKm,
        unit: "Ω/km",
        citation: {
          kind: "catalogue",
          document: "Elsewedy Power Cables Catalogue",
          page: 15,
          datasetVersion: "1.0.0",
        },
        ...(parallelRuns > 1 ? { note: `Divided by ${parallelRuns} parallel runs.` } : {}),
      }),
      step({
        label: "Reactance",
        value: reactancePerKm,
        unit: "Ω/km",
        citation: reactanceCite,
      }),
      step({
        label: "Voltage drop",
        formula: threePhase
          ? "ΔU = √3 · I · L · (R cos φ + X sin φ)"
          : "ΔU = 2 · I · L · (R cos φ + X sin φ)",
        inputs: {
          I: current,
          "L (km)": lengthKm,
          R: resistancePerKm,
          X: reactancePerKm,
          "cos φ": powerFactor,
        },
        value: volts,
        unit: "V",
        citation: {
          kind: "catalogue",
          document: "Elsewedy Power Cables Catalogue",
          page: 16,
          datasetVersion: "1.0.0",
        },
      }),
      step({
        label: "Voltage drop",
        formula: "ΔU% = ΔU / U",
        inputs: { ΔU: volts, U: nominalVoltage },
        value: percent * 100,
        unit: "%",
        citation: { kind: "standard", standard: "IEC 60364-5-52", clause: "Annex G" },
      }),
    ]),
  };
};
