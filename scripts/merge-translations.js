#!/usr/bin/env node
/**
 * 中間JSON（zhのみ）と翻訳データ（ja）をキャラ名でマッチングして結合するスクリプト。
 * 行数が一致しない場合はエラーとして報告し、マージを中断する（誤対応防止）。
 *
 * 使い方:
 *   node scripts/merge-translations.js <raw.json> <translations.json> <out.json>
 */
'use strict';
const path = require('path');
const fs = require('fs');

function main() {
  const [, , rawPathArg, transPathArg, outPathArg] = process.argv;
  if (!rawPathArg || !transPathArg || !outPathArg) {
    console.error('Usage: node merge-translations.js <raw.json> <translations.json> <out.json>');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(path.resolve(rawPathArg), 'utf-8'));
  const translations = JSON.parse(fs.readFileSync(path.resolve(transPathArg), 'utf-8'));

  const errors = [];
  const missingTranslation = [];

  for (const char of raw.characters) {
    const t = translations[char.name];
    if (!t) {
      missingTranslation.push(char.name);
      continue;
    }
    if (char.summary.zh && !t.summaryJa) {
      errors.push(`[${char.name}] summaryJaが空です（zhは存在）`);
    }
    char.summary.ja = t.summaryJa || '';

    if (char.material) {
      if (char.material.zh && !t.materialJa) {
        errors.push(`[${char.name}] materialJaが空です（zhは存在）`);
      }
      char.material.ja = t.materialJa || '';
    }

    if (t.rowsJa.length !== char.rows.length) {
      errors.push(
        `[${char.name}] 行数不一致: raw=${char.rows.length}行, translations=${t.rowsJa.length}行`
      );
      continue;
    }
    char.rows.forEach((row, idx) => {
      row.ja = t.rowsJa[idx];
    });
  }

  if (missingTranslation.length) {
    console.error('翻訳データが見つからないキャラ:', missingTranslation.join(', '));
  }
  if (errors.length) {
    console.error('--- マージエラー ---');
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }

  fs.writeFileSync(path.resolve(outPathArg), JSON.stringify(raw, null, 2), 'utf-8');
  console.error(`OK: ${raw.characters.length}キャラをマージ -> ${outPathArg}`);
}

main();
