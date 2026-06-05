export function wChanValidate(
  fn: string,
  actual: any,
  schema: Record<string, string>,
): { fn: string; expected: Record<string, string>; received: any; match: boolean; fields: Record<string, boolean> } {
  const fields: Record<string, boolean> = {};
  for (const [key, type] of Object.entries(schema)) {
    const val = actual?.[key];
    if (type === 'nonempty-string') fields[key] = typeof val === 'string' && val.length > 0;
    else if (type === 'array') fields[key] = Array.isArray(val);
    else fields[key] = typeof val === type;
  }
  const match = Object.values(fields).every(Boolean);
  console.log(`[wChan][validate] ${fn} match=${match}`, JSON.stringify({ fields, received: actual }));
  return { fn, expected: schema, received: actual, match, fields };
}
