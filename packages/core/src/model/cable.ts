import { z } from "zod";

/**
 * Cable construction vocabulary.
 *
 * These enumerations are driven by what the source datasets actually contain.
 * The Elsewedy Power Cables Catalogue is organised as a matrix of
 * conductor material x insulation x armour x core arrangement x voltage grade,
 * and every product row falls at one intersection of it.
 */

/** Conductor material. Resistivity and temperature coefficient differ per IEC 60228. */
export const ConductorMaterial = z.enum(["copper", "aluminium"]);
export type ConductorMaterial = z.infer<typeof ConductorMaterial>;

/**
 * Insulation compound, which fixes the maximum continuous operating temperature
 * and the short-circuit limit temperature (catalogue Table 13).
 */
export const Insulation = z.enum(["pvc", "xlpe", "epr"]);
export type Insulation = z.infer<typeof Insulation>;

/**
 * Armour type.
 *
 * STA/SWA are steel and are used on multicore cables. ATA/AWA are aluminium and
 * are used on single-core cables, because steel armour around a single core
 * would form a magnetic circuit and cause severe eddy-current heating.
 */
export const Armour = z.enum([
  "none",
  /** Steel tape armour — multicore. */
  "sta",
  /** Steel wire armour — multicore. */
  "swa",
  /** Aluminium tape armour — single core. */
  "ata",
  /** Aluminium wire armour — single core. */
  "awa",
]);
export type Armour = z.infer<typeof Armour>;

/** Outer sheath compound. */
export const Sheath = z.enum(["pvc", "lszh", "pe"]);
export type Sheath = z.infer<typeof Sheath>;

/**
 * Rated voltage designation U0/U per IEC 60183, as published in the catalogue
 * (p.14). U0 is conductor-to-earth, U is conductor-to-conductor.
 */
export const VoltageGrade = z.enum([
  "450/750",
  "0.6/1",
  "1.8/3",
  "3.6/6",
  "6/10",
  "8.7/15",
  "12/20",
  "18/30",
]);
export type VoltageGrade = z.infer<typeof VoltageGrade>;

/**
 * Installation condition.
 *
 * IMPORTANT — there are two distinct sizing bases in this tool and they are not
 * interchangeable:
 *
 *  - `ground` / `duct` / `freeAir` are the three conditions the Elsewedy
 *    catalogue publishes ampacities for. They are computed per IEC 60287 under
 *    the reference conditions on catalogue p.16. Correct for buried and
 *    free-air feeder and MV runs.
 *
 *  - IEC 60364-5-52 reference methods A1..G describe how a cable is installed
 *    inside a building (in conduit in an insulated wall, in trunking, clipped
 *    direct, on a tray, spaced from a surface). Final circuits are designed
 *    against these, and the catalogue has no column for them.
 *
 * Choosing free-air ampacity for a cable actually buried in wall insulation
 * would oversize the result badly, so the design basis is explicit per circuit
 * and the engine refuses to mix them.
 */
export const CatalogueInstallation = z.enum(["ground", "duct", "freeAir"]);
export type CatalogueInstallation = z.infer<typeof CatalogueInstallation>;

/** IEC 60364-5-52 reference methods, Table B.52.1. */
export const ReferenceMethod = z.enum(["A1", "A2", "B1", "B2", "C", "D1", "D2", "E", "F", "G"]);
export type ReferenceMethod = z.infer<typeof ReferenceMethod>;

/** Which dataset a circuit is sized against. */
export const DesignBasis = z.enum([
  /** Manufacturer catalogue data, IEC 60287 basis. */
  "catalogue",
  /** IEC 60364-5-52 tabulated reference-method data. */
  "iec60364",
]);
export type DesignBasis = z.infer<typeof DesignBasis>;

/** Physical arrangement of single-core cables, which sets mutual reactance. */
export const Formation = z.enum(["trefoil", "flat"]);
export type Formation = z.infer<typeof Formation>;

/**
 * How a published impedance is qualified.
 *
 * Single-core cables have a reactance per formation, because the engineer sets
 * the spacing. Multicore cables have one figure — the cores are fixed by the
 * cable's construction and cannot be rearranged on site.
 */
export const ImpedanceArrangement = z.enum(["default", "trefoil", "flat"]);
export type ImpedanceArrangement = z.infer<typeof ImpedanceArrangement>;

/**
 * How a published ampacity is qualified within an installation condition.
 *
 * Ratings are kept per arrangement rather than collapsed to one figure per
 * condition. The difference is real and the arrangement is the engineer's
 * choice — 0.6/1 kV 240 mm2 single-core copper is rated 622 A flat-touching
 * against 602 A trefoil-touching in free air, and spacing the same cables apart
 * raises it further still.
 */
export const AmpacityArrangement = z.enum([
  /** The condition publishes a single figure, with no arrangement variants. */
  "default",
  "flat",
  "trefoil",
  "flatSpaced",
  "flatTouching",
  "trefoilTouching",
]);
export type AmpacityArrangement = z.infer<typeof AmpacityArrangement>;

