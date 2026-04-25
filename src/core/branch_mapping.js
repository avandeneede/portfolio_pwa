// Branch mapping loader. Wraps config/branch_mapping.json into the forward
// and reverse indexes analyzer.js needs.
//
// Loaded eagerly in Node (tests) via fs; in the browser, the caller imports
// the JSON via a fetch/bundler and passes it into buildBranchIndex().

/**
 * @typedef {Record<string, string[]>} BranchMapping
 * @typedef {{ mapping: BranchMapping, codes: string[], reverse: Map<string, string> }} BranchIndex
 */

/**
 * @param {BranchMapping} mapping
 * @returns {BranchIndex}
 */
export function buildBranchIndex(mapping) {
  const codes = Object.keys(mapping);
  /** @type {Map<string, string>} */
  const reverse = new Map();
  for (const code of codes) {
    for (const v of mapping[code]) {
      reverse.set(String(v).toLowerCase(), code);
    }
  }
  return { mapping, codes, reverse };
}

/**
 * @param {string|null|undefined} typePolice
 * @param {Map<string, string>} reverse
 * @returns {string}
 */
export function getBranchCode(typePolice, reverse) {
  if (!typePolice) return 'DIV';
  return reverse.get(String(typePolice).trim().toLowerCase()) || 'DIV';
}
