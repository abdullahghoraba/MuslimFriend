import { EncIndex, encCandidates, isChainOnly, overlap, parseDorarSearch, parseDorarSharh, sameHadith, sharhQueries } from './hadith-explain';

const bukhari1 = 'حَدَّثَنَا الْحُمَيْدِيُّ عَبْدُ اللَّهِ بْنُ الزُّبَيْرِ، قَالَ حَدَّثَنَا سُفْيَانُ، قَالَ حَدَّثَنَا يَحْيَى بْنُ سَعِيدٍ الأَنْصَارِيُّ، قَالَ أَخْبَرَنِي مُحَمَّدُ بْنُ إِبْرَاهِيمَ التَّيْمِيُّ، أَنَّهُ سَمِعَ عَلْقَمَةَ بْنَ وَقَّاصٍ اللَّيْثِيَّ، يَقُولُ سَمِعْتُ عُمَرَ بْنَ الْخَطَّابِ ـ رضى الله عنه ـ عَلَى الْمِنْبَرِ قَالَ سَمِعْتُ رَسُولَ اللَّهِ صلى الله عليه وسلم يَقُولُ ‏"‏ إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى، فَمَنْ كَانَتْ هِجْرَتُهُ إِلَى دُنْيَا يُصِيبُهَا أَوْ إِلَى امْرَأَةٍ يَنْكِحُهَا فَهِجْرَتُهُ إِلَى مَا هَاجَرَ إِلَيْهِ ‏"‏‏.‏';
const index: EncIndex = [
  ['1', 'ترجيع النبي صلى الله عليه وسلم'],
  ['2', 'إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى'],
  ['3', 'الدين النصيحة'],
  ['4', 'لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه'],
];

describe('hadith explanation lookup', () => {
  it('finds the encyclopedia hadith by its words, not by the blessings every narration has', () => {
    expect(encCandidates(bukhari1, index)).toEqual(['2']);
    expect(encCandidates('قال النبي صلى الله عليه وسلم: الدين النصيحة', index)).toEqual([]);
  });

  it('accepts an explained narration only when its words are this hadith', () => {
    expect(sameHadith(bukhari1, 'عن عمر رضي الله عنه قال: سمعت رسول الله صلى الله عليه وسلم يقول: «إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى، فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله»')).toBe(true);
    expect(sameHadith(bukhari1, 'لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه')).toBe(false);
    expect(overlap('a b', 'a b')).toBe(0);
  });

  it('searches Dorar for the hadith words after the chain of narrators', () => {
    const qs = sharhQueries(bukhari1);
    expect(qs[0]).toBe('إنما الأعمال بالنيات وإنما لكل امرئ');
    expect(qs.every((q) => !/حدثنا/.test(q))).toBe(true);
    // Muslim's chains have no commas: the last words are the hadith's.
    expect(sharhQueries('حدثنا يحيى بن يحيى قال قرأت على مالك عن نافع عن ابن عمر أن رجلا سأل عن الصلاة فقال مثنى مثنى فإذا خشي أحدكم الصبح صلى واحدة')).toContain('فإذا خشي أحدكم الصبح صلى واحدة');
  });

  it('knows a narration that is only another chain for the hadith before it', () => {
    expect(isChainOnly('وحدثنا ابن نمير، حدثنا أبي، حدثنا عبيد الله، عن عائشة، - رضى الله عنها - عن النبي صلى الله عليه وسلم بمثله ‏.‏')).toBe(true);
    expect(isChainOnly(bukhari1)).toBe(false);
  });

  it('reads the explanation links of a Dorar search page', () => {
    const html = `<div class="border-bottom"><article><h5> 3 - إنَّما الأعمالُ بالنِّيَّاتِ...</h5></article>
      <div class="d-block"><a href="" xplain="211149" class="xplain"> | شرح حديث مشابه </a></div></div>
      <div class="border-bottom"><article><h5>4 - غيره</h5></article><div><a xplain="javascript:1">x</a></div></div>`;
    expect(parseDorarSearch(html)).toEqual([{ id: '211149', text: 'إنَّما الأعمالُ بالنِّيَّاتِ', similar: true }]);
  });

  it('reads a Dorar explanation page: the narration, its reference, the meaning and the lessons', () => {
    const html = `<html><body><div id="sharh-text-content">﻿<div><div>الأعمالُ بالنِّيَّةِ، ولكُلِّ امرِئٍ ما نَوى.</div>
      <div class="app-hadith-info"> الراوي : <span>عمر بن الخطاب</span> <span>|</span> المحدث : <span>البخاري</span></div><hr></div>
      هذا الحديثُ العَظيمُ قاعدةٌ مِن قواعدِ الإسلامِ، وأصلٌ مِن أُصولِ الشَّريعةِ.<br />
      فلا تصِحُّ العِباداتُ إلَّا بالنِّيَّةِ، ومن قصد بعمله الدنيا لم ينل إلا ما قصد.<br />
      وفي الحديثِ: الحثُّ على الإخلاصِ.<script>alert(1)</script><div class="visible-xs"></div></div></body></html>`;
    const r = parseDorarSharh(html)!;
    expect(r.hadith).toBe('الأعمالُ بالنِّيَّةِ، ولكُلِّ امرِئٍ ما نَوى.');
    expect(r.reference).toBe('الراوي : عمر بن الخطاب · المحدث : البخاري');
    expect(r.explanation.split('\n\n')).toHaveLength(2);
    expect(r.benefits).toEqual(['الحثُّ على الإخلاصِ.']);
    expect(r.explanation).not.toContain('alert');
    expect(parseDorarSharh('<html>Attention Required! | Cloudflare</html>')).toBeNull();
  });
});
