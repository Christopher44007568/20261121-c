"""Low-order (3 bands, 9 coefficients) real spherical harmonics.

Convention: real SH, Condon-Shortley sign, directions on the unit sphere
with z = up.  This is the convention used by Sloan's "Stupid SH Tricks":

    Y_0^0 =  1/2 * sqrt(1/pi)
    Y_1^-1 =  y * sqrt(3/(4pi))
    Y_1^0  =  z * sqrt(3/(4pi))
    Y_1^1  =  x * sqrt(3/(4pi))

The 9 basis functions are indexed 0..8 in (l, m) order
(0,0), (1,-1), (1,0), (1,1), (2,-2), (2,-1), (2,0), (2,1), (2,2).
"""

import math

PI = math.pi
N_BANDS = 3
N_COEF = N_BANDS * N_BANDS


def basis(d):
    """Return the 9 SH basis values evaluated at unit direction d=(x,y,z)."""
    x, y, z = d
    x2, y2, z2 = x * x, y * y, z * z
    return [
        0.28209479177387814,
        0.4886025119029199 * y,
        0.4886025119029199 * z,
        0.4886025119029199 * x,
        1.0925484305920792 * x * y,
        1.0925484305920792 * y * z,
        0.31539156525252005 * (3.0 * z2 - 1.0),
        1.0925484305920792 * x * z,
        0.5462742152960396 * (x2 - y2),
    ]


def reconstruct(coefs, d):
    """Evaluate the truncated SH expansion at direction d (per channel)."""
    b = basis(d)
    return [sum(c[i] * b[i] for i in range(N_COEF)) for c in coefs]


def _rotation_band1(R):
    """Rotation of the l=1 vector in SH order -1,0,1 (y,z,x)."""
    # SH order (y,z,x) is cartesian permutation (1,2,0); reorder R directly.
    perm = (1, 2, 0)
    return [[R[perm[r]][perm[c]] for c in range(3)] for r in range(3)]


def rotation_matrix(R):
    """Build the 9x9 block-diagonal SH rotation for 3x3 rotation matrix R.

    l=0 is trivial; l=1 rotates like a vector; l=2 is the rotation of the
    symmetric traceless tensor built from the same five quadratic monomials
    that span the band (xy, yz, 2z^2-x^2-y^2, xz, x^2-y^2).
    """
    M = [[0.0] * N_COEF for _ in range(N_COEF)]
    M[0][0] = 1.0

    r1 = _rotation_band1(R)
    for i in range(3):
        for j in range(3):
            M[1 + i][1 + j] = r1[i][j]

    # Band-2 basis polynomials (constants omitted):
    #   s0=xy, s1=yz, s2=2z^2-x^2-y^2, s3=xz, s4=x^2-y^2.
    # Represent each by the symmetric quadratic-form matrix Q where the
    # polynomial equals v^T Q v (off-diagonal Q entries are therefore half the
    # monomial coefficient).  Rotating v -> R v gives Q' = R Q R^T, which is
    # exact and free of bookkeeping factors of two.
    def basis_matrix(j):
        Q = [[0.0] * 3 for _ in range(3)]
        if j == 0:      # xy
            Q[0][1] = Q[1][0] = 0.5 * 1.0925484305920792
        elif j == 1:    # yz
            Q[1][2] = Q[2][1] = 0.5 * 1.0925484305920792
        elif j == 2:    # 2z^2 - x^2 - y^2
            k = 0.31539156525252005
            Q[0][0] = Q[1][1] = -k
            Q[2][2] = 2.0 * k
        elif j == 3:    # xz
            Q[0][2] = Q[2][0] = 0.5 * 1.0925484305920792
        else:           # x^2 - y^2
            Q[0][0] = 0.5462742152960396
            Q[1][1] = -0.5462742152960396
        return Q

    def project_basis(Q):
        # Invert basis_matrix: divide out each basis polynomial constant.
        return [
            2.0 * Q[0][1] / 1.0925484305920792,
            2.0 * Q[1][2] / 1.0925484305920792,
            Q[2][2] / (2.0 * 0.31539156525252005),
            2.0 * Q[0][2] / 1.0925484305920792,
            (Q[0][0] - Q[1][1]) / (2.0 * 0.5462742152960396),
        ]

    r2 = [[0.0] * 5 for _ in range(5)]
    for j in range(5):
        Q = basis_matrix(j)
        rot = [
            [sum(R[a][i] * Q[i][b] for i in range(3)) for b in range(3)]
            for a in range(3)
        ]
        rot = [
            [sum(rot[a][i] * R[b][i] for i in range(3)) for b in range(3)]
            for a in range(3)
        ]
        coeffs = project_basis(rot)
        for i in range(5):
            r2[i][j] = coeffs[i]
    for i in range(5):
        for j in range(5):
            M[4 + i][4 + j] = r2[i][j]
    return M


def rotate(coefs, M):
    """Apply SH rotation matrix M (per channel)."""
    return [
        [sum(M[i][j] * c[j] for j in range(N_COEF)) for i in range(N_COEF)]
        for c in coefs
    ]


def rotation_axis_angle(axis, angle):
    """Rodrigues' formula: 3x3 rotation about unit axis by angle (radians)."""
    ax, ay, az = axis
    c, s = math.cos(angle), math.sin(angle)
    C = 1.0 - c
    return [
        [c + ax * ax * C, ax * ay * C - az * s, ax * az * C + ay * s],
        [ay * ax * C + az * s, c + ay * ay * C, ay * az * C - ax * s],
        [az * ax * C - ay * s, az * ay * C + ax * s, c + az * az * C],
    ]


