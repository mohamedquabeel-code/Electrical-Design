#!/usr/bin/env node
/**
 * Size a circuit from the command line.
 *
 * A thin demonstration harness for the engine before the web UI exists — it
 * proves the whole chain end to end against the real catalogue and prints the
 * working, which is what a reviewer actually needs to see.
 *
 *   node tools/size-circuit.mjs --power 30000 --pf 0.86 --eff 0.92 \
 *       --length 120 --install ground --soil 1.5 --depth 0.8
 */

import { readFileSync } from "node:fs";
import { IEC, Load, Route, sizeCircuit, citationText } from "@ed/core";

const DATA = "packages/standards-data/datasets/elsewedy-cables";
const read = (name) => JSON.parse(readFileSync(`${DATA}/${name}`, "utf-8"));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, index, all) => {
    if (token.startsWith("--")) pairs.push([token.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);

const number = (name, fallback) => (args[name] === undefined ? fallback : Number(args[name]));
const text = (name, fallback) => args[name] ?? fallback;

const context = {
  profile: IEC,
  products: read("cables.json").products,
  tables: read("general.json").tables,
  reactance: read("derived-reactance.json").reactance,
  datasetVersion: "1.0.0",
};

const load = Load.parse({
  id: "CLI",
  name: text("name", "Circuit"),
  type: text("type", "other"),
  connection: text("connection", "3ph-4w"),
  voltage: number("voltage", 400),
  power: number("power", 30000),
  powerFactor: number("pf", 0.85),
  efficiency: number("eff", 1),
});

const route = Route.parse({
  length: number("length", 50),
  basis: "catalogue",
  catalogueInstallation: text("install", "ground"),
  ambientAirTemp: number("air", 30),
  groundTemp: number("ground", 20),
  burialDepth: number("depth", 0.5),
  soilResistivity: number("soil", 1),
  groupedCircuits: number("circuits", 1),
  formation: text("formation", "trefoil"),
});

const result = sizeCircuit(
  context,
  {
    load,
    route,
    nominalVoltage: load.voltage,
    deviceType: text("device", "mccb"),
    ...(args.fault ? { faultCurrent: Number(args.fault), clearingTime: number("clear", 0.1) } : {}),
  },
  {
    conductor: text("conductor", "copper"),
    insulation: text("insulation", "xlpe"),
    armour: text("armour", "none"),
    cores: number("cores", 4),
    voltageGrade: "0.6/1",
  },
);

if (!result.selected) {
  console.error("No compliant cable found in the filtered range.");
  const worst = result.rejected.at(-1);
  if (worst) {
    console.error(`\nLargest candidate tried: ${worst.candidate.product.productCode}`);
    for (const rule of worst.rules.filter((r) => r.status === "fail")) {
      console.error(`  FAIL ${rule.label}: ${rule.message}`);
    }
  }
  process.exit(1);
}

const { candidate, device, designCurrent, correctionFactor, ampacity, voltageDrop, rules, traces } =
  result.selected;

console.log(`\n${load.name}  —  ${load.power / 1000} kW, ${load.connection}, ${load.voltage} V`);
console.log(`Route: ${route.length} m, ${route.catalogueInstallation}\n`);

console.log(`SELECTED   ${candidate.product.productCode}  ${candidate.product.csa} mm²`);
console.log(
  `           ${candidate.product.cores}-core ${candidate.product.conductor}/` +
    `${candidate.product.insulation.toUpperCase()}` +
    `${candidate.product.armour === "none" ? "" : "/" + candidate.product.armour.toUpperCase()}` +
    `   (catalogue p.${candidate.product.sourcePage})`,
);
console.log(
  `\n  Ib  ${designCurrent.toFixed(1)} A      In  ${device.rating} A      Iz  ${ampacity.toFixed(1)} A`,
);
console.log(`  Correction factor  ${correctionFactor.toFixed(4)}`);
console.log(
  `  Voltage drop  ${voltageDrop.volts.toFixed(2)} V  (${(voltageDrop.percent * 100).toFixed(2)}%)`,
);

console.log("\nCOMPLIANCE");
for (const rule of rules) {
  const mark = { pass: "PASS", fail: "FAIL", warn: "WARN", notEvaluated: "  — " }[rule.status];
  console.log(`  ${mark}  ${rule.label}`);
  console.log(`        ${rule.message}`);
  console.log(`        ${citationText(rule.citation)}`);
}

if (args.working !== undefined) {
  console.log("\nWORKING");
  for (const trace of traces) {
    console.log(`\n  ${trace.title}`);
    for (const entry of trace.steps) {
      const formula = entry.formula ? `  ${entry.formula}` : "";
      console.log(`    ${entry.label}: ${entry.value.toPrecision(5)} ${entry.unit}${formula}`);
      if (entry.inputs) {
        const inputs = Object.entries(entry.inputs)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ");
        console.log(`        ${inputs}`);
      }
      console.log(`        ${citationText(entry.citation)}`);
      if (entry.note) console.log(`        NOTE: ${entry.note}`);
    }
  }
}

console.log(
  `\n${result.rejected.length} smaller candidate(s) rejected. ` +
    `Re-run with --working to see the full calculation.\n`,
);
