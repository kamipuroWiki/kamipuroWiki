#!/usr/bin/env python3
"""
神姬云测评（翻訳版）xls から、指定シートのキャラ立ち絵（埋め込み画像）を抽出するスクリプト。

古い.xls（BIFF8/OLE2）は埋め込み画像がBIFFレコードの中に分断格納されているため、
単純なバイト列コピーでは画像が壊れる（CRC不一致で確認済み）。
このスクリプトはCONTINUEレコードを正しく結合してから、Escher（MS-ODRAW）構造を
辿って画像本体（BSE = Blip Store Entry）と、各シート上の図形のセル位置（行番号）
を突き合わせ、行番号の昇順（= キャラの出現順、characters.*.jsonと同じ順）で
01.png, 02.png ... として保存する。

依存: olefile（未インストールならスクリプト実行前に
  `python3 -m pip install --user --break-system-packages olefile` が必要）

キャラとの対応付けは「出現順の単純な位置合わせ」ではなく、各キャラの見出し行番号
（parse-kamihime-xls.jsが出力する中間JSONの`nameRow`、0-indexed）+1 と画像の行アンカー
（row1）を厳密に一致させる方式にしている。属性シートには時々、キャラ立ち絵ではない
装飾画像（効果量早見表の図など）が別の行に埋め込まれていることがあり、単純な出現順
zipではズレる（水属性で実際に検出・修正済み）。

使い方:
  python3 scripts/extract-images.py <xlsPath> <sheetName> <outputDir> <rawJsonPath>
"""
import sys
import os
import struct
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import olefile
from escher import extract_bse_images, extract_shape_anchors_and_blips

CONTINUE = 0x003C
BOF = 0x0809
EOF = 0x000A
MSODRAWINGGROUP = 0x00EB
MSODRAWING = 0x00EC


def dechunk_biff(wb_stream):
    """BIFFレコードを走査し、CONTINUE(0x3C)レコードを直前のレコードに結合する。"""
    logical_records = []
    pos = 0
    n = len(wb_stream)
    cur_type = None
    cur_data = None
    while pos + 4 <= n:
        rtype = struct.unpack_from("<H", wb_stream, pos)[0]
        rlen = struct.unpack_from("<H", wb_stream, pos + 2)[0]
        data = wb_stream[pos + 4: pos + 4 + rlen]
        pos += 4 + rlen
        if rtype == CONTINUE and cur_data is not None:
            cur_data += data
        else:
            if cur_type is not None:
                logical_records.append((cur_type, cur_data))
            cur_type = rtype
            cur_data = bytearray(data)
    if cur_type is not None:
        logical_records.append((cur_type, cur_data))
    return logical_records


def split_sections(logical_records):
    """BOF..EOFのブロック単位に分割する。sections[0]はワークブック全体のglobals、
    sections[1]以降がwb.SheetNamesの順（sheet_to_jsonのシート順）と対応する。"""
    sections = []
    cur = None
    for rtype, data in logical_records:
        if rtype == BOF:
            cur = {"records": []}
        if cur is not None:
            cur["records"].append((rtype, data))
        if rtype == EOF and cur is not None:
            sections.append(cur)
            cur = None
    return sections


def main():
    if len(sys.argv) != 5:
        print("Usage: python3 extract-images.py <xlsPath> <sheetName> <outputDir> <rawJsonPath>", file=sys.stderr)
        sys.exit(1)
    xls_path, sheet_name, out_dir, raw_json_path = sys.argv[1:5]
    os.makedirs(out_dir, exist_ok=True)

    with open(raw_json_path, encoding="utf-8") as f:
        raw = json.load(f)
    characters = raw["characters"]
    if any("nameRow" not in c for c in characters):
        print("raw JSONにnameRowが無い古い形式です。parse-kamihime-xls.jsを再実行してください。", file=sys.stderr)
        sys.exit(1)

    # openpyxl/xlsxのSheetNames順を再現するため、node側で得たシート名リストが必要。
    # ここではNode側のxlsxライブラリと同じ順序をolefileのBOUNDSHEETレコードから素直に復元する。
    ole = olefile.OleFileIO(xls_path)
    wb_stream = ole.openstream("Workbook").read()
    logical_records = dechunk_biff(wb_stream)
    sections = split_sections(logical_records)

    # シート名はNode(xlsx)側から渡してもらう方式にする（BOUNDSHEETの文字コード処理が煩雑なため）。
    sheet_names_json = os.environ.get("KH_SHEET_NAMES")
    if not sheet_names_json:
        print("環境変数 KH_SHEET_NAMES にシート名リスト(JSON配列)を渡してください", file=sys.stderr)
        sys.exit(1)
    sheet_names = json.loads(sheet_names_json)
    if sheet_name not in sheet_names:
        print(f"シート '{sheet_name}' が見つかりません: {sheet_names}", file=sys.stderr)
        sys.exit(1)
    section_idx = 1 + sheet_names.index(sheet_name)  # sections[0]はglobals
    if section_idx >= len(sections):
        print("対応するBOF..EOFセクションが見つかりません", file=sys.stderr)
        sys.exit(1)

    dgg_data = bytearray()
    for rtype, data in logical_records:
        if rtype == MSODRAWINGGROUP:
            dgg_data += data
    bse_images = extract_bse_images(bytes(dgg_data))

    target_section = sections[section_idx]
    sheet_drawing_data = bytearray()
    for rtype, data in target_section["records"]:
        if rtype == MSODRAWING:
            sheet_drawing_data += data
    anchors = extract_shape_anchors_and_blips(bytes(sheet_drawing_data))

    # row1 -> (kind, bytes) の候補一覧を作る（1つのrow1に複数候補があれば最初のものを使う）
    by_row1 = {}
    extra_count = 0
    for row1, pib in anchors:
        if row1 is None or pib is None:
            continue
        if pib < 1 or pib > len(bse_images) or bse_images[pib - 1] is None:
            continue
        kind, img_bytes = bse_images[pib - 1]
        by_row1.setdefault(row1, []).append((kind, img_bytes))

    # 各キャラの見出し行(nameRow, 0-indexed) + 1 〜 +3 の範囲で一致する画像を探す。
    # 範囲内で複数の行に画像がある場合は最も近い行を採用する。
    out_mapping = []
    missing = []
    used_row1 = set()
    for i, char in enumerate(characters):
        name_row = char["nameRow"]
        candidate_row1 = None
        for offset in (1, 2, 3):
            r = name_row + offset
            if r in by_row1:
                candidate_row1 = r
                break
        idx = i + 1
        if candidate_row1 is None:
            missing.append(char["name"])
            continue
        used_row1.add(candidate_row1)
        kind, img_bytes = by_row1[candidate_row1][0]
        fname = f"{idx:02d}.{kind}"
        with open(os.path.join(out_dir, fname), "wb") as f:
            f.write(img_bytes)
        out_mapping.append({"index": idx, "name": char["name"], "nameRow": name_row, "row1": candidate_row1, "file": fname})

    extra_count = len([r for r in by_row1 if r not in used_row1])

    with open(os.path.join(out_dir, "_mapping.json"), "w", encoding="utf-8") as f:
        json.dump(out_mapping, f, ensure_ascii=False, indent=2)

    print(f"{len(out_mapping)}枚を抽出 -> {out_dir}（キャラ総数: {len(characters)}、装飾等で除外: {extra_count}）", file=sys.stderr)
    if missing:
        print(f"画像が見つからなかったキャラ（{len(missing)}件）: {', '.join(missing)}", file=sys.stderr)


if __name__ == "__main__":
    main()
