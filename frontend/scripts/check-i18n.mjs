// Vérifie que (1) fr.ts et ar.ts ont exactement les mêmes clés, (2) toute clé t("...") utilisée dans le code existe.
// Usage : node scripts/check-i18n.mjs
import fs from "fs";
import path from "path";

const root = path.join(process.cwd(), "src");
const keysOf = (f) => new Set([...fs.readFileSync(path.join(root, "i18n", f), "utf8").matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]));
const fr = keysOf("fr.ts");
const ar = keysOf("ar.ts");
let bad = 0;
for (const k of fr) if (!ar.has(k)) (console.log("missing in ar:", k), bad++);
for (const k of ar) if (!fr.has(k)) (console.log("missing in fr:", k), bad++);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) e.name !== "i18n" && walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})(root);

const prefixes = "admin|app|booking|chart|common|dash|device|err|labs|login|nav|notif|path|profile|questions|quiz|remote|report|reports|role|sim|stage|teacher";
const re = new RegExp(`["'\`]((?:${prefixes})\\.[A-Za-z0-9_.]+)["'\`]`, "g");
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    const k = m[1];
    if (!fr.has(k) && k !== "labs.token") {
      // familles dynamiques (préfixe + variable) sont vérifiées par leurs valeurs connues
      console.log(`unknown key ${k}  (${path.relative(root, f)})`);
      bad++;
    }
  }
}
console.log(bad ? `\n${bad} problem(s)` : `OK — ${fr.size} keys, fr/ar identical, all literal keys defined`);
process.exit(bad ? 1 : 0);
