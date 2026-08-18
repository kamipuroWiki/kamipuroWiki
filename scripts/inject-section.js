#!/usr/bin/env node
/**
 * 生成済みフラグメント（技能详细セクション）を、簡評ページ（例: hime/fire.md）内の
 * マーカーコメント <!-- KAMIHIME:DETAIL:<key>:START --> 〜 END の間に差し込む。
 *
 * - マーカーが既に存在する場合: その間の内容をフラグメントで置き換える（丸ごと上書き）。
 * - マーカーが無い場合: ファイル末尾にマーカー付きで新規追記する。
 * - 簡評ページのマーカー外の内容（旧神姫簡評や導入文など）には一切触れない。
 *
 * 使い方:
 *   node scripts/inject-section.js <targetMd> <fragmentMd> <key>
 * 例:
 *   node scripts/inject-section.js hime/fire.md /tmp/fire-fragment.md fire
 */
'use strict';
const fs = require('fs');
const path = require('path');

function main() {
  const [targetPathArg, fragmentPathArg, key] = process.argv.slice(2);
  if (!targetPathArg || !fragmentPathArg || !key) {
    console.error('Usage: node inject-section.js <targetMd> <fragmentMd> <key>');
    process.exit(1);
  }
  const targetPath = path.resolve(targetPathArg);
  const fragment = fs.readFileSync(path.resolve(fragmentPathArg), 'utf-8').trim();
  const startMarker = `<!-- KAMIHIME:DETAIL:${key}:START -->`;
  const endMarker = `<!-- KAMIHIME:DETAIL:${key}:END -->`;
  const block = `${startMarker}\n${fragment}\n${endMarker}`;

  let target = fs.readFileSync(targetPath, 'utf-8');
  const startIdx = target.indexOf(startMarker);
  const endIdx = target.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    target = target.slice(0, startIdx) + block + target.slice(endIdx + endMarker.length);
  } else if (startIdx !== -1 || endIdx !== -1) {
    console.error(`マーカーが片方しか見つかりません（${key}）。手動で確認してください。`);
    process.exit(1);
  } else {
    target = target.replace(/\s*$/, '') + '\n\n---\n\n' + block + '\n';
  }

  fs.writeFileSync(targetPath, target, 'utf-8');
  console.error(`差し込み完了 (key=${key}) -> ${targetPath}`);
}

main();