/**
 * Published ratings by installation condition and arrangement, in amperes.
 *
 * Entries are absent rather than zero when a rating is not published, or when
 * ingest quarantined a defective published value. A missing rating must never
 * be read as zero or substituted from a neighbouring condition — the engine
 * treats it as "this cable cannot be selected here", which fails safe.
 */
export const AmpacitySet = z.record(
  z.enum(["ground", "duct", "freeAir", "conduit"]),
  z.record(AmpacityArrangement, z.number().positive()),
);
export type AmpacitySet = z.infer<typeof AmpacitySet>;

/**
 * A single cable product row as published in a catalogue.
 *
 * `ampacity` is keyed by installation condition; a product may not publish a
 * value for every condition, so entries are optional rather than defaulted —
 * a missing value must never be silently read as zero or as "same as free air".
 */
export const CableProduct = z.object({
  /** Manufacturer product code, e.g. "CP1-T102-U04". */
  productCode: z.string().min(1),
  /** Nominal conductor cross-sectional area in mm2. */
  csa: z.number().positive(),
  conductor: ConductorMaterial,
  insulation: Insulation,
  armour: Armour,
  sheath: Sheath,
  voltageGrade: VoltageGrade,
  /** Number of current-carrying cores. 1 for single-core products. */
  cores: z.number().int().positive(),
  /** Conductor DC resistance at 20 degC, ohm/km. */
  rDc20: z.number().positive(),
  /**
   * Published conductor AC resistance at the catalogue's stated maximum
   * operating temperature, ohm/km.
   *
   * Treat as indicative rather than authoritative: for XLPE below 16 mm2 the
   * catalogue's values imply roughly 70 degC despite a 90 degC column heading
   * (see docs/engineering/dataset-findings.md). The engine recomputes
   * resistance at the actual operating temperature from `rDc20` instead.
   */
  rAcMax: z.number().positive(),
  /**
   * Reactance at 50 Hz by arrangement, ohm/km.
   *
   * Present on MV products, where the catalogue publishes inductance directly
   * and reactance is X = 2*pi*f*L. Absent on LV products, where it is derived
   * by the standard profile.
   *
   * Single-core products publish trefoil and flat separately; multicore
   * products publish one figure, since the cores are fixed in place by the
   * cable's own construction and the engineer cannot alter their spacing.
   */
  reactance: z.record(ImpedanceArrangement, z.number().nonnegative()).optional(),
  /** Published inductance by arrangement, mH/km. MV products only. */
  inductance: z.record(z.string(), z.number().nonnegative()).optional(),
  /** Published capacitance, microfarads/km. MV products only. */
  capacitance: z.number().positive().optional(),
  ampacity: AmpacitySet,
  /** Reduced neutral size for 4-core cables that carry one, mm2. */
  reducedNeutralCsa: z.number().positive().optional(),
  /** Approximate overall diameter, mm. Used for conduit and tray fill. */
  overallDiameter: z.number().positive().optional(),
  /** Approximate mass, kg/km. Used for tray loading and BOM. */
  weight: z.number().positive().optional(),
  /** Source page in the origin PDF, for the calculation report. */
  sourcePage: z.number().int().positive(),
});
export type CableProduct = z.infer<typeof CableProduct>;

/**
 * Conductor resistance corrected to an operating temperature, ohm/km.
 * `R_theta = R20 [1 + alpha(theta - 20)]` — catalogue p.15.
 */
export const resistanceAtTemperature = (
  rDc20: number,
  conductor: ConductorMaterial,
  temperature: number,
): number => rDc20 * (1 + TEMPERATURE_COEFFICIENT[conductor] * (temperature - 20));

/**
 * Maximum continuous conductor operating temperature by insulation, degC.
 * Catalogue p.16 and Table 13.
 */
export const MAX_OPERATING_TEMP: Record<Insulation, number> = {
  pvc: 70,
  xlpe: 90,
  epr: 90,
};

/**
 * Maximum permitted conductor temperature under short circuit, degC.
 * Catalogue Table 13. PVC is 160 degC for CSA <= 300 mm2 and 140 degC above,
 * because a larger conductor holds more heat in the insulation.
 */
export const shortCircuitLimitTemp = (insulation: Insulation, csa: number): number => {
  if (insulation === "pvc") return csa > 300 ? 140 : 160;
  return 250;
};

/**
 * Temperature coefficient of resistance per degC at 20 degC.
 * Catalogue Table 1.
 */
export const TEMPERATURE_COEFFICIENT: Record<ConductorMaterial, number> = {
  copper: 0.00393,
  aluminium: 0.00403,
};

/**
 * Adiabatic constant k for the cable short-circuit withstand check
 * (t <= k^2 S^2 / I^2), IEC 60364-5-54 Table 43.1.
 */
export const ADIABATIC_K: Record<ConductorMaterial, Record<Insulation, number>> = {
  copper: { pvc: 115, xlpe: 143, epr: 143 },
  aluminium: { pvc: 76, xlpe: 94, epr: 94 },
};
