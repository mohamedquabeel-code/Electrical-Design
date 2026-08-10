import { z } from "zod";
import { Circuit } from "./circuit.js";
import { Load } from "./load.js";
import { EarthingSystem, Source } from "./source.js";

/**
 * Current project schema version.
 *
 * Bump on any breaking change to the shape and add a migration step in
 * `migrations.ts`. Projects are engineering records that may be reopened years
 * later, so an old file must always load.
 */
export const PROJECT_SCHEMA_VERSION = 1;

/** Which body of rules the project is designed to. */
export const StandardId = z.enum(["IEC", "BS7671", "NEC"]);
export type StandardId = z.infer<typeof StandardId>;

export const ProjectKind = z.enum(["residential", "industrial", "commercial"]);
export type ProjectKind = z.infer<typeof ProjectKind>;

/**
 * A pinned dataset version.
 *
 * Recording this in the project is what makes results reproducible. If a
 * catalogue is re-digitised or a correction is issued, an existing project
 * keeps resolving against the dataset it was actually designed with, and the
 * report continues to match what was submitted for approval.
 */
export const DatasetPin = z.object({
  /** Dataset identifier, e.g. "elsewedy-cables". */
  id: z.string().min(1),
  /** Semantic version of the dataset build. */
  version: z.string().min(1),
});
export type DatasetPin = z.infer<typeof DatasetPin>;

export const Project = z.object({
  schemaVersion: z.number().int().positive(),
  id: z.string().min(1),
  name: z.string().default("Untitled project"),
  kind: ProjectKind,
  standard: StandardId.default("IEC"),
  /** Nominal system frequency, Hz. The catalogue data is 50 Hz. */
  frequency: z.number().positive().default(50),
  earthing: EarthingSystem.default("TN-S"),
  sources: z.array(Source).default([]),
  loads: z.array(Load).default([]),
  circuits: z.array(Circuit).default([]),
  datasets: z.array(DatasetPin).default([]),
  /** ISO 8601. Supplied by the caller — the engine itself never reads a clock. */
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

/**
 * Referential integrity checks that zod cannot express structurally.
 * Returns human-readable problems; an empty array means the project is coherent.
 */
export const checkProjectIntegrity = (project: Project): string[] => {
  const problems: string[] = [];
  const loadIds = new Set(project.loads.map((load) => load.id));

  for (const circuit of project.circuits) {
    if (!loadIds.has(circuit.loadId)) {
      problems.push(`Circuit "${circuit.id}" references unknown load "${circuit.loadId}".`);
    }
    if (circuit.mode === "manual" && !circuit.cable) {
      problems.push(`Circuit "${circuit.id}" is in manual mode but has no cable selected.`);
    }
    const { basis, catalogueInstallation, referenceMethod } = circuit.route;
    if (basis === "catalogue" && !catalogueInstallation) {
      problems.push(`Circuit "${circuit.id}" uses catalogue basis but no installation condition.`);
    }
    if (basis === "iec60364" && !referenceMethod) {
      problems.push(`Circuit "${circuit.id}" uses IEC 60364 basis but no reference method.`);
    }
  }

  const duplicateLoad = findDuplicate(project.loads.map((load) => load.id));
  if (duplicateLoad) problems.push(`Duplicate load id "${duplicateLoad}".`);

  const duplicateCircuit = findDuplicate(project.circuits.map((circuit) => circuit.id));
  if (duplicateCircuit) problems.push(`Duplicate circuit id "${duplicateCircuit}".`);

  return problems;
};

const findDuplicate = (values: string[]): string | undefined => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
};
