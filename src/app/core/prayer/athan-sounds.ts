/**
 * Athan recordings the user can download once (then they play offline), from Wikimedia Commons or the Internet
 * Archive under the licence shown in their credit line. The Madinah athan (DEFAULT_RECORDING) downloads by itself
 * when the athan is turned on; until it is on the phone, BUILTIN_ATHAN below plays, which needs no download.
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
  /** The same muezzin's Fajr athan (with «الصلاة خير من النوم»): downloaded alongside and used for Fajr. */
  fajr?: { id: string; url: string; ext: AthanRecording['ext']; sizeMb: number };
}

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';
const ARCHIVE = 'https://archive.org/download/azaan-of-world-mosques-english';

/** Downloaded automatically when the athan is turned on, and then the athan for every prayer. */
export const DEFAULT_RECORDING = 'madinah-essam-bukhari';

export const ATHAN_RECORDINGS: AthanRecording[] = [
  {
    // Both files were checked to hold the complete athan (12 and 14 phrases), ending in silence.
    id: DEFAULT_RECORDING,
    nameAr: 'أذان المسجد النبوي - عصام بخاري',
    nameEn: "Athan of the Prophet's Mosque, Madinah - Essam Bukhari",
    url: `${ARCHIVE}/${encodeURIComponent('عصام بخاري2 (www.alqurantranslation.com).MP3')}`,
    ext: 'mp3',
    sizeMb: 4.7,
    credit: 'Internet Archive · Public Domain Mark',
    source: 'https://archive.org/details/azaan-of-world-mosques-english',
    fajr: {
      id: DEFAULT_RECORDING + '-fajr',
      url: `${ARCHIVE}/${encodeURIComponent('عصام بخاري1 (www.alqurantranslation.com).MP3')}`,
      ext: 'mp3',
      sizeMb: 2.6,
    },
  },
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
