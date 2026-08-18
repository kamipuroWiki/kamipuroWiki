#!/usr/bin/env node
/**
 * 神姬云测评（翻訳版）xls → 中間JSON 変換スクリプト
 *
 * 仕様: docs/spec/神姬云测评データ統合_要件定義書_仕様書.md 5.5節
 *
 * 使い方:
 *   node scripts/parse-kamihime-xls.js <xlsPath> <sheetName> <outputJsonPath>
 *
 * 例:
 *   node scripts/parse-kamihime-xls.js "../神姬云测评-翻译版(20260716）.xls" 火属性 docs/spec/data/characters.fire.raw.json
 *
 * 対応シート: 属性6シート（火属性/水属性/风属性/雷属性/光属性/暗属性）、英灵シート。
 * 未対応（Phase2以降で対応予定）: 真化·觉醒シート（素材消耗行の特殊レイアウト）、武器效果量シート（別構造）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', '..', 'node_modules', 'xlsx'));

function isEmptyRow(row) {
  return row.every((c) => (c || '').toString().trim() === '');
}

/**
 * 属性シート／英霊シートを1キャラ=1ブロックとしてパースする。
 * ブロック構造:
 *   [キャラ名]                       (col0)
 *   (任意) 総評コメント               (col1)
 *   技能详细 | 持续 | CD              (ヘッダ行、col1 === '技能详细')
 *   B特效 / ■技能N / 被动N / 专武效果 | 详细 | 持续 | CD  (col0=ラベル, col1=本文, col2=持続, col3=CD)
 *   [空行] → 次のブロックへ
 */
function parseAttributeSheet(rows) {
  const characters = [];
  const unmatched = []; // 要確認: ヘッダ行を見つけられなかった見出し候補行
  let i = 0;

  while (i < rows.length) {
    if (isEmptyRow(rows[i])) {
      i++;
      continue;
    }
    const row = rows[i];
    const col0 = (row[0] || '').toString().trim();
    const col1 = (row[1] || '').toString().trim();
    const isLabelRow = /^(■|被动|B特效|专武效果)/.test(col0);

    if (!isLabelRow && col0 !== '') {
      // 直後〜2行先に「技能详细」ヘッダがあるか探索（間に総評コメント行が挟まる場合がある）。
      // 一部のブロックではマージセルの都合でC1列の「技能详细」文字が欠落することがあるため、
      // C2列=「持续」かつC3列=「CD」というより頑健な判定もフォールバックとして併用する。
      let headerOffset = -1;
      for (let j = 1; j <= 3 && i + j < rows.length; j++) {
        const r = rows[i + j];
        const c1 = (r[1] || '').toString().trim();
        const c2 = (r[2] || '').toString().trim();
        const c3 = (r[3] || '').toString().trim();
        if (c1.startsWith('技能详细') || (c2 === '持续' && c3 === 'CD')) {
          headerOffset = j;
          break;
        }
      }

      if (headerOffset !== -1) {
        const name = col0;
        // 名前行〜ヘッダ行の間にある行（総評コメント、または真化·觉醒シート特有の
        // 「消耗真化素材给予强化合计」のような素材ボーナス行）をすべて回収する。
        // 素材ボーナス行はC2列に本文が入る（総評コメントはC1列のみ）ので、その有無で区別する。
        let summaryZh = '';
        let materialZh = '';
        for (let k = i + 1; k < i + headerOffset; k++) {
          const r = rows[k];
          const rc1 = (r[1] || '').toString().trim();
          const rc2 = (r[2] || '').toString().trim();
          if (rc2) {
            materialZh += (materialZh ? '\n' : '') + (rc1 ? `${rc1}：${rc2}` : rc2);
          } else if (rc1) {
            summaryZh += (summaryZh ? '\n' : '') + rc1;
          }
        }
        let idx = i + 1 + headerOffset; // ヘッダ行の次（i+1〜ヘッダ行まで全てスキップ）

        const skillRows = [];
        while (idx < rows.length && !isEmptyRow(rows[idx])) {
          const r = rows[idx];
          const label = (r[0] || '').toString().trim();
          const detail = (r[1] || '').toString().trim();
          const duration = (r[2] || '').toString().trim();
          const cd = (r[3] || '').toString().trim();
          if (label || detail) {
            skillRows.push({ label, zh: detail, ja: '', duration, cd });
          }
          idx++;
        }

        const character = {
          name,
          isTrueForm: false,
          nameRow: i, // sheet_to_json配列上の0-indexed行番号（画像抽出時の行アンカー突き合わせに使う）
          summary: { zh: summaryZh, ja: '' },
          rows: skillRows,
        };
        if (materialZh) {
          character.material = { zh: materialZh, ja: '' }; // 真化·觉醒の素材ボーナス（該当キャラのみ）
        }
        characters.push(character);
        i = idx;
        continue;
      } else {
        // ヘッダが見つからない見出し候補行 → 要確認リストへ
        unmatched.push({ row: i, col0 });
      }
    }
    i++;
  }

  return { characters, unmatched };
}

function main() {
  const [, , xlsPathArg, sheetName, outPathArg] = process.argv;
  if (!xlsPathArg || !sheetName) {
    console.error('Usage: node parse-kamihime-xls.js <xlsPath> <sheetName> [outputJsonPath]');
    process.exit(1);
  }
  const xlsPath = path.resolve(process.cwd(), xlsPathArg);
  const wb = XLSX.readFile(xlsPath);
  if (!wb.SheetNames.includes(sheetName)) {
    console.error(`シート "${sheetName}" が見つかりません。利用可能: ${wb.SheetNames.join(', ')}`);
    process.exit(1);
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const { characters, unmatched } = parseAttributeSheet(rows);

  const result = {
    sourceFile: path.basename(xlsPath),
    sheetName,
    parsedAt: null, // 生成時に呼び出し側で埋める（Date.now系はスクリプト外で付与）
    characterCount: characters.length,
    characters,
    unmatched,
  };

  const json = JSON.stringify(result, null, 2);
  if (outPathArg) {
    const outPath = path.resolve(process.cwd(), outPathArg);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, 'utf-8');
    console.error(`Wrote ${characters.length} characters (unmatched: ${unmatched.length}) -> ${outPath}`);
  } else {
    process.stdout.write(json);
  }
}

main();
