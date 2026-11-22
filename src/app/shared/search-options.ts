import { SearchText, prepareSearch, searchList } from '../core/util/search';

/** One choice of a searchable list: what it stands for, how it is shown, and what else finds it. */
export interface SearchOption {
  value: string | number;
  label: string;
  /** A second line (a sura's English name...). */
  hint?: string;
  /** More words that find it (other names, spellings...). */
  keys?: string[];
  /** Numbers typed that find it exactly (a sura's number). */
  numbers?: number[];
}

/** Eastern Arabic and Persian digits as 0-9 (a reader may type «٢٥٥»). */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

const indexes = new WeakMap<readonly SearchOption[], Map<SearchOption, SearchText>>();

/** The options matching [query]: numbers (ayat) by the digits they start with, the rest by name in any spelling. */
export function filterOptions(options: readonly SearchOption[], query: string): SearchOption[] {
  const q = westernDigits(query.trim());
  if (!q) return [...options];
  if (options.every((o) => /^\d+$/.test(westernDigits(o.label))) && /^\d+$/.test(q)) {
    const exact = options.filter((o) => westernDigits(o.label) === q);
    return [...exact, ...options.filter((o) => westernDigits(o.label) !== q && westernDigits(o.label).startsWith(q))];
  }
  let index = indexes.get(options);
  if (!index) {
    index = new Map(options.map((o) => [o, prepareSearch(o.label, o.hint, ...(o.keys ?? []))]));
    indexes.set(options, index);
  }
  return searchList(options, q, (o) => [index!.get(o)!], (o) => o.numbers ?? []);
}

const numberLists = new Map<string, SearchOption[]>();
/** 1..[count] (an ayah's number), shown with [format] (the reader's digits); the same list each time it is asked for. */
export function numberOptions(count: number, format: (n: number) => string = String): SearchOption[] {
  const key = `${count}|${format(1234567890)}`;
  let list = numberLists.get(key);
  if (!list) {
    list = Array.from({ length: count }, (_, i) => ({ value: i + 1, label: format(i + 1) }));
    numberLists.set(key, list);
  }
  return list;
}

/** The suras, found by their number or their name in Arabic, transliterated or in English (any spelling). */
export function suraSearchOptions(
  suras: readonly { index: number; name: string; tname?: string; ename?: string }[],
  label: (s: { index: number; name: string }) => string = (s) => `${s.index}. ${s.name}`,
): SearchOption[] {
  return suras.map((s) => ({
    value: s.index,
    label: label(s),
    hint: [...new Set([s.tname, s.ename].filter(Boolean))].join(' · ') || undefined,
    keys: [s.name, s.tname ?? '', s.ename ?? ''],
    numbers: [s.index],
  }));
}
