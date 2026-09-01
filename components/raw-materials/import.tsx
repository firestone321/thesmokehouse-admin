"use client";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { RawMaterial } from "@/lib/raw-materials/types";

function dateValue(value: unknown) { if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value; if (typeof value === "number") { const d = XLSX.SSF.parse_date_code(value); if (d) return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`; } return ""; }
function LegacyRawMaterialsImport({ materials, suppliers, action }: { materials: Array<Pick<RawMaterial,"id"|"name">>; suppliers: Array<{id:number;name:string}>; action: (formData: FormData) => void }) {
  const [rows, setRows] = useState<any[]>([]); const [filename, setFilename] = useState(""); const [importHash, setImportHash] = useState(""); const [error, setError] = useState("");
  async function handleFile(file?: File) { if (!file) return; setError(""); setFilename(file.name); try { const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"}); const sheet=workbook.Sheets[workbook.SheetNames[0]]; const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:""}); const next=raw.map((row,index)=>({row:index+2,material:String(row.Material??row.material??"").trim(),quantity:Number(row.Quantity??row.quantity),supplier:String(row.Supplier??row.supplier??"").trim(),totalCostUgx:Number(row["Total Cost"]??row.totalCost??row["Total Cost (UGX)"]),receivedDate:dateValue(row["Date Received"]??row.receivedDate),notes:String(row.Notes??row.notes??"").trim()})); const names=new Set(materials.map((m)=>m.name.toLowerCase())); const supplierNames=new Set(suppliers.map((s)=>s.name.toLowerCase())); const seen=new Set<string>(); const checked=next.map((item)=>{const problems:string[]=[]; const key=`${item.material.toLowerCase()}|${item.supplier.toLowerCase()}|${item.quantity}|${item.totalCostUgx}|${item.receivedDate}`; if(!item.material) problems.push("Missing material"); else if(!names.has(item.material.toLowerCase())) problems.push("Unknown material"); if(!Number.isFinite(item.quantity)||item.quantity<=0) problems.push("Quantity must be positive"); if(!item.supplier) problems.push("Missing supplier"); else if(!supplierNames.has(item.supplier.toLowerCase())) problems.push("Unknown supplier"); if(!Number.isInteger(item.totalCostUgx)||item.totalCostUgx<=0) problems.push("Total cost must be a positive whole UGX amount"); if(!/^\d{4}-\d{2}-\d{2}$/.test(item.receivedDate)) problems.push("Invalid date"); if(seen.has(key)) problems.push("Duplicate row"); seen.add(key); return {...item,problems};}); setRows(checked); const canonical = checked.filter((item)=>item.problems.length===0).map(({row,problems,...item})=>item); const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical))); setImportHash(Array.from(new Uint8Array(digest)).map((byte)=>byte.toString(16).padStart(2,"0")).join("")); } catch { setError("Unable to parse this workbook. Use the supplied template columns."); setRows([]); } }
  function downloadTemplate() { const sheet=XLSX.utils.json_to_sheet([{Material:"Charcoal",Quantity:6,Supplier:"", "Total Cost":180000,"Date Received":"2026-08-29",Notes:""}]); const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,sheet,"Raw Materials"); XLSX.writeFile(book,"raw-materials-template.xlsx"); }
  const valid=rows.filter((row)=>row.problems.length===0); return <section className="surface-card rounded-[32px] p-5"><p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Excel import</p><h2 className="mt-2 text-xl font-semibold">Import Raw Materials</h2><p className="mt-2 text-sm leading-6 text-[#6B7280]">Upload, validate, preview, then confirm. Preview does not change stock or money.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={downloadTemplate} className="rounded-xl border border-[#D7DDE4] bg-white px-4 py-2.5 text-sm font-semibold">Download template</button><label className="cursor-pointer rounded-xl bg-[#5E2519] px-4 py-2.5 text-sm font-semibold text-white">Choose .xlsx<input type="file" accept=".xlsx" className="hidden" onChange={(event)=>void handleFile(event.target.files?.[0])}/></label></div>{error?<p className="mt-3 text-sm text-[#A52B20]">{error}</p>:null}{rows.length>0?<><p className="mt-4 text-sm font-semibold">Preview: {valid.length} valid / {rows.length} rows</p><div className="mt-3 max-h-60 overflow-auto rounded-xl border border-[#E4E7EB]"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">Row</th><th className="p-2">Material</th><th className="p-2">Quantity</th><th className="p-2">Cost</th><th className="p-2">Status</th></tr></thead><tbody>{rows.map((row)=><tr key={row.row} className="border-b"><td className="p-2">{row.row}</td><td className="p-2">{row.material}</td><td className="p-2">{row.quantity}</td><td className="p-2">{row.totalCostUgx}</td><td className={`p-2 ${row.problems.length?"text-[#A52B20]":"text-[#287241]"}`}>{row.problems.length?row.problems.join(", "):"Valid"}</td></tr>)}</tbody></table></div>{valid.length===rows.length?<form action={action} className="mt-4"><input type="hidden" name="filename" value={filename}/><input type="hidden" name="rows" value={JSON.stringify(valid)}/><input type="hidden" name="import_hash" value={importHash}/><input type="hidden" name="batch_number" value={`RM-IMP-${importHash.slice(0,16)}`}/><button className="rounded-xl bg-[#287241] px-4 py-2.5 text-sm font-semibold text-white">Confirm import</button></form>:<p className="mt-3 text-sm text-[#A52B20]">Fix invalid rows and upload again before confirming.</p>}</>:null}</section>;
}

type ImportSection = "Vegetables & fruits" | "Irish potatoes" | "Spices" | "Cleaning supplies" | "Charcoal" | "Other non-edibles";
type Decision = "add" | "disregard";
type ImportRow = {
  id: string; section: ImportSection; source: string; sourceRow: number; material: string; supplier: string;
  quantity: string; amount: string; notes: string; category: "edible" | "non_edible"; unit: string;
  materialDecision: Decision; supplierDecision: Decision;
};
type SheetConfig = { section: ImportSection; category: "edible" | "non_edible"; unit?: string; amountHeaders: string[] };

const importSheets: Record<string, SheetConfig> = {
  "VEGETABLES & FRUITS": { section: "Vegetables & fruits", category: "edible", amountHeaders: ["AMOUNT"] },
  IRISH: { section: "Irish potatoes", category: "edible", unit: "sacks", amountHeaders: ["AMOUNT"] },
  GONJA: { section: "Vegetables & fruits", category: "edible", amountHeaders: ["AMOUNT"] },
  SPICES: { section: "Spices", category: "edible", amountHeaders: ["AMOUNT"] },
  CHARCOAL: { section: "Charcoal", category: "non_edible", unit: "sacks", amountHeaders: ["AMOUNT"] },
  "FIRE WOOD": { section: "Other non-edibles", category: "non_edible", amountHeaders: ["AMOUNT"] },
  "CLEANING MATERIAL": { section: "Cleaning supplies", category: "non_edible", amountHeaders: ["PRICE", "AMOUNT"] },
  "WRAPPING MATERIAL": { section: "Other non-edibles", category: "non_edible", amountHeaders: ["PRICE", "AMOUNT"] }
};

function importKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function importText(value: unknown) { return String(value ?? "").trim(); }
function importMaterial(value: string) {
  const cleaned = value.replace(/\[fresh\]/gi, "").trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = { coatmeal: "Coriander (coat meal)", corriander: "Coriander (coat meal)", greenpaper: "Green pepper", brocoli: "Broccoli" };
  return aliases[importKey(cleaned)] ?? cleaned;
}
function importFirst(row: Record<string, unknown>, headers: string[]) {
  for (const header of headers) if (importText(row[header])) return row[header];
  return "";
}
function importQuantity(value: unknown) {
  const source = importText(value);
  const fraction = source.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fraction) return String(Number(fraction[1]) / Number(fraction[2]));
  return source.replace(/,/g, "").match(/^\d+(?:\.\d+)?/)?.[0] ?? "";
}
function importAmount(value: unknown) { return importText(value).replace(/^UGX/i, "").replace(/[\s,]/g, ""); }

export function RawMaterialsImport({
  materials, suppliers, action, defaultEventDate
}: {
  materials: RawMaterial[];
  suppliers: Array<{ id: number; name: string }>;
  action: (formData: FormData) => void | Promise<void>;
  defaultEventDate: string;
}) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [eventDate, setEventDate] = useState(defaultEventDate);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const materialMap = useMemo(() => new Map(materials.filter((item) => item.isActive).map((item) => [importKey(item.name), item])), [materials]);
  const supplierMap = useMemo(() => new Map(suppliers.map((supplier) => [importKey(supplier.name), supplier])), [suppliers]);

  function update(id: string, change: Partial<ImportRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...change } : row));
  }

  async function parse(file?: File) {
    if (!file) return;
    setError("");
    setFilename(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const next: ImportRow[] = [];
      for (const source of workbook.SheetNames) {
        const config = importSheets[source.trim().toUpperCase()];
        if (!config) continue;
        const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[source], { defval: "", raw: false });
        sheetRows.forEach((record, index) => {
          const item: ImportRow = {
            id: source + ":" + (index + 2), section: config.section, source, sourceRow: index + 2,
            material: importMaterial(importText(record.ITEM)), supplier: importText(record.SUPPLIER),
            quantity: importQuantity(record.QUANTITY), amount: importAmount(importFirst(record, config.amountHeaders)),
            notes: "Imported from " + source + ", row " + (index + 2), category: config.category,
            unit: config.unit ?? importText(record["UNIT OF MEASURE"]), materialDecision: "disregard", supplierDecision: "disregard"
          };
          if (item.material || item.supplier || item.quantity || item.amount) next.push(item);
        });
      }
      if (!next.length) throw new Error("No supported rows");
      setRows(next);
    } catch {
      setRows([]);
      setError("No supported vegetable, Irish, spice, or non-edible sheets with data were found.");
    }
  }

  const reviewed = rows.map((row) => {
    const knownMaterial = materialMap.get(importKey(row.material));
    const knownSupplier = supplierMap.get(importKey(row.supplier));
    const quantity = Number(row.quantity);
    const amount = Number(row.amount);
    const disregarded = (!knownMaterial && row.materialDecision === "disregard") || (!knownSupplier && row.supplierDecision === "disregard");
    const problems: string[] = [];
    if (!row.material) problems.push("Item required");
    if (!row.supplier) problems.push("Supplier required");
    if (!knownMaterial && row.materialDecision === "add" && !row.unit) problems.push("New item needs a unit");
    if (!Number.isFinite(quantity) || quantity <= 0) problems.push("Positive numeric quantity required");
    if (!Number.isInteger(amount) || amount <= 0) problems.push("Positive whole UGX amount required");
    return { ...row, knownMaterial, knownSupplier, quantity, amount, disregarded, problems };
  });
  const ready = reviewed.filter((row) => !row.disregarded && row.problems.length === 0);
  const payload = ready.map(({ knownMaterial, knownSupplier, quantity, amount, disregarded, problems, ...row }) => ({
    ...row, quantity, totalCostUgx: amount,
    materialDecision: knownMaterial ? "existing" : "add",
    supplierDecision: knownSupplier ? "existing" : "add"
  }));
  const groups = Array.from(new Set(rows.map((row) => row.section))).map((section) => ({ section, rows: reviewed.filter((row) => row.section === section) }));

  return <section className="surface-card rounded-[32px] p-5">
    <p className="text-[11px] uppercase tracking-[0.18em] text-[#9CA3AF]">Workbook intake</p>
    <h2 className="mt-2 text-xl font-semibold">Review non-meat raw materials</h2>
    <p className="mt-2 text-sm leading-6 text-[#6B7280]">Meat, fries, and operational expenses are ignored. Choose one date for the whole intake event; each accepted row posts its own amount spent.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="grid gap-2 text-sm"><span>Event date</span><input type="date" value={eventDate} max={defaultEventDate} onChange={(event) => setEventDate(event.target.value)} className="rounded-xl border border-[#D7DDE4] px-3 py-2.5" /></label>
      <label className="cursor-pointer rounded-xl bg-[#5E2519] px-4 py-2.5 text-sm font-semibold text-white">Choose .xlsx<input type="file" accept=".xlsx" className="hidden" onChange={(event) => void parse(event.target.files?.[0])} /></label>
      {filename ? <p className="pb-2 text-sm text-[#6B7280]">{filename}</p> : null}
    </div>
    {error ? <p className="mt-3 text-sm text-[#A52B20]">{error}</p> : null}
    {groups.map((group) => <section key={group.section} className="mt-5 rounded-2xl border border-[#E4E7EB] p-4">
      <h3 className="font-semibold">{group.section}</h3>
      <div className="mt-3 space-y-3">{group.rows.map((row) => <article key={row.id} className={"rounded-xl border p-3 " + (row.disregarded ? "border-[#E4E7EB] bg-[#F8FAFB] opacity-70" : row.problems.length ? "border-[#F2C6C0] bg-[#FFF8F7]" : "border-[#CDE8D5] bg-white")}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs"><span>Item · row {row.sourceRow}</span><input value={row.material} onChange={(event) => update(row.id, { material: importMaterial(event.target.value) })} className="rounded-lg border border-[#D7DDE4] px-2 py-2 text-sm" /></label>
          <label className="grid gap-1 text-xs"><span>Supplier</span><input value={row.supplier} onChange={(event) => update(row.id, { supplier: event.target.value })} className="rounded-lg border border-[#D7DDE4] px-2 py-2 text-sm" /></label>
          <label className="grid gap-1 text-xs"><span>Quantity</span><input type="number" min="0.01" step="0.01" value={row.quantity} onChange={(event) => update(row.id, { quantity: event.target.value })} className="rounded-lg border border-[#D7DDE4] px-2 py-2 text-sm" /></label>
          <label className="grid gap-1 text-xs"><span>Amount spent (UGX)</span><input inputMode="numeric" value={row.amount} onChange={(event) => update(row.id, { amount: event.target.value })} className="rounded-lg border border-[#D7DDE4] px-2 py-2 text-sm" /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          {row.knownMaterial ? <span className="text-[#287241]">Existing item · {row.knownMaterial.unitName}</span> : <><label>New item <select value={row.materialDecision} onChange={(event) => update(row.id, { materialDecision: event.target.value as Decision })} className="ml-1 rounded border px-1 py-1"><option value="disregard">Disregard line</option><option value="add">Add item</option></select></label>{row.materialDecision === "add" ? <><select value={row.category} onChange={(event) => update(row.id, { category: event.target.value as "edible" | "non_edible" })} className="rounded border px-1 py-1"><option value="edible">Edible</option><option value="non_edible">Non-edible</option></select><input value={row.unit} onChange={(event) => update(row.id, { unit: event.target.value })} placeholder="Stock unit" className="rounded border px-2 py-1" /></> : null}</>}
          {row.knownSupplier ? <span className="text-[#287241]">Existing supplier</span> : <label>New supplier <select value={row.supplierDecision} onChange={(event) => update(row.id, { supplierDecision: event.target.value as Decision })} className="ml-1 rounded border px-1 py-1"><option value="disregard">Disregard line</option><option value="add">Add supplier</option></select></label>}
          {row.problems.length && !row.disregarded ? <span className="text-[#A52B20]">{row.problems.join(" · ")}</span> : null}
        </div>
      </article>)}</div>
    </section>)}
    {rows.length ? <form action={action} className="mt-5"><input type="hidden" name="filename" value={filename} /><input type="hidden" name="event_date" value={eventDate} /><input type="hidden" name="rows" value={JSON.stringify(payload)} /><p className="mb-3 text-sm text-[#6B7280]">{ready.length} row(s) ready. Disregarded and incomplete rows will not post.</p><button disabled={!eventDate || ready.length === 0} className="rounded-xl bg-[#287241] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Confirm {ready.length} row(s)</button></form> : null}
  </section>;
}
