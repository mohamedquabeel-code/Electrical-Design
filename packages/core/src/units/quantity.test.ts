import { describe, expect, it } from "vitest";
import {
  amperes,
  feet,
  kcmil,
  kVA,
  kW,
  metres,
  ohmsPerKm,
  overLength,
  toFeet,
  toKcmil,
  toKVA,
  toKW,
} from "./quantity.js";

describe("unit conversions", () => {
  it("converts kW and kVA to base units", () => {
    expect(toKW(kW(7.5))).toBeCloseTo(7.5, 10);
    expect(toKVA(kVA(1600))).toBeCloseTo(1600, 10);
  });

  it("resolves per-kilometre impedance over a run length in metres", () => {
    // 0.727 ohm/km over 50 m is 0.03635 ohm. The /1000 lives in one place so a
    // call site cannot forget it.
    expect(overLength(ohmsPerKm(0.727), metres(50))).toBeCloseTo(0.03635, 10);
  });

  it("round-trips imperial conversions", () => {
    expect(toFeet(feet(100))).toBeCloseTo(100, 9);
    expect(toKcmil(kcmil(250))).toBeCloseTo(250, 9);
  });

  it("maps kcmil to mm2 at the documented ratio", () => {
    // 250 kcmil is ~126.7 mm2, the standard equivalence used in NEC work.
    expect(kcmil(250)).toBeCloseTo(126.68, 2);
  });

  it("treats brands as erased at runtime", () => {
    expect(amperes(32) + 1).toBe(33);
  });
});
