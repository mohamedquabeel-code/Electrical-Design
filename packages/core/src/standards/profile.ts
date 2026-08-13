import type { ConductorMaterial, Insulation } from "../model/cable.js";
import type { DeviceType } from "../model/circuit.js";
import type { LoadType } from "../model/load.js";
import type { StandardId } from "../model/project.js";

/**
 * A body of design rules.
 *
 * IEC, BS 7671 and NEC differ in their limits, their tables and their
 * vocabulary, but not in the shape of the calculation. Expressing each as an
 * implementation of one interface means the engine and the UI are written once
 * and switching standard swaps data and limits, not code paths.
 *
 * Anything a standard *asserts* — a limit, a factor, a rating series — belongs
 * here. Anything that follows from physics — Ohm's law, the adiabatic equation —
 * belongs in `calc/` and is shared by every standard.
 */
export interface StandardProfile {
  readonly id: StandardId;
  readonly name: string;

  /**
   * Preferred rating series for overcurrent devices, amperes, ascending.
   * IEC 60947-2 / IEC 60269 rating steps.
   */
  readonly deviceRatings: readonly number[];

  /**
   * Permitted voltage drop as a ratio of nominal voltage.
   * Lighting is held tighter than other loads because lamp output and lifetime
   * fall off faster with voltage than most equipment tolerates.
   */
  voltageDropLimit(loadType: LoadType): number;

  /**
   * The ratio between a device's conventional tripping current I2 and its
   * nominal rating In.
   *
   * This is what makes the second coordination condition (`I2 <= 1.45 Iz`)
   * bite differently per device family: breakers to IEC 60947-2 trip at
   * 1.45 In, so the condition is automatically satisfied whenever
   * `In <= Iz`, whereas gG fuses to IEC 60269 trip at 1.6 In and therefore
   * need a cable rated above the device.
   */
  i2Factor(deviceType: DeviceType): number;

  /**
   * Adiabatic constant k for the cable short-circuit withstand check,
   * `t <= k^2 S^2 / I^2`. IEC 60364-5-54 Table 43.1.
   */
  adiabaticK(conductor: ConductorMaterial, insulation: Insulation): number;

  /**
   * Maximum disconnection time for a final circuit, seconds.
   * IEC 60364-4-41 Table 41.1.
   */
  disconnectionTime(input: {
    earthing: "TN-S" | "TN-C-S" | "TT" | "IT";
    nominalVoltageToEarth: number;
    isFinalCircuit: boolean;
  }): number;

  /** Terminology, so the UI can speak the user's standard. */
  readonly terms: Readonly<Record<string, string>>;
}

/** Smallest rating in the series that is at least `current`. */
export const nextDeviceRating = (profile: StandardProfile, current: number): number | undefined =>
  profile.deviceRatings.find((rating) => rating >= current);
