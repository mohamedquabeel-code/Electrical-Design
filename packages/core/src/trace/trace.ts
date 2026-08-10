/**
 * Calculation trace.
 *
 * Every value the engine produces carries the formula that produced it, the
 * inputs that went in, and a citation. Three things depend on this:
 *
 *  1. The PDF calculation report is generated from the trace, so the submitted
 *     document shows real working rather than bare answers.
 *  2. The engineer can see why a cable was chosen and challenge it.
 *  3. When a result rests on an assumed value rather than published data —
 *     a transformer impedance that the catalogue does not print, for instance —
 *     the trace says so, instead of presenting a guess as a fact.
 */

/** Where a number came from. */
export type Citation =
  | {
      readonly kind: "standard";
      /** e.g. "IEC 60364-5-52". */
      readonly standard: string;
      /** e.g. "Table B.52.14" or "411.3.2.2". */
      readonly clause: string;
    }
  | {
      readonly kind: "catalogue";
      /** e.g. "Elsewedy Power Cables Catalogue". */
      readonly document: string;
      readonly page: number;
      readonly table?: string;
      /** Dataset build this row came from, for reproducibility. */
      readonly datasetVersion: string;
    }
  | {
      readonly kind: "derived";
      /** Why the value had to be derived rather than read. */
      readonly reason: string;
    }
  | {
      readonly kind: "assumed";
      /** What was assumed and on whose authority. */
      readonly reason: string;
    }
  | { readonly kind: "userInput" };

/** One step of working. */
export interface TraceStep {
  /** Short label, e.g. "Design current". */
  readonly label: string;
  /** Symbolic form, e.g. "Ib = P / (sqrt(3) * U * pf * eff)". */
  readonly formula?: string;
  /** Named inputs actually substituted into the formula. */
  readonly inputs?: Readonly<Record<string, number | string>>;
  readonly value: number;
  readonly unit: string;
  readonly citation: Citation;
  /** Anything the engineer must know to read the number correctly. */
  readonly note?: string;
}

/** An ordered set of steps producing one result. */
export interface CalculationTrace {
  readonly title: string;
  readonly steps: readonly TraceStep[];
}

/** Build a trace step. Thin, but keeps construction uniform at call sites. */
export const step = (input: TraceStep): TraceStep => input;

export const trace = (title: string, steps: readonly TraceStep[]): CalculationTrace => ({
  title,
  steps,
});

/** True when any step in the trace rests on an assumption rather than data. */
export const hasAssumptions = (calculation: CalculationTrace): boolean =>
  calculation.steps.some((entry) => entry.citation.kind === "assumed");

/** Every assumption in a trace, for the report's assumptions register. */
export const assumptions = (calculation: CalculationTrace): readonly TraceStep[] =>
  calculation.steps.filter((entry) => entry.citation.kind === "assumed");

/** Render a citation as the short string used in report footnotes. */
export const citationText = (citation: Citation): string => {
  switch (citation.kind) {
    case "standard":
      return `${citation.standard} ${citation.clause}`;
    case "catalogue":
      return citation.table
        ? `${citation.document}, ${citation.table} (p.${citation.page})`
        : `${citation.document}, p.${citation.page}`;
    case "derived":
      return `Derived: ${citation.reason}`;
    case "assumed":
      return `Assumed: ${citation.reason}`;
    case "userInput":
      return "User input";
  }
};
