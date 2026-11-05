// Understands a family written in Arabic or English («توفي رجل وترك زوجتين وأبًا وأمًا وابنًا وبنتين»,
// "a woman left her husband, 2 sons and a daughter") and returns the relatives with their numbers.
import { Family, HEIR, HeirKey } from './heirs';

export interface Parsed {
  deceased?: 'm' | 'f';
  family: Family;
  /** Relatives named in the plural without a number (counted as two; the reader should check). */
  guessed: HeirKey[];
}

type Base = 'son' | 'daughter' | 'father' | 'mother' | 'gf' | 'gm' | 'husband' | 'wife' | 'brother' | 'sister' | 'uncle' | 'aunt' | 'muncle' | 'maunt'
  | 'fullB' | 'fullS' | 'nephew' | 'niece' | 'cousin' | 'grandson' | 'granddaughter';
type Mod = 'full' | 'pat' | 'mat';
interface Tok { base: Base; n?: number | 'pl' }

const AR_NUM: Record<string, number> = {
  واحد: 1, واحدة: 1, اثنان: 2, اثنين: 2, اثنتان: 2, اثنتين: 2, ثلاث: 3, ثلاثة: 3, اربع: 4, اربعة: 4, خمس: 5, خمسة: 5,
  ست: 6, ستة: 6, سبع: 7, سبعة: 7, ثمان: 8, ثماني: 8, ثمانية: 8, تسع: 9, تسعة: 9, عشر: 10, عشرة: 10,
};
const EN_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const AR: Record<string, Tok> = {
  ابن: { base: 'son' }, ابنا: { base: 'son', n: 2 }, ابنان: { base: 'son', n: 2 }, ابنين: { base: 'son', n: 2 }, ابناء: { base: 'son', n: 'pl' },
  ولد: { base: 'son' }, ولدان: { base: 'son', n: 2 }, ولدين: { base: 'son', n: 2 },
  بنت: { base: 'daughter' }, ابنة: { base: 'daughter' }, بنتان: { base: 'daughter', n: 2 }, بنتين: { base: 'daughter', n: 2 },
  ابنتان: { base: 'daughter', n: 2 }, ابنتين: { base: 'daughter', n: 2 }, بنات: { base: 'daughter', n: 'pl' },
  اب: { base: 'father' }, ابو: { base: 'father' }, ابي: { base: 'father' }, ابا: { base: 'father' }, والد: { base: 'father' }, ابوين: { base: 'father', n: 2 },
  ام: { base: 'mother' }, والدة: { base: 'mother' },
  جد: { base: 'gf' }, جدة: { base: 'gm' }, جدتان: { base: 'gm', n: 2 }, جدتين: { base: 'gm', n: 2 },
  زوج: { base: 'husband' }, زوجة: { base: 'wife' }, زوجتان: { base: 'wife', n: 2 }, زوجتين: { base: 'wife', n: 2 }, زوجات: { base: 'wife', n: 'pl' },
  اخ: { base: 'brother' }, اخو: { base: 'brother' }, اخا: { base: 'brother' }, اخوان: { base: 'brother', n: 2 }, اخوين: { base: 'brother', n: 2 }, اخوة: { base: 'brother', n: 'pl' },
  اخت: { base: 'sister' }, اختان: { base: 'sister', n: 2 }, اختين: { base: 'sister', n: 2 }, اخوات: { base: 'sister', n: 'pl' },
  شقيق: { base: 'fullB' }, شقيقان: { base: 'fullB', n: 2 }, شقيقين: { base: 'fullB', n: 2 }, اشقاء: { base: 'fullB', n: 'pl' },
  شقيقة: { base: 'fullS' }, شقيقتان: { base: 'fullS', n: 2 }, شقيقتين: { base: 'fullS', n: 2 }, شقيقات: { base: 'fullS', n: 'pl' },
  عم: { base: 'uncle' }, عمان: { base: 'uncle', n: 2 }, عمين: { base: 'uncle', n: 2 }, اعمام: { base: 'uncle', n: 'pl' },
  عمة: { base: 'aunt' }, عمتان: { base: 'aunt', n: 2 }, عمتين: { base: 'aunt', n: 2 }, عمات: { base: 'aunt', n: 'pl' },
  خال: { base: 'muncle' }, خالان: { base: 'muncle', n: 2 }, خالين: { base: 'muncle', n: 2 }, اخوال: { base: 'muncle', n: 'pl' },
  خالة: { base: 'maunt' }, خالتان: { base: 'maunt', n: 2 }, خالتين: { base: 'maunt', n: 2 }, خالات: { base: 'maunt', n: 'pl' },
  حفيد: { base: 'grandson' }, حفيدان: { base: 'grandson', n: 2 }, حفيدين: { base: 'grandson', n: 2 }, احفاد: { base: 'grandson', n: 'pl' },
  حفيدة: { base: 'granddaughter' }, حفيدتان: { base: 'granddaughter', n: 2 }, حفيدتين: { base: 'granddaughter', n: 2 }, حفيدات: { base: 'granddaughter', n: 'pl' },
};
const EN: Record<string, Tok> = {
  son: { base: 'son' }, sons: { base: 'son', n: 'pl' }, daughter: { base: 'daughter' }, daughters: { base: 'daughter', n: 'pl' },
  father: { base: 'father' }, dad: { base: 'father' }, mother: { base: 'mother' }, mom: { base: 'mother' }, mum: { base: 'mother' },
  parents: { base: 'father', n: 2 },
  grandfather: { base: 'gf' }, grandmother: { base: 'gm' }, grandmothers: { base: 'gm', n: 'pl' },
  husband: { base: 'husband' }, wife: { base: 'wife' }, wives: { base: 'wife', n: 'pl' },
  brother: { base: 'brother' }, brothers: { base: 'brother', n: 'pl' }, sister: { base: 'sister' }, sisters: { base: 'sister', n: 'pl' },
  uncle: { base: 'uncle' }, uncles: { base: 'uncle', n: 'pl' }, aunt: { base: 'aunt' }, aunts: { base: 'aunt', n: 'pl' },
  nephew: { base: 'nephew' }, nephews: { base: 'nephew', n: 'pl' }, niece: { base: 'niece' }, nieces: { base: 'niece', n: 'pl' },
  cousin: { base: 'cousin' }, cousins: { base: 'cousin', n: 'pl' },
  grandson: { base: 'grandson' }, grandsons: { base: 'grandson', n: 'pl' }, granddaughter: { base: 'granddaughter' }, granddaughters: { base: 'granddaughter', n: 'pl' },
};
const EN_MOD: Record<string, Mod> = { full: 'full', germane: 'full', paternal: 'pat', consanguine: 'pat', maternal: 'mat', uterine: 'mat' };

