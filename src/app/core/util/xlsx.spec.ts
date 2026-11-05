import { xlsx, zip } from './xlsx';

/** Reads a stored ZIP back: name → text. */
function unzip(b: Uint8Array): Map<string, string> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<string, string>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const size = v.getUint32(at + 18, true), nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(b.subarray(at + 30, at + 30 + nameLen));
    out.set(name, new TextDecoder().decode(b.subarray(at + 30 + nameLen, at + 30 + nameLen + size)));
    at += 30 + nameLen + size;
  }
  return out;
}

describe('the Excel writer', () => {
  it('writes the workbook parts, right-to-left sheets, numbers as numbers and escaped text', () => {
    const files = unzip(xlsx([{ name: 'الأنصبة', rtl: true, bold: [0], rows: [['الوارث', 'المبلغ'], ['<الزوجة & "ابن">', 1250.5]] }]));
    expect([...files.keys()]).toContain('xl/worksheets/sheet1.xml');
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('<v>1250.5</v>');
    expect(sheet).toContain('&lt;الزوجة &amp; &quot;ابن&quot;&gt;');
    expect(files.get('xl/workbook.xml')).toContain('name="الأنصبة"');
  });
  it('ends with a central directory listing every file', () => {
    const b = zip([['a.txt', new TextEncoder().encode('x')], ['b.txt', new TextEncoder().encode('yy')]]);
    const v = new DataView(b.buffer);
    expect(v.getUint32(b.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(b.length - 22 + 10, true)).toBe(2);
  });
});
