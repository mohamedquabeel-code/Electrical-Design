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
  /** Conductor AC resistance at maximum operating temperature, ohm/km. */
  rAcMax: z.number().positive(),
  /**
   * Reactance at 50 Hz, ohm/km. Not published per-row in the catalogue; it is
   * derived during ingest (see tools/pdf-ingest) and carries its own provenance.
   */
  x: z.number().nonnegative().optional(),
  /** Current rating by installation condition, amperes. */
  ampacity: z.object({
    ground: z.number().positive().optional(),
    duct: z.number().positive().optional(),
    freeAir: z.number().positive().optional(),
  }),
  /** Approximate overall diameter, mm. Used for conduit and tray fill. */
  overallDiameter: z.number().positive().optional(),
  /** Approximate mass, kg/km. Used for tray loading and BOM. */
  weight: z.number().positive().optional(),
  /** Source page in the origin PDF, for the calculation report. */
  sourcePage: z.number().int().positive(),
});
export type CableProduct = z.infer<typeof CableProduct>;

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
