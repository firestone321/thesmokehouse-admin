import { createHash } from "node:crypto";

// Pure policy: callers must independently obtain the verified project identity.
// This does not connect to a database or authorize a migration on its own.
export function assertStagingIdentity({allowlist, projectRef, verifiedProjectRef, host, verifiedHost, forbiddenRefs=[], forbiddenHosts=[], approved=false, migrationHistory, expectedHistory}) {
  const ref = x => typeof x === "string" && /^[a-z0-9]{20}$/.test(x);
  if (!ref(projectRef) || !ref(verifiedProjectRef) || projectRef !== verifiedProjectRef) throw Error("project_identity_mismatch");
  if (!Array.isArray(allowlist) || !allowlist.includes(projectRef)) throw Error("project_not_allowlisted");
  if (forbiddenRefs.includes(projectRef)) throw Error("forbidden_project");
  if (typeof host !== "string" || host !== host.toLowerCase() || host !== `db.${projectRef}.supabase.co` || host !== verifiedHost || forbiddenHosts.includes(host)) throw Error("database_host_mismatch");
  if (approved !== true) throw Error("explicit_operator_approval_required");
  if (!Array.isArray(migrationHistory) || !Array.isArray(expectedHistory) || migrationHistory.some(x => typeof x !== "string" || /^(103|104|105|106|107|108|109|110|111|112|113)(?:\D|$)/.test(x)) || JSON.stringify(migrationHistory) !== JSON.stringify(expectedHistory)) throw Error("unexpected_migration_history");
  return true;
}

function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const rowDigest = row => createHash('sha256').update(canonical(row)).digest('hex');

// Capture keyed historical rows, not a table-wide aggregate: later insertions are
// reported separately, while even one removed/changed prior row fails integrity.
export function captureHistorical(rowsByTable, sequence) {
  const tables={};
  for (const [table,rows] of Object.entries(rowsByTable)) {
    if (!Array.isArray(rows)) throw Error('rows_must_be_arrays');
    tables[table]={};
    for (const {key,row} of rows) {
      if (typeof key !== 'string' || Object.hasOwn(tables[table],key)) throw Error('invalid_or_duplicate_row_key');
      tables[table][key]=rowDigest(row);
    }
  }
  return {version:1,tables,sequence};
}
export function compareHistorical(before,after) {
  if (before?.version!==1 || after?.version!==1) throw Error('unsupported_evidence');
  const issues=[], additions=[];
  for (const [table,rows] of Object.entries(before.tables)) {
    const current=after.tables[table];
    if (!current) {issues.push(`${table}: missing table`);continue;}
    for (const [key,digest] of Object.entries(rows)) {
      if (!Object.hasOwn(current,key)) issues.push(`${table}/${key}: missing`);
      else if (current[key]!==digest) issues.push(`${table}/${key}: changed`);
    }
  }
  for (const [table,rows] of Object.entries(after.tables)) for (const key of Object.keys(rows)) if (!Object.hasOwn(before.tables[table]||{},key)) additions.push(`${table}/${key}`);
  if (canonical(before.sequence)!==canonical(after.sequence)) issues.push('order_number_sequence: changed');
  return {ok:issues.length===0,issues,additions};
}
