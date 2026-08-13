import { describe, expect, it } from "vitest";
import { Load } from "../model/load.js";
import { Route } from "../model/circuit.js";
import type { CableProduct } from "../model/cable.js";
import { IEC } from "../standards/iec.js";
import { evaluate, publishedRating, sizeCircuit, type SizingContext } from "./size.js";

/**
 * A small hand-built dataset. Values mirror the real catalogue rows so the
 * arithmetic below can be checked by hand, but the fixture is fixed here so
 * these tests exercise the engine rather than the ingest.
 */
const product = (over: Partial<CableProduct> & Pick<CableProduct, "productCode" | "csa">) =>
  ({
    conductor: "copper",
    insulation: "pvc",
    armour: "none",
    sheath: "pvc",
    voltageGrade: "0.6/1",
    cores: 3,
    rDc20: 1,
    rAcMax: 1.2,
    ampacity: { ground: { default: 100 }, freeAir: { default: 80 } },
    sourcePage: 67,
    ...over,
  }) as CableProduct;

// Real 0.6/1 kV 3-core Cu/PVC rows from catalogue p.67.
const CATALOGUE: CableProduct[] = [
  product({
    productCode: "C-1.5",
    csa: 1.5,
    rDc20: 12.1,
    ampacity: { ground: { default: 27 }, freeAir: { default: 20 } },
  }),
  product({
    productCode: "C-2.5",
    csa: 2.5,
    rDc20: 7.41,
    ampacity: { ground: { default: 35 }, freeAir: { default: 24 } },
  }),
  product({
    productCode: "C-4",
    csa: 4,
    rDc20: 4.61,
    ampacity: { ground: { default: 46 }, freeAir: { default: 34 } },
  }),
  product({
    productCode: "C-6",
    csa: 6,
    rDc20: 3.08,
    ampacity: { ground: { default: 59 }, freeAir: { default: 43 } },
  }),
  product({
    productCode: "C-10",
    csa: 10,
    rDc20: 1.83,
    ampacity: { ground: { default: 78 }, freeAir: { default: 59 } },
  }),
  product({
    productCode: "C-16",
    csa: 16,
    rDc20: 1.15,
    ampacity: { ground: { default: 98 }, freeAir: { default: 80 } },
  }),
  product({
    productCode: "C-25",
    csa: 25,
    rDc20: 0.727,
    ampacity: { ground: { default: 130 }, freeAir: { default: 102 } },
  }),
  product({
    productCode: "C-35",
    csa: 35,
    rDc20: 0.524,
    ampacity: { ground: { default: 156 }, freeAir: { default: 125 } },
  }),
];

const context: SizingContext = {
  profile: IEC,
  products: CATALOGUE,
  datasetVersion: "test",
  tables: {
    temperatureDerating: {
      air: {
        pvc: { "30": 1, "35": 0.92, "40": 0.84, "45": 0.75 },
        xlpe: { "30": 1, "35": 0.95, "40": 0.9, "45": 0.84 },
      },
      ground: {
        pvc: { "20": 1, "25": 0.95, "30": 0.89 },
        xlpe: { "20": 1, "25": 0.96, "30": 0.93 },
      },
    },
    burialDepth: {
      directBuried: { threeCore: { "0.5": 1, "1": 0.94 }, singleCoreUpTo185: { "0.5": 1 } },
    },
    soilResistivity: { "0.8": 1.1, "1.0": 1, "1.5": 0.83, "2.0": 0.73 },
    groupingInGround: {
      multiCore: { "2": { touching: { trefoil: 0.81, flat: 0.81 } } },
      singleCore: { "2": { touching: { trefoil: 0.77, flat: 0.8 } } },
    },
  },
  reactance: {
    singleCore: { copper: { pvc: { "25": { flat: 0.146, trefoil: 0.0882 } } } },
    multiCore: { copper: { pvc: { "16": { default: 0.0976 }, "25": { default: 0.0882 } } } },
  },
};

