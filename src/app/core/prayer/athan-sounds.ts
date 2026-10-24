/**
 * Athan recordings the user can download once (then they play offline). Every one is freely licensed on
 * Wikimedia Commons; the credit line is shown in the app as the licences require.
 * The default athan is BUILTIN_ATHAN below, which needs no download.
 */
export interface AthanRecording {
  id: string;
  nameAr: string;
  nameEn: string;
  url: string;
  /** File extension used for the saved copy. */
  ext: 'webm' | 'mp3' | 'ogg';
  sizeMb: number;
  /** "Author · licence" as required for attribution. */
  credit: string;
  source: string;
}

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';

export const ATHAN_RECORDINGS: AthanRecording[] = [
  {
    id: 'haram-makkah',
    nameAr: 'أذان المسجد الحرام - مكة المكرمة',
    nameEn: 'Athan of al-Masjid al-Haram, Makkah',
    url: `${COMMONS}/transcoded/a/a7/Adhan%2C_Great_Mosque_of_Mecca_-_Jan_21%2C_2013.webm/Adhan%2C_Great_Mosque_of_Mecca_-_Jan_21%2C_2013.webm.240p.vp9.webm`,
    ext: 'webm',
    sizeMb: 8,
    credit: 'Seyfula Islam · CC BY 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Adhan,_Great_Mosque_of_Mecca_-_Jan_21,_2013.webm',
  },
  {
    id: 'haram-makkah-maghrib',
    nameAr: 'أذان المغرب في المسجد الحرام - مكة المكرمة',
    nameEn: 'Maghrib athan, al-Masjid al-Haram, Makkah',
    url: `${COMMONS}/transcoded/6/6d/Maghrib_Adhan_at_the_Masjid_al_Haram%2C_Mecca_-_25_Feb%2C_2012.webm/Maghrib_Adhan_at_the_Masjid_al_Haram%2C_Mecca_-_25_Feb%2C_2012.webm.240p.vp9.webm`,
    ext: 'webm',
    sizeMb: 12,
    credit: '3omar Faruq · CC BY 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Maghrib_Adhan_at_the_Masjid_al_Haram,_Mecca_-_25_Feb,_2012.webm',
  },
  {
    id: 'aaqib-azeez',
    nameAr: 'أذان - عاقب عزيز',
    nameEn: 'Athan - Aaqib Azeez',
    url: `${COMMONS}/7/7d/The_Adhan_-_Muslim_Call_to_Prayer_-_Aaqib_Azeez.mp3`,
    ext: 'mp3',
    sizeMb: 1.4,
    credit: 'Atcovi · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:The_Adhan_-_Muslim_Call_to_Prayer_-_Aaqib_Azeez.mp3',
  },
  {
    id: 'azan-andrewler',
    nameAr: 'أذان (تسجيل مسجد)',
    nameEn: 'Athan (mosque recording)',
    url: `${COMMONS}/8/86/Azan.ogg`,
    ext: 'ogg',
    sizeMb: 1.5,
    credit: 'Andrewler · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Azan.ogg',
  },
  {
    id: 'call-to-worship',
    nameAr: 'أذان (تسجيل آخر)',
    nameEn: 'Athan (another recording)',
    url: `${COMMONS}/d/d2/Islamic_call_to_worship.oga`,
    ext: 'ogg',
    sizeMb: 1.3,
    credit: 'Mahfoudou · CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Islamic_call_to_worship.oga',
  },
];

/** The athan shipped inside the app (android res/raw/athan_default.mp3): sound 'athan', the default for every prayer. */
export const BUILTIN_ATHAN = {
  nameAr: 'أذان - عاقب عزيز (مدمج في التطبيق)',
  nameEn: 'Athan - Aaqib Azeez (built in)',
  credit: 'Atcovi · CC BY-SA 4.0',
  source: 'https://commons.wikimedia.org/wiki/File:The_Adhan_-_Muslim_Call_to_Prayer_-_Aaqib_Azeez.mp3',
};
