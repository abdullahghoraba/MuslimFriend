/**
 * Zakat on what a Muslim owns: each property is entered with its kind, and gold and silver are valued at today's price
 * in the reader's currency (MetalPricesService). Pure functions, tested in zakat.spec.ts.
 */

export type AssetKind = 'cash' | 'bank' | 'gold' | 'silver' | 'trade' | 'receivable' | 'stocks' | 'other' | 'debt';
export const ASSET_KINDS: AssetKind[] = ['cash', 'bank', 'gold', 'silver', 'trade', 'receivable', 'stocks', 'other', 'debt'];
export type Karat = 24 | 22 | 21 | 18;
export const KARATS: Karat[] = [24, 22, 21, 18];

/** One property (or debt). Gold and silver: [amount] in grams. Everything else: money in [currency]. */
export interface ZakatAsset {
  id: string;
  kind: AssetKind;
  /** The reader's own name for it ("Savings at the bank", "Wife's bracelet"). */
  label: string;
  amount: number;
  /** For money: its currency (ISO 4217, lower case), defaults to the main currency. */
  currency?: string;
  karat?: Karat;
}

/** Today's prices in the main currency, and the value of one unit of other currencies in it. */
export interface ZakatPrices {
  currency: string;
  /** One gram of pure (24 karat) gold, and of silver. */
  goldGram: number;
  silverGram: number;
  /** Main-currency value of 1 unit of [code]; undefined when unknown. */
  rate(code: string): number | undefined;
}

export interface ZakatLine {
  id: string;
  /** Value in the main currency (negative for a debt); null when it can't be valued (unknown currency). */
  value: number | null;
}

export interface ZakatResult {
  lines: ZakatLine[];
  /** Zakatable wealth after debts, never below zero. */
  total: number;
  nisabValue: number;
  due: boolean;
  amount: number;
}

/** Nisab: 20 mithqal of gold (85 g) or 200 dirhams of silver (595 g). */
export const NISAB_GOLD_GRAMS = 85;
export const NISAB_SILVER_GRAMS = 595;
export const ZAKAT_RATE = 0.025;
export const TROY_OUNCE_GRAMS = 31.1034768;

const pos = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

export function assetValue(a: ZakatAsset, p: ZakatPrices): number | null {
  const amount = pos(a.amount);
  if (a.kind === 'gold') return amount * ((a.karat ?? 21) / 24) * p.goldGram;
  if (a.kind === 'silver') return amount * p.silverGram;
  const code = (a.currency || p.currency).toLowerCase();
  const rate = code === p.currency ? 1 : p.rate(code);
  if (rate === undefined) return null;
  const value = amount * rate;
  return a.kind === 'debt' ? -value : value;
}

export function zakatOf(assets: ZakatAsset[], p: ZakatPrices, nisab: 'gold' | 'silver'): ZakatResult {
  const lines = assets.map((a) => ({ id: a.id, value: assetValue(a, p) }));
  const total = Math.max(0, lines.reduce((sum, l) => sum + (l.value ?? 0), 0));
  const nisabValue = (nisab === 'gold' ? NISAB_GOLD_GRAMS * p.goldGram : NISAB_SILVER_GRAMS * p.silverGram);
  const due = total > 0 && nisabValue > 0 && total >= nisabValue;
  return { lines, total, nisabValue, due, amount: due ? total * ZAKAT_RATE : 0 };
}

/** Country (ISO 3166) → currency (ISO 4217, lower case). */
const CURRENCY_OF = Object.fromEntries(
  ('AD:eur AE:aed AF:afn AG:xcd AI:xcd AL:all AM:amd AO:aoa AR:ars AS:usd AT:eur AU:aud AW:awg AX:eur AZ:azn BA:bam BB:bbd ' +
    'BD:bdt BE:eur BF:xof BG:bgn BH:bhd BI:bif BJ:xof BL:eur BM:bmd BN:bnd BO:bob BQ:usd BR:brl BS:bsd BT:btn BW:bwp BY:byn ' +
    'BZ:bzd CA:cad CC:aud CD:cdf CF:xaf CG:xaf CH:chf CI:xof CK:nzd CL:clp CM:xaf CN:cny CO:cop CR:crc CU:cup CV:cve CW:ang ' +
    'CX:aud CY:eur CZ:czk DE:eur DJ:djf DK:dkk DM:xcd DO:dop DZ:dzd EC:usd EE:eur EG:egp EH:mad ER:ern ES:eur ET:etb FI:eur ' +
    'FJ:fjd FK:fkp FM:usd FO:dkk FR:eur GA:xaf GB:gbp GD:xcd GE:gel GF:eur GG:gbp GH:ghs GI:gip GL:dkk GM:gmd GN:gnf GP:eur ' +
    'GQ:xaf GR:eur GS:gbp GT:gtq GU:usd GW:xof GY:gyd HK:hkd HN:hnl HR:eur HT:htg HU:huf ID:idr IE:eur IM:gbp IN:inr IQ:iqd ' +
    'IR:irr IS:isk IT:eur JE:gbp JM:jmd JO:jod JP:jpy KE:kes KG:kgs KH:khr KI:aud KM:kmf KN:xcd KP:kpw KR:krw KW:kwd KY:kyd ' +
    'KZ:kzt LA:lak LB:lbp LC:xcd LI:chf LK:lkr LR:lrd LS:lsl LT:eur LU:eur LV:eur LY:lyd MA:mad MC:eur MD:mdl ME:eur MF:eur ' +
    'MG:mga MH:usd MK:mkd ML:xof MM:mmk MN:mnt MO:mop MP:usd MQ:eur MR:mru MS:xcd MT:eur MU:mur MV:mvr MW:mwk MX:mxn MY:myr ' +
    'MZ:mzn NA:nad NC:xpf NE:xof NF:aud NG:ngn NI:nio NL:eur NO:nok NP:npr NR:aud NU:nzd NZ:nzd OM:omr PA:pab PE:pen PF:xpf ' +
    'PG:pgk PH:php PK:pkr PL:pln PM:eur PN:nzd PR:usd PS:ils PT:eur PW:usd PY:pyg QA:qar RE:eur RO:ron RS:rsd RU:rub RW:rwf ' +
    'SA:sar SB:sbd SC:scr SD:sdg SE:sek SG:sgd SH:shp SI:eur SJ:nok SK:eur SL:sle SM:eur SN:xof SO:sos SR:srd SS:ssp ST:stn ' +
    'SV:usd SX:ang SY:syp SZ:szl TC:usd TD:xaf TF:eur TG:xof TH:thb TJ:tjs TL:usd TM:tmt TN:tnd TO:top TR:try TT:ttd TV:aud ' +
    'TW:twd TZ:tzs UA:uah UG:ugx US:usd UY:uyu UZ:uzs VA:eur VC:xcd VE:ves VG:usd VI:usd VN:vnd VU:vuv WF:xpf WS:wst XK:eur ' +
    'YE:yer YT:eur ZA:zar ZM:zmw ZW:zwg')
    .split(' ')
    .map((pair) => pair.split(':') as [string, string]),
);

export function currencyOf(country: string | null | undefined): string | undefined {
  return country ? CURRENCY_OF[country.toUpperCase()] : undefined;
}