const load = (over: Partial<Record<string, unknown>> = {}) =>
  Load.parse({
    id: "L1",
    name: "Test load",
    type: "other",
    connection: "3ph-4w",
    voltage: 400,
    power: 30000,
    powerFactor: 0.85,
    ...over,
  });

const route = (over: Partial<Record<string, unknown>> = {}) =>
  Route.parse({ length: 50, basis: "catalogue", catalogueInstallation: "freeAir", ...over });

describe("design current", () => {
  it("uses the three-phase formula and includes efficiency", () => {
    // 30 kW, 400 V, pf 0.85, eff 0.9 -> 30000/(1.732*400*0.85*0.9) = 56.6 A
    const result = evaluate(
      context,
      { load: load({ efficiency: 0.9 }), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { product: CATALOGUE[7]!, parallelRuns: 1 },
    );
    expect(result.designCurrent).toBeCloseTo(56.6, 1);
  });

  it("uses the single-phase formula when the load is single phase", () => {
    // 3 kW, 230 V, pf 1 -> 13.04 A
    const result = evaluate(
      context,
      {
        load: load({ connection: "1ph-ln", voltage: 230, power: 3000, powerFactor: 1 }),
        route: route(),
        nominalVoltage: 230,
        deviceType: "mcb",
      },
      { product: CATALOGUE[0]!, parallelRuns: 1 },
    );
    expect(result.designCurrent).toBeCloseTo(13.04, 2);
  });
});

describe("correction factors", () => {
  it("applies ambient temperature, interpolating between tabulated steps", () => {
    // 37.5 degC is midway between 0.92 at 35 and 0.84 at 40 -> 0.88
    const result = evaluate(
      context,
      {
        load: load(),
        route: route({ ambientAirTemp: 37.5 }),
        nominalVoltage: 400,
        deviceType: "mccb",
      },
      { product: CATALOGUE[7]!, parallelRuns: 1 },
    );
    expect(result.correctionFactor).toBeCloseTo(0.88, 4);
  });

  it("multiplies burial depth, soil resistivity and grouping together", () => {
    // 1 m depth 0.94 x 1.5 K.m/W 0.83 x 2 circuits touching 0.81 = 0.632
    const result = evaluate(
      context,
      {
        load: load(),
        route: route({
          catalogueInstallation: "ground",
          burialDepth: 1,
          soilResistivity: 1.5,
          groupedCircuits: 2,
        }),
        nominalVoltage: 400,
        deviceType: "mccb",
      },
      { product: CATALOGUE[7]!, parallelRuns: 1 },
    );
    expect(result.correctionFactor).toBeCloseTo(0.94 * 0.83 * 0.81, 4);
  });

  it("does not apply burial corrections to a cable in free air", () => {
    const result = evaluate(
      context,
      {
        load: load(),
        route: route({ soilResistivity: 2.0, burialDepth: 3 }),
        nominalVoltage: 400,
        deviceType: "mccb",
      },
      { product: CATALOGUE[7]!, parallelRuns: 1 },
    );
    expect(result.correctionFactor).toBe(1);
  });
});

describe("coordination rules", () => {
  it("passes a correctly sized circuit", () => {
    const result = evaluate(
      context,
      { load: load({ power: 20000 }), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { product: CATALOGUE[6]!, parallelRuns: 1 },
    );
    const ids = result.rules.filter((r) => r.status === "fail").map((r) => r.id);
    expect(ids).toEqual([]);
  });

  it("fails Iz >= In when the cable cannot carry what the device allows", () => {
    // 30 kW -> Ib 50.9 A -> In 63 A, but 4 mm2 in free air is only 34 A.
    const result = evaluate(
      context,
      { load: load(), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { product: CATALOGUE[2]!, parallelRuns: 1 },
    );
    const failed = result.rules.find((r) => r.id === "coordination.izGeIn");
    expect(failed?.status).toBe("fail");
    expect(result.compliant).toBe(false);
  });

  it("holds a fuse to a higher cable rating than a breaker, per I2", () => {
    // A gG fuse trips at 1.6 In where a breaker trips at 1.45 In, so the rule
    // I2 <= 1.45 Iz only separates them when Iz sits in [In, 1.103 In):
    // above that band both pass, below it both fail on Iz >= In.
    //
    // 20.6 kW at 400 V, pf 0.85 -> Ib 35.0 A -> In 40 A.
    // 6 mm2 in free air gives Iz 43 A, which is inside the band.
    //   breaker  I2 = 1.45 x 40 = 58.0 A <= 1.45 x 43 = 62.35 A   pass
    //   fuse     I2 = 1.60 x 40 = 64.0 A >  62.35 A               fail
    const input = { load: load({ power: 20600 }), route: route(), nominalVoltage: 400 };
    const candidate = { product: CATALOGUE[3]!, parallelRuns: 1 };

    const breaker = evaluate(context, { ...input, deviceType: "mccb" }, candidate);
    const fuse = evaluate(context, { ...input, deviceType: "fuse-gG" }, candidate);

    expect(breaker.rules.find((r) => r.id === "coordination.i2")?.status).not.toBe("fail");
    expect(fuse.rules.find((r) => r.id === "coordination.i2")?.status).toBe("fail");
  });
});

describe("voltage drop", () => {
  it("computes from R and X at the operating temperature", () => {
    // 16 mm2 Cu/PVC: R20 = 1.15, at 70 degC R = 1.15 x 1.1965 = 1.3760 ohm/km
    // X = 0.0976, pf 0.85 -> sin = 0.5268
    // Ib = 20000/(1.732*400*0.85) = 33.97 A over 50 m
    // dU = 1.732 * 33.97 * 0.05 * (1.3760*0.85 + 0.0976*0.5268) = 3.58 V
    const result = evaluate(
      context,
      { load: load({ power: 20000 }), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { product: CATALOGUE[5]!, parallelRuns: 1 },
    );
    expect(result.voltageDrop.volts).toBeCloseTo(3.58, 1);
    expect(result.voltageDrop.percent * 100).toBeCloseTo(0.895, 2);
  });

  it("holds lighting to 3% and other loads to 5%", () => {
    expect(IEC.voltageDropLimit("lighting")).toBe(0.03);
    expect(IEC.voltageDropLimit("socket")).toBe(0.05);
  });

  it("halves the drop when two cables run in parallel", () => {
    const input = { load: load({ power: 20000 }), route: route(), nominalVoltage: 400 } as const;
    const one = evaluate(
      context,
      { ...input, deviceType: "mccb" },
      {
        product: CATALOGUE[5]!,
        parallelRuns: 1,
      },
    );
    const two = evaluate(
      context,
      { ...input, deviceType: "mccb" },
      {
        product: CATALOGUE[5]!,
        parallelRuns: 2,
      },
    );
    expect(two.voltageDrop.volts).toBeCloseTo(one.voltageDrop.volts / 2, 6);
  });
});

describe("short-circuit withstand", () => {
  it("passes when the device clears before the conductor overheats", () => {
    // 16 mm2 Cu/PVC, k = 115: t <= (115 x 16)^2 / 6000^2 = 0.094 s
    const result = evaluate(
      context,
      {
        load: load({ power: 20000 }),
        route: route(),
        nominalVoltage: 400,
        deviceType: "mccb",
        faultCurrent: 6000,
        clearingTime: 0.05,
      },
      { product: CATALOGUE[5]!, parallelRuns: 1 },
    );
    const rule = result.rules.find((r) => r.id === "shortCircuit.adiabatic");
    expect(rule?.status).not.toBe("fail");
    expect(rule?.limit).toBeCloseTo(0.094, 3);
  });

  it("fails when the device is too slow for the conductor", () => {
    const result = evaluate(
      context,
      {
        load: load({ power: 20000 }),
        route: route(),
        nominalVoltage: 400,
        deviceType: "mccb",
        faultCurrent: 6000,
        clearingTime: 0.2,
      },
      { product: CATALOGUE[5]!, parallelRuns: 1 },
    );
    expect(result.rules.find((r) => r.id === "shortCircuit.adiabatic")?.status).toBe("fail");
  });

  it("reports the check as not evaluated rather than passing it silently", () => {
    const result = evaluate(
      context,
      { load: load({ power: 20000 }), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { product: CATALOGUE[5]!, parallelRuns: 1 },
    );
    const rule = result.rules.find((r) => r.id === "shortCircuit.adiabatic");
    expect(rule?.status).toBe("notEvaluated");
    // A check that could not run must never count as compliance.
    expect(rule?.status).not.toBe("pass");
  });
});

describe("published ratings", () => {
  it("returns nothing when the arrangement has no published rating", () => {
    const quarantined = product({
      productCode: "Q",
      csa: 25,
      cores: 1,
      ampacity: { ground: { trefoil: 160 } },
    });
    // The flat rating was quarantined as defective; it must not fall back to
    // the trefoil figure, which describes a different arrangement.
    expect(publishedRating(quarantined, "ground", "flat")).toBeUndefined();
    expect(publishedRating(quarantined, "ground", "trefoil")?.value).toBe(160);
  });
});

describe("automatic sizing", () => {
  it("selects the smallest compliant cable", () => {
    const result = sizeCircuit(
      context,
      { load: load(), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { cores: 3 },
    );
    // Ib = 50.9 A -> In = 63 A -> needs Iz >= 63 A in free air: 16 mm2 at 80 A.
    expect(result.selected?.candidate.product.productCode).toBe("C-16");
    expect(result.selected?.device.rating).toBe(63);
  });

  it("goes up a size when voltage drop rules out the smaller one", () => {
    const short = sizeCircuit(
      context,
      { load: load(), route: route({ length: 20 }), nominalVoltage: 400, deviceType: "mccb" },
      { cores: 3 },
    );
    const long = sizeCircuit(
      context,
      { load: load(), route: route({ length: 200 }), nominalVoltage: 400, deviceType: "mccb" },
      { cores: 3 },
    );
    expect(short.selected?.candidate.product.csa).toBe(16);
    expect(long.selected!.candidate.product.csa).toBeGreaterThan(16);
  });

  it("explains why each rejected cable was rejected", () => {
    const result = sizeCircuit(
      context,
      { load: load(), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { cores: 3 },
    );
    expect(result.rejected.length).toBeGreaterThan(0);
    for (const rejection of result.rejected) {
      expect(rejection.rules.some((rule) => rule.status === "fail")).toBe(true);
    }
  });

  it("agrees with manual evaluation of the same cable", () => {
    const input = {
      load: load(),
      route: route(),
      nominalVoltage: 400,
      deviceType: "mccb",
    } as const;
    const auto = sizeCircuit(context, input, { cores: 3 });
    const manual = evaluate(context, input, auto.selected!.candidate);
    // Automatic and manual share one implementation, so they cannot disagree.
    expect(manual.compliant).toBe(auto.selected!.compliant);
    expect(manual.ampacity).toBe(auto.selected!.ampacity);
    expect(manual.voltageDrop.volts).toBe(auto.selected!.voltageDrop.volts);
  });

  it("returns no selection when nothing in the range works", () => {
    const result = sizeCircuit(
      context,
      { load: load({ power: 500000 }), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { cores: 3 },
    );
    expect(result.selected).toBeUndefined();
    expect(result.rejected.length).toBeGreaterThan(0);
  });
});

describe("traces", () => {
  it("carries a citation on every step", () => {
    const result = evaluate(
      context,
      { load: load(), route: route(), nominalVoltage: 400, deviceType: "mccb" },
      { product: CATALOGUE[6]!, parallelRuns: 1 },
    );
    const steps = result.traces.flatMap((t) => t.steps);
    expect(steps.length).toBeGreaterThan(5);
    for (const entry of steps) {
      expect(entry.citation).toBeDefined();
      expect(entry.value).toBeTypeOf("number");
    }
  });
});
