// The opening courses are imported from the course database (python courses/import_db.py <db>).
// Where no import has been done (CI, a fresh clone), create an empty course list so the app builds.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../src/data/courses.json", import.meta.url));
if (!existsSync(target)) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, '{"courses":[]}\n');
  console.log("No imported courses: created an empty src/data/courses.json (run courses/import_db.py to import).");
}
