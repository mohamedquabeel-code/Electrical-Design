import { ADIABATIC_K, type ConductorMaterial, type Insulation } from "../model/cable.js";
import type { DeviceType } from "../model/circuit.js";
import type { LoadType } from "../model/load.js";
import type { StandardProfile } from "./profile.js";

/**
 * Standard overcurrent device ratings, amperes.
 * The IEC 60947-2 / IEC 60269 preferred series, from a domestic lighting
 * circuit up to a main incomer.
 */
const DEVICE_RATINGS = [
  6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000,
  1250, 1600, 2000, 2500, 3200, 4000,
] as const;

/**
 * Voltage drop limits, IEC 60364-5-52 Annex G.
 *
 * 3% for lighting and 5% for other loads, measured from the origin of the
 * installation. Where the installation has its own transformer the standard
 * permits 6% and 8%, because the supply cable to the origin is under the
 * designer's control rather than the distributor's; that variant is applied at
 * project level and is not encoded here.
 */
const VOLTAGE_DROP_LIMITS: Record<LoadType, number> = {
  lighting: 0.03,
  socket: 0.05,
  motor: 0.05,
  hvac: 0.05,
  heating: 0.05,
  ups: 0.05,
  evCharger: 0.05,
  lift: 0.05,
  welding: 0.05,
  other: 0.05,
};

/**
 * Conventional tripping current as a multiple of nominal rating.
 *
 * Circuit breakers to IEC 60947-2 and IEC 60898 are tested at 1.45 In, which is
 * exactly the coefficient in the coordination rule, so `I2 <= 1.45 Iz` follows
 * automatically from `In <= Iz`. Fuses to IEC 60269 operate at 1.6 In, so a
 * fuse-protected circuit needs a cable rated above the fuse.
 */
const I2_FACTORS: Record<DeviceType, number> = {
  mcb: 1.45,
  mccb: 1.45,
  acb: 1.45,
  mpcb: 1.45,
  "fuse-gG": 1.6,
  "fuse-aM": 1.6,
};

/**
 * Maximum disconnection times, IEC 60364-4-41 Table 41.1, seconds.
 *
 * Final circuits up to 63 A must clear fast enough to limit the duration of a
 * touch voltage; distribution circuits are allowed longer because they are not
 * expected to be held by a person when they fault.
 */
const DISCONNECTION_TIMES = {
  "TN-S": { final: 0.4, distribution: 5 },
  "TN-C-S": { final: 0.4, distribution: 5 },
  TT: { final: 0.2, distribution: 1 },
  // An IT system's first fault draws negligible current and does not require
  // disconnection; the times below apply to the second fault.
  IT: { final: 0.4, distribution: 5 },
} as const;

export const IEC: StandardProfile = {
  id: "IEC",
  name: "IEC 60364",
  deviceRatings: DEVICE_RATINGS,

  voltageDropLimit(loadType: LoadType): number {
    return VOLTAGE_DROP_LIMITS[loadType];
  },

  i2Factor(deviceType: DeviceType): number {
    return I2_FACTORS[deviceType];
  },

  adiabaticK(conductor: ConductorMaterial, insulation: Insulation): number {
    return ADIABATIC_K[conductor][insulation];
  },

  disconnectionTime({ earthing, isFinalCircuit }): number {
    const times = DISCONNECTION_TIMES[earthing];
    return isFinalCircuit ? times.final : times.distribution;
  },

  terms: {
    ampacity: "Current-carrying capacity (Iz)",
    designCurrent: "Design current (Ib)",
    deviceRating: "Nominal rating (In)",
    protectiveConductor: "Protective conductor (PE)",
    conductorSize: "Cross-sectional area (mm²)",
  },
};
