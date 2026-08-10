/**
 * @ed/standards-data — versioned datasets with page-level provenance.
 *
 * Standards tables and manufacturer catalogues are data, not code. They are
 * loaded as versioned packs and the pack version is pinned into each project,
 * so reopening a design years later reproduces the numbers it was submitted
 * with even after a catalogue is re-digitised or corrected.
 */

import { z } from "zod";

/** Identifies a dataset build. */
export const DatasetMeta = z.object({
  datasetId: z.string().min(1),
  version: z.string().min(1),
});
export type DatasetMeta = z.infer<typeof DatasetMeta>;

/**
 * A published value that review found to be defective and ingest removed.
 *
 * Surfaced so a calculation report can state which manufacturer figures were
 * rejected and why, rather than silently presenting a dataset that differs
 * from the printed catalogue.
 */
export const QuarantinedValue = z.object({
  productCode: z.string(),
  field: z.string(),
  published: z.number(),
  page: z.number().int().positive(),
  reason: z.string(),
});
export type QuarantinedValue = z.infer<typeof QuarantinedValue>;

/**
 * The conditions a catalogue's ampacities were computed under.
 *
 * Every correction factor the engine applies is a departure from exactly these
 * conditions, so they belong with the data rather than in a constant somewhere
 * in the engine.
 */
export const ReferenceConditions = z.object({
  ambientAirTempC: z.number(),
  groundTempC: z.number(),
  soilThermalResistivityKmPerW: z.number(),
  burialDepthM: z.number(),
  ductInnerDiameterRatio: z.number(),
  loadFactor: z.number(),
  frequencyHz: z.number(),
  /** The standard the ratings were computed to, e.g. "IEC 60287". */
  ampacityBasis: z.string(),
  sourcePage: z.number().int().positive(),
});
export type ReferenceConditions = z.infer<typeof ReferenceConditions>;

export const Provenance = DatasetMeta.extend({
  source: z.object({
    document: z.string(),
    file: z.string(),
    sha256: z.string().length(64),
    pageCount: z.number().int().positive(),
  }),
  coverage: z.object({
    cablePages: z.tuple([z.number(), z.number()]),
    generalTablePages: z.tuple([z.number(), z.number()]),
    excluded: z.object({
      pages: z.tuple([z.number(), z.number()]),
      reason: z.string(),
    }),
  }),
  referenceConditions: ReferenceConditions,
  tables: z.record(
    z.string(),
    z.object({ caption: z.string(), page: z.number(), document: z.string() }),
  ),
  quarantinedValues: z.array(QuarantinedValue),
});
export type Provenance = z.infer<typeof Provenance>;

export { DATASETS_DIR } from "./paths.js";
