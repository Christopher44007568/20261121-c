"""OBJ/MTL reading and writing for position-welded corner-attribute meshes."""

from __future__ import annotations

import os

import numpy as np

from .mesh import Mesh

WELD_GRID = 1e-9


def _weld_key(p: np.ndarray) -> tuple:
    return tuple(np.round(p / WELD_GRID).astype(np.int64))


def build_mesh(raw_verts, raw_uv, raw_faces, face_mats, face_parts,
               materials, parts, name="mesh") -> Mesh:
    """Weld positions; keep one UV pair per face corner."""
    raw_verts = np.asarray(raw_verts, dtype=np.float64)
    index_map = {}
    positions = []
    faces = []
    for tri in raw_faces:
        out = []
        for vi in tri:
            key = _weld_key(raw_verts[vi])
            if key not in index_map:
                index_map[key] = len(positions)
                positions.append(raw_verts[vi])
            out.append(index_map[key])
        faces.append(out)
    positions = np.asarray(positions, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int32)
    corner_uv = np.zeros((len(faces), 3, 2), dtype=np.float64)
    for fi, tri in enumerate(raw_faces):
        for s, vi in enumerate(tri):
            corner_uv[fi, s] = raw_uv[vi] if raw_uv is not None else (0.0, 0.0)
    return Mesh(
        positions=positions,
        faces=faces,
        corner_uv=corner_uv,
        face_mat=np.asarray(face_mats, dtype=np.int32),
        face_part=np.asarray(face_parts, dtype=np.int32),
        materials=list(materials),
        parts=list(parts),
        name=name,
    )


def load_obj(path: str, name: str | None = None) -> Mesh:
    raw_verts, raw_uv = [], []
    raw_faces, corner_uv_src, face_mats, face_parts = [], [], [], []
    mat_index, part_index = {}, {}
    cur_mat, cur_part = 0, 0
    part_token = os.path.splitext(os.path.basename(path))[0]
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("v "):
                raw_verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                tok = line.split()
                raw_uv.append([float(tok[1]), float(tok[2])])
            elif line.startswith("usemtl "):
                m = line.split(maxsplit=1)[1].strip()
                if m not in mat_index:
                    mat_index[m] = len(mat_index)
                cur_mat = mat_index[m]
            elif line.startswith("o ") or line.startswith("g "):
                g = line.split(maxsplit=1)[1].strip()
                if g not in part_index:
                    part_index[g] = len(part_index)
                cur_part = part_index[g]
            elif line.startswith("f "):
                idx = []
                uv_idx = []
                for tok in line.split()[1:]:
                    parts = tok.split("/")
                    idx.append(int(parts[0]) - 1)
                    uv_idx.append(int(parts[1]) - 1
                                  if len(parts) > 1 and parts[1] else -1)
                if len(idx) != 3:
                    raise ValueError("only triangle faces are supported")
                raw_faces.append(idx)
                corner_uv_src.append(uv_idx)
                face_mats.append(cur_mat)
                face_parts.append(cur_part)
    if not raw_uv:
        raw_uv = np.zeros((len(raw_verts), 2))
    else:
        raw_uv = np.asarray(raw_uv, dtype=np.float64)
    materials = sorted(mat_index, key=lambda k: mat_index[k]) or ["default"]
    parts = sorted(part_index, key=lambda k: part_index[k]) or [part_token]
    mesh = build_mesh(raw_verts, np.zeros((len(raw_verts), 2)), raw_faces,
                      face_mats, face_parts, materials, parts,
                      name or part_token)
    # restore per-corner UVs after position welding
    for fi, uv_idx in enumerate(corner_uv_src):
        for s, ui in enumerate(uv_idx):
            mesh.corner_uv[fi, s] = raw_uv[ui] if ui >= 0 else (0.0, 0.0)
    return mesh


def _compact_mesh(mesh: Mesh):
    """Return alive geometry with compact vertex ids and split UV vertices."""
    alive_face_ids = np.where(mesh.face_alive)[0]
    used_verts = np.unique(mesh.faces[alive_face_ids])
    remap = -np.ones(mesh.num_vertices, dtype=np.int32)
    remap[used_verts] = np.arange(used_verts.size)
    positions = mesh.positions[used_verts]
    faces_c = remap[mesh.faces[alive_face_ids]]
    uv_c = mesh.corner_uv[alive_face_ids]
    mat_c = mesh.face_mat[alive_face_ids]
    part_c = mesh.face_part[alive_face_ids]
    return positions, faces_c, uv_c, mat_c, part_c


def write_obj(mesh: Mesh, obj_path: str, mtl_name: str | None = None) -> None:
    positions, faces_c, uv_c, mat_c, part_c = _compact_mesh(mesh)
    # One OBJ vt per distinct (position, uv) pair so seams stay split on disk.
    vt_index = {}
    v_out, vt_out, f_out = [], [], []
    for fi, tri in enumerate(faces_c):
        face_tokens = []
        for s, vi in enumerate(tri):
            uv_key = (int(vi), np.round(uv_c[fi, s], 8).tobytes())
            if uv_key not in vt_index:
                vt_index[uv_key] = len(vt_out) + 1
                vt_out.append(uv_c[fi, s])
            face_tokens.append(f"{int(vi) + 1}/{vt_index[uv_key]}")
        f_out.append(face_tokens)
    mtl_name = mtl_name or (mesh.name + ".mtl")
    os.makedirs(os.path.dirname(os.path.abspath(obj_path)), exist_ok=True)
    with open(obj_path, "w", encoding="utf-8") as fh:
        fh.write(f"mtllib {os.path.basename(mtl_name)}\n")
        fh.write(f"o {mesh.name}\n")
        for p in positions:
            fh.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
        for uv in vt_out:
            fh.write(f"vt {uv[0]:.6f} {uv[1]:.6f}\n")
        cur_mat = None
        cur_part = None
        for fi, tokens in enumerate(f_out):
            m = int(mat_c[fi])
            p = int(part_c[fi])
            if p != cur_part:
                fh.write(f"g {mesh.parts[p] if p < len(mesh.parts) else p}\n")
                cur_part = p
                cur_mat = None
            if m != cur_mat:
                name = mesh.materials[m] if m < len(mesh.materials) else str(m)
                fh.write(f"usemtl {name}\n")
                cur_mat = m
            fh.write("f " + " ".join(tokens) + "\n")
    _write_mtl(mesh, os.path.join(os.path.dirname(obj_path),
                                  os.path.basename(mtl_name)))


def _write_mtl(mesh: Mesh, mtl_path: str) -> None:
    palette = [(0.83, 0.32, 0.27), (0.25, 0.45, 0.78), (0.35, 0.7, 0.45),
               (0.85, 0.65, 0.25), (0.6, 0.4, 0.75), (0.4, 0.7, 0.75)]
    with open(mtl_path, "w", encoding="utf-8") as fh:
        for i, name in enumerate(mesh.materials):
            r, g, b = palette[i % len(palette)]
            fh.write(f"newmtl {name}\n")
            fh.write(f"Kd {r:.3f} {g:.3f} {b:.3f}\n")
            fh.write("Ka 0.100 0.100 0.100\nKs 0.050 0.050 0.050\n\n")
