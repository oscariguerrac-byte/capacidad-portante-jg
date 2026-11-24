/* Motor de cálculo – Capacidad portante de cimentaciones superficiales
 * J.G Laboratorio de Suelos, Concretos y Pavimentos
 * Métodos: Terzaghi (1943), Ecuación general de Meyerhof (1963) con factores
 * de De Beer (1970), Hansen (1970), Vesić (1973) y Meyerhof-Hanna (1981),
 * y Hansen (1970).
 * Unidades: kN, m, kPa, kN/m³, grados.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;
  const GW = 9.81; // kN/m³

  /* ---------- Geometría efectiva (Meyerhof 1953: B' = B − 2e) ---------- */
  function geometria(p) {
    const avisos = [];
    let B = p.B, L = p.L, eB = p.eB || 0, eL = p.eL || 0;
    if (p.tipo === 'corrida') { L = Infinity; eL = 0; }
    if (p.tipo === 'cuadrada') { L = B; }
    if (p.tipo === 'circular') {
      L = B;
      if (eB || eL) avisos.push('La excentricidad no se aplica en zapatas circulares (se ignoró).');
      eB = 0; eL = 0;
    }
    if (p.tipo === 'rectangular' && L < B) {
      avisos.push('L < B: se intercambiaron las dimensiones (B es el lado menor).');
      [B, L] = [L, B]; [eB, eL] = [eL, eB];
    }
    if (eB > B / 6) avisos.push('eB > B/6: parte de la base queda en tracción.');
    if (isFinite(L) && eL > L / 6) avisos.push('eL > L/6: parte de la base queda en tracción.');
    let Bp = B - 2 * eB;
    let Lp = isFinite(L) ? L - 2 * eL : Infinity;
    if (Lp < Bp) [Bp, Lp] = [Lp, Bp];
    const r = p.tipo === 'corrida' ? 0 : Bp / Lp;
    const A = p.tipo === 'corrida' ? Bp : (p.tipo === 'circular' ? Math.PI * B * B / 4 : Bp * Lp);
    const valido = Bp > 0 && (!isFinite(Lp) || Lp > 0) && B > 0;
    if (!valido) avisos.push('Dimensiones efectivas no válidas (revise B, L y excentricidades).');
    return { B, L, eB, eL, Bp, Lp, r, A, valido, avisos };
  }

  /* ---------- Nivel freático (Das, Principles of Foundation Engineering) ---------- */
  function freatico(p, Bref) {
    const gsub = p.gsat - GW;
    if (!p.nfOn || p.Dw >= p.Df + Bref) {
      return { q: p.g * p.Df, g3: p.g, gsub, caso: 3 };
    }
    if (p.Dw <= p.Df) {
      const Dw = Math.max(0, p.Dw);
      return { q: p.g * Dw + gsub * (p.Df - Dw), g3: gsub, gsub, caso: 1 };
    }
    const d = p.Dw - p.Df;
    return { q: p.g * p.Df, g3: gsub + (d / Bref) * (p.g - gsub), gsub, caso: 2 };
  }

  /* ---------- Factores de capacidad ---------- */
  function NqReissner(phi) { // Reissner (1924)
    if (phi === 0) return 1;
    const t = Math.tan(phi * D2R);
    return Math.exp(Math.PI * t) * Math.pow(Math.tan((45 + phi / 2) * D2R), 2);
  }
  function NcPrandtl(phi, Nq) { // Prandtl (1921)
    return phi === 0 ? 5.14 : (Nq - 1) / Math.tan(phi * D2R);
  }
  function kProf(Df, B) { // Hansen (1970): Df/B ≤ 1 → Df/B ; > 1 → arctan(Df/B) [rad]
    const x = Df / B;
    return x <= 1 ? x : Math.atan(x);
  }

  /* ---------- Terzaghi (1943) ---------- */
  function terzaghi(p, c, phi, G, W) {
    const out = { metodo: 'Terzaghi', avisos: [] };
    if (p.beta > 0) {
      out.ok = false;
      out.msg = 'Terzaghi no considera carga inclinada (β > 0).';
      return out;
    }
    if (p.Df > p.B) out.avisos.push('Df > B: Terzaghi se formuló para Df ≤ B.');
    const t = Math.tan(phi * D2R);
    let Nq, Nc, Ng;
    if (phi === 0) { Nq = 1; Nc = 5.7; Ng = 0; }
    else {
      const a = Math.exp((0.75 * Math.PI - phi * D2R / 2) * t);
      Nq = a * a / (2 * Math.pow(Math.cos((45 + phi / 2) * D2R), 2));
      Nc = (Nq - 1) / t;
      Ng = 2 * (Nq + 1) * t / (1 + 0.4 * Math.sin(4 * phi * D2R)); // Coduto (2001)
    }
    let sc = 1, sg = 1;
    if (p.tipo === 'cuadrada') { sc = 1.3; sg = 0.8; }
    else if (p.tipo === 'circular') { sc = 1.3; sg = 0.6; }
    else if (p.tipo === 'rectangular') { sc = 1 + 0.3 * G.r; sg = 1 - 0.2 * G.r; }
    const t1 = c * Nc * sc, t2 = W.q * Nq, t3 = 0.5 * W.g3 * G.Bp * Ng * sg;
    Object.assign(out, {
      ok: true, forma: 'general',
      N: { c: Nc, q: Nq, g: Ng },
      s: { c: sc, q: 1, g: sg }, d: { c: 1, q: 1, g: 1 }, i: { c: 1, q: 1, g: 1 },
      terms: [t1, t2, t3], qu: t1 + t2 + t3
    });
    return out;
  }

  /* ---------- Ecuación general – Meyerhof (1963) / Vesić / De Beer / Hansen ---------- */
  function meyerhof(p, c, phi, G, W) {
    const out = { metodo: 'Meyerhof (ecuación general)', avisos: [] };
    const t = Math.tan(phi * D2R), sn = Math.sin(phi * D2R);
    const Nq = NqReissner(phi), Nc = NcPrandtl(phi, Nq);
    const Ng = 2 * (Nq + 1) * t; // Vesić (1973)
    const r = G.r;
    const s = { c: 1 + r * Nq / Nc, q: 1 + r * t, g: 1 - 0.4 * r }; // De Beer (1970)
    const k = kProf(p.Df, G.B);
    let d;
    if (phi === 0) d = { c: 1 + 0.4 * k, q: 1, g: 1 };
    else {
      const dq = 1 + 2 * t * Math.pow(1 - sn, 2) * k;
      d = { c: dq - (1 - dq) / (Nc * t), q: dq, g: 1 };
    }
    const b = p.beta;
    const ic = Math.pow(1 - b / 90, 2);
    let ig = 1;
    if (phi > 0) ig = b >= phi ? 0 : Math.pow(1 - b / phi, 2);
    if (phi > 0 && b >= phi) out.avisos.push('β ≥ φ: el término de peso propio se anula (Fγi = 0).');
    const i = { c: ic, q: ic, g: ig };
    const t1 = c * Nc * s.c * d.c * i.c;
    const t2 = W.q * Nq * s.q * d.q * i.q;
    const t3 = 0.5 * W.g3 * G.Bp * Ng * s.g * d.g * i.g;
    Object.assign(out, {
      ok: true, forma: 'general', k,
      N: { c: Nc, q: Nq, g: Ng }, s, d, i,
      terms: [t1, t2, t3], qu: t1 + t2 + t3
    });
    return out;
  }

  /* ---------- Hansen (1970) ---------- */
  function hansen(p, c, phi, G, W) {
    const out = { metodo: 'Hansen', avisos: [] };
    const t = Math.tan(phi * D2R), sn = Math.sin(phi * D2R);
    const Nq = NqReissner(phi), Nc = NcPrandtl(phi, Nq);
    const Ng = 1.5 * (Nq - 1) * t;
    const r = G.r;
    const k = kProf(p.Df, G.B);
    const tb = Math.tan(p.beta * D2R);
    const V = p.V > 0 ? p.V : 0;
    const H = V * tb;

    if (phi === 0) {
      // qu = 5,14·su·(1 + s'c + d'c − i'c) + q
      const scp = 0.2 * r, dcp = 0.4 * k;
      let icp = 0;
      if (p.beta > 0) {
        if (!(V > 0)) {
          out.ok = false;
          out.msg = 'Hansen con φ = 0 y β > 0 requiere la carga vertical V para calcular H.';
          return out;
        }
        const x = H / (G.A * c);
        if (!(c > 0) || x > 1) {
          out.ok = false;
          out.msg = 'H > A′·cₐ: falla por deslizamiento; i′c no está definido.';
          return out;
        }
        icp = 0.5 - 0.5 * Math.sqrt(1 - x);
      }
      const t1 = 5.14 * c * (1 + scp + dcp - icp), t2 = W.q;
      Object.assign(out, {
        ok: true, forma: 'phi0', k,
        N: { c: 5.14, q: 1, g: 0 },
        s: { c: scp, q: 1, g: 1 }, d: { c: dcp, q: 1, g: 1 }, i: { c: icp, q: 1, g: 1 },
        terms: [t1, t2, 0], qu: t1 + t2
      });
      return out;
    }

    const s = { c: 1 + r * Nq / Nc, q: 1 + r * sn, g: Math.max(0.6, 1 - 0.4 * r) };
    const d = { c: 1 + 0.4 * k, q: 1 + 2 * t * Math.pow(1 - sn, 2) * k, g: 1 };
    let i = { c: 1, q: 1, g: 1 };
    if (p.beta > 0) {
      // H/(V + A'·ca·cotφ); sin V se toma H/V = tanβ (omite la adherencia: conservador)
      let ratio;
      if (V > 0) ratio = H / (V + G.A * c / t);
      else {
        ratio = tb;
        if (c > 0) out.avisos.push('Sin V: se omitió A′·cₐ·cotφ en iq e iγ (conservador).');
      }
      const iq = Math.pow(Math.max(0, 1 - 0.5 * ratio), 5);
      const ig = Math.pow(Math.max(0, 1 - 0.7 * ratio), 5);
      const ic = iq - (1 - iq) / (Nq - 1);
      i = { c: Math.max(0, ic), q: iq, g: ig };
    }
    const t1 = c * Nc * s.c * d.c * i.c;
    const t2 = W.q * Nq * s.q * d.q * i.q;
    const t3 = 0.5 * W.g3 * G.Bp * Ng * s.g * d.g * i.g;
    Object.assign(out, {
      ok: true, forma: 'general', k,
      N: { c: Nc, q: Nq, g: Ng }, s, d, i,
      terms: [t1, t2, t3], qu: t1 + t2 + t3
    });
    return out;
  }

  const METODOS = { terzaghi, meyerhof, hansen };
  const NOMBRES = { terzaghi: 'Terzaghi (1943)', meyerhof: 'Meyerhof – ecuación general', hansen: 'Hansen (1970)' };

  /* ---------- Cálculo completo ---------- */
  function calcular(p) {
    const G = geometria(p);
    const res = { G, metodos: {}, avisos: G.avisos.slice() };
    if (!G.valido) return res;
    const W = freatico(p, G.Bp);
    res.W = W;
    // Método directo: FSBM sobre c' y tan φ' (NSR-10 Tabla H.2.4-1)
    const cR = p.c / p.FSBM;
    const phiR = Math.atan(Math.tan(p.phi * D2R) / p.FSBM) / D2R;
    res.cR = cR; res.phiR = phiR;
    let min = Infinity, minKey = null;
    for (const key of Object.keys(METODOS)) {
      if (!p.metodos[key]) continue;
      const est = METODOS[key](p, p.c, p.phi, G, W);
      const m = { key, nombre: NOMBRES[key], est };
      if (est.ok) {
        m.qadmInd = est.qu / p.FS;
        const dir = METODOS[key](p, cR, phiR, G, W);
        m.dir = dir;
        m.qadmDir = dir.ok ? dir.qu : NaN;
        m.qadm = p.usarDirecto && isFinite(m.qadmDir) ? Math.min(m.qadmInd, m.qadmDir) : m.qadmInd;
        m.Qadm = m.qadm * G.A;
        if (m.qadm < min) { min = m.qadm; minKey = key; }
      }
      res.metodos[key] = m;
    }
    res.qadmMin = isFinite(min) ? min : NaN;
    res.minKey = minKey;
    res.QadmMin = res.qadmMin * G.A;
    return res;
  }

  root.CP = { calcular, geometria, freatico, NOMBRES, GW };
  if (typeof module !== 'undefined') module.exports = root.CP;
})(typeof window !== 'undefined' ? window : globalThis);