def _matmul(A, B):
    n, m, p = len(A), len(B), len(B[0])
    return [[sum(A[i][k] * B[k][j] for k in range(m)) for j in range(p)] for i in range(n)]


# ---------------------------------------------------------------------------
# Analytic reference values used by the convergence/validation tests.
# ---------------------------------------------------------------------------

def _zonal_to_axis(axis, integrals, color):
    """Rotate pole-aligned zonal coefficients onto an arbitrary axis.

    `integrals[l]` is int P_l(t) dt over the signal's polar support (already
    including any signal-specific limits); the pole-aligned m=0 coefficient of
    band l is 2 pi * K_l * integral where K_l is the Y_l^0 normalization.
    The full 9-vector is then obtained with the SH rotation that maps +z onto
    the target axis.
    """
    k_norm = (
        0.28209479177387814,
        0.4886025119029199,
        0.31539156525252005,
    )
    pole_idx = (0, 2, 6)
    pole = [[0.0] * N_COEF for _ in color]
    for ch, v in enumerate(color):
        for band, idx in enumerate(pole_idx):
            pole[ch][idx] = v * 2.0 * PI * k_norm[band] * integrals[band]
    ax, ay, az = axis
    if abs(az - 1.0) < 1e-12:
        return pole
    # Rotation taking +z to axis: rotate about (z x axis) by acos(axis.z).
    nz = math.sqrt(max(0.0, 1.0 - az * az))
    r_axis = (-ay / nz, ax / nz, 0.0)
    angle = math.acos(max(-1.0, min(1.0, az)))
    R = rotation_axis_angle(r_axis, angle)
    M = rotation_matrix(R)
    return rotate(pole, M)

def analytic_constant(value):
    """SH of an everywhere-constant radiance (one value per RGB channel)."""
    coefs = [[0.0] * N_COEF for _ in value]
    for ch, v in enumerate(value):
        coefs[ch][0] = v * 4.0 * PI * 0.28209479177387814
    return coefs


def analytic_zonal_spot(axis, half_angle, color):
    """Analytic SH of a hard-edged uniform cone (a "directional spot").

    A cone of constant radiance `color` around `axis` with polar half-angle
    `half_angle` is a zonal harmonic.  Only m=0 terms are nonzero in the
    frame whose pole is the axis; integral of P_l over [cos a, 1] gives the
    band-l amplitude, which is then redistributed onto the directional basis
    using Y_l^m(d) = sqrt((2l+1)/(4pi)) * P_l .
    """
    u = math.cos(half_angle)
    # Integrals over the cone support in the Y_l^0 = K_l * polynomial
    # convention (polynomials: 1, t, 3t^2-1).
    i0 = 1.0 - u
    i1 = 0.5 * (1.0 - u * u)
    i2 = u - u * u * u          # int_u^1 (3t^2-1) dt = [t^3-t]_u^1
    # A zonal signal L(mu)=color * 1[mu>=u] (mu = dot(d, axis)) has only the
    # m=0 basis aligned with the axis.  Rotating the pole-aligned coefficient
    # onto direction `axis` gives, per band l,
    #   c_l(axis-direction) = 2 pi * (int_u^1 P_l dt) * Y_l^0(axis)
    # where Y_l^0(axis) is the directional basis value at the axis.
    return _zonal_to_axis(axis, (i0, i1, i2), color)


def analytic_hemisphere(top, bottom):
    """Analytic SH for constant color above/below the z=0 horizon.

    Only m=0 terms survive azimuthal integration; values are exact for the
    l=0,1,2 bands.
    """
    # Integrals of the m=0 basis over one hemisphere (solid angle 2 pi):
    #   int_hemi Y00 dOmega = 2 pi Y00
    #   int_hemi Y10 dOmega = sqrt(3/4pi) * pi
    #   int_hemi Y20 dOmega = 0  (P2 integrates to zero on a hemisphere)
    y00 = 0.28209479177387814
    hemi = (2.0 * PI * y00, math.sqrt(3.0 / (4.0 * PI)) * PI, 0.0)
    idx = (0, 2, 6)
    coefs = [[0.0] * N_COEF for _ in top]
    for ch in range(len(top)):
        coefs[ch][idx[0]] = (top[ch] + bottom[ch]) * hemi[0]
        coefs[ch][idx[1]] = (top[ch] - bottom[ch]) * hemi[1]
        coefs[ch][idx[2]] = 0.0
    return coefs


def total_energy(coefs):
    """Integral over the sphere of the reconstructed signal (per channel)."""
    # int Y_0^0 dOmega = sqrt(4 pi); all other basis functions integrate to 0.
    return [c[0] * math.sqrt(4.0 * PI) for c in coefs]


def analytic_soft_spot(axis, exponent, color):
    """Analytic SH of the smooth lobe color * max(dot,0)^exponent.

    Zonal integral I_l = 2 pi int_0^1 t^n P_l(t) dt with
      P0=1, P1=t, P2=(3t^2-1)/2:
      I0 = 2 pi / (n+1)
      I1 = 2 pi / (n+2)
      I2 = 2 pi * (1/(n+3) - 0.5/(n+1))
    Each is projected onto the directional m=0 basis at the axis.
    """
    n = float(exponent)
    i0 = 1.0 / (n + 1.0)
    i1 = 1.0 / (n + 2.0)
    # The helper multiplies the Y_l^0 normalization K_l, where
    # Y20 = K2 (3t^2-1).  The required integral is therefore over the full
    # polynomial (3t^2-1), not over P2=(3t^2-1)/2:
    #   int_0^1 t^n (3t^2-1) dt = 3/(n+3) - 1/(n+1)
    i2 = 3.0 / (n + 3.0) - 1.0 / (n + 1.0)
    return _zonal_to_axis(axis, (i0, i1, i2), color)
