// The opening courses are imported locally (python courses/import_db.py <db>) and never committed.
// Where no import has been done (CI, a fresh clone), create an empty course list so the app builds.
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../src/data/courses.json", import.meta.url));
if (!existsSync(target)) {
  writeFileSync(target, '{"courses":[]}\n');
  console.log("No imported courses: created an empty src/data/courses.json (run courses/import_db.py to import).");
}
