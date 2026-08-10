import type { Citation } from "../trace/trace.js";

/**
 * Compliance rules.
 *
 * Every design check — ampacity, the 1.45 coordination rule, voltage drop,
 * disconnection time, breaking capacity, cable short-circuit withstand —
 * returns the same shape. Two things follow from that:
 *
 *  - The UI renders one compliance matrix rather than a bespoke panel per check.
 *  - Automatic design is a search over candidates for one that satisfies every
 *    rule, using exactly the rule set that manual mode is judged against. The
 *    two modes cannot drift apart, because there is only one implementation.
 */

export type RuleStatus =
  /** The check passed. */
  | "pass"
  /** The check failed; the design is not compliant. */
  | "fail"
  /** Passed, but with little margin, or resting on an assumption. */
  | "warn"
  /** Could not be evaluated because a required input is missing. */
  | "notEvaluated";

export interface RuleResult {
  /** Stable identifier, e.g. "ampacity.ibLeInLeIz". */
  readonly id: string;
  /** Short human label, e.g. "Ib <= In <= Iz". */
  readonly label: string;
  readonly status: RuleStatus;
  /** The value that was tested. */
  readonly actual?: number;
  /** The limit it was tested against. */
  readonly limit?: number;
  readonly unit?: string;
  /** Sentence stating the outcome, suitable for the report. */
  readonly message: string;
  readonly citation: Citation;
  /**
   * Fractional margin to the limit, where positive means compliant.
   * Lets the UI sort by how close a design is to failing and lets the
   * automatic solver prefer candidates that are not marginal.
   */
  readonly margin?: number;
}

/** A design is compliant when no rule failed. */
export const isCompliant = (results: readonly RuleResult[]): boolean =>
  results.every((result) => result.status !== "fail");

/** Rules that failed, for the "why was this rejected" explanation. */
export const failures = (results: readonly RuleResult[]): readonly RuleResult[] =>
  results.filter((result) => result.status === "fail");

/** Rules that passed only marginally or rest on an assumption. */
export const warnings = (results: readonly RuleResult[]): readonly RuleResult[] =>
  results.filter((result) => result.status === "warn");

/**
 * Build a "value must not exceed limit" rule.
 *
 * `warnBelow` is the fraction of the limit above which a pass is downgraded to
 * a warning — a cable at 99% of its permitted voltage drop is compliant, but
 * the engineer should be told before the run length changes on site.
 */
export const checkMax = (input: {
  id: string;
  label: string;
  actual: number;
  limit: number;
  unit: string;
  citation: Citation;
  message: (verdict: "pass" | "fail") => string;
  warnBelow?: number;
}): RuleResult => {
  const { id, label, actual, limit, unit, citation, message, warnBelow = 0.95 } = input;
  const passed = actual <= limit;
  const margin = limit === 0 ? 0 : (limit - actual) / limit;
  const status: RuleStatus = !passed ? "fail" : actual > limit * warnBelow ? "warn" : "pass";
  return {
    id,
    label,
    status,
    actual,
    limit,
    unit,
    citation,
    margin,
    message: message(passed ? "pass" : "fail"),
  };
};

/** Build a "value must reach at least limit" rule. */
export const checkMin = (input: {
  id: string;
  label: string;
  actual: number;
  limit: number;
  unit: string;
  citation: Citation;
  message: (verdict: "pass" | "fail") => string;
  warnAbove?: number;
}): RuleResult => {
  const { id, label, actual, limit, unit, citation, message, warnAbove = 1.05 } = input;
  const passed = actual >= limit;
  const margin = limit === 0 ? 0 : (actual - limit) / limit;
  const status: RuleStatus = !passed ? "fail" : actual < limit * warnAbove ? "warn" : "pass";
  return {
    id,
    label,
    status,
    actual,
    limit,
    unit,
    citation,
    margin,
    message: message(passed ? "pass" : "fail"),
  };
};

/** A rule that could not run because an input was missing. */
export const notEvaluated = (input: {
  id: string;
  label: string;
  reason: string;
  citation: Citation;
}): RuleResult => ({
  id: input.id,
  label: input.label,
  status: "notEvaluated",
  message: input.reason,
  citation: input.citation,
});
