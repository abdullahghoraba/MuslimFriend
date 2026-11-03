// Adds the newer features to the Play listing texts (store-assets/listing-translations.json): a new short description
// and a section after the opening paragraph of the full description. Usage: node scripts/store-shots/listing-update.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../../store-assets/listing-translations.json', import.meta.url);
const listing = JSON.parse(readFileSync(path, 'utf8'));

// [short description (<= 80), section heading, bullets...]
const add = {
  ar: ['مصحف يسمع تلاوتك ويصحّحها، تفسير وتلاوات، أذكار ومواقيت الصلاة، بلا إعلانات', 'سمّع ويصحّح لك',
    'التسميع: اقرأ من حفظك ويستمع التطبيق ويتحقق من كل كلمة، فيُظهر الكلمة الخاطئة أو المتروكة مع صوابها، ويعمل بلا إنترنت بذكاء «ترتيل» المدرَّب على تلاوة القرآن.',
    'استوديو التلاوة: سجّل تلاوتك صوتًا أو فيديو مع إزالة الضوضاء وتحسين الصوت وصدى المسجد إن شئت، وشاركها أو احفظها في المعرض.',
    'مصحف الشمرلي بصفحاته المطبوعة نفسها، مع تكبير الخط والتظليل والعلامات، والصفحة المصوّرة بلمسة، إلى جانب مصحف المدينة وروايات ورش وقالون وغيرها.',
    'بحث أذكى: القرّاء بأي كتابة، والسور بالاسم أو الرقم، وكلمات القرآن بالإملاء المعتاد.'],
  en: ['Quran that checks your recitation, tafsir, athkar & prayer times. No ads.', 'Recite and be corrected',
    "Tasmee': recite from memory and the app listens and checks every word, showing a wrong or skipped word with the right one. Works offline with Tarteel's Quran-trained AI.",
    'Recitation studio: record your recitation as sound or video with noise removal, a clear voice and an optional mosque echo, then share it or save it to your gallery.',
    'The Shamarly mushaf on its own printed pages, with text size, highlights and bookmarks, and the scanned page one tap away, besides the Madinah mushaf and the riwayat of Warsh, Qalun and more.',
    'Smarter search: reciters in any spelling, surahs by name or number, and Quran words in everyday spelling.'],
  fr: ['Le Coran qui vérifie votre récitation, tafsir, adhkar, horaires. Sans pub.', 'Récitez, il vous corrige',
    "Tasmee' : récitez de mémoire, l'appli écoute et vérifie chaque mot, et montre un mot erroné ou sauté avec le bon. Fonctionne hors ligne avec l'IA de Tarteel entraînée sur la récitation du Coran.",
    'Studio de récitation : enregistrez votre récitation en audio ou vidéo, sans bruit, voix claire et écho de mosquée au choix, puis partagez-la ou enregistrez-la dans la galerie.',
    "Le mushaf Shamarly sur ses propres pages imprimées, avec taille du texte, surlignage et signets, et la page scannée en un geste, en plus du mushaf de Médine et des riwayat de Warsh, Qalun et d'autres.",
    'Recherche plus intelligente : récitateurs quelle que soit l’orthographe, sourates par nom ou numéro, mots du Coran en orthographe courante.'],
  es: ['El Corán que revisa tu recitación, tafsir, adhkar y horarios. Sin anuncios.', 'Recita y te corrige',
    "Tasmee': recita de memoria y la app escucha y revisa cada palabra, mostrando una palabra errónea u omitida con la correcta. Funciona sin conexión con la IA de Tarteel entrenada en la recitación del Corán.",
    'Estudio de recitación: graba tu recitación en audio o video, sin ruido, con voz clara y eco de mezquita opcional, y compártela o guárdala en la galería.',
    'El mushaf Shamarly en sus propias páginas impresas, con tamaño de letra, resaltado y marcadores, y la página escaneada a un toque, además del mushaf de Medina y las riwayat de Warsh, Qalun y más.',
    'Búsqueda más inteligente: recitadores con cualquier ortografía, suras por nombre o número y palabras del Corán con ortografía común.'],
  de: ['Koran, der deine Rezitation prüft, Tafsir, Adhkar, Gebetszeiten. Werbefrei.', 'Vortragen und korrigiert werden',
    "Tasmee': aus dem Gedächtnis rezitieren, die App hört zu und prüft jedes Wort und zeigt ein falsches oder ausgelassenes Wort mit dem richtigen. Offline mit Tarteels auf Koranrezitation trainierter KI.",
    'Rezitationsstudio: Rezitation als Ton oder Video aufnehmen, ohne Rauschen, mit klarer Stimme und auf Wunsch Moschee-Hall, dann teilen oder in der Galerie speichern.',
    'Der Shamarly-Mushaf auf seinen eigenen gedruckten Seiten, mit Schriftgröße, Markierungen und Lesezeichen, die Scan-Seite mit einem Tipp, neben dem Medina-Mushaf und den Riwayat von Warsch, Qalun und weiteren.',
    'Klügere Suche: Rezitatoren in jeder Schreibweise, Suren nach Name oder Nummer, Koranwörter in gewohnter Schreibweise.'],
  pt: ['O Alcorão que confere sua recitação, tafsir, adhkar e horários. Sem anúncios.', 'Recite e seja corrigido',
    "Tasmee': recite de memória e o app escuta e confere cada palavra, mostrando uma palavra errada ou pulada com a certa. Funciona offline com a IA da Tarteel treinada na recitação do Alcorão.",
    'Estúdio de recitação: grave sua recitação em áudio ou vídeo, sem ruído, com voz clara e eco de mesquita opcional, e compartilhe ou salve na galeria.',
    'O mushaf Shamarly nas suas próprias páginas impressas, com tamanho do texto, destaques e marcadores, e a página escaneada a um toque, além do mushaf de Medina e das riwayat de Warsh, Qalun e outras.',
    'Busca mais inteligente: recitadores em qualquer grafia, suratas por nome ou número e palavras do Alcorão na grafia comum.'],
  tr: ["Tilavetini kontrol eden Kur'an, tefsir, zikirler, namaz vakitleri. Reklamsız.", 'Oku, düzeltsin',
    "Tesmî: ezberden oku, uygulama dinler ve her kelimeyi kontrol eder; yanlış veya atlanan kelimeyi doğrusuyla gösterir. Tarteel'in Kur'an tilavetiyle eğitilmiş yapay zekâsıyla internetsiz çalışır.",
    'Tilavet stüdyosu: tilavetini ses veya video olarak kaydet; gürültü giderme, temiz ses ve istersen cami yankısı; paylaş veya galeriye kaydet.',
    "Şemerli mushafı kendi basılı sayfalarıyla; yazı boyutu, vurgulama ve yer imleri; taranmış sayfa tek dokunuşta. Medine mushafı ve Verş, Kalun gibi rivayetlerin yanında.",
    "Daha akıllı arama: her yazılışla kâriler, ad veya numarayla sureler ve olağan yazımla Kur'an kelimeleri."],
  id: ["Al-Qur'an yang memeriksa bacaanmu, tafsir, zikir, jadwal salat. Tanpa iklan.", 'Setor hafalan, dikoreksi',
    "Tasmi': baca dari hafalan, aplikasi mendengar dan memeriksa tiap kata, menampilkan kata yang salah atau terlewat beserta yang benar. Bekerja offline dengan AI Tarteel yang dilatih dengan bacaan Al-Qur'an.",
    'Studio tilawah: rekam bacaanmu dalam suara atau video, tanpa bising, suara jernih dan gema masjid bila mau, lalu bagikan atau simpan ke galeri.',
    'Mushaf Syamarli pada halaman cetaknya sendiri, dengan ukuran teks, sorotan, dan penanda, serta halaman pindaian sekali ketuk, selain mushaf Madinah dan riwayat Warsy, Qalun, dan lainnya.',
    "Pencarian lebih cerdas: qari dengan ejaan apa pun, surah dengan nama atau nomor, dan kata Al-Qur'an dengan ejaan biasa."],
  ms: ['Al-Quran yang menyemak bacaan anda, tafsir, zikir, waktu solat. Tanpa iklan.', 'Baca, ia membetulkan',
    "Tasmi': baca dari hafazan, aplikasi mendengar dan menyemak setiap perkataan, menunjukkan perkataan yang salah atau tertinggal bersama yang betul. Berfungsi luar talian dengan AI Tarteel yang dilatih dengan bacaan al-Quran.",
    'Studio tilawah: rakam bacaan anda dalam bunyi atau video, tanpa hingar, suara jelas dan gema masjid jika mahu, kemudian kongsi atau simpan ke galeri.',
    'Mushaf Syamarli pada halaman cetaknya sendiri, dengan saiz teks, serlahan dan penanda, serta halaman imbasan sekali ketik, selain mushaf Madinah dan riwayat Warsy, Qalun dan lain-lain.',
    'Carian lebih bijak: qari dengan apa jua ejaan, surah dengan nama atau nombor, dan perkataan al-Quran dengan ejaan biasa.'],
  ru: ['Коран, проверяющий ваше чтение, тафсир, азкары, время намаза. Без рекламы.', 'Читайте — он исправит',
    'Тасми: читайте наизусть, приложение слушает и проверяет каждое слово, показывая неверное или пропущенное слово рядом с правильным. Работает офлайн с ИИ Tarteel, обученным на чтении Корана.',
    'Студия чтения: записывайте чтение звуком или видео, без шума, с чистым голосом и по желанию эхом мечети, затем делитесь или сохраняйте в галерею.',
    'Мусхаф Шамарли на его собственных печатных страницах, с размером текста, выделением и закладками, скан страницы одним касанием, а также мединский мусхаф и риваяты Варша, Калуна и другие.',
    'Умнее поиск: чтецы в любом написании, суры по названию или номеру и слова Корана в привычном написании.'],
  ur: ['قرآن جو آپ کی تلاوت جانچے، تفسیر، اذکار اور نماز کے اوقات، اشتہارات کے بغیر', 'سنائیں، یہ درست کرے',
    'تسمیع: حفظ سے پڑھیں، ایپ سن کر ہر لفظ جانچتی ہے اور غلط یا چھوٹا ہوا لفظ درست لفظ کے ساتھ دکھاتی ہے۔ ترتیل کے قرآن پر تربیت یافتہ AI کے ساتھ آف لائن کام کرتی ہے۔',
    'تلاوت اسٹوڈیو: اپنی تلاوت آواز یا ویڈیو میں ریکارڈ کریں، شور کے بغیر، صاف آواز اور چاہیں تو مسجد کی گونج کے ساتھ، پھر شیئر کریں یا گیلری میں محفوظ کریں۔',
    'مصحف شمرلی اپنے ہی چھپے صفحات پر، فونٹ، نشانات اور بک مارکس کے ساتھ، اسکین صفحہ ایک ٹیپ پر، مدینہ مصحف اور ورش، قالون وغیرہ کی روایات کے ساتھ۔',
    'بہتر تلاش: قاری کسی بھی املا میں، سورتیں نام یا نمبر سے، اور قرآن کے الفاظ عام املا میں۔'],
  fa: ['قرآنی که تلاوتتان را بررسی می‌کند، تفسیر، اذکار، اوقات شرعی، بدون تبلیغات', 'بخوانید، تصحیح می‌کند',
    'تسمیع: از حفظ بخوانید، برنامه گوش می‌دهد و هر کلمه را بررسی می‌کند و کلمه نادرست یا جاافتاده را با کلمه درست نشان می‌دهد. با هوش مصنوعی ترتیل که با تلاوت قرآن آموزش دیده، آفلاین کار می‌کند.',
    'استودیوی تلاوت: تلاوت خود را صوتی یا تصویری ضبط کنید، بدون نویز، با صدای شفاف و در صورت تمایل پژواک مسجد، سپس به اشتراک بگذارید یا در گالری ذخیره کنید.',
    'مصحف شمرلی بر صفحات چاپی خودش، با اندازه قلم، برجسته‌سازی و نشانک، و صفحه اسکن‌شده با یک لمس، در کنار مصحف مدینه و روایات ورش، قالون و دیگران.',
    'جستجوی هوشمندتر: قاریان با هر املا، سوره‌ها با نام یا شماره، و کلمات قرآن با املای رایج.'],
  bn: ['কুরআন যা আপনার তিলাওয়াত যাচাই করে, তাফসির, যিকির, নামাজের সময়, বিজ্ঞাপন নেই', 'শোনান, সংশোধন পান',
    'তাসমী: মুখস্থ থেকে পড়ুন, অ্যাপ শুনে প্রতিটি শব্দ যাচাই করে এবং ভুল বা বাদ পড়া শব্দ সঠিকটির সাথে দেখায়। তারতিলের কুরআন-প্রশিক্ষিত AI দিয়ে অফলাইনে কাজ করে।',
    'তিলাওয়াত স্টুডিও: তিলাওয়াত অডিও বা ভিডিওতে রেকর্ড করুন, শব্দদূষণ ছাড়া, পরিষ্কার কণ্ঠ ও চাইলে মসজিদের প্রতিধ্বনিসহ, তারপর শেয়ার করুন বা গ্যালারিতে রাখুন।',
    'শামারলি মুসহাফ নিজস্ব ছাপা পৃষ্ঠায়, ফন্ট, হাইলাইট ও বুকমার্কসহ, স্ক্যান পৃষ্ঠা এক ট্যাপে, মদীনা মুসহাফ এবং ওয়ারশ, কালুন ও অন্যান্য রিওয়ায়াতের পাশাপাশি।',
    'আরও স্মার্ট খোঁজ: যেকোনো বানানে ক্বারী, নাম বা নম্বরে সূরা, এবং সাধারণ বানানে কুরআনের শব্দ।'],
  hi: ['क़ुरआन जो आपकी तिलावत जाँचे, तफ़सीर, अज़कार, नमाज़ का समय, बिना विज्ञापन', 'सुनाएँ, यह सुधारे',
    'तस्मीअ: याद से पढ़ें, ऐप सुनकर हर शब्द जाँचता है और ग़लत या छूटा शब्द सही शब्द के साथ दिखाता है। तरतील के क़ुरआन पर प्रशिक्षित AI से ऑफ़लाइन काम करता है।',
    'तिलावत स्टूडियो: अपनी तिलावत आवाज़ या वीडियो में रिकॉर्ड करें, शोर के बिना, साफ़ आवाज़ और चाहें तो मस्जिद की गूँज के साथ, फिर साझा करें या गैलरी में सहेजें।',
    'शमरली मुसहफ़ अपने छपे पन्नों पर, फ़ॉन्ट, हाइलाइट और बुकमार्क के साथ, स्कैन पन्ना एक टैप पर, मदीना मुसहफ़ और वर्श, क़ालून आदि रिवायतों के साथ।',
    'बेहतर खोज: किसी भी वर्तनी में क़ारी, नाम या नंबर से सूरह, और आम वर्तनी में क़ुरआन के शब्द।'],
  zh: ['能检查您诵读的古兰经应用：经注、记念词、礼拜时间，无广告', '背诵，它来纠正',
    '背诵检查：凭记忆诵读，应用聆听并检查每个词，标出读错或漏读的词并显示正确的词。借助 Tarteel 以古兰经诵读训练的 AI，可离线使用。',
    '诵读录音室：以音频或视频录制您的诵读，自动降噪、人声清晰，可选清真寺回声，然后分享或保存到相册。',
    '沙马尔利版穆斯哈夫按其印刷页面排版，可调字号、高亮和书签，一键查看扫描页；另有麦地那版及沃尔什、格伦等传本。',
    '更智能的搜索：任意拼写的诵读者、按名称或编号查章，以及常用拼写的古兰经词语。'],
  sw: ["Qur'ani inayokagua kisomo, tafsiri, adhkar, nyakati za swala. Bila matangazo", 'Soma, ikusahihishe',
    "Tasmi': soma kwa moyo, programu inasikiliza na kukagua kila neno, ikionyesha neno lililokosewa au kurukwa pamoja na sahihi. Inafanya kazi bila mtandao kwa AI ya Tarteel iliyofunzwa kwa kisomo cha Qur'ani.",
    'Studio ya kisomo: rekodi kisomo chako kwa sauti au video, bila kelele, sauti safi na mwangwi wa msikiti ukipenda, kisha shiriki au hifadhi kwenye picha.',
    'Msahafu wa Shamarly kwenye kurasa zake za kuchapishwa, ukubwa wa maandishi, kuangazia na alamisho, ukurasa uliopigwa picha kwa mguso mmoja, pamoja na Msahafu wa Madina na riwaya za Warsh, Qalun na nyinginezo.',
    "Utafutaji bora: wasomaji kwa tahajia yoyote, sura kwa jina au namba, na maneno ya Qur'ani kwa tahajia ya kawaida."],
};

let bad = false;
for (const [lang, [short, heading, ...bullets]] of Object.entries(add)) {
  const l = listing[lang];
  if (!l) throw new Error(`no listing for ${lang}`);
  l.short = short;
  const section = `${heading}\n${bullets.map((b) => `• ${b}`).join('\n')}`;
  const parts = l.full.split('\n\n');
  // Rerunning replaces the section (found by its heading, or by the invisible mark an earlier run left).
  const at = parts.findIndex((p) => p.startsWith(`${heading}\n`) || p.startsWith(`${heading}⁣`));
  if (at >= 0) parts[at] = section;
  else parts.splice(1, 0, section);
  l.full = parts.join('\n\n');
  const s = [...l.short].length;
  const f = [...l.full].length;
  if (s > 80 || f > 4000) bad = true;
  console.log(`${s > 80 || f > 4000 ? 'TOO LONG' : 'ok      '} ${lang}: short ${s}/80, full ${f}/4000`);
}
writeFileSync(path, JSON.stringify(listing, null, 2) + '\n');
process.exit(bad ? 1 : 0);
