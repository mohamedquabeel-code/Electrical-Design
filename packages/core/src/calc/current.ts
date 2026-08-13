import { isThreePhase, type Load } from "../model/load.js";
import { step, trace, type CalculationTrace } from "../trace/trace.js";

const SQRT3 = Math.sqrt(3);

/**
 * Design current Ib — the current the circuit is expected to carry in normal
 * service, and the starting point of every subsequent check.
 *
 *   single phase   Ib = P / (U · cos φ · η)
 *   three phase    Ib = P / (√3 · U · cos φ · η)
 *
 * Efficiency appears because a motor's rated power is its *output* at the
 * shaft, while the cable carries its input. Omitting η undersizes every motor
 * circuit by the efficiency, which is 8–12% on a typical machine.
 */
export const designCurrent = (load: Load): { value: number; trace: CalculationTrace } => {
  const threePhase = isThreePhase(load.connection);
  const denominator =
    (threePhase ? SQRT3 * load.voltage : load.voltage) * load.powerFactor * load.efficiency;
  const value = load.power / denominator;

  return {
    value,
    trace: trace(`Design current — ${load.name || load.id}`, [
      step({
        label: "Design current",
        formula: threePhase ? "Ib = P / (√3 · U · cos φ · η)" : "Ib = P / (U · cos φ · η)",
        inputs: {
          P: load.power,
          U: load.voltage,
          "cos φ": load.powerFactor,
          η: load.efficiency,
        },
        value,
        unit: "A",
        citation: { kind: "standard", standard: "IEC 60364-5-52", clause: "523" },
        ...(load.efficiency === 1 && load.type === "motor"
          ? {
              note:
                "Efficiency is 1, so the cable is sized on shaft output rather " +
                "than input power. Enter the motor's efficiency to size on the " +
                "current it actually draws.",
            }
          : {}),
      }),
    ]),
  };
};

/**
 * Neutral current from triplen harmonics, IEC 60364-5-52 Annex E.
 *
 * Third-harmonic currents are in phase in all three lines, so instead of
 * cancelling in the neutral they add. Above 33% third-harmonic content the
 * neutral carries more than the lines and becomes the conductor that sets the
 * cable size — which is why this is not an exotic case for LED lighting, IT
 * loads and drives.
 */
export const neutralCurrent = (lineCurrent: number, thirdHarmonic: number): number =>
  3 * thirdHarmonic * lineCurrent;

/**
 * Harmonic correction factor applied to the tabulated rating,
 * IEC 60364-5-52 Annex E Table E.1, selected on third-harmonic content.
 */
export const harmonicFactor = (
  thirdHarmonic: number,
): { factor: number; sizedOnNeutral: boolean } => {
  const percent = thirdHarmonic * 100;
  if (percent <= 15) return { factor: 1, sizedOnNeutral: false };
  if (percent <= 33) return { factor: 0.86, sizedOnNeutral: false };
  if (percent <= 45) return { factor: 0.86, sizedOnNeutral: true };
  return { factor: 1 / 1.15, sizedOnNeutral: true };
};
