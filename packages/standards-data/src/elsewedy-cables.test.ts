import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CableProduct } from "@ed/core";
import { DATASETS_DIR } from "./paths.js";
import { Provenance } from "./index.js";

/**
 * End-to-end check that the generated dataset satisfies the engine's schema.
 *
 * This is the seam where the Python ingest meets the TypeScript engine. Nothing
 * else verifies that the two agree on field names, units or optionality, and a
 * mismatch here would surface as a runtime failure deep inside a calculation.
 */

const read = (name: string): unknown =>
  JSON.parse(readFileSync(join(DATASETS_DIR, "elsewedy-cables", name), "utf-8"));

const cables = read("cables.json") as { products: unknown[]; version: string };
const provenance = read("provenance.json");

describe("elsewedy-cables dataset", () => {
  it("parses every product row against the engine's schema", () => {
    const failures: string[] = [];
    for (const product of cables.products) {
      const result = CableProduct.safeParse(product);
      if (!result.success) {
        const code = (product as { productCode?: string }).productCode ?? "?";
        failures.push(`${code}: ${result.error.issues[0]?.message ?? "invalid"}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(cables.products.length).toBeGreaterThan(1900);
  });

  it("has valid provenance recording the source document and its hash", () => {
    const parsed = Provenance.parse(provenance);
    expect(parsed.source.file).toBe("power-cables-catalogue.pdf");
    expect(parsed.referenceConditions.ampacityBasis).toBe("IEC 60287");
    // The reference conditions every correction factor is measured against.
    expect(parsed.referenceConditions.ambientAirTempC).toBe(30);
    expect(parsed.referenceConditions.groundTempC).toBe(20);
    expect(parsed.referenceConditions.burialDepthM).toBe(0.5);
  });

  it("records the defective published values that were quarantined", () => {
    const parsed = Provenance.parse(provenance);
    expect(parsed.quarantinedValues.length).toBe(5);
    // The most dangerous one: 468 A where the row's own trefoil column says 160.
    const worst = parsed.quarantinedValues.find((v) => v.productCode === "CXB-T101-B12");
    expect(worst?.published).toBe(468);
    expect(worst?.field).toBe("ampacity.ground.flat");
  });

  it("removed the quarantined cells from the product data", () => {
    const products = cables.products as {
      productCode: string;
      ampacity: Record<string, unknown>;
    }[];
    const affected = products.find((p) => p.productCode === "CXB-T101-B12");
    expect(affected).toBeDefined();
    // The flat rating is gone; trefoil, which was sound, is retained.
    expect((affected?.ampacity["ground"] as Record<string, number>)["flat"]).toBeUndefined();
    expect((affected?.ampacity["ground"] as Record<string, number>)["trefoil"]).toBe(160);
  });

  it("reproduces known catalogue rows exactly", () => {
    const products = cables.products as Record<string, never>[];
    const find = (code: string) => products.find((p) => p["productCode"] === code);

    // p.67, 2-core 1.5 mm2 Cu/PVC/PVC.
    expect(find("CP1-T102-U04")).toMatchObject({
      csa: 1.5,
      rDc20: 12.1,
      rAcMax: 14.6,
      cores: 2,
      ampacity: { ground: { default: 34 }, duct: { default: 25 }, freeAir: { default: 21 } },
      weight: 127,
    });

    // p.112, MV single core: inductance is published, so reactance is measured
    // rather than inferred. X = 2*pi*50*0.4033e-3 = 0.1267 ohm/km.
    expect(find("CXB-T101-U12")).toMatchObject({
      csa: 25,
      capacitance: 0.252,
      inductance: { trefoil: 0.4033, flat: 0.5733 },
      reactance: { trefoil: 0.1267 },
    });

    // p.68, 4-core with a reduced neutral: both sizes are retained.
    expect(find("CP1-T105-U12")).toMatchObject({ csa: 25, reducedNeutralCsa: 16, cores: 4 });
  });

  it("keeps flat reactance above trefoil, since the conductors sit further apart", () => {
    const products = cables.products as { reactance?: Record<string, number> }[];
    const withBoth = products.filter((p) => p.reactance?.["flat"] && p.reactance?.["trefoil"]);
    expect(withBoth.length).toBeGreaterThan(100);
    for (const product of withBoth) {
      expect(product.reactance!["flat"]!).toBeGreaterThan(product.reactance!["trefoil"]!);
    }
  });
});
