import { PROJECT_SCHEMA_VERSION, Project } from "./project.js";

/**
 * Project file migration.
 *
 * A project is an engineering record. Someone may reopen a design years after
 * it was submitted, to answer a question about it or to extend the
 * installation, and it must still load and still produce the same numbers.
 * Every breaking schema change therefore needs a migration step here rather
 * than a "please re-create your project" message.
 */

/** Transforms a project document from `from` to `from + 1`. */
export interface Migration {
  readonly from: number;
  readonly describe: string;
  readonly apply: (document: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Ordered migration steps. Append only — never edit a released step, because
 * files already exist that were written by it.
 */
export const MIGRATIONS: readonly Migration[] = [];

export class ProjectMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectMigrationError";
  }
}

/**
 * Bring a raw project document up to the current schema version and validate it.
 *
 * Accepts `unknown` deliberately: the input is whatever was on disk or in the
 * browser's storage, and it is not trusted until it has been through zod.
 */
export const loadProject = (raw: unknown): Project => {
  if (typeof raw !== "object" || raw === null) {
    throw new ProjectMigrationError("Project file is not an object.");
  }

  let document = { ...(raw as Record<string, unknown>) };
  const version = document["schemaVersion"];

  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProjectMigrationError(
      `Project file has a missing or invalid schemaVersion (${String(version)}).`,
    );
  }

  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectMigrationError(
      `Project was written by a newer version of the application ` +
        `(file schema ${version}, this build supports ${PROJECT_SCHEMA_VERSION}). ` +
        `Update the application to open it.`,
    );
  }

  let current = version;
  while (current < PROJECT_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((migration) => migration.from === current);
    if (!step) {
      throw new ProjectMigrationError(
        `No migration registered from schema version ${current} to ${current + 1}.`,
      );
    }
    document = step.apply(document);
    current += 1;
    document["schemaVersion"] = current;
  }

  return Project.parse(document);
};
