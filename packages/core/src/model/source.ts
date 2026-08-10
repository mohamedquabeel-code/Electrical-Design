import { z } from "zod";

/**
 * System earthing arrangement, IEC 60364-1.
 *
 * This is a project-level decision and it changes a great deal: the earth-fault
 * loop path and therefore the fault current available to operate a protective
 * device, the required disconnection times, whether an RCD is mandatory, and
 * how the PE conductor is sized.
 *
 *  - `TN-S`    separate protective and neutral conductors throughout
 *  - `TN-C-S`  combined PEN up to the origin, separated after (UK "PME")
 *  - `TT`      installation earth electrode independent of the source earth;
 *              loop impedance is usually too high for overcurrent devices, so
 *              RCD protection is effectively mandatory
 *  - `IT`      source unearthed or earthed through an impedance
 */
export const EarthingSystem = z.enum(["TN-S", "TN-C-S", "TT", "IT"]);
export type EarthingSystem = z.infer<typeof EarthingSystem>;

/** Where the installation gets its power from. */
export const SourceType = z.enum(["utility", "transformer", "generator"]);
export type SourceType = z.infer<typeof SourceType>;

/** Transformer winding configuration and phase displacement, IEC 60076-1. */
export const VectorGroup = z.enum(["Dyn11", "Dyn1", "Yzn11", "Yyn0", "Dd0"]);
export type VectorGroup = z.infer<typeof VectorGroup>;

/** Transformer cooling class, IEC 60076-2. */
export const CoolingClass = z.enum(["ONAN", "ONAF", "OFAF", "OFWF", "ODAF", "AN", "AF"]);
export type CoolingClass = z.infer<typeof CoolingClass>;

/**
 * Generator duty classification, ISO 8528-1.
 *
 * The same alternator carries a different permitted rating under each duty, so
 * this is not a label — it directly scales the usable output.
 *
 *  - `ESP` emergency standby: variable load, no overload, limited hours/year
 *  - `PRP` prime: unlimited hours at variable load, 10% overload for 1 h in 12
 *  - `COP` continuous: unlimited hours at constant load, no overload
 *  - `LTP` limited-time: full load for a limited number of hours per year
 */
export const GeneratorDuty = z.enum(["ESP", "PRP", "COP", "LTP"]);
export type GeneratorDuty = z.infer<typeof GeneratorDuty>;

/** Utility (grid) supply. */
export const UtilitySource = z.object({
  kind: z.literal("utility"),
  /** Nominal line-to-line voltage, volts. */
  voltage: z.number().positive(),
  /**
   * Three-phase symmetrical short-circuit level at the point of supply, in MVA.
   * Where the utility quotes a fault current instead, the UI converts.
   */
  faultLevelMva: z.number().positive(),
  /** Source X/R ratio. Sets the peak factor in the IEC 60909 calculation. */
  xOverR: z.number().positive().default(10),
  /**
   * External earth-fault loop impedance Ze at the origin, ohms. Declared by the
   * distributor, or measured. Required for the disconnection-time check.
   */
  ze: z.number().positive().optional(),
});

/** Distribution transformer supply. */
export const TransformerSource = z.object({
  kind: z.literal("transformer"),
  /** Rated apparent power, kVA. */
  ratingKva: z.number().positive(),
  /** Primary (HV) line-to-line voltage, volts. */
  primaryVoltage: z.number().positive(),
  /** Secondary (LV) line-to-line voltage, volts. */
  secondaryVoltage: z.number().positive(),
  /**
   * Short-circuit impedance as a percentage of rated, from the nameplate.
   *
   * The uploaded Elsewedy transformer catalogue does not publish this per
   * rating, so where it is unknown the engine substitutes the IEC 60076-5
   * typical value (4% up to 630 kVA, 6% above) and marks the result as resting
   * on an assumed value rather than nameplate data.
   */
  impedancePercent: z.number().positive().optional(),
  /** Load loss at rated current, watts. Used to split %Z into R and X. */
  loadLossW: z.number().positive().optional(),
  vectorGroup: VectorGroup.default("Dyn11"),
  cooling: CoolingClass.default("ONAN"),
  /** Upstream utility fault level in MVA; infinite bus if omitted. */
  upstreamFaultLevelMva: z.number().positive().optional(),
});

/** Standby or prime generator supply. */
export const GeneratorSource = z.object({
  kind: z.literal("generator"),
  /** Rated apparent power at the declared duty, kVA. */
  ratingKva: z.number().positive(),
  /** Line-to-line voltage, volts. */
  voltage: z.number().positive(),
  duty: GeneratorDuty.default("ESP"),
  /**
   * Direct-axis subtransient reactance, per unit. Typically 0.12-0.18.
   * Sets the initial fault contribution: roughly 1/xd" times rated current,
   * which is far lower than a transformer of the same rating and often decides
   * whether downstream protection will operate at all on generator supply.
   */
  subtransientReactance: z.number().positive().default(0.15),
  /** Permitted transient voltage dip on motor starting, as a ratio. */
  maxTransientDip: z.number().gt(0).lt(1).default(0.15),
});

export const Source = z.discriminatedUnion("kind", [
  UtilitySource,
  TransformerSource,
  GeneratorSource,
]);
export type Source = z.infer<typeof Source>;

/**
 * Typical short-circuit impedance per IEC 60076-5, used only when the nameplate
 * value is unknown. Any result derived from this is flagged in the calculation
 * trace as assumed.
 */
export const typicalImpedancePercent = (ratingKva: number): number => (ratingKva <= 630 ? 4 : 6);
