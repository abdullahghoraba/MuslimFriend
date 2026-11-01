// Makes release/app-release-slim.aab: the release bundle without R8's deobfuscation map, re-signed with the upload key,
// so it fits a browser upload limited to 10 MB. The map is kept as release/mapping.txt; upload it in Play Console
// (App bundle explorer → Downloads → ReTrace mapping) if readable Java crash traces are wanted.
// Usage: node scripts/slim-bundle.mjs   (after npm run release)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'release/app-release.aab');
const out = resolve(root, 'release/app-release-slim.aab');
const mapping = resolve(root, 'release/mapping.txt');
const MAP_ENTRY = 'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map';

const props = Object.fromEntries(
  readFileSync(resolve(root, 'android/keystore.properties'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const jdk = process.env.ATHKAR_JAVA_HOME ?? 'C:\\Program Files\\Android\\openjdk\\jdk-21.0.8';
const jarsigner = existsSync(resolve(jdk, 'bin/jarsigner.exe')) ? resolve(jdk, 'bin/jarsigner.exe') : 'jarsigner';

// 7-Zip removes entries and copies the others as they are (stored entries stay stored, which jarsigner needs).
const sevenZip = ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].find((p) => existsSync(p)) ?? '7z';
copyFileSync(src, out);
// Keep the map, then take it out with the old signature (the bundle is signed again below).
execFileSync(sevenZip, ['e', src, MAP_ENTRY, `-o${dirname(mapping)}`, '-y'], { stdio: 'ignore' });
copyFileSync(resolve(dirname(mapping), 'proguard.map'), mapping);
rmSync(resolve(dirname(mapping), 'proguard.map'));
execFileSync(sevenZip, ['d', out, MAP_ENTRY, 'META-INF/MANIFEST.MF', 'META-INF/*.SF', 'META-INF/*.RSA', 'META-INF/*.EC', 'META-INF/*.DSA'], { stdio: 'ignore' });

try {
  execFileSync(jarsigner, [
    '-keystore', resolve(root, 'android', props.storeFile),
    '-storepass:env', 'SLIM_STOREPASS', '-keypass:env', 'SLIM_KEYPASS',
    '-digestalg', 'SHA-256',
    out, props.keyAlias,
  ], { env: { ...process.env, SLIM_STOREPASS: props.storePassword, SLIM_KEYPASS: props.keyPassword }, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  // jarsigner reports its errors on stdout.
  console.error(String(e.stdout ?? '') + String(e.stderr ?? ''));
  process.exit(1);
}

const verify = execFileSync(jarsigner, ['-verify', out], { encoding: 'utf8' });
if (!/jar verified/.test(verify)) throw new Error('signature check failed');
const mb = (f) => (statSync(f).size / 1e6).toFixed(2) + ' MB';
console.log(`release/app-release-slim.aab ${mb(out)} (signed, verified); map kept in release/mapping.txt (${mb(mapping)})`);
