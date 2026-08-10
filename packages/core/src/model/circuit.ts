import { z } from "zod";
import {
  Armour,
  CatalogueInstallation,
  ConductorMaterial,
  DesignBasis,
  Formation,
  Insulation,
  ReferenceMethod,
  VoltageGrade,
} from "./cable.js";

/**
 * The physical route a cable takes, which supplies every input to the derating
 * chain. Getting these wrong is the most common cause of an undersized cable in
 * practice, so each field maps to a specific published correction table rather
 * than to a general "safety factor".
 */
export const Route = z.object({
  /** Run length in metres, source to load. */
  length: z.number().positive(),
  /** Which dataset and therefore which installation vocabulary applies. */
  basis: DesignBasis,
  /** Installation condition when `basis` is `catalogue`. */
  catalogueInstallation: CatalogueInstallation.optional(),
  /** Reference method when `basis` is `iec60364`. */
  referenceMethod: ReferenceMethod.optional(),
  /**
   * Ambient air temperature, degC. Catalogue reference is 30 degC shaded;
   * departures are corrected by catalogue Table 3.
   */
  ambientAirTemp: z.number().default(30),
  /**
   * Ground temperature, degC. Catalogue reference is 20 degC; corrected by
   * catalogue Table 4.
   */
  groundTemp: z.number().default(20),
  /** Burial depth in metres. Catalogue reference is 0.5 m; Table 5. */
  burialDepth: z.number().positive().default(0.5),
  /**
   * Soil thermal resistivity, K.m/W. Catalogue reference is 1.0 (published as
   * 100 K.cm/W); Table 6. Dry sand can reach 2.5 and roughly halves ampacity,
   * which is why this is an explicit input rather than an assumed constant.
   */
  soilResistivity: z.number().positive().default(1.0),
  /** Number of circuits grouped together. Tables 8-11. */
  groupedCircuits: z.number().int().positive().default(1),
  /** Arrangement of single-core cables in a group. */
  formation: Formation.default("trefoil"),
  /** Centre-to-centre spacing between grouped circuits, metres. Tables 8-9. */
  spacing: z.number().nonnegative().default(0),
  /** Number of cable trays in the stack, for grouping factors in air. */
  trays: z.number().int().positive().default(1),
});
export type Route = z.infer<typeof Route>;

/**
 * A user's manual cable choice.
 *
 * When present the engine evaluates exactly this candidate and reports which
 * rules it fails; when absent the engine searches for the smallest compliant
 * option. Both paths run the identical rule set, so an automatic result and a
 * manual result can never disagree about whether a given cable is acceptable.
 */
export const CableSelection = z.object({
  csa: z.number().positive(),
  conductor: ConductorMaterial,
  insulation: Insulation,
  armour: Armour,
  cores: z.number().int().positive(),
  voltageGrade: VoltageGrade,
  /** Cables in parallel per phase. */
  parallelRuns: z.number().int().positive().default(1),
  /** Explicit product code, when the user picked a specific catalogue item. */
  productCode: z.string().optional(),
});
export type CableSelection = z.infer<typeof CableSelection>;

/** Overcurrent protective device family. */
export const DeviceType = z.enum([
  /** Miniature circuit breaker, IEC 60898. */
  "mcb",
  /** Moulded case circuit breaker, IEC 60947-2. */
  "mccb",
  /** Air circuit breaker, IEC 60947-2. */
  "acb",
  /** General purpose fuse, IEC 60269. */
  "fuse-gG",
  /** Motor circuit fuse (back-up protection only), IEC 60269. */
  "fuse-aM",
  /** Motor protection circuit breaker, IEC 60947-4-1. */
  "mpcb",
]);
export type DeviceType = z.infer<typeof DeviceType>;

/**
 * MCB instantaneous trip characteristic, IEC 60898.
 * B trips at 3-5x In, C at 5-10x, D at 10-20x. A motor on a type B device will
 * trip on its own inrush, which is why the starting method feeds device choice.
 */
export const McbCurve = z.enum(["B", "C", "D"]);
export type McbCurve = z.infer<typeof McbCurve>;

export const DeviceSelection = z.object({
  type: DeviceType,
  /** Nominal rating In, amperes. */
  rating: z.number().positive(),
  curve: McbCurve.optional(),
  /** Rated ultimate breaking capacity Icu, kA. */
  breakingCapacityKa: z.number().positive().optional(),
  /** Residual current device sensitivity, milliamperes. Omitted if no RCD. */
  rcdSensitivityMa: z.number().positive().optional(),
});
export type DeviceSelection = z.infer<typeof DeviceSelection>;

/** Automatic sizing, or evaluation of the engineer's own choice. */
export const DesignMode = z.enum(["automatic", "manual"]);
export type DesignMode = z.infer<typeof DesignMode>;

/** One load fed from one point of supply over one cable route. */
export const Circuit = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  loadId: z.string().min(1),
  route: Route,
  mode: DesignMode.default("automatic"),
  /** Required in manual mode; ignored in automatic mode. */
  cable: CableSelection.optional(),
  /** Optional manual device override; otherwise selected automatically. */
  device: DeviceSelection.optional(),
  /**
   * Voltage-drop limit for this circuit as a ratio of nominal.
   * When omitted the standard profile supplies it from the load type
   * (IEC 60364 Annex G: 3% lighting, 5% other).
   */
  voltageDropLimit: z.number().gt(0).lt(1).optional(),
});
export type Circuit = z.infer<typeof Circuit>;
