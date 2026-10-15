// Одяг КОМБАТ за модулем: ПС — льотне спорядження, ПВК — парадна форма авіації, ДШВ — берет,
// РВ і Артилерія — польова форма з нашивкою роду військ. Чиста логіка без DOM.
export const OUTFITS = Object.freeze(['default', 'pilot', 'dress', 'dshv', 'rocket', 'artillery', 'lecturer']);

const BY_BRANCH = Object.freeze({ air: 'pilot', pvk: 'dress', dshv: 'dshv', rocket: 'rocket', artillery: 'artillery' });

/** Повертає ідентифікатор одягу для модуля; на стартовому екрані й для невідомих значень — 'default'. */
export function outfitForBranch(branch) {
  return typeof branch === 'string' && Object.prototype.hasOwnProperty.call(BY_BRANCH, branch) ? BY_BRANCH[branch] : 'default';
}

/** Якщо в модулі відкрито довідник, КОМБАТ виходить у вигляді лектора з указкою й книгою. */
export function outfitFor(branch, referenceOpen = false) {
  const base = outfitForBranch(branch);
  return referenceOpen === true && base !== 'default' ? 'lecturer' : base;
}
