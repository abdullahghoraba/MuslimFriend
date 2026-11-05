// Every relative the calculator knows, in the order the form shows them.

export type HeirKey =
  | 'husband' | 'wife'
  | 'son' | 'daughter' | 'sonSon' | 'sonDaughter' | 'sonSonSon' | 'sonSonDaughter'
  | 'father' | 'mother' | 'grandfather' | 'grandmotherM' | 'grandmotherF' | 'grandmotherFF'
  | 'fullBrother' | 'fullSister' | 'patBrother' | 'patSister' | 'matBrother' | 'matSister'
  | 'fullNephew' | 'patNephew' | 'fullNephewSon' | 'patNephewSon' | 'fullUncle' | 'patUncle' | 'fullCousin' | 'patCousin'
  // ذوو الأرحام: relatives who inherit only when there is no heir by share or residue (other than a spouse).
  | 'daughterSon' | 'daughterDaughter' | 'fullSisterSon' | 'fullSisterDaughter' | 'patSisterSon' | 'patSisterDaughter'
  | 'matSiblingSon' | 'matSiblingDaughter' | 'fullBrotherDaughter' | 'patBrotherDaughter' | 'fullUncleDaughter'
  | 'patAunt' | 'uterineUncle' | 'matUncle' | 'matAunt' | 'matGrandfather';

export type HeirGroup = 'spouse' | 'descendants' | 'ascendants' | 'siblings' | 'relatives' | 'arham';

export interface HeirInfo {
  key: HeirKey;
  group: HeirGroup;
  male: boolean;
  /** At most this many (one father, four wives). */
  max: number;
  /** Only when the deceased is a man ('m') or a woman ('f'). */
  only?: 'm' | 'f';
  /** ذوو الأرحام: the heir whose place they take (التنزيل). */
  position?: HeirKey;
}

const h = (key: HeirKey, group: HeirGroup, male: boolean, max = 99, extra: Partial<HeirInfo> = {}): HeirInfo => ({ key, group, male, max, ...extra });

export const HEIRS: HeirInfo[] = [
  h('husband', 'spouse', true, 1, { only: 'f' }),
  h('wife', 'spouse', false, 4, { only: 'm' }),
  h('son', 'descendants', true), h('daughter', 'descendants', false),
  h('sonSon', 'descendants', true), h('sonDaughter', 'descendants', false),
  h('sonSonSon', 'descendants', true), h('sonSonDaughter', 'descendants', false),
  h('father', 'ascendants', true, 1), h('mother', 'ascendants', false, 1),
  h('grandfather', 'ascendants', true, 1), h('grandmotherM', 'ascendants', false, 1),
  h('grandmotherF', 'ascendants', false, 1), h('grandmotherFF', 'ascendants', false, 1),
  h('fullBrother', 'siblings', true), h('fullSister', 'siblings', false),
  h('patBrother', 'siblings', true), h('patSister', 'siblings', false),
  h('matBrother', 'siblings', true), h('matSister', 'siblings', false),
  h('fullNephew', 'relatives', true), h('patNephew', 'relatives', true),
  h('fullNephewSon', 'relatives', true), h('patNephewSon', 'relatives', true),
  h('fullUncle', 'relatives', true), h('patUncle', 'relatives', true),
  h('fullCousin', 'relatives', true), h('patCousin', 'relatives', true),
  h('daughterSon', 'arham', true, 99, { position: 'daughter' }), h('daughterDaughter', 'arham', false, 99, { position: 'daughter' }),
  h('fullSisterSon', 'arham', true, 99, { position: 'fullSister' }), h('fullSisterDaughter', 'arham', false, 99, { position: 'fullSister' }),
  h('patSisterSon', 'arham', true, 99, { position: 'patSister' }), h('patSisterDaughter', 'arham', false, 99, { position: 'patSister' }),
  h('matSiblingSon', 'arham', true, 99, { position: 'matBrother' }), h('matSiblingDaughter', 'arham', false, 99, { position: 'matBrother' }),
  h('fullBrotherDaughter', 'arham', false, 99, { position: 'fullBrother' }), h('patBrotherDaughter', 'arham', false, 99, { position: 'patBrother' }),
  h('fullUncleDaughter', 'arham', false, 99, { position: 'fullUncle' }),
  h('patAunt', 'arham', false, 99, { position: 'father' }), h('uterineUncle', 'arham', true, 99, { position: 'father' }),
  h('matUncle', 'arham', true, 99, { position: 'mother' }), h('matAunt', 'arham', false, 99, { position: 'mother' }),
  h('matGrandfather', 'arham', true, 1, { position: 'mother' }),
];

export const HEIR = Object.fromEntries(HEIRS.map((x) => [x.key, x])) as Record<HeirKey, HeirInfo>;
export type Family = Partial<Record<HeirKey, number>>;
