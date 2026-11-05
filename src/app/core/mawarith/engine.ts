// علم الفرائض: who inherits what, by the four schools. Every share is an exact fraction of the estate (after the
// funeral, the debts and the will). The rules and their evidence:
//  - the shares (الفروض): an-Nisa' 11, 12 and 176; the grandmother's sixth by the Companions' consensus;
//  - the residue (التعصيب): «ألحقوا الفرائض بأهلها، فما بقي فلأولى رجل ذكر» (al-Bukhari 6732, Muslim 1615);
//  - the son's daughter's sixth with one daughter, and the sister with daughters (Ibn Mas'ud, al-Bukhari 6736);
//  - العول, الرد, العمريتان (as ruled by 'Umar), المشتركة, الأكدرية and the grandfather with the siblings (Zayd),
//    with the schools' known differences (see the notes in each step).
import { Frac, f, lcm, sum } from './fraction';
import { Family, HEIR, HEIRS, HeirKey } from './heirs';

export type School = 'hanafi' | 'maliki' | 'shafii' | 'hanbali';
export const SCHOOLS: School[] = ['hanafi', 'maliki', 'shafii', 'hanbali'];

export type ShareKind = 'fard' | 'asaba' | 'fardAsaba' | 'blocked' | 'arham' | 'none';

export interface Share {
  key: HeirKey;
  count: number;
  /** The whole group's part of the estate. */
  total: Frac;
  kind: ShareKind;
  /** Why (an i18n key under mawarith.reason). */
  reason: string;
  /** Heirs who block this one, or the place a relative of the womb takes. */
  by?: HeirKey[];
  /** The share before العول / الرد, when they changed it. */
  original?: Frac;
}

export interface Calculation {
  school: School;
  shares: Share[];
  /** أصل المسألة (the common denominator of the shares). */
  asl: number;
  /** The base after العول, when the shares exceed the estate. */
  awl?: number;
  /** The remainder was returned to the heirs by share (الرد). */
  radd: boolean;
  /** The base where every person's part is a whole number (التصحيح). */
  base: number;
  special?: 'umariyya' | 'mushtaraka' | 'akdariyya' | 'jadd' | 'arham' | 'spouseRadd';
  /** Part with no heir at all (to the public treasury). */
  treasury?: Frac;
  /** i18n keys under mawarith.note. */
  notes: string[];
}

export interface Input { deceased: 'm' | 'f'; family: Family }

interface Entry { total: Frac; kind: ShareKind; reason: string; by?: HeirKey[]; original?: Frac; /** The whole share of the group it is part of (for أصل المسألة). */ whole?: Frac }

const ASABA_ORDER: HeirKey[] = ['fullNephew', 'patNephew', 'fullNephewSon', 'patNephewSon', 'fullUncle', 'patUncle', 'fullCousin', 'patCousin'];

