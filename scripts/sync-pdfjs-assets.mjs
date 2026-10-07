#!/usr/bin/env node
/**
 * pdf.js 静态资产保鲜——cmaps／standard_fonts 从 node_modules/pdfjs-dist 同步进 public/pdfjs/。
 *
 * 为什么：SDK packager 的静态清单是白名单（icon/i18n/README…），不收任意子目录；
 * vite 的 publicDir 通道（内层 build outDir=pkgDir，publicDir 未关）是「任意文件随包」的
 * 原生口——资产放 public/ 即整树进 zip。本脚本挂 npm `prebuild` 钩子，每次 build 前幂等同步，
 * 版本随 lockfile 钉死的 pdfjs-dist 走（升版本 = 重装 + 重建，产物自动跟）。
 *
 * ⛔ public/pdfjs/ 不进 git（.gitignore）——它是产物不是源码，别提交二进制副本。
 */
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));

const pairs = [
  ["cmaps", "pdfjs/cmaps"],
  ["standard_fonts", "pdfjs/standard_fonts"],
];

for (const [src, dest] of pairs) {
  const destAbs = join(repoRoot, "public", dest);
  rmSync(destAbs, { recursive: true, force: true });
  cpSync(join(pdfjsRoot, src), destAbs, { recursive: true });
  console.log(`[sync-pdfjs-assets] ${src} → public/${dest}`);
}
