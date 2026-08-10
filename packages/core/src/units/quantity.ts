/**
 * Branded quantity types.
 *
 * These are compile-time only — a `Brand<number, "A">` is a plain `number` at
 * runtime, so there is zero overhead. The point is to make it impossible to pass
 * a resistance where an ampacity is expected, which is the class of mistake that
 * silently produces a plausible-looking but wrong cable size.
 *
 * CANONICAL UNITS
 * ---------------
 * The canonical unit for each dimension is chosen to match the units the source
 * data is published in, NOT strict SI. The Elsewedy catalogue publishes
 * resistance in ohm/km and conductor size in mm2; IEC 60364-5-52 does the same.
 * Storing those as ohm/m and m^2 would mean every single table value needs a
 * conversion on the way in and on the way out, and each conversion is a chance
 * to be wrong by 10^3 or 10^6. Matching the source is the safer choice.
 */

declare const brandSymbol: unique symbol;
type Brand<T, B extends string> = T & { readonly [brandSymbol]: B };

/** Electric current, amperes. */
export type Amperes = Brand<number, "A">;
/** Potential difference, volts. */
export type Volts = Brand<number, "V">;
/** Active power, watts. */
export type Watts = Brand<number, "W">;
/** Apparent power, volt-amperes. */
export type VoltAmperes = Brand<number, "VA">;
/** Reactive power, volt-amperes reactive. */
export type Vars = Brand<number, "var">;
/** Resistance or reactance, ohms. */
export type Ohms = Brand<number, "ohm">;
/** Resistance or reactance per unit length, ohms per kilometre. */
export type OhmsPerKm = Brand<number, "ohm/km">;
/** Conductor cross-sectional area, square millimetres. */
export type SquareMm = Brand<number, "mm2">;
/** Length, metres. */
export type Metres = Brand<number, "m">;
/** Diameter or thickness, millimetres. */
export type Mm = Brand<number, "mm">;
/** Temperature, degrees Celsius. */
export type Celsius = Brand<number, "degC">;
/** Duration, seconds. */
export type Seconds = Brand<number, "s">;
/** Frequency, hertz. */
export type Hertz = Brand<number, "Hz">;
/** Mass per unit length, kilograms per kilometre. */
export type KgPerKm = Brand<number, "kg/km">;
/**
 * A dimensionless ratio, e.g. a derating factor or power factor.
 * Not a percentage — 0.95 means 95%.
 */
export type Ratio = Brand<number, "ratio">;

/* -------------------------------------------------------------------------- */
/* Constructors                                                               */
/* -------------------------------------------------------------------------- */

const make =
  <T extends number>() =>
  (value: number): T =>
    value as T;

export const amperes = make<Amperes>();
export const volts = make<Volts>();
export const watts = make<Watts>();
export const voltAmperes = make<VoltAmperes>();
export const vars = make<Vars>();
export const ohms = make<Ohms>();
export const ohmsPerKm = make<OhmsPerKm>();
export const squareMm = make<SquareMm>();
export const metres = make<Metres>();
export const mm = make<Mm>();
export const celsius = make<Celsius>();
export const seconds = make<Seconds>();
export const hertz = make<Hertz>();
export const kgPerKm = make<KgPerKm>();
export const ratio = make<Ratio>();

/** Strip the brand. Use when handing a value to generic numeric code. */
export const raw = (value: number): number => value;

/* -------------------------------------------------------------------------- */
/* Derived-unit conversions                                                   */
/* -------------------------------------------------------------------------- */

/** Kilowatts to watts. */
export const kW = (value: number): Watts => watts(value * 1000);
/** Kilovolt-amperes to volt-amperes. */
export const kVA = (value: number): VoltAmperes => voltAmperes(value * 1000);
/** Kilovolts to volts. */
export const kV = (value: number): Volts => volts(value * 1000);
/** Kiloamperes to amperes. */
export const kA = (value: number): Amperes => amperes(value * 1000);

/** Watts expressed in kilowatts. */
export const toKW = (value: Watts): number => value / 1000;
/** Volt-amperes expressed in kilovolt-amperes. */
export const toKVA = (value: VoltAmperes): number => value / 1000;
/** Volts expressed in kilovolts. */
export const toKV = (value: Volts): number => value / 1000;
/** Amperes expressed in kiloamperes. */
export const toKA = (value: Amperes): number => value / 1000;

/**
 * Resolve a per-kilometre impedance over an actual run length.
 *
 * Cable data is published per kilometre; circuits are specified in metres.
 * Doing this in one audited place means the /1000 cannot be forgotten at a
 * call site.
 */
export const overLength = (perKm: OhmsPerKm, length: Metres): Ohms => ohms((perKm * length) / 1000);

/* -------------------------------------------------------------------------- */
/* Imperial / AWG support (Phase 9, NEC profile)                              */
/* -------------------------------------------------------------------------- */

/** Feet to metres. */
export const feet = (value: number): Metres => metres(value * 0.3048);
/** Metres expressed in feet. */
export const toFeet = (value: Metres): number => value / 0.3048;
/** Thousand circular mils to square millimetres. */
export const kcmil = (value: number): SquareMm => squareMm(value * 0.5067075);
/** Square millimetres expressed in thousand circular mils. */
export const toKcmil = (value: SquareMm): number => value / 0.5067075;
/** Degrees Fahrenheit to degrees Celsius. */
export const fahrenheit = (value: number): Celsius => celsius(((value - 32) * 5) / 9);
/** Degrees Celsius expressed in degrees Fahrenheit. */
export const toFahrenheit = (value: Celsius): number => (value * 9) / 5 + 32;