export function calculate(input: Input, school: School): Calculation {
  const male = input.deceased === 'm';
  const c = (k: HeirKey): number => {
    const info = HEIR[k];
    if (info.only && info.only !== input.deceased) return 0;
    return Math.max(0, Math.min(info.max, Math.floor(Number(input.family[k] ?? 0)) || 0));
  };
  const out = new Map<HeirKey, Entry>();
  const notes: string[] = [];
  const set = (k: HeirKey, total: Frac, kind: ShareKind, reason: string, by?: HeirKey[], whole?: Frac) => out.set(k, { total, kind, reason, by, whole });
  const block = (k: HeirKey, by: HeirKey[], reason = 'blocked') => { if (c(k)) set(k, Frac.ZERO, 'blocked', reason, by); };
  const present = (k: HeirKey) => c(k) > 0;
  let special: Calculation['special'];

  // ---- descendants ------------------------------------------------------------------------------------------
  const males: HeirKey[] = ['son', 'sonSon', 'sonSonSon'];
  const females: HeirKey[] = ['daughter', 'sonDaughter', 'sonSonDaughter'];
  const maleDesc = males.some(present);
  const femaleDesc = females.some(present);
  const anyDesc = maleDesc || femaleDesc;
  const lm = males.findIndex(present); // the nearest level with a male (-1: none)
  const topMale = lm >= 0 ? males[lm] : undefined;
  /** Females who inherit as residuaries with the males (their level, or above them without a share). */
  const descAsaba: HeirKey[] = [];
  if (lm >= 0) {
    males.forEach((k, l) => { if (l > lm) block(k, [topMale!]); });
    females.forEach((k, l) => { if (l > lm) block(k, [topMale!]); });
    descAsaba.push(topMale!);
    if (present(females[lm])) descAsaba.push(females[lm]);
  }
  {
    let state: 'none' | 'single' | 'full' = 'none';
    const takers: HeirKey[] = [];
    const last = lm >= 0 ? lm : 3;
    for (let l = 0; l < last; l++) {
      const k = females[l];
      if (!present(k)) continue;
      if (state === 'none') {
        set(k, c(k) === 1 ? f(1, 2) : f(2, 3), 'fard', c(k) === 1 ? 'half' : 'twoThirds');
        state = c(k) === 1 ? 'single' : 'full';
        takers.push(k);
      } else if (state === 'single') {
        set(k, f(1, 6), 'fard', 'takmila', [takers[0]]);
        state = 'full';
        takers.push(k);
      } else if (lm >= 0) {
        // القريب المبارك: a male below her makes her a residuary instead of leaving her with nothing.
        descAsaba.push(k);
      } else {
        block(k, takers, 'blockedTwoThirds');
      }
    }
  }

  // ---- spouses -----------------------------------------------------------------------------------------------
  if (present('husband')) set('husband', anyDesc ? f(1, 4) : f(1, 2), 'fard', anyDesc ? 'quarterDesc' : 'halfNoDesc');
  if (present('wife')) set('wife', anyDesc ? f(1, 8) : f(1, 4), 'fard', anyDesc ? 'eighthDesc' : 'quarterNoDesc');

  // ---- father, grandfather ----------------------------------------------------------------------------------
  const father = present('father');
  const gfActive = !father && present('grandfather');
  if (father) block('grandfather', ['father']);
  const parentRole = (k: 'father' | 'grandfather') => {
    if (maleDesc) set(k, f(1, 6), 'fard', 'sixthMaleDesc');
    else if (femaleDesc) set(k, f(1, 6), 'fardAsaba', 'sixthAndRest');
    else set(k, Frac.ZERO, 'asaba', 'asabaParent');
  };
  if (father) parentRole('father');

  // ---- mother, grandmothers ---------------------------------------------------------------------------------
  const siblingsAll = (['fullBrother', 'fullSister', 'patBrother', 'patSister', 'matBrother', 'matSister'] as HeirKey[]).reduce((n, k) => n + c(k), 0);
  if (present('mother')) {
    if (anyDesc) set('mother', f(1, 6), 'fard', 'sixthDesc');
    else if (siblingsAll >= 2) set('mother', f(1, 6), 'fard', 'sixthSiblings');
    else set('mother', f(1, 3), 'fard', 'third');
    for (const g of ['grandmotherM', 'grandmotherF', 'grandmotherFF'] as HeirKey[]) block(g, ['mother']);
  } else {
    const heirs: HeirKey[] = [];
    if (present('grandmotherM')) heirs.push('grandmotherM');
    if (present('grandmotherF')) {
      if (father && school !== 'hanbali') block('grandmotherF', ['father']);
      else heirs.push('grandmotherF');
    }
    if (present('grandmotherFF')) {
      // Malik: only two grandmothers inherit (the mother's mother and the father's mother, and their mothers).
      if (school === 'maliki') set('grandmotherFF', Frac.ZERO, 'none', 'malikiTwoGrandmothers');
      else if (present('grandmotherF')) block('grandmotherFF', ['grandmotherF'], 'blockedNearer');
      else if (present('grandmotherM')) block('grandmotherFF', ['grandmotherM'], 'blockedNearer');
      else if (father && school !== 'hanbali') block('grandmotherFF', ['father']);
      else if (present('grandfather') && !father && school !== 'hanbali') block('grandmotherFF', ['grandfather']);
      else heirs.push('grandmotherFF');
    }
    for (const g of heirs) set(g, f(1, 6).div(heirs.length), 'fard', heirs.length > 1 ? 'grandmothersShare' : 'grandmotherSixth', undefined, f(1, 6));
  }

  // ---- maternal siblings ------------------------------------------------------------------------------------
  const matBlockers: HeirKey[] = [...males.filter(present), ...females.filter(present), ...(father ? ['father' as HeirKey] : []), ...(present('grandfather') ? ['grandfather' as HeirKey] : [])];
  const mats = c('matBrother') + c('matSister');
  if (mats) {
    if (matBlockers.length) { block('matBrother', matBlockers); block('matSister', matBlockers); }
    else {
      const share = mats === 1 ? f(1, 6) : f(1, 3);
      for (const k of ['matBrother', 'matSister'] as HeirKey[]) if (present(k)) set(k, share.mul(c(k)).div(mats), 'fard', mats === 1 ? 'matSixth' : 'matThird', undefined, share);
    }
  }

  // ---- full and paternal siblings ---------------------------------------------------------------------------
  const fb = c('fullBrother'), fs = c('fullSister'), pb = c('patBrother'), ps = c('patSister');
  const fullPat = fb + fs + pb + ps;
  let jadd = false;
  /** The residuary group among the siblings, or none. */
  let siblingAsaba: HeirKey[] = [];
  let sisterWithDaughters = false;
  if (fullPat) {
    const blockers: HeirKey[] = topMale ? [topMale] : father ? ['father'] : [];
    if (blockers.length) {
      for (const k of ['fullBrother', 'fullSister', 'patBrother', 'patSister'] as HeirKey[]) block(k, blockers);
    } else if (gfActive && school === 'hanafi') {
      // Abu Hanifa (with Abu Bakr and Ibn 'Abbas): the grandfather is a father and blocks the siblings.
      for (const k of ['fullBrother', 'fullSister', 'patBrother', 'patSister'] as HeirKey[]) block(k, ['grandfather'], 'blockedGrandfatherHanafi');
    } else if (gfActive) {
      jadd = true;
    } else {
      if (fs) {
        if (fb) siblingAsaba = ['fullBrother', 'fullSister'];
        else if (femaleDesc) { set('fullSister', Frac.ZERO, 'asaba', 'withDaughters'); siblingAsaba = ['fullSister']; sisterWithDaughters = true; }
        else set('fullSister', fs === 1 ? f(1, 2) : f(2, 3), 'fard', fs === 1 ? 'half' : 'twoThirds');
      } else if (fb) siblingAsaba = ['fullBrother'];
      if (pb || ps) {
        if (fb) { block('patBrother', ['fullBrother']); block('patSister', ['fullBrother']); }
        else if (sisterWithDaughters) { block('patBrother', ['fullSister'], 'blockedSisterAsaba'); block('patSister', ['fullSister'], 'blockedSisterAsaba'); }
        else if (pb) {
          if (!siblingAsaba.length) siblingAsaba = ps ? ['patBrother', 'patSister'] : ['patBrother'];
        } else if (fs === 1) set('patSister', f(1, 6), 'fard', 'takmila', ['fullSister']);
        else if (fs >= 2) block('patSister', ['fullSister'], 'blockedTwoThirds');
        else if (femaleDesc) { set('patSister', Frac.ZERO, 'asaba', 'withDaughters'); siblingAsaba = ['patSister']; }
        else set('patSister', ps === 1 ? f(1, 2) : f(2, 3), 'fard', ps === 1 ? 'half' : 'twoThirds');
      }
    }
  }
  if (gfActive && !jadd) parentRole('grandfather');

  // ---- the other residuaries (nephews, uncles, cousins) -----------------------------------------------------
  const higher: HeirKey[] = [];
  if (topMale) higher.push(topMale);
  if (father) higher.push('father');
  if (present('grandfather') && !father) higher.push('grandfather');
  if (fb && !higher.length) higher.push('fullBrother');
  if (sisterWithDaughters && !higher.length) higher.push('fullSister');
  if (pb && !higher.length && !fb) higher.push('patBrother');
  if (siblingAsaba[0] === 'patSister' && !higher.length) higher.push('patSister');
  let remoteAsaba: HeirKey | undefined;
  for (const k of ASABA_ORDER) {
    if (!present(k)) continue;
    if (higher.length) block(k, [higher[0]]);
    else if (remoteAsaba) block(k, [remoteAsaba]);
    else remoteAsaba = k;
  }

  // ---- العمريتان: spouse, father and mother: the mother takes a third of what the spouse leaves -------------
  const spouseKey: HeirKey | undefined = present('husband') ? 'husband' : present('wife') ? 'wife' : undefined;
  if (spouseKey && father && present('mother') && !anyDesc && siblingsAll < 2) {
    set('mother', Frac.ONE.sub(out.get(spouseKey)!.total).div(3), 'fard', 'umariyya');
    special = 'umariyya';
  }

  // ---- الجد مع الإخوة (Zayd: Malik, al-Shafi'i, Ahmad) --------------------------------------------------------
  if (jadd) {
    special = 'jadd';
    const others = [...out.values()].filter((e) => e.kind === 'fard' || e.kind === 'fardAsaba');
    const akdariyya = present('husband') && present('mother') && fb + pb === 0 && fs + ps === 1 && !anyDesc && siblingsAll === 1 && !present('wife');
    if (akdariyya) {
      // الأكدرية: husband 1/2, mother 1/3, grandfather 1/6, sister 1/2 (العول to 9), then the grandfather and the
      // sister share their 4/9 as brother and sister: 27 = 9 + 6 + 8 + 4.
      special = 'akdariyya';
      set('husband', f(9, 27), 'fard', 'halfNoDesc');
      set('mother', f(6, 27), 'fard', 'third');
      set('grandfather', f(8, 27), 'fard', 'akdariyya');
      set(fs ? 'fullSister' : 'patSister', f(4, 27), 'fard', 'akdariyya');
      return finish();
    }
    const fixed = sum(others.map((e) => e.total));
    const rest = Frac.ONE.sub(fixed);
    const units = 2 + 2 * (fb + pb) + fs + ps;
    const muq = (r: Frac) => r.mul(2).div(units);
    let g: Frac;
    let how: string;
    if (!others.length) {
      g = muq(Frac.ONE).max(f(1, 3));
      how = muq(Frac.ONE).gt(f(1, 3)) ? 'jaddMuqasama' : 'jaddThird';
    } else if (!rest.gt(f(1, 6))) {
      g = f(1, 6);
      how = 'jaddSixth';
    } else {
      const options: [Frac, string][] = [[muq(rest), 'jaddMuqasama'], [rest.div(3), 'jaddThirdRest'], [f(1, 6), 'jaddSixth']];
      [g, how] = options.reduce((a, b) => (b[0].gt(a[0]) ? b : a));
    }
    set('grandfather', g, 'fard', how);
    let rs = rest.sub(g);
    if (rs.lt(Frac.ZERO)) rs = Frac.ZERO;
    const give = (keys: HeirKey[], amount: Frac) => {
      const u = keys.reduce((n, k) => n + c(k) * (HEIR[k].male ? 2 : 1), 0);
      for (const k of keys) set(k, amount.mul(c(k) * (HEIR[k].male ? 2 : 1)).div(u), 'asaba', 'withGrandfather');
    };
    if (rs.isZero()) {
      for (const k of ['fullBrother', 'fullSister', 'patBrother', 'patSister'] as HeirKey[]) block(k, ['grandfather'], 'nothingLeft');
    } else if (fb) {
      give(fs ? ['fullBrother', 'fullSister'] : ['fullBrother'], rs);
      block('patBrother', ['fullBrother']); block('patSister', ['fullBrother']);
    } else if (fs && (pb || ps)) {
      // المعادة: the paternal siblings were counted against the grandfather; the full sister then takes up to her share.
      const sisterPart = (fs === 1 ? f(1, 2) : f(2, 3)).min(rs);
      set('fullSister', sisterPart, 'asaba', 'withGrandfather');
      const left = rs.sub(sisterPart);
      if (left.isZero()) { block('patBrother', ['fullSister'], 'muadda'); block('patSister', ['fullSister'], 'muadda'); }
      else give([...(pb ? ['patBrother' as HeirKey] : []), ...(ps ? ['patSister' as HeirKey] : [])], left);
    } else if (fs) {
      give(['fullSister'], rs);
    } else {
      give([...(pb ? ['patBrother' as HeirKey] : []), ...(ps ? ['patSister' as HeirKey] : [])], rs);
    }
    return finish();
  }

  // ---- the residue -------------------------------------------------------------------------------------------
  const asabaGroup: HeirKey[] = descAsaba.length ? descAsaba
    : father && !maleDesc ? ['father']
      : gfActive && !maleDesc ? ['grandfather']
        : siblingAsaba.length ? siblingAsaba
          : remoteAsaba ? [remoteAsaba] : [];

  // المشتركة: the full brothers would get nothing although they are the maternal siblings' brothers too.
  if (fb && school !== 'hanafi' && school !== 'hanbali' && present('husband') && (present('mother') || ['grandmotherM', 'grandmotherF', 'grandmotherFF'].some((g) => out.get(g as HeirKey)?.kind === 'fard'))
    && mats >= 2 && !anyDesc && !father && !present('grandfather')) {
    const fardSum = sum([...out.values()].filter((e) => e.kind === 'fard').map((e) => e.total));
    if (!Frac.ONE.sub(fardSum).gt(Frac.ZERO)) {
      special = 'mushtaraka';
      const heads = mats + fb + fs;
      for (const k of ['matBrother', 'matSister', 'fullBrother', 'fullSister'] as HeirKey[]) {
        if (present(k)) set(k, f(1, 3).mul(c(k)).div(heads), 'fard', 'mushtaraka', undefined, f(1, 3));
      }
      return finish();
    }
  }

  const fards = () => [...out.entries()].filter(([, e]) => e.kind === 'fard' || e.kind === 'fardAsaba');
  const fardSum = sum(fards().map(([, e]) => e.total));
  const residue = Frac.ONE.sub(fardSum);
  if (asabaGroup.length) {
    const amount = residue.gt(Frac.ZERO) ? residue : Frac.ZERO;
    const units = asabaGroup.reduce((n, k) => n + c(k) * (HEIR[k].male ? 2 : 1), 0);
    for (const k of asabaGroup) {
      const part = amount.mul(c(k) * (HEIR[k].male ? 2 : 1)).div(units);
      const prev = out.get(k);
      if (prev?.kind === 'fardAsaba') set(k, prev.total.add(part), 'fardAsaba', prev.reason);
      else {
        const reason = asabaGroup.length > 1 && (k === 'son' || k === 'daughter' || k === 'sonSon' || k === 'sonDaughter' || k === 'sonSonSon' || k === 'sonSonDaughter' || k === 'fullBrother' || k === 'fullSister' || k === 'patBrother' || k === 'patSister')
          ? (HEIR[k].male ? 'asabaWithSisters' : (descAsaba.includes(k) && lm >= 0 && females.indexOf(k) < lm ? 'blessed' : 'withBrother'))
          : prev?.reason ?? 'asaba';
        set(k, part, 'asaba', amount.isZero() ? 'nothingLeft' : reason);
      }
    }
  }
  return finish();

  /** العول, الرد, ذوو الأرحام, then the bases. */
  function finish(): Calculation {
    let radd = false;
    let awl: number | undefined;
    let treasury: Frac | undefined;
    const fardEntries = [...out.entries()].filter(([, e]) => e.kind === 'fard' || e.kind === 'fardAsaba');
    let asl = Number(fardEntries.reduce((d, [, e]) => lcm(d, e.kind === 'fardAsaba' ? 6n : (e.whole ?? e.total).d), 1n));
    if (!fardEntries.length) {
      // Residuaries only: the base is their heads, a male counting as two females when both are there.
      const takers = [...out.keys()].filter((k) => out.get(k)!.kind === 'asaba' && !out.get(k)!.total.isZero());
      const mixed = takers.some((k) => !HEIR[k].male);
      asl = takers.reduce((n, k) => n + c(k) * (mixed && HEIR[k].male ? 2 : 1), 0) || 1;
    }
    const total = sum([...out.values()].filter((e) => e.kind !== 'blocked' && e.kind !== 'none').map((e) => e.total));
    const hasAsaba = [...out.values()].some((e) => e.kind === 'asaba' || e.kind === 'fardAsaba');
    if (total.gt(Frac.ONE)) {
      // العول: every share is reduced in proportion.
      awl = Number(total.mul(asl).n / total.mul(asl).d);
      for (const [k, e] of out) if (!e.total.isZero()) out.set(k, { ...e, total: e.total.div(total), original: e.total } as Entry);
      notes.push('awl');
    } else if (total.lt(Frac.ONE) && !hasAsaba) {
      const rest = Frac.ONE.sub(total);
      const returnable = [...out.entries()].filter(([k, e]) => e.kind === 'fard' && k !== 'husband' && k !== 'wife');
      const arhamKeys = HEIRS.filter((x) => x.group === 'arham' && present(x.key)).map((x) => x.key);
      if (returnable.length) {
        radd = true;
        const base = sum(returnable.map(([, e]) => e.total));
        for (const [k, e] of returnable) out.set(k, { ...e, total: e.total.add(rest.mul(e.total).div(base)), original: e.total } as Entry);
        notes.push(school === 'maliki' || school === 'shafii' ? 'raddLater' : 'radd');
      } else if (arhamKeys.length) {
        special = 'arham';
        distributeArham(arhamKeys, rest);
        notes.push(school === 'hanafi' ? 'arhamHanafi' : school === 'hanbali' ? 'arhamHanbali' : 'arhamLater');
      } else if (spouseKey) {
        special = 'spouseRadd';
        const e = out.get(spouseKey)!;
        out.set(spouseKey, { ...e, total: e.total.add(rest), original: e.total } as Entry);
        notes.push('spouseRadd');
      } else {
        treasury = rest;
        notes.push('treasury');
      }
    }
    // Relatives of the womb never inherit beside an heir by share or residue (other than a spouse).
    for (const x of HEIRS) if (x.group === 'arham' && present(x.key) && !out.has(x.key)) set(x.key, Frac.ZERO, 'blocked', 'arhamExcluded');
    // Anyone listed and not handled is blocked by the residuary who took the rest.
    for (const x of HEIRS) if (present(x.key) && !out.has(x.key)) set(x.key, Frac.ZERO, 'blocked', 'blocked');

    const shares: Share[] = HEIRS.filter((x) => out.has(x.key)).map((x) => ({ key: x.key, count: c(x.key), ...out.get(x.key)! }));
    let base = 1n;
    for (const s of shares) if (!s.total.isZero()) base = lcm(base, s.total.div(s.count).d);
    if (treasury) base = lcm(base, treasury.d);
    if (special === 'akdariyya') return { school, shares, asl: 6, awl: 9, radd, base: 27, special, notes };
    return { school, shares, asl: Math.max(asl, 1), awl, radd, base: Number(base), special, treasury, notes };
  }

  /** ذوو الأرحام: by التنزيل (Ahmad; the later Malikis and Shafi'is), or by القرابة classes (Abu Hanifa's school). */
  function distributeArham(keys: HeirKey[], rest: Frac): void {
    const units = (k: HeirKey, equal: boolean) => c(k) * (equal || !HEIR[k].male ? 1 : 2);
    const split = (group: HeirKey[], amount: Frac, equal: boolean, reason: string) => {
      const u = group.reduce((n, k) => n + units(k, equal), 0);
      for (const k of group) set(k, amount.mul(units(k, equal)).div(u), 'arham', reason, HEIR[k].position ? [HEIR[k].position!] : undefined);
    };
    if (school === 'hanafi') {
      const classes: HeirKey[][] = [
        ['daughterSon', 'daughterDaughter'],
        ['matGrandfather'],
        ['fullSisterSon', 'fullSisterDaughter', 'patSisterSon', 'patSisterDaughter', 'matSiblingSon', 'matSiblingDaughter', 'fullBrotherDaughter', 'patBrotherDaughter'],
        ['patAunt', 'uterineUncle', 'matUncle', 'matAunt'],
        ['fullUncleDaughter'],
      ];
      const cls = classes.find((g) => g.some((k) => keys.includes(k)))!;
      const inClass = cls.filter((k) => keys.includes(k));
      for (const k of keys) if (!inClass.includes(k)) set(k, Frac.ZERO, 'blocked', 'arhamNearerClass', [inClass[0]]);
      if (cls === classes[3]) {
        // The father's side (the aunt, the uncle by the mother) two thirds, the mother's side one third.
        const fatherSide = inClass.filter((k) => k === 'patAunt' || k === 'uterineUncle');
        const motherSide = inClass.filter((k) => k === 'matUncle' || k === 'matAunt');
        if (fatherSide.length && motherSide.length) {
          split(fatherSide, rest.mul(f(2, 3)), false, 'arhamHanafi');
          split(motherSide, rest.mul(f(1, 3)), false, 'arhamHanafi');
        } else split(inClass, rest, false, 'arhamHanafi');
        return;
      }
      if (cls === classes[2]) return tanzil(inClass, rest, false);
      split(inClass, rest, false, 'arhamHanafi');
      return;
    }
    tanzil(keys, rest, school === 'hanbali');
  }

  /** التنزيل: each takes the place of the heir they come through; that heir's share is divided among them. */
  function tanzil(keys: HeirKey[], rest: Frac, equal: boolean): void {
    const family: Family = {};
    for (const k of keys) family[HEIR[k].position!] = 1;
    const sub = calculate({ deceased: input.deceased, family }, school === 'hanafi' ? 'hanbali' : school);
    for (const s of sub.shares) {
      const group = keys.filter((k) => HEIR[k].position === s.key);
      if (!group.length) continue;
      if (s.total.isZero()) { for (const k of group) set(k, Frac.ZERO, 'blocked', 'arhamPosition', [s.key]); continue; }
      const eq = equal || s.key === 'matBrother';
      const u = group.reduce((n, k) => n + c(k) * (eq || !HEIR[k].male ? 1 : 2), 0);
      for (const k of group) set(k, rest.mul(s.total).mul(c(k) * (eq || !HEIR[k].male ? 1 : 2)).div(u), 'arham', 'arhamTanzil', [s.key]);
    }
  }
}

/** The same family in the four schools; [same] when they all agree on every share. */
export function compareSchools(input: Input): { results: Calculation[]; same: boolean } {
  const results = SCHOOLS.map((s) => calculate(input, s));
  const key = (r: Calculation) => r.shares.map((s) => `${s.key}:${s.total}`).join('|') + `|t${r.treasury ?? ''}`;
  return { results, same: results.every((r) => key(r) === key(results[0])) };
}
