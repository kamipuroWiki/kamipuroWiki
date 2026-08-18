#!/usr/bin/env node
/**
 * 既存の簡評ページ（hime/<属性>.md）を、旧神姫簡評として<details>で折りたたみ化し、
 * 技能详细セクション用のマーカーを追加する（v3・1ページ統合方式）。
 *
 * - 導入文（最初の"### "見出しより前）は無改変で残す。
 * - 最初の"### "見出し以降（キャラ一覧）を<details><summary>旧神姫簡評</summary>...</details>で囲む。
 * - 折りたたみ内の各"### "見出しには、サイドバーのページ内目次から除外するため
 *   <!-- {docsify-ignore} --> を末尾に付与する（docsify組み込み機能）。
 * - 末尾に <!-- KAMIHIME:DETAIL:<key>:START/END --> マーカーを追加する
 *   （inject-section.jsがこの区間に技能详细セクションを差し込む）。
 * - 既にKAMIHIME:DETAILマーカーが存在する場合は「既に処理済み」として何もしない（冪等性）。
 *
 * 使い方:
 *   node scripts/wrap-legacy-review.js <mdPath> <key>
 * 例:
 *   node scripts/wrap-legacy-review.js hime/water.md water
 */
'use strict';
const fs = require('fs');
const path = require('path');

function main() {
  const [mdPathArg, key] = process.argv.slice(2);
  if (!mdPathArg || !key) {
    console.error('Usage: node wrap-legacy-review.js <mdPath> <key>');
    process.exit(1);
  }
  const mdPath = path.resolve(mdPathArg);
  const content = fs.readFileSync(mdPath, 'utf-8');

  const startMarker = `<!-- KAMIHIME:DETAIL:${key}:START -->`;
  if (content.includes(startMarker)) {
    console.error(`既に処理済み（${startMarker} が存在） -> ${mdPath} をスキップ`);
    return;
  }

  const lines = content.split('\n');
  const firstHeadingIdx = lines.findIndex((l) => l.startsWith('### '));
  if (firstHeadingIdx === -1) {
    console.error(`"### "見出しが見つかりません -> ${mdPath}`);
    process.exit(1);
  }

  const introLines = lines.slice(0, firstHeadingIdx);
  const bodyLines = lines.slice(firstHeadingIdx).map((l) =>
    l.startsWith('### ') ? `${l} <!-- {docsify-ignore} -->` : l
  );
  const headingCount = bodyLines.filter((l) => l.startsWith('### ')).length;

  const out = [];
  out.push(...introLines);
  // introLinesの末尾に既に空行があってもなくても、区切りを1つ入れる
  if (out.length && out[out.length - 1].trim() !== '') out.push('');
  out.push('<details>');
  out.push('<summary>📜 旧神姫簡評（クリックで表示）</summary>');
  out.push('');
  out.push(...bodyLines);
  out.push('');
  out.push('</details>');
  out.push('');
  out.push('---');
  out.push('');
  out.push(startMarker);
  out.push(`<!-- KAMIHIME:DETAIL:${key}:END -->`);
  out.push('');

  fs.writeFileSync(mdPath, out.join('\n'), 'utf-8');
  console.error(`OK: ${headingCount}件の見出しを折りたたみ化 -> ${mdPath}`);
}

main();
