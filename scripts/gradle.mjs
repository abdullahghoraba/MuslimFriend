// Runs the Android Gradle wrapper from android/ with JDK 21, on Windows or Unix.
// Usage: node scripts/gradle.mjs <tasks...>
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const androidDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'android');
const isWin = process.platform === 'win32';
const env = { ...process.env };

// The build needs JDK 21. ATHKAR_JAVA_HOME wins; otherwise use the JDK 21 installed with Android tooling,
// because a machine-wide JAVA_HOME often points at an older JDK.
const bundledJdk = 'C:\\Program Files\\Android\\openjdk\\jdk-21.0.8';
if (env.ATHKAR_JAVA_HOME) env.JAVA_HOME = env.ATHKAR_JAVA_HOME;
else if (isWin && existsSync(bundledJdk)) env.JAVA_HOME = bundledJdk;

// Absolute path: some shells disable running executables from the current directory.
const wrapper = resolve(androidDir, isWin ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(isWin ? `"${wrapper}"` : wrapper, process.argv.slice(2), {
  cwd: androidDir,
  env,
  stdio: 'inherit',
  shell: isWin,
});
process.exit(result.status ?? 1);
