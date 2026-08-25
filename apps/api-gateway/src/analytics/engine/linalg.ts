/**
 * WineOps Analytics Engine — small dense linear algebra.
 *
 * Just enough matrix math for closed-form ridge/OLS regression (normal
 * equations) without pulling in a numeric library. Sizes here are tiny
 * (features ≤ a few dozen), so O(n³) Gaussian elimination is ideal.
 */

/** Transpose an m×n matrix. */
export function transpose(A: number[][]): number[][] {
  if (A.length === 0) return [];
  const m = A.length;
  const n = A[0].length;
  const T: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  return T;
}

/** Matrix product A(m×k) · B(k×n). */
export function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const k = A[0]?.length ?? 0;
  const n = B[0]?.length ?? 0;
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < n; j++) C[i][j] += a * B[p][j];
    }
  }
  return C;
}

/** Matrix–vector product A(m×n) · x(n). */
export function matVec(A: number[][], x: number[]): number[] {
  return A.map((row) => {
    let s = 0;
    for (let j = 0; j < row.length; j++) s += row[j] * x[j];
    return s;
  });
}

/**
 * Solve A·x = b for square A via Gaussian elimination with partial pivoting.
 * Returns null if A is singular (pivot ~0). Mutates copies, not inputs.
 */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  if (n === 0 || A.some((r) => r.length !== n) || b.length !== n) return null;
  // augmented copy
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // partial pivot
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    // eliminate below
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // back-substitute
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/** n×n identity. */
export function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}
