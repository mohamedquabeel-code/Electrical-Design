import { describe, expect, it } from "vitest";
import { checkProjectIntegrity, PROJECT_SCHEMA_VERSION, Project } from "./project.js";

const project = (overrides: Partial<Record<string, unknown>> = {}) =>
  Project.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "p1",
    name: "Plant",
    kind: "industrial",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

const load = { id: "L1", type: "motor", connection: "3ph-3w", voltage: 400, power: 22000 };

const route = {
  length: 60,
  basis: "catalogue",
  catalogueInstallation: "ground",
};

describe("checkProjectIntegrity", () => {
  it("accepts a coherent project", () => {
    const result = checkProjectIntegrity(
      project({ loads: [load], circuits: [{ id: "C1", loadId: "L1", route }] }),
    );
    expect(result).toEqual([]);
  });

  it("catches a circuit pointing at a load that does not exist", () => {
    const result = checkProjectIntegrity(
      project({ loads: [load], circuits: [{ id: "C1", loadId: "missing", route }] }),
    );
    expect(result).toEqual([expect.stringContaining('unknown load "missing"')]);
  });

  it("catches manual mode with no cable chosen", () => {
    const result = checkProjectIntegrity(
      project({ loads: [load], circuits: [{ id: "C1", loadId: "L1", route, mode: "manual" }] }),
    );
    expect(result).toEqual([expect.stringContaining("no cable selected")]);
  });

  it("catches a design basis with no matching installation description", () => {
    const withoutInstallation = { length: 60, basis: "catalogue" };
    const result = checkProjectIntegrity(
      project({
        loads: [load],
        circuits: [{ id: "C1", loadId: "L1", route: withoutInstallation }],
      }),
    );
    expect(result).toEqual([expect.stringContaining("no installation condition")]);
  });

  it("catches an IEC 60364 basis with no reference method", () => {
    const result = checkProjectIntegrity(
      project({
        loads: [load],
        circuits: [{ id: "C1", loadId: "L1", route: { length: 20, basis: "iec60364" } }],
      }),
    );
    expect(result).toEqual([expect.stringContaining("no reference method")]);
  });

  it("catches duplicate ids", () => {
    const result = checkProjectIntegrity(project({ loads: [load, { ...load }] }));
    expect(result).toEqual([expect.stringContaining('Duplicate load id "L1"')]);
  });
});
