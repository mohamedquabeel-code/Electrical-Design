import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IEC,
  Load,
  Route,
  evaluate,
  sizeCircuit,
  type CableProduct,
  type SizingContext,
} from "@ed/core";
import { DATASETS_DIR } from "./paths.js";

/**
 * The engine driven against the real catalogue dataset.
 *
 * The unit tests in @ed/core use a small fixture so their arithmetic can be
 * checked by hand. This file does the opposite: it runs the whole chain over
 * all 1,974 real products, which is the only way to catch the failures that
 * come from the data rather than the logic — a missing rating for a common
 * arrangement, a reactance lookup that misses, a filter that excludes
 * everything.
 */

const read = (name: string): Record<string, never> =>
  JSON.parse(readFileSync(join(DATASETS_DIR, "elsewedy-cables", name), "utf-8"));

const products = read("cables.json")["products"] as unknown as CableProduct[];
const tables = read("general.json")["tables"] as unknown as SizingContext["tables"];
const reactance = read("derived-reactance.json")[
  "reactance"
] as unknown as SizingContext["reactance"];

const context: SizingContext = {
  profile: IEC,
  products,
  tables,
  reactance,
  datasetVersion: "1.0.0",
};

describe("sizing against the real catalogue", () => {
  it("sizes a 30 kW three-phase motor feeder buried in ground", () => {
    const load = Load.parse({
      id: "M1",
      name: "Pump P-101",
      type: "motor",
      connection: "3ph-3w",
      voltage: 400,
      power: 30000,
      powerFactor: 0.86,
      efficiency: 0.92,
    });

    const route = Route.parse({
      length: 120,
      basis: "catalogue",
      catalogueInstallation: "ground",
      groundTemp: 25,
      burialDepth: 0.8,
      soilResistivity: 1.5,
    });

    const result = sizeCircuit(
      context,
      { load, route, nominalVoltage: 400, deviceType: "mccb" },
      { conductor: "copper", insulation: "xlpe", armour: "swa", cores: 3, voltageGrade: "0.6/1" },
    );

    expect(result.selected).toBeDefined();
    const selected = result.selected!;

    // Ib = 30000 / (sqrt(3) x 400 x 0.86 x 0.92) = 54.7 A
    expect(selected.designCurrent).toBeCloseTo(54.7, 1);
    expect(selected.device.rating).toBe(63);

    // Hot, deep and dry ground all cut the rating.
    expect(selected.correctionFactor).toBeLessThan(1);
    expect(selected.ampacity).toBeGreaterThanOrEqual(selected.device.rating);
    expect(selected.voltageDrop.percent).toBeLessThanOrEqual(0.05);
    expect(selected.compliant).toBe(true);
  });

  it("picks a larger cable for the same load on a longer run", () => {
    const load = Load.parse({
      id: "M1",
      type: "motor",
      connection: "3ph-3w",
      voltage: 400,
      power: 30000,
      powerFactor: 0.86,
      efficiency: 0.92,
    });
    const base = { basis: "catalogue", catalogueInstallation: "ground" };
    const filter = {
      conductor: "copper",
      insulation: "xlpe",
      armour: "swa",
      cores: 3,
      voltageGrade: "0.6/1",
    } as const;

    const short = sizeCircuit(
      context,
      {
        load,
        route: Route.parse({ ...base, length: 30 }),
        nominalVoltage: 400,
        deviceType: "mccb",
      },
      filter,
    );
    const long = sizeCircuit(
      context,
      {
        load,
        route: Route.parse({ ...base, length: 400 }),
        nominalVoltage: 400,
        deviceType: "mccb",
      },
      filter,
    );

    expect(short.selected).toBeDefined();
    expect(long.selected).toBeDefined();
    // Ampacity alone would give the same cable; voltage drop forces the upsize.
    expect(long.selected!.candidate.product.csa).toBeGreaterThan(
      short.selected!.candidate.product.csa,
    );
    const reason = short.selected!.candidate.product.csa;
    expect(reason).toBeGreaterThan(0);
  });

  it("holds a lighting circuit to the tighter 3% limit", () => {
    const asType = (type: "lighting" | "socket") =>
      Load.parse({
        id: "L1",
        type,
        connection: "1ph-ln",
        voltage: 230,
        power: 3000,
        powerFactor: 0.95,
      });
    const route = Route.parse({
      length: 60,
      basis: "catalogue",
      catalogueInstallation: "freeAir",
    });
    const filter = {
      conductor: "copper",
      insulation: "pvc",
      armour: "none",
      cores: 2,
      voltageGrade: "0.6/1",
    } as const;

    const lighting = sizeCircuit(
      context,
      { load: asType("lighting"), route, nominalVoltage: 230, deviceType: "mcb" },
      filter,
    );
    const socket = sizeCircuit(
      context,
      { load: asType("socket"), route, nominalVoltage: 230, deviceType: "mcb" },
      filter,
    );

    expect(lighting.selected).toBeDefined();
    expect(socket.selected).toBeDefined();
    // Same load and route; only the permitted drop differs, so lighting needs
    // at least as much copper.
    expect(lighting.selected!.candidate.product.csa).toBeGreaterThanOrEqual(
      socket.selected!.candidate.product.csa,
    );
    expect(lighting.selected!.voltageDrop.percent).toBeLessThanOrEqual(0.03);
  });

  it("resolves reactance for every LV product it selects", () => {
    const load = Load.parse({
      id: "L1",
      type: "other",
      connection: "3ph-4w",
      voltage: 400,
      power: 50000,
      powerFactor: 0.9,
    });
    const route = Route.parse({
      length: 100,
      basis: "catalogue",
      catalogueInstallation: "freeAir",
    });

    for (const insulation of ["pvc", "xlpe"] as const) {
      for (const conductor of ["copper", "aluminium"] as const) {
        const result = sizeCircuit(
          context,
          { load, route, nominalVoltage: 400, deviceType: "mccb" },
          { conductor, insulation, armour: "none", cores: 4, voltageGrade: "0.6/1" },
        );
        expect(result.selected, `${conductor}/${insulation}`).toBeDefined();
        // A zero drop would mean both R and X resolved to nothing.
        expect(result.selected!.voltageDrop.volts).toBeGreaterThan(0);
      }
    }
  });

  it("refuses a product whose rating for that arrangement was quarantined", () => {
    // CXB-T101-B12's ground/flat rating of 468 A was removed as defective.
    const product = products.find((p) => p.productCode === "CXB-T101-B12");
    expect(product).toBeDefined();

    const load = Load.parse({
      id: "L1",
      type: "other",
      connection: "3ph-3w",
      voltage: 6000,
      power: 1_200_000,
      powerFactor: 0.9,
    });

    const flat = evaluate(
      context,
      {
        load,
        route: Route.parse({
          length: 50,
          basis: "catalogue",
          catalogueInstallation: "ground",
          formation: "flat",
        }),
        nominalVoltage: 6000,
        deviceType: "mccb",
      },
      { product: product!, parallelRuns: 1 },
    );

    const rule = flat.rules.find((r) => r.id === "ampacity.published");
    expect(rule?.status).toBe("notEvaluated");
    expect(flat.compliant).toBe(false);

    // The sound trefoil rating on the same product is still usable.
    const trefoil = evaluate(
      context,
      {
        load,
        route: Route.parse({
          length: 50,
          basis: "catalogue",
          catalogueInstallation: "ground",
          formation: "trefoil",
        }),
        nominalVoltage: 6000,
        deviceType: "mccb",
      },
      { product: product!, parallelRuns: 1 },
    );
    expect(trefoil.rules.find((r) => r.id === "ampacity.published")).toBeUndefined();
  });

  it("uses published inductance for MV rather than a derived value", () => {
    const product = products.find((p) => p.productCode === "CXB-T101-U12")!;
    const result = evaluate(
      context,
      {
        load: Load.parse({
          id: "L1",
          type: "other",
          connection: "3ph-3w",
          voltage: 6000,
          power: 1_000_000,
          powerFactor: 0.9,
        }),
        route: Route.parse({
          length: 200,
          basis: "catalogue",
          catalogueInstallation: "ground",
          formation: "trefoil",
        }),
        nominalVoltage: 6000,
        deviceType: "mccb",
      },
      { product, parallelRuns: 1 },
    );

    const reactanceStep = result.traces
      .flatMap((t) => t.steps)
      .find((s) => s.label === "Reactance");
    expect(reactanceStep?.value).toBeCloseTo(0.1267, 4);
    expect(reactanceStep?.citation.kind).toBe("catalogue");
  });

  it("cites a source for every value in the calculation", () => {
    const result = sizeCircuit(
      context,
      {
        load: Load.parse({
          id: "L1",
          type: "other",
          connection: "3ph-4w",
          voltage: 400,
          power: 40000,
          powerFactor: 0.9,
        }),
        route: Route.parse({
          length: 75,
          basis: "catalogue",
          catalogueInstallation: "ground",
          soilResistivity: 1.2,
        }),
        nominalVoltage: 400,
        deviceType: "mccb",
      },
      { conductor: "copper", insulation: "xlpe", armour: "none", cores: 4, voltageGrade: "0.6/1" },
    );

    const steps = result.selected!.traces.flatMap((t) => t.steps);
    for (const entry of steps) {
      expect(entry.citation.kind).toBeDefined();
      expect(Number.isFinite(entry.value)).toBe(true);
    }
    // The report needs real page references, not just formulas.
    expect(steps.some((s) => s.citation.kind === "catalogue")).toBe(true);
    expect(steps.some((s) => s.citation.kind === "standard")).toBe(true);
  });
});
