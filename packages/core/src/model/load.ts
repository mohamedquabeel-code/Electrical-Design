import { z } from "zod";

/**
 * How a load is connected, which determines the design-current formula and
 * whether a neutral is present.
 *
 *  - `1ph-ln`  single phase between a line and neutral, Ib = P / (U0 * pf * eff)
 *  - `1ph-ll`  single phase between two lines, Ib = P / (U * pf * eff)
 *  - `3ph-3w`  three phase, no neutral (delta loads, most motors)
 *  - `3ph-4w`  three phase with neutral (mixed distribution boards)
 *
 * Three-phase forms use Ib = P / (sqrt(3) * U * pf * eff).
 */
export const Connection = z.enum(["1ph-ln", "1ph-ll", "3ph-3w", "3ph-4w"]);
export type Connection = z.infer<typeof Connection>;

/** Whether the connection carries a neutral conductor. */
export const hasNeutral = (connection: Connection): boolean =>
  connection === "1ph-ln" || connection === "3ph-4w";

/** Whether the connection is three phase. */
export const isThreePhase = (connection: Connection): boolean =>
  connection === "3ph-3w" || connection === "3ph-4w";

/**
 * Load category. Drives the voltage-drop limit (lighting is held to a tighter
 * limit than other loads), the diversity factor applied during load estimation,
 * and whether harmonic neutral loading needs to be considered.
 */
export const LoadType = z.enum([
  "lighting",
  "socket",
  "motor",
  "hvac",
  "heating",
  "ups",
  "evCharger",
  "lift",
  "welding",
  "other",
]);
export type LoadType = z.infer<typeof LoadType>;

/**
 * Motor starting method.
 *
 * The starting current multiple and the fraction of full-load torque produced
 * differ sharply between these, and both matter: the current sets the voltage
 * dip and the protective device type, while the torque decides whether the
 * motor can actually accelerate its load at the reduced voltage.
 */
export const StartingMethod = z.enum([
  /** Direct on line. Full torque, 6-8x FLC. */
  "dol",
  /** Star-delta. One third of DOL current and one third of DOL torque. */
  "starDelta",
  /** Autotransformer. Current and torque both scale with tap^2. */
  "autotransformer",
  /** Soft starter. Current-limited ramp, typically 2-4x FLC. */
  "softStarter",
  /** Variable frequency drive. Near full-load current, full torque available. */
  "vfd",
]);
export type StartingMethod = z.infer<typeof StartingMethod>;

/** Motor-specific parameters, present only when `type` is `motor`. */
export const MotorData = z.object({
  startingMethod: StartingMethod,
  /**
   * Starting current as a multiple of full-load current, before any reduction
   * by the starting method. Typically 6-8 for a cage induction motor.
   */
  lockedRotorMultiple: z.number().positive().default(6.5),
  /** Autotransformer tap as a ratio, e.g. 0.8 for the 80% tap. */
  autotransformerTap: z.number().gt(0).lte(1).optional(),
  /** Soft starter current limit as a multiple of full-load current. */
  softStarterLimit: z.number().positive().optional(),
  /** Starting duration in seconds, used for the cable thermal withstand check. */
  startingTime: z.number().positive().default(5),
  /** Power factor while starting. Much lower than running; ~0.3 is typical. */
  startingPowerFactor: z.number().gt(0).lte(1).default(0.3),
  /** Thermal overload relay trip class, IEC 60947-4-1. */
  overloadClass: z.enum(["10", "20", "30"]).default("10"),
});
export type MotorData = z.infer<typeof MotorData>;

/** A single electrical load. */
export const Load = z.object({
  id: z.string().min(1),
  /** Optional human name, e.g. "Kitchen ring main" or "Chiller CH-01". */
  name: z.string().default(""),
  type: LoadType,
  connection: Connection,
  /** Nominal line-to-line voltage for three-phase, or the supply voltage for single phase. */
  voltage: z.number().positive(),
  /**
   * Rated active power in watts. For loads specified in kVA or in amperes the
   * UI converts on entry, so the engine only ever deals with one representation.
   */
  power: z.number().positive(),
  /** Displacement power factor, 0 < pf <= 1. */
  powerFactor: z.number().gt(0).lte(1).default(0.85),
  /** Efficiency, 0 < eff <= 1. Applies to the input power of rotating machines. */
  efficiency: z.number().gt(0).lte(1).default(1),
  /**
   * Third-harmonic content as a fraction of fundamental line current.
   * Above 0.15 the neutral becomes loaded; above 0.33 it is the
   * current-carrying conductor and sets the cable size (IEC 60364-5-52 Annex E).
   */
  thirdHarmonic: z.number().min(0).max(2).default(0),
  /** Utilisation factor for load estimation. 1 means the load runs at full rating. */
  utilisation: z.number().gt(0).lte(1).default(1),
  motor: MotorData.optional(),
});
export type Load = z.infer<typeof Load>;
