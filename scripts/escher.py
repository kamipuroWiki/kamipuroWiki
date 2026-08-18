import struct

def parse_escher_records(data, start=0, end=None):
    """Walk a flat list of top-level escher records (header+data) within data[start:end].
    Returns list of (recType, recInstance, recVer, payload_bytes, payload_start_abs)."""
    if end is None:
        end = len(data)
    recs = []
    pos = start
    while pos + 8 <= end:
        verInst, recType, recLen = struct.unpack_from("<HHI", data, pos)
        recVer = verInst & 0xF
        recInstance = verInst >> 4
        payload_start = pos + 8
        payload = data[payload_start: payload_start + recLen]
        recs.append((recType, recInstance, recVer, payload, payload_start))
        pos = payload_start + recLen
    return recs


def find_containers(data, start, end, target_type):
    """Recursively search for containers/atoms of target_type within data[start:end]."""
    found = []
    for recType, recInstance, recVer, payload, payload_start in parse_escher_records(data, start, end):
        if recType == target_type:
            found.append((recType, recInstance, recVer, payload, payload_start))
        if recVer == 0xF:  # container -> recurse into its payload
            found.extend(find_containers(data, payload_start, payload_start + len(payload), target_type))
    return found


BSTORE_CONTAINER = 0xF001
FBSE = 0xF007
SP_CONTAINER = 0xF004
FOPT = 0xF00B
FCLIENT_ANCHOR = 0xF010  # msofbtClientAnchor (NOT 0xF00D, which is ClientTextbox)

# Blip type IDs (btWin32 field in FBSE header) -> known signature prefixes
BLIP_SIGNATURES = {
    0xF01A: "PICT",
    0xF01B: "JPEG",
    0xF01C: "PNG",
    0xF01D: "DIB",
    0xF01E: "TIFF",
    0xF01F: "JPEG",
    0xF029: "PNG",
    0xF02A: "JPEG",
}


def extract_bse_images(dgg_data):
    """Return ordered list of raw image bytes (one per FBSE atom) found in the drawing group data."""
    bstores = find_containers(dgg_data, 0, len(dgg_data), BSTORE_CONTAINER)
    images = []
    for _, _, _, bstore_payload, bstore_abs_start in bstores:
        for recType, recInstance, recVer, payload, _ in parse_escher_records(
            dgg_data, bstore_abs_start, bstore_abs_start + len(bstore_payload)
        ):
            if recType != FBSE:
                continue
            # OfficeArtBSE header = 36 bytes:
            # btWin32(1) btMacOS(1) rgbUid(16) tag(2) size(4) cRef(4) foDelay(4) usage(1) cbName(1) unused2(1) unused3(1)
            if len(payload) < 36:
                images.append(None)
                continue
            btWin32 = payload[0]
            header_len = 36
            blip_data = payload[header_len:]
            # The embedded OfficeArtBlip itself has a small header before the raw image bytes:
            # for most raster blips: rgbUid(16) [+ an extra rgbUid if instance has 2 uids] + tag(1) then image bytes.
            # Simplest robust approach: search for known raster signatures inside blip_data directly.
            img_bytes = None
            sig_positions = {
                b"\x89PNG\r\n\x1a\n": "png",
                b"\xff\xd8\xff": "jpg",
            }
            best_pos = None
            best_kind = None
            for sig, kind in sig_positions.items():
                p = blip_data.find(sig)
                if p != -1 and (best_pos is None or p < best_pos):
                    best_pos = p
                    best_kind = kind
            if best_pos is not None:
                img_bytes = (best_kind, blip_data[best_pos:])
            images.append(img_bytes)
    return images


def extract_shape_anchors_and_blips(sheet_data_concat):
    """Within a sheet's concatenated MSODRAWING escher bytes, find each SpContainer's
    (row1 anchor, pib blip index). Returns list of (row1, pib) in document order."""
    return _scan_sp_containers(sheet_data_concat, 0, len(sheet_data_concat))


def _scan_sp_containers(data, start, end):
    results = []
    for recType, recInstance, recVer, payload, abs_start in parse_escher_records(data, start, end):
        if recType == SP_CONTAINER:
            row1 = None
            pib = None
            for r2type, r2inst, r2ver, r2payload, r2abs in parse_escher_records(
                data, abs_start, abs_start + len(payload)
            ):
                if r2type == FCLIENT_ANCHOR and len(r2payload) >= 18:
                    flag, col1, dx1, row1_, dy1, col2, dx2, row2, dy2 = struct.unpack_from(
                        "<HHHHHHHHH", r2payload, 0
                    )
                    row1 = row1_
                elif r2type == FOPT:
                    pib = _find_pib(r2payload, r2inst)
            results.append((row1, pib))
        if recVer == 0xF:
            results.extend(_scan_sp_containers(data, abs_start, abs_start + len(payload)))
    return results


def _find_pib(fopt_payload, prop_count):
    # FOPT payload's property table is exactly `prop_count` fixed 6-byte entries
    # (UINT16 id_and_flags, UINT32 value); complex property extra data, if any,
    # follows the table and must NOT be walked as if it were more entries.
    pos = 0
    n = min(len(fopt_payload), prop_count * 6)
    while pos + 6 <= n:
        id_and_flags, value = struct.unpack_from("<HI", fopt_payload, pos)
        prop_id = id_and_flags & 0x3FFF
        if prop_id == 0x0104:  # pib
            return value
        pos += 6
    return None