/** Arabic letters without marks, the alef and ya forms unified; ة is kept (ابنة is not ابنه "his son"). */
function normAr(t: string): string {
  // The accusative ending (ابنًا، أبًا) is one person, not the dual «ابنا».
  return t.normalize('NFC').replace(/(\p{L})(?:ًا|اً)(?=$|[^\p{L}])/gu, '$1').replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** One Arabic word as a known word: without و/ف, ال/لل and the possessive endings (ابنه، زوجته، امها). */
function arWord(w: string): string | null {
  const tries = new Set<string>();
  const strip = (x: string) => {
    tries.add(x);
    for (const end of ['هما', 'هم', 'ها', 'ه']) if (x.length > end.length + 1 && x.endsWith(end)) {
      const s = x.slice(0, -end.length);
      tries.add(s);
      if (s.endsWith('ت')) tries.add(s.slice(0, -1) + 'ة'); // زوجته → زوجة
    }
  };
  for (const pre of ['', 'و', 'ف', 'ب']) {
    if (pre && !w.startsWith(pre)) continue;
    const a = w.slice(pre.length);
    strip(a);
    if (a.startsWith('ال')) strip(a.slice(2));
    if (a.startsWith('لل')) strip(a.slice(2));
  }
  for (const t of tries) if (AR[t] || AR_NUM[t] !== undefined || /^(شقيق|شقيقة|لاب|لام|لاخ)$/.test(t)) return t;
  // Accusative tanween forms (ابنًا → ابنا, which is also "two sons" in construct): read as one.
  for (const t of tries) if (t.endsWith('ا') && AR[t.slice(0, -1)]) return t.slice(0, -1);
  return null;
}

/** The heir a chain of words names: [ابن, ابن] is the son's son; a modifier picks full/paternal/maternal. */
function heirOf(chain: Base[], mod?: Mod): HeirKey | null {
  const k = chain.join(' ');
  const by = (full: HeirKey, pat: HeirKey, mat?: HeirKey): HeirKey => (mod === 'pat' ? pat : mod === 'mat' && mat ? mat : full);
  switch (k) {
    case 'son': return 'son';
    case 'daughter': return 'daughter';
    case 'father': return 'father';
    case 'mother': return 'mother';
    case 'gf': return mod === 'mat' ? 'matGrandfather' : 'grandfather';
    case 'gm': return mod === 'pat' ? 'grandmotherF' : 'grandmotherM';
    case 'husband': return 'husband';
    case 'wife': return 'wife';
    case 'brother': return by('fullBrother', 'patBrother', 'matBrother');
    case 'sister': return by('fullSister', 'patSister', 'matSister');
    case 'fullB': return 'fullBrother';
    case 'fullS': return 'fullSister';
    case 'uncle': return by('fullUncle', 'patUncle', 'uterineUncle');
    case 'aunt': return mod === 'mat' ? 'matAunt' : 'patAunt';
    case 'muncle': return 'matUncle';
    case 'maunt': return 'matAunt';
    case 'grandson': case 'son son': return 'sonSon';
    case 'granddaughter': case 'daughter son': return 'sonDaughter';
    case 'son son son': case 'grandson son': return 'sonSonSon';
    case 'daughter son son': case 'granddaughter son': return 'sonSonDaughter';
    case 'son daughter': return 'daughterSon';
    case 'daughter daughter': return 'daughterDaughter';
    case 'son brother': case 'son fullB': case 'nephew': return by('fullNephew', 'patNephew', 'matSiblingSon');
    case 'son son brother': case 'son son fullB': return by('fullNephewSon', 'patNephewSon');
    case 'daughter brother': case 'daughter fullB': case 'niece': return by('fullBrotherDaughter', 'patBrotherDaughter', 'matSiblingDaughter');
    case 'son sister': case 'son fullS': return by('fullSisterSon', 'patSisterSon', 'matSiblingSon');
    case 'daughter sister': case 'daughter fullS': return by('fullSisterDaughter', 'patSisterDaughter', 'matSiblingDaughter');
    case 'son uncle': case 'cousin': return by('fullCousin', 'patCousin');
    case 'daughter uncle': return 'fullUncleDaughter';
    case 'mother mother': return 'grandmotherM';
    case 'mother father': return 'grandmotherF';
    case 'mother father father': case 'mother gf': return 'grandmotherFF';
    case 'father father': return 'grandfather';
    case 'father mother': return 'matGrandfather';
    default: return null;
  }
}

export function parseFamily(text: string): Parsed {
  const family: Family = {};
  const guessed: HeirKey[] = [];
  let deceased: 'm' | 'f' | undefined;
  const ar = /[؀-ۿ]/.test(text);
  const add = (key: HeirKey, n: number | 'pl' | undefined, num: number | undefined) => {
    const count = num ?? (n === 'pl' ? 2 : n ?? 1);
    if (num === undefined && n === 'pl') guessed.push(key);
    family[key] = Math.min(HEIR[key].max, (family[key] ?? 0) + count);
    if (key === 'husband') deceased = 'f';
    if (key === 'wife') deceased = 'm';
  };
  if (ar) {
    const t = normAr(text);
    if (/توفيت|ماتت|امراة|امراه|سيدة|بنت توفيت/.test(t)) deceased = 'f';
    else if (/توفي|مات|رجل/.test(t)) deceased = 'm';
    const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    let num: number | undefined;
    for (let i = 0; i < words.length; i++) {
      const raw = words[i];
      if (/^[وف]?\d+$/.test(raw)) { num = Number(raw.replace(/^[وف]/, '')); continue; }
      const w = arWord(raw);
      if (!w) continue;
      if (AR_NUM[w] !== undefined && !AR[w]) { num = AR_NUM[w]; continue; }
      const head = AR[w];
      if (!head) continue;
      // The chain: «ابن ابن اخ», «ام ام», then a modifier «شقيق / لأب / لأم / من الأب».
      const chain: Base[] = [head.base];
      let j = i + 1;
      while (j < words.length && chain.length < 3) {
        // «وأم» after «أب» is a new relative (and), «ام» alone is «of the mother».
        if (/^[وف]/.test(words[j]) && !AR[words[j]]) break;
        const nw = arWord(words[j]);
        const next = nw ? AR[nw] : undefined;
        if (!next || next.n !== undefined && next.n !== 1 || !['son', 'daughter', 'father', 'mother', 'brother', 'sister', 'uncle', 'gf', 'fullB', 'fullS'].includes(next.base)) break;
        if (!heirOf([...chain, next.base])) break;
        chain.push(next.base);
        j++;
      }
      let mod: Mod | undefined;
      const look = (k: number) => (k < words.length ? normAr(words[k]).replace(/^و/, '') : '');
      const m1 = look(j), m2 = look(j + 1);
      if (/^(ال)?شقيق(ة|ان|ين|تان|تين|ات)?$|^اشقاء$/.test(m1)) { mod = 'full'; j++; }
      else if (/^لاب$|^لابيه$/.test(m1) || m1 === 'من' && /^(ال)?اب$/.test(m2)) { mod = 'pat'; j += m1 === 'من' ? 2 : 1; }
      else if (/^لام$|^لامه$/.test(m1) || m1 === 'من' && /^(ال)?ام$/.test(m2)) { mod = 'mat'; j += m1 === 'من' ? 2 : 1; }
      const key = heirOf(chain, mod) ?? heirOf([chain[0]], mod);
      if (key) {
        // «ابوين / والدين»: a father and a mother.
        if (w === 'ابوين' || w === 'والدين') { add('father', 1, undefined); add('mother', 1, undefined); }
        else add(key, head.n, num);
      }
      num = undefined;
      i = j - 1;
    }
  } else {
    const t = text.toLowerCase();
    if (/(woman|lady|she)/.test(t)) deceased = 'f';
    else if (/(man|he)/.test(t)) deceased = 'm';
    else if (/her/.test(t)) deceased = 'f';
    else if (/his/.test(t)) deceased = 'm';
    const words = t.replace(/'s/g, ' s ').split(/[^a-z0-9]+/).filter(Boolean);
    let num: number | undefined;
    let mod: Mod | undefined;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^\d+$/.test(w)) { num = Number(w); continue; }
      if (EN_NUM[w] !== undefined) { num = EN_NUM[w]; continue; }
      if (EN_MOD[w]) { mod = EN_MOD[w]; continue; }
      const head = EN[w];
      if (!head) continue;
      // "son's daughter" (the owner first) and "daughter of the son" (the relative first).
      const seq: Tok[] = [head];
      let possessive = false;
      let j = i + 1;
      while (j < words.length && seq.length < 3) {
        if (words[j] === 's' && EN[words[j + 1]]) { seq.push(EN[words[j + 1]]); possessive = true; j += 2; continue; }
        if (words[j] === 'of') {
          let k = j + 1;
          if (['the', 'his', 'her', 'a'].includes(words[k])) k++;
          if (EN[words[k]]) { seq.push(EN[words[k]]); j = k + 1; continue; }
        }
        break;
      }
      const ordered = possessive ? seq.slice().reverse() : seq;
      const chain = ordered.map((x) => x.base);
      // In English a maternal uncle / aunt is the mother's brother / sister, a paternal one the father's.
      let m = mod;
      if (chain.length === 1 && chain[0] === 'uncle') { if (m === 'mat') { chain[0] = 'muncle'; m = undefined; } else m = undefined; }
      if (chain.length === 1 && chain[0] === 'aunt' && m === 'mat') { chain[0] = 'maunt'; m = undefined; }
      const key = heirOf(chain, m) ?? (chain.length === 1 ? null : heirOf([chain[0]], m));
      if (key) {
        if (w === 'parents') { add('father', 1, undefined); add('mother', 1, undefined); }
        else add(key, ordered[0].n, num);
      }
      num = undefined;
      mod = undefined;
      i = j - 1;
    }
  }
  if (family.husband) deceased = 'f';
  if (family.wife) deceased = 'm';
  return { deceased, family, guessed };
}
