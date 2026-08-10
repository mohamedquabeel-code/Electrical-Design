import { describe, expect, it } from "vitest";
import { loadProject, ProjectMigrationError } from "./migrations.js";
import { PROJECT_SCHEMA_VERSION } from "./project.js";

const minimalProject = () => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  id: "p1",
  name: "Villa",
  kind: "residential",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("loadProject", () => {
  it("loads a current-version project and applies schema defaults", () => {
    const project = loadProject(minimalProject());
    expect(project.standard).toBe("IEC");
    expect(project.earthing).toBe("TN-S");
    expect(project.frequency).toBe(50);
    expect(project.circuits).toEqual([]);
  });

  it("refuses a project written by a newer build rather than silently dropping fields", () => {
    const future = { ...minimalProject(), schemaVersion: PROJECT_SCHEMA_VERSION + 1 };
    expect(() => loadProject(future)).toThrow(ProjectMigrationError);
  });

  it("rejects a document with no schema version", () => {
    const { schemaVersion: _dropped, ...noVersion } = minimalProject();
    expect(() => loadProject(noVersion)).toThrow(/schemaVersion/);
  });

  it("rejects non-objects", () => {
    expect(() => loadProject(null)).toThrow(ProjectMigrationError);
    expect(() => loadProject("{}")).toThrow(ProjectMigrationError);
  });

  it("round-trips through JSON without loss", () => {
    const original = loadProject(minimalProject());
    const restored = loadProject(JSON.parse(JSON.stringify(original)));
    expect(restored).toEqual(original);
  });
});
