#!/usr/bin/env node
/**
 * 真化・覚醒キャラ（characters.trueform.json）を属性ごとに振り分け、
 * 各属性用のフラグメントMarkdownを生成する。
 * 属性の判定結果は本スクリプト内にハードコードする（仕様書3.3節の判定手順を適用した結果）。
 * イシス[神化覚醒]・女媧[神化覚醒] は属性を確定できなかったため、要確認として出力する。
 *
 * 使い方: node scripts/split-trueform.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ATTR_MAP = {
  'フルーレティ［神想真化］': 'water',
  'メタトロン［神想真化］': 'light',
  'ハデス［神想真化］': 'dark',
  'アテナ［神想真化］': 'thunder',
  'タナトス［神想真化］': 'dark',
  '妲己［神想真化］': 'fire',
  'ヴィシュヌ［神想真化］': 'light',
  'ユースティティア［神想真化］': 'thunder',
  'アーシラト[神想真化]': 'water',
  'クー・フーリン［神想真化］': 'wind',
  'アマテラス［神想真化］': 'fire',
  'アモン［神想真化］': 'dark',
  'アルテミス［神想真化］': 'light',
  'バアル［神想真化］': 'thunder',
  'キュベレー［神想真化］': 'wind',
  'ニケ［神想真化］': 'water',
  'ミネルヴァ[神化覚醒]': 'fire',
  'ユピテル[神化覚醒]': 'wind',
  'カーリー[神化覚醒]': 'dark',
  // 以下2体は属性未確定（要確認）。ATTR_MAPに含めず、UNRESOLVEDに列挙する。
};
const UNRESOLVED = ['イシス[神化覚醒]', '女媧[神化覚醒]'];

const dataDir = path.join(__dirname, '..', 'docs', 'spec', 'data');
const imagesDir = path.join(__dirname, '..', 'hime', 'images', 'trueform');
const mapping = JSON.parse(fs.readFileSync(path.join(imagesDir, '_mapping.json'), 'utf-8'));
const imageByName = {};
for (const m of mapping) imageByName[m.name] = `images/trueform/${m.file}`;

const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'characters.trueform.json'), 'utf-8'));

const byAttr = {};
const unresolvedChars = [];
for (const char of data.characters) {
  if (UNRESOLVED.includes(char.name)) {
    unresolvedChars.push(char.name);
    continue;
  }
  const attr = ATTR_MAP[char.name];
  if (!attr) {
    console.error(`未定義のキャラ（ATTR_MAPに追加してください）: ${char.name}`);
    process.exit(1);
  }
  const withImage = { ...char, image: imageByName[char.name] || null };
  (byAttr[attr] = byAttr[attr] || []).push(withImage);
}

for (const [attr, chars] of Object.entries(byAttr)) {
  const outPath = path.join(dataDir, `characters.${attr}.trueform-subset.json`);
  fs.writeFileSync(outPath, JSON.stringify({ characters: chars }, null, 2), 'utf-8');
  console.error(`${attr}: ${chars.length}体 -> ${outPath}`);
}

console.error(`未確定（要確認、出力対象外）: ${unresolvedChars.join(', ')}`);
