import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
export function loadTs(file, mocks = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.resolve(file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  new Function("require", "module", "exports", output)(
    (id) => { if(id in mocks)return mocks[id]; const relative=path.resolve(path.dirname(path.resolve(file)),id+".ts"); if(id.startsWith(".")&&fs.existsSync(relative))return loadTs(relative,mocks); return require(id); }, module, module.exports);
  return module.exports;
}
