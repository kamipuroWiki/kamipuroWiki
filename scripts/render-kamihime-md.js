#!/usr/bin/env node
/**
 * 中間JSON（中日併記済み）→ 技能详细セクション（Markdownフラグメント）生成スクリプト。
 * 仕様: docs/spec/神姬云测评データ統合_要件定義書_仕様書.md 5.2節
 *
 * 出力は「フラグメント」（ページ全体ではなく技能详细セクションのみ）。
 * 簡評ページ（hime/<属性>.md）に scripts/inject-section.js でマーカーコメントの
 * 間へ差し込む運用（別ページ方式ではなく、同一ページ内セクションとして統合する）。
 *
 * 使い方:
 *   node scripts/render-kamihime-md.js <characters.json> <outputMd> \
 *     --heading "火系" --sourceDate "2026-07-16" --imagesDir "images/fire"
 */
'use strict';
const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      args._.push(a);
    }
  }
  return args;
}

// セル内の\nを<br>に変換（<details>内の平文表示用）
function toHtmlLines(text) {
  return (text || '').split('\n').join('<br>\n');
}

// 総評コメント（blockquote）用: 各行に "> " を付与
function toBlockquote(text) {
  return (text || '')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function renderMeta(row) {
  const parts = [];
  if (row.duration) parts.push(`持続: ${row.duration}`);
  if (row.cd) parts.push(`CD: ${row.cd}`);
  return parts.length ? `（${parts.join(' / ')}）` : '';
}

function renderCharacter(char, imageSrc) {
  const lines = [];
  lines.push(`### ${char.name}`);
  lines.push('');
  if (imageSrc) {
    // カード形式: 立ち絵を左、本文を右に配置（css/default.css の .kh-char 参照）。
    // 画像は生の<img>ではなくMarkdown記法 ![]() で書く。docsifyはgetCurrentPath()を基準に
    // 相対パスを解決する処理をmarkdown-itのimageレンダラーにしか適用しないため、
    // 生の<img src="...">はハッシュルーティングのURL（index.html基準）で解決されて壊れる。
    // 開始/終了タグをそれぞれ空行区切りの独立行にすることで、HTMLブロックの終端がそこで
    // 切れても、ブラウザ側のHTML解釈では最終的に正しくこのdiv内に入れ子になる
    // （docsify/markdown-itの「HTMLブロック内Markdown」の一般的な挙動）。
    lines.push('<div class="kh-char">');
    lines.push('');
    lines.push(`![${char.name}](${imageSrc})`);
    lines.push('');
    lines.push('<div class="kh-char-body">');
    lines.push('');
  }
  if (char.summary && (char.summary.zh || char.summary.ja)) {
    if (char.summary.zh) lines.push(toBlockquote(`🇨🇳 ${char.summary.zh}`));
    if (char.summary.zh && char.summary.ja) lines.push('>');
    if (char.summary.ja) lines.push(toBlockquote(`🇯🇵 ${char.summary.ja}`));
    lines.push('');
  }
  if (char.material && (char.material.zh || char.material.ja)) {
    // 真化に必要な素材ボーナス（該当キャラのみ）
    lines.push('**🔺 真化ボーナス**');
    lines.push('');
    if (char.material.zh) lines.push(`🇨🇳 ${toHtmlLines(char.material.zh)}`);
    lines.push('');
    if (char.material.ja) lines.push(`🇯🇵 ${toHtmlLines(char.material.ja)}`);
    lines.push('');
  }
  lines.push('<details>');
  lines.push('<summary>📊 技能详细を見る</summary>');
  lines.push('');
  for (const row of char.rows) {
    lines.push(`**${row.label}**${renderMeta(row)}`);
    lines.push('');
    if (row.zh) {
      lines.push(`🇨🇳 ${toHtmlLines(row.zh)}`);
      lines.push('');
    }
    if (row.ja) {
      lines.push(`🇯🇵 ${toHtmlLines(row.ja)}`);
      lines.push('');
    }
  }
  lines.push('</details>');
  if (imageSrc) {
    lines.push('');
    lines.push('</div></div>');
  }
  lines.push('');
  return lines.join('\n');
}

function renderPage(data, opts) {
  const lines = [];
  lines.push(`## ${opts.heading}・技能详细`);
  lines.push('');
  lines.push(
    `> 📌 以下は「神姬云测评（翻訳版）」（更新日: ${opts.sourceDate}）を基に自動生成されたセクションです。` +
      '**手動で編集しないでください**（次回データ更新時に上書きされます）。誤訳・記載ミスに気づいた場合はIssueで報告してください。'
  );
  lines.push('');
  data.characters.forEach((char, i) => {
    // char.image が明示的に指定されていれば最優先（真化・覚醒キャラを他属性ページに
    // 追記する場合など、画像フォルダの連番と characters配列の位置が一致しないケース用）。
    const imageSrc = char.image || (opts.imageFor ? opts.imageFor(i) : null);
    lines.push(renderCharacter(char, imageSrc));
  });
  return lines.join('\n');
}

// 画像フォルダ内の "01.png"/"01.jpg" のような连番ファイルを探し、
// 出力Markdownからの相対URL（例: "images/fire/01.png"）を返す関数を作る。
function makeImageResolver(imagesUrlPrefix, imagesFsDir) {
  if (!imagesUrlPrefix || !imagesFsDir) return null;
  const exts = ['png', 'jpg', 'jpeg'];
  return (index) => {
    const num = String(index + 1).padStart(2, '0');
    for (const ext of exts) {
      const fsPath = path.join(imagesFsDir, `${num}.${ext}`);
      if (fs.existsSync(fsPath)) {
        return `${imagesUrlPrefix}/${num}.${ext}`;
      }
    }
    return null;
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [inPathArg, outPathArg] = args._;
  if (!inPathArg || !outPathArg || !args.heading || !args.sourceDate) {
    console.error(
      'Usage: node render-kamihime-md.js <characters.json> <outputFragmentMd> --heading <t> --sourceDate <date> [--imagesDir <relPath>]'
    );
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(path.resolve(inPathArg), 'utf-8'));
  const outPath = path.resolve(outPathArg);
  // imagesDirは出力フラグメントの「差し込み先ページ」から見た相対パスなので、
  // ファイル存在チェックは出力フラグメント自身の場所ではなく差し込み先ディレクトリ
  // （--imagesBaseDirで明示、省略時は出力フラグメントと同じディレクトリ）を基準にする。
  const imagesBaseDir = args.imagesBaseDir ? path.resolve(args.imagesBaseDir) : path.dirname(outPath);
  const imagesFsDir = args.imagesDir ? path.join(imagesBaseDir, args.imagesDir) : null;
  const md = renderPage(data, {
    heading: args.heading,
    sourceDate: args.sourceDate,
    imageFor: makeImageResolver(args.imagesDir, imagesFsDir),
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf-8');
  console.error(`Wrote ${data.characters.length} characters -> ${outPath}`);
}

main();
