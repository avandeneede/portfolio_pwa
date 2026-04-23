// Branch mapping loader. Wraps config/branch_mapping.json into the forward
// and reverse indexes analyzer.js needs.
//
// Loaded eagerly in Node (tests) via fs; in the browser, the caller imports
// the JSON via a fetch/bundler and passes it into buildBranchIndex().

export function buildBranchIndex(mapping) {
  const codes = Object.keys(mapping);
  const reverse = new Map();
  for (const code of codes) {
    for (const v of mapping[code]) {
      reverse.set(String(v).toLowerCase(), code);
    }
  }
  return { mapping, codes, reverse };
}

export function getBranchCode(typePolice, reverse) {
  if (!typePolice) return 'DIV';
  return reverse.get(String(typePolice).trim().toLowerCase()) || 'DIV';
}
