import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const yamlPath = new URL("../openapi/openapi.yaml", import.meta.url);
const jsonPath = new URL("../openapi/openapi.json", import.meta.url);
const document = parse(readFileSync(yamlPath, "utf8"));
writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
