// 3D-карта «Рельєф України» для вкладки «Карта» модулів ПС і РВ. Працює повністю офлайн: ресурси лежать у map-assets.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { haversineKm, bearingDeg, compassDirUk, polygonAreaKm2, buildElevationProfile, searchPlaces } from './map-measure-core.js';
import { HD_SOURCES, pickHdZoom, visibleTileSpecs } from './map-hd-tiles-core.js';
import { DIMAP_STORAGE_KEY, DIMAP_MODES, DIMAP_REGIONS, findDimapRegion, buildDimapUrl, nearestDimapRegion, parseDimapState } from './map-dimap-core.js';

// Армійська авіація відкриває карту з ?module=army: тло, панелі й сітка в її зеленому кольорі (map.css).
if (new URLSearchParams(location.search).get('module') === 'army') document.documentElement.dataset.module = 'army';

// ---------- geodata core: pure functions shared by the Web Worker and the main-thread fallback ----------
// Projection: Lambert conformal conic on WGS84 (standard parallels 45.7° and 51°), so distances and angles in the scene are true to
// within about 0.3 % everywhere in Ukraine. The rasters stay on their plate grid (lon/lat-linear); only the geometry is projected.
function geoCore(){
  const D2R = Math.PI/180;
  let M = null, P = null, heights = null;
  function setup(meta){
    M = meta;
    const a = 6378137, f = 1/298.257223563, e2 = f*(2-f), e = Math.sqrt(e2);
    const m = p => Math.cos(p)/Math.sqrt(1 - e2*Math.sin(p)*Math.sin(p));
    const t = p => Math.tan(Math.PI/4 - p/2)/Math.pow((1 - e*Math.sin(p))/(1 + e*Math.sin(p)), e/2);
    const p1 = meta.sp1*D2R, p2 = meta.sp2*D2R, p0 = (meta.lat0 + meta.lat1)/2*D2R;
    const n = (Math.log(m(p1)) - Math.log(m(p2)))/(Math.log(t(p1)) - Math.log(t(p2)));
    const F = m(p1)/(n*Math.pow(t(p1), n));
    P = {a, e, n, F, t, rho0:a*F*Math.pow(t(p0), n), lam0:(meta.lon0 + meta.lon1)/2*D2R, s:meta.scale};
  }
  // degrees -> scene [x, z]; the scene origin is the centre of the map, +x east, +z south, units = metres * scale
  function fwd(lon, lat, out){
    const rho = P.a*P.F*Math.pow(P.t(lat*D2R), P.n), th = P.n*(lon*D2R - P.lam0);
    out[0] = rho*Math.sin(th)*P.s; out[1] = -(P.rho0 - rho*Math.cos(th))*P.s; return out;
  }
  function inv(x, z, out){
    const X = x/P.s, dy = P.rho0 + z/P.s, rho = Math.hypot(X, dy), tt = Math.pow(rho/(P.a*P.F), 1/P.n);
    let phi = Math.PI/2 - 2*Math.atan(tt);
    for (let i = 0; i < 6; i++){ const s = P.e*Math.sin(phi); phi = Math.PI/2 - 2*Math.atan(tt*Math.pow((1 - s)/(1 + s), P.e/2)); }
    out[0] = (Math.atan2(X, dy)/P.n + P.lam0)/D2R; out[1] = phi/D2R; return out;
  }
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function toHalf(v){
    f32[0] = v; const x = u32[0], s = (x >>> 16) & 0x8000, e = (x >>> 23) & 0xff; let m = (x >>> 12) & 0x7ff;
    if (e < 103) return s; if (e > 142) return s | 0x7c00;
    if (e < 113){ m |= 0x800; return s | ((m >> (114 - e)) + ((m >> (113 - e)) & 1)); }
    return (s | ((e - 112) << 10) | (m >> 1)) + (m & 1);
  }
  function setHeights(h){ heights = h; }
  // bilinear height in metres; texel centres sit at (k + 0.5)/W, the same convention the GPU uses, so CPU and GPU surfaces agree
  function sampleH(lon, lat){
    if (!heights) return 0;
    const W = M.w, H = M.h, x = (lon - M.lon0)/(M.lon1 - M.lon0)*W - 0.5, y = (M.lat1 - lat)/(M.lat1 - M.lat0)*H - 0.5;
    const xi = Math.max(0, Math.min(W - 2, Math.floor(x))), yi = Math.max(0, Math.min(H - 2, Math.floor(y)));
    const fx = Math.max(0, Math.min(1, x - xi)), fy = Math.max(0, Math.min(1, y - yi)), i = yi*W + xi;
    const h = heights[i]*(1 - fx)*(1 - fy) + heights[i + 1]*fx*(1 - fy) + heights[i + W]*(1 - fx)*fy + heights[i + W + 1]*fx*fy;
    return Math.max(0, h);
  }
  // heights.png (R*256 + G - 1000 = metres, B = land mask) -> heights, a half-float texture [height, land, dh/dx, dh/dz] and the mask alpha
  function processHeights(px, grow){
    const W = M.w, H = M.h, n = W*H, hs = new Float32Array(n), land = new Uint8Array(n), alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++){ hs[i] = px[i*4]*256 + px[i*4 + 1] - 1000; alpha[i] = px[i*4 + 2]; land[i] = alpha[i] > 127 ? 1 : 0; }
    // grow the land outward (breadth-first, copying the neighbour's height) so coarse LOD cells that straddle the outline stay level; the mask texture clips the surplus
    let front = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const i = y*W + x; if (land[i] && ((x > 0 && !land[i - 1]) || (x < W - 1 && !land[i + 1]) || (y > 0 && !land[i - W]) || (y < H - 1 && !land[i + W]))) front.push(i); }
    for (let pass = 0; pass < grow && front.length; pass++){
      const next = [];
      for (const i of front){ const x = i % W, y = (i - x)/W;
        if (x > 0 && !land[i - 1]){ land[i - 1] = 1; hs[i - 1] = hs[i]; next.push(i - 1); }
        if (x < W - 1 && !land[i + 1]){ land[i + 1] = 1; hs[i + 1] = hs[i]; next.push(i + 1); }
        if (y > 0 && !land[i - W]){ land[i - W] = 1; hs[i - W] = hs[i]; next.push(i - W); }
        if (y < H - 1 && !land[i + W]){ land[i + W] = 1; hs[i + W] = hs[i]; next.push(i + W); } }
      front = next;
    }
    // surface gradient in the scene frame: finite differences on the lon/lat grid, mapped through the projection's Jacobian
    const half = new Uint16Array(n*4), sinT = new Float64Array(W), cosT = new Float64Array(W), one = toHalf(1), zero = toHalf(0);
    for (let x = 0; x < W; x++){ const th = P.n*((M.lon0 + (x + 0.5)/W*(M.lon1 - M.lon0))*D2R - P.lam0); sinT[x] = Math.sin(th); cosT[x] = Math.cos(th); }
    const dLam = (M.lon1 - M.lon0)/W*D2R, dPhi = -(M.lat1 - M.lat0)/H*D2R, rhoAt = p => P.a*P.F*Math.pow(P.t(p), P.n);
    for (let y = 0; y < H; y++){
      const phi = (M.lat1 - (y + 0.5)/H*(M.lat1 - M.lat0))*D2R, rho = rhoAt(phi), rhoP = (rhoAt(phi + 1e-5) - rhoAt(phi - 1e-5))/2e-5;
      const yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
      for (let x = 0; x < W; x++){
        const i = y*W + x, xl = x > 0 ? x - 1 : x, xr = x < W - 1 ? x + 1 : x;
        const hLam = (Math.max(0, hs[y*W + xr]) - Math.max(0, hs[y*W + xl]))/((xr - xl)*dLam), hPhi = (Math.max(0, hs[yd*W + x]) - Math.max(0, hs[yu*W + x]))/((yd - yu)*dPhi);
        const xL = rho*P.n*cosT[x], nL = rho*P.n*sinT[x], xP = rhoP*sinT[x], nP = -rhoP*cosT[x], det = xL*nP - nL*xP;
        const gx = (hLam*nP - nL*hPhi)/det, gN = (xL*hPhi - xP*hLam)/det;
        half[i*4] = toHalf(Math.max(-500, hs[i])); half[i*4 + 1] = land[i] ? one : zero; half[i*4 + 2] = toHalf(gx); half[i*4 + 3] = toHalf(-gN);
      }
    }
    heights = hs;
    return {heights:hs, half, alpha};
  }
  // regular lon/lat grid projected into the scene, relative to its own centre (the mesh carries the offset, so vertex floats stay small).
  // position.y is 0 on the surface and -1 on the skirt ring that hides seams between tiles of different detail.
  function buildGrid(b, nx, ny, skirt){
    const cols = nx + 1, rows = ny + 1, core = cols*rows, nv = core + (skirt ? 2*(cols + rows) : 0);
    const pos = new Float32Array(nv*3), uvg = new Float32Array(nv*2), o = fwd((b[0] + b[1])/2, (b[2] + b[3])/2, [0, 0]), q = [0, 0];
    const idx = new (nv > 65535 ? Uint32Array : Uint16Array)((nx*ny + (skirt ? 2*(nx + ny) : 0))*6);
    let r2 = 0, k = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++){
      const lon = b[0] + (b[1] - b[0])*i/nx, lat = b[3] - (b[3] - b[2])*j/ny, v = j*cols + i; fwd(lon, lat, q);
      const x = q[0] - o[0], z = q[1] - o[1]; pos[v*3] = x; pos[v*3 + 2] = z; r2 = Math.max(r2, x*x + z*z);
      uvg[v*2] = (lon - M.lon0)/(M.lon1 - M.lon0); uvg[v*2 + 1] = (M.lat1 - lat)/(M.lat1 - M.lat0);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){ const a = j*cols + i, c = a + cols; idx[k++] = a; idx[k++] = c; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = c; idx[k++] = c + 1; }
    if (skirt){
      let v = core;
      const edge = (count, at) => { const base = v;
        for (let i = 0; i < count; i++){ const s = at(i); pos[v*3] = pos[s*3]; pos[v*3 + 1] = -1; pos[v*3 + 2] = pos[s*3 + 2]; uvg[v*2] = uvg[s*2]; uvg[v*2 + 1] = uvg[s*2 + 1]; v++; }
        for (let i = 0; i < count - 1; i++){ const a = at(i), c = at(i + 1); idx[k++] = a; idx[k++] = base + i; idx[k++] = c; idx[k++] = c; idx[k++] = base + i; idx[k++] = base + i + 1; } };
      edge(cols, i => i); edge(cols, i => ny*cols + i); edge(rows, j => j*cols); edge(rows, j => j*cols + nx);
    }
    return {pos, uvg, idx, origin:o, radius:Math.sqrt(r2)};
  }
  // building footprints (DNB2/DNB3 packs) -> one merged buffer per pack; stamps 20 3D archetypes (10 high-rise + 10 private house types) onto real footprints
  function buildCity(u8, c, o){
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]); if (magic !== 'DNB2' && magic !== 'DNB3') throw new Error('формат забудови');
    const unit = magic === 'DNB3' ? 1 : 0.5;   // DNB2: half-metres (city packs), DNB3: whole metres (village cells, 65 km range)
    const count = dv.getUint32(4, true), skipCat = o.skipCat;
    const isDNB2 = magic === 'DNB2';
    // First pass: estimate vertex budget including 3D architectural crowns, pitched roofs, setbacks, spires, and rooftop structures
    let p = 8, nv = 0;
    for (let b = 0; b < count; b++){ const n = u8[p];
      if (n === 0){ if (u8[p + 9] !== skipCat) nv += 44; p += 10; continue; }
      const h0 = dv.getUint16(p + 1, true)/10, cat = u8[p + 3];
      if (cat !== skipCat){
        nv += 4*n + 8;   // walls + central apex/ridge vertices for pitched/pyramid roofs
        if (isDNB2 && (cat === 1 || cat === 2 || cat === 3 || h0 >= 11)) nv += 56;   // setbacks, elevator penthouses, spires, skylights
      }
      p += 4 + n*4 + (n - 2)*3; }
    let pos = new Float32Array(nv*3), grd = new Float32Array(nv), col = new Uint8Array(nv*3), uv = new Float32Array(nv*2);
    function ensure(need){
      if (v + need <= grd.length) return;
      const nn = Math.max(grd.length + need, Math.ceil(grd.length * 1.35));
      const nPos = new Float32Array(nn*3), nGrd = new Float32Array(nn), nCol = new Uint8Array(nn*3), nUv = new Float32Array(nn*2);
      nPos.set(pos); nGrd.set(grd); nCol.set(col); nUv.set(uv);
      pos = nPos; grd = nGrd; col = nCol; uv = nUv;
    }
    const idxRoof = [[], [], [], [], []], idxWall = [[], [], [], [], []];
    const sc = P.s;
    const org = fwd((c.b[0] + c.b[1])/2, (c.b[2] + c.b[3])/2, [0, 0]), q = [0, 0], lon0 = c.b[0], lat1 = c.b[3], lonM = c.lonM;
    const px = new Float64Array(256), py = new Float64Array(256), wx = new Float64Array(256), wz = new Float64Array(256), tri = new Uint8Array(765);
    const DU = [-0.5, -0.5, 0.5, 0.5], DL = [-0.5, 0.5, 0.5, -0.5];   // box corners, CCW seen from above (y points south)
    // Helper: append an oriented 3D architectural box (tier, penthouse, dormer, chimney, or skylight) in scene space
    function pushBox(cx, cz, ux, uz, vx, vz, y0, y1, tw, th, wr, wg, wb, rr, rg, rb, g, wl, rl, crownPitch){
      ensure(24);
      const bx0 = cx - ux - vx, bz0 = cz - uz - vz;
      const bx1 = cx - ux + vx, bz1 = cz - uz + vz;
      const bx2 = cx + ux + vx, bz2 = cz + uz + vz;
      const bx3 = cx + ux - vx, bz3 = cz + uz - vz;
      const xs = [bx0, bx1, bx2, bx3], zs = [bz0, bz1, bz2, bz3];
      const wLen = Math.hypot(ux, uz)*2 / sc, lLen = Math.hypot(vx, vz)*2 / sc;
      const base = v, v0 = y0/th, v1 = y1/th, bBot = Math.round(wr*0.84), gBot = Math.round(wg*0.84), rBot = Math.round(wb*0.84);
      let uRun = 0;
      for (let i = 0; i < 4; i++){
        const j = (i + 1) & 3, seg = (i & 1) ? wLen : lLen, u0 = uRun/tw, u1 = (uRun + seg)/tw; uRun += seg;
        const k = base + 4*i;
        pos[k*3] = xs[i]; pos[k*3+1] = y1; pos[k*3+2] = zs[i]; uv[k*2] = u0; uv[k*2+1] = v1;
        pos[k*3+3] = xs[i]; pos[k*3+4] = y0; pos[k*3+5] = zs[i]; uv[k*2+2] = u0; uv[k*2+3] = v0;
        pos[k*3+6] = xs[j]; pos[k*3+7] = y0; pos[k*3+8] = zs[j]; uv[k*2+4] = u1; uv[k*2+5] = v0;
        pos[k*3+9] = xs[j]; pos[k*3+10] = y1; pos[k*3+11] = zs[j]; uv[k*2+6] = u1; uv[k*2+7] = v1;
        col[k*3] = wr; col[k*3+1] = wg; col[k*3+2] = wb;
        col[(k+1)*3] = bBot; col[(k+1)*3+1] = gBot; col[(k+1)*3+2] = rBot;
        col[(k+2)*3] = bBot; col[(k+2)*3+1] = gBot; col[(k+2)*3+2] = rBot;
        col[(k+3)*3] = wr; col[(k+3)*3+1] = wg; col[(k+3)*3+2] = wb;
        for (let s = 0; s < 4; s++) grd[k + s] = g;
        wl.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
      v += 16;
      if (crownPitch > 0){
        const ap = v++;
        pos[ap*3] = cx; pos[ap*3+1] = y1 + crownPitch; pos[ap*3+2] = cz; uv[ap*2] = 0.5; uv[ap*2+1] = 0.5;
        col[ap*3] = Math.min(255, rr + 14); col[ap*3+1] = Math.min(255, rg + 14); col[ap*3+2] = Math.min(255, rb + 14); grd[ap] = g;
        for (let i = 0; i < 4; i++) rl.push(base + 4*i, base + 4*((i + 1) & 3), ap);
      } else {
        for (let i = 0; i < 4; i++){ const k = base + 4*i; col[k*3] = rr; col[k*3+1] = rg; col[k*3+2] = rb; }
        rl.push(base, base + 4, base + 8, base, base + 8, base + 12);
      }
    }
    p = 8; let v = 0, r2 = 0;
    for (let b = 0; b < count; b++){
      let n = u8[p], h, cat, isBox = false;
      if (n === 0){
        const mx = dv.getUint16(p + 1, true), my = dv.getUint16(p + 3, true), w = u8[p + 5]/2, l = u8[p + 6]/2, ang = u8[p + 7]/256*Math.PI; h = u8[p + 8]/2; cat = u8[p + 9]; p += 10;
        if (cat === skipCat) continue;
        n = 4; isBox = true; const ca = Math.cos(ang), sa = Math.sin(ang);
        for (let i = 0; i < 4; i++){ px[i] = mx + DU[i]*w*ca - DL[i]*l*sa; py[i] = my + DU[i]*w*sa + DL[i]*l*ca; }
        tri[0] = 0; tri[1] = 1; tri[2] = 2; tri[3] = 0; tri[4] = 2; tri[5] = 3;
      } else {
        h = dv.getUint16(p + 1, true)/10; cat = u8[p + 3]; p += 4;
        if (cat === skipCat){ p += n*4 + (n - 2)*3; continue; }
        for (let i = 0; i < n; i++){ px[i] = dv.getUint16(p + i*4, true)*unit; py[i] = dv.getUint16(p + i*4 + 2, true)*unit; }
        p += n*4; tri.set(u8.subarray(p, p + (n - 2)*3)); p += (n - 2)*3;
      }
      let cx = 0, cy = 0, wcx = 0, wcz = 0;
      for (let i = 0; i < n; i++){
        cx += px[i]; cy += py[i]; fwd(lon0 + px[i]/lonM, lat1 - py[i]/111320, q);
        wx[i] = q[0] - org[0]; wz[i] = q[1] - org[1]; wcx += wx[i]; wcz += wz[i];
        r2 = Math.max(r2, wx[i]*wx[i] + wz[i]*wz[i]);
      }
      wcx /= n; wcz /= n;
      const g = sampleH(lon0 + cx/n/lonM, lat1 - cy/n/111320);
      const hash = ((b*2654435761) >>> 0);
      const arch = hash % 10;   // deterministic archetype index 0..9 (10 high-rises / 10 private houses)
      const fac = o.fac[cat] || o.fac[0], tw = fac ? fac[0] : 6, th = fac ? fac[1] : 3;
      const jit = 0.85 + (hash % 1000) / 1000 * 0.22;
      // Richer architectural palette variation inspired by IMG_9557 (cool glass/concrete) & IMG_9556 (warm sandstone/ochre/terracotta)
      const warmShift = ((hash >>> 10) & 7) < 4 ? 1.04 : 0.96;
      const cc = o.colors[cat] || o.colors[0];
      const wr = Math.min(255, Math.round((fac ? 246 : cc[0]*255)*jit*warmShift));
      const wg = Math.min(255, Math.round((fac ? 242 : cc[1]*255)*jit));
      const wb = Math.min(255, Math.round((fac ? 236 : cc[2]*255)*jit*(2 - warmShift)));
      // Ground ambient occlusion: bottom of walls is darker (gives realistic street canyon depth as in IMG_9557)
      const ao = h > 16 ? 0.72 : h > 8 ? 0.78 : 0.84;
      const wrBot = Math.round(wr*ao), wgBot = Math.round(wg*ao), wbBot = Math.round(wb*ao);
      const rr = Math.min(255, Math.round(wr*0.92)), rg = Math.min(255, Math.round(wg*0.90)), rb = Math.min(255, Math.round(wb*0.88));
      const wl = idxWall[cat] || idxWall[0], rl = idxRoof[cat] || idxRoof[0];

      // Determine whether this footprint gets a high-rise archetype (0..9) or private house archetype (0..9)
      const isHighrise = cat === 1 || cat === 3 || (cat === 2 && h >= 10) || h >= 10.5;
      const isHouse = !isHighrise && (cat === 0 || (cat === 4 && h >= 3.2));
      // Slanted roof crown for highrise archetype 8 (highrise_09_slanted_crown)
      const slant = isHighrise && arch === 8 && h >= 18 ? Math.min(6.5, h*0.16) : 0;

      ensure(4*n + 8);
      const base = v, vTop = h/th; let uRun = 0;
      let maxEdge = 0, majUx = 1, majUz = 0, spanAcc = 0;
      for (let i = 0; i < n; i++){
        const j = (i + 1) % n, dx = px[j] - px[i], dy = py[j] - py[i], len = Math.hypot(dx, dy);
        const sdx = wx[j] - wx[i], sdz = wz[j] - wz[i], sLen = Math.hypot(sdx, sdz);
        spanAcc += sLen;
        if (sLen > maxEdge){ maxEdge = sLen; majUx = sdx / (sLen || 1); majUz = sdz / (sLen || 1); }
        const u0 = uRun/tw, u1 = (uRun + len)/tw; uRun += len;
        const hi = slant ? h + slant * ((i === 0 || i === 1) ? 1 : 0) : h;
        const hj = slant ? h + slant * ((j === 0 || j === 1) ? 1 : 0) : h;
        const k = base + 4*i;
        pos[k*3] = wx[i]; pos[k*3 + 1] = hi; pos[k*3 + 2] = wz[i];     uv[k*2] = u0; uv[k*2 + 1] = vTop;
        pos[k*3 + 3] = wx[i]; pos[k*3 + 4] = 0; pos[k*3 + 5] = wz[i];  uv[k*2 + 2] = u0; uv[k*2 + 3] = 0;
        pos[k*3 + 6] = wx[j]; pos[k*3 + 7] = 0; pos[k*3 + 8] = wz[j];  uv[k*2 + 4] = u1; uv[k*2 + 5] = 0;
        pos[k*3 + 9] = wx[j]; pos[k*3 + 10] = hj; pos[k*3 + 11] = wz[j]; uv[k*2 + 6] = u1; uv[k*2 + 7] = vTop;
        col[k*3] = wr; col[k*3 + 1] = wg; col[k*3 + 2] = wb;
        col[(k + 1)*3] = wrBot; col[(k + 1)*3 + 1] = wgBot; col[(k + 1)*3 + 2] = wbBot;
        col[(k + 2)*3] = wrBot; col[(k + 2)*3 + 1] = wgBot; col[(k + 2)*3 + 2] = wbBot;
        col[(k + 3)*3] = wr; col[(k + 3)*3 + 1] = wg; col[(k + 3)*3 + 2] = wb;
        for (let s = 0; s < 4; s++) grd[k + s] = g;
        wl.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
      v += 4*n;

      // Principal axes of the footprint in scene units for stamping 3D superstructures
      const avgSide = Math.max(4*sc, Math.min(45*sc, spanAcc / n));
      const minSide = Math.min(maxEdge, avgSide * 0.85);
      const ux = majUx * Math.min(maxEdge * 0.42, 22*sc), uz = majUz * Math.min(maxEdge * 0.42, 22*sc);
      const vx = -majUz * Math.min(minSide * 0.36, 12*sc), vz = majUx * Math.min(minSide * 0.36, 12*sc);

      // ---------- 10 PRIVATE HOUSE ARCHETYPES (pitched gabled/hipped/mansard/modern roofs) ----------
      if (isHouse && n === 4 && arch !== 7){
        // Archetypes 0..9 for 4-corner residential houses: gabled ridge or hipped/mansard apex
        const pitch = arch === 9 ? Math.min(3.5, h*0.72) : arch === 6 ? Math.min(2.8, h*0.58) : Math.min(2.5, Math.max(1.3, h*0.46));
        const d01 = Math.hypot(wx[1] - wx[0], wz[1] - wz[0]), d12 = Math.hypot(wx[2] - wx[1], wz[2] - wz[1]);
        const hip = (arch === 1 || arch === 5 || arch === 8) ? 0.22 : 0.04;   // hipped vs gabled ridge inset
        const r0 = v++, r1 = v++;
        if (d01 >= d12){
          const mx0 = (wx[0] + wx[3])*0.5, mz0 = (wz[0] + wz[3])*0.5, mx1 = (wx[1] + wx[2])*0.5, mz1 = (wz[1] + wz[2])*0.5;
          pos[r0*3] = mx0 + (mx1 - mx0)*hip; pos[r0*3+1] = h + pitch; pos[r0*3+2] = mz0 + (mz1 - mz0)*hip;
          pos[r1*3] = mx1 - (mx1 - mx0)*hip; pos[r1*3+1] = h + pitch; pos[r1*3+2] = mz1 - (mz1 - mz0)*hip;
          rl.push(base, base + 4, r1, base, r1, r0, base + 8, base + 12, r0, base + 8, r0, r1, base + 4, base + 8, r1, base + 12, base, r0);
        } else {
          const mx0 = (wx[0] + wx[1])*0.5, mz0 = (wz[0] + wz[1])*0.5, mx1 = (wx[2] + wx[3])*0.5, mz1 = (wz[2] + wz[3])*0.5;
          pos[r0*3] = mx0 + (mx1 - mx0)*hip; pos[r0*3+1] = h + pitch; pos[r0*3+2] = mz0 + (mz1 - mz0)*hip;
          pos[r1*3] = mx1 - (mx1 - mx0)*hip; pos[r1*3+1] = h + pitch; pos[r1*3+2] = mz1 - (mz1 - mz0)*hip;
          rl.push(base + 4, base + 8, r1, base + 4, r1, r0, base + 12, base, r0, base + 12, r0, r1, base, base + 4, r0, base + 8, base + 12, r1);
        }
        for (const rv of [r0, r1]){
          uv[rv*2] = 0.5; uv[rv*2+1] = 0.5;
          col[rv*3] = Math.min(255, rr + 18); col[rv*3+1] = Math.min(255, rg + 16); col[rv*3+2] = Math.min(255, rb + 14); grd[rv] = g;
        }
        // In city packs (DNB2), add chimney or dormer/upper tier for house archetypes 3, 4, 6
        if (isDNB2 && (arch === 3 || arch === 4 || arch === 6) && minSide > 6*sc){
          pushBox(wcx + ux*0.25, wcz + uz*0.25, ux*0.28, uz*0.28, vx*0.35, vz*0.35, h*0.65, h + pitch*0.88, tw, th, wr, wg, wb, rr, rg, rb, g, wl, rl, 0);
        }
      } else if (isHouse && arch !== 7){
        // Polygonal private houses (L-shaped, U-shaped, rural homesteads): hipped pyramid roof to centroid apex
        const pitch = Math.min(2.6, Math.max(1.3, h*0.44));
        const ap = v++;
        pos[ap*3] = wcx; pos[ap*3+1] = h + pitch; pos[ap*3+2] = wcz; uv[ap*2] = 0.5; uv[ap*2+1] = 0.5;
        col[ap*3] = Math.min(255, rr + 18); col[ap*3+1] = Math.min(255, rg + 16); col[ap*3+2] = Math.min(255, rb + 14); grd[ap] = g;
        for (let i = 0; i < n; i++) rl.push(base + 4*i, base + 4*((i + 1) % n), ap);
      } else if (isHighrise && arch === 5){
        // High-rise Archetype 6 (highrise_06_courtyard_mansard): classic urban block with pitched mansard crown
        const pitch = Math.min(3.6, Math.max(1.8, h*0.16));
        const ap = v++;
        pos[ap*3] = wcx; pos[ap*3+1] = h + pitch; pos[ap*3+2] = wcz; uv[ap*2] = 0.5; uv[ap*2+1] = 0.5;
        col[ap*3] = Math.min(255, rr + 16); col[ap*3+1] = Math.min(255, rg + 16); col[ap*3+2] = Math.min(255, rb + 16); grd[ap] = g;
        for (let i = 0; i < n; i++) rl.push(base + 4*i, base + 4*((i + 1) % n), ap);
      } else {
        // Flat roof base (for modern flat houses arch===7, industrial halls, and high-rises with 3D rooftop superstructures)
        for (let t = 0; t < n - 2; t++) rl.push(base + 4*tri[t*3], base + 4*tri[t*3 + 1], base + 4*tri[t*3 + 2]);
        if (isDNB2 && isHouse && arch === 7 && minSide > 6*sc){
          // Modern flat-roof house archetype 8: upper terrace volume
          pushBox(wcx - ux*0.18, wcz - uz*0.18, ux*0.58, uz*0.58, vx*0.62, vz*0.62, h, h + Math.min(3.0, h*0.65), tw, th, wr, wg, wb, rr, rg, rb, g, wl, rl, 0);
        }
      }

      // ---------- 10 HIGH-RISE & URBAN ARCHETYPES (superstructures, setbacks, spires, HVAC, skylights) ----------
      if (isDNB2 && isHighrise && !isBox && minSide > 6.5*sc){
        if (arch === 0 || arch === 4){
          // Archetype 1 (panel9) & Archetype 5 (bay residential): twin elevator penthouses + rooftop parapet volume
          const ph = Math.min(3.2, Math.max(2.0, h*0.10));
          pushBox(wcx - ux*0.42, wcz - uz*0.42, ux*0.24, uz*0.24, vx*0.42, vz*0.42, h, h + ph, tw, th, wrBot, wgBot, wbBot, rr, rg, rb, g, wl, rl, 0);
          if (maxEdge > 18*sc) pushBox(wcx + ux*0.42, wcz + uz*0.42, ux*0.24, uz*0.24, vx*0.42, vz*0.42, h, h + ph, tw, th, wrBot, wgBot, wbBot, rr, rg, rb, g, wl, rl, 0);
        } else if (arch === 1 || arch === 7){
          // Archetype 2 (monolith tower) & Archetype 8 (cylindrical/crown tower): recessed mechanical crown + spire/mast
          const th1 = Math.min(4.8, Math.max(2.4, h*0.13));
          pushBox(wcx, wcz, ux*0.56, uz*0.56, vx*0.56, vz*0.56, h, h + th1, tw, th, wr, wg, wb, rr, rg, rb, g, wl, rl, arch === 7 ? 1.4 : 0);
        } else if (arch === 2){
          // Archetype 3 (setback tower, IMG_9557): two stepped architectural tiers
          const t1 = Math.min(12.0, Math.max(3.5, h*0.26)), t2 = Math.min(8.0, Math.max(2.6, h*0.18));
          pushBox(wcx, wcz, ux*0.72, uz*0.72, vx*0.72, vz*0.72, h, h + t1, tw, th, wr, wg, wb, rr, rg, rb, g, wl, rl, 0);
          pushBox(wcx, wcz, ux*0.44, uz*0.44, vx*0.44, vz*0.44, h + t1, h + t1 + t2, tw, th, wr, wg, wb, rr, rg, rb, g, wl, rl, 0);
        } else if (arch === 3){
          // Archetype 4 (glass office business centre): HVAC mechanical row + helipad/crown slab
          const hh = Math.min(3.0, Math.max(1.8, h*0.09));
          pushBox(wcx - ux*0.35, wcz - uz*0.35, ux*0.22, uz*0.22, vx*0.48, vz*0.48, h, h + hh, tw, th, wrBot, wgBot, wbBot, rr, rg, rb, g, wl, rl, 0);
          pushBox(wcx + ux*0.35, wcz + uz*0.35, ux*0.22, uz*0.22, vx*0.48, vz*0.48, h, h + hh*0.85, tw, th, wrBot, wgBot, wbBot, rr, rg, rb, g, wl, rl, 0);
        } else if (arch === 6){
          // Archetype 7 (monumental spire building, IMG_9556): stepped central tower + pyramidal spire
          const t1 = Math.min(14.0, Math.max(4.0, h*0.32)), sp = Math.min(11.0, Math.max(3.5, h*0.28));
          pushBox(wcx, wcz, ux*0.54, uz*0.54, vx*0.54, vz*0.54, h, h + t1, tw, th, wr, wg, wb, rr, rg, rb, g, wl, rl, sp);
        } else if (arch === 9 || cat === 2){
          // Archetype 10 (industrial hall): sawtooth / clerestory roof monitors along the roof
          const sh = Math.min(2.6, Math.max(1.5, h*0.16));
          pushBox(wcx - ux*0.36, wcz - uz*0.36, ux*0.22, uz*0.22, vx*0.68, vz*0.68, h, h + sh, tw, th, wrBot, wgBot, wbBot, rr, rg, rb, g, wl, rl, sh*0.6);
          pushBox(wcx + ux*0.36, wcz + uz*0.36, ux*0.22, uz*0.22, vx*0.68, vz*0.68, h, h + sh, tw, th, wrBot, wgBot, wbBot, rr, rg, rb, g, wl, rl, sh*0.6);
        }
      }
    }
    const usedPos = pos.subarray(0, v*3), usedGrd = grd.subarray(0, v), usedCol = col.subarray(0, v*3), usedUv = uv.subarray(0, v*2);
    const total = a => a.reduce((s, x) => s + x.length, 0), idx = new Uint32Array(total(idxRoof) + total(idxWall)), groups = []; let off = 0;
    idxRoof.forEach((a, k) => { if (a.length){ idx.set(a, off); groups.push([off, a.length, k]); off += a.length; } });
    idxWall.forEach((a, k) => { if (a.length){ idx.set(a, off); groups.push([off, a.length, 5 + k]); off += a.length; } });
    return {pos:usedPos.slice(), grd:usedGrd.slice(), col:usedCol.slice(), uv:usedUv.slice(), idx, groups, origin:org, radius:Math.sqrt(r2)};
  }
  return {setup, fwd, inv, setHeights, sampleH, processHeights, buildGrid, buildCity};
}

// Worker body: decodes PNGs off the main thread and runs the heavy steps (heightfield, tile grids, building meshes); results come back as transferables.
function workerMain(geoCore){
  const core = geoCore();
  async function decode(blob){
    const bmp = await createImageBitmap(blob, {premultiplyAlpha:'none', colorSpaceConversion:'none'});
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', {willReadFrequently:true}); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height); bmp.close(); return d;
  }
  self.onmessage = async e => {
    const {id, op, a} = e.data;
    try {
      let r = true, tr = [];
      if (op === 'setup') core.setup(a);
      else if (op === 'heights'){ const d = await decode(a.blob), o = core.processHeights(d.data, a.grow), copy = o.heights.slice(); r = {heights:copy, half:o.half, alpha:o.alpha}; tr = [copy.buffer, o.half.buffer, o.alpha.buffer]; }
      else if (op === 'grid'){ r = core.buildGrid(a.b, a.nx, a.ny, a.skirt); tr = [r.pos.buffer, r.uvg.buffer, r.idx.buffer]; }
      else if (op === 'city'){ const d = await decode(a.blob), u8 = new Uint8Array(d.width*d.height); for (let i = 0; i < u8.length; i++) u8[i] = d.data[i*4];
        r = core.buildCity(u8, a.c, a.opts); tr = [r.pos.buffer, r.grd.buffer, r.col.buffer, r.uv.buffer, r.idx.buffer]; }
      self.postMessage({id, r}, tr);
    } catch (err) { self.postMessage({id, err:String(err && err.message || err)}); }
  };
}

const META = {w:2048, h:1398, lon0:21.9, lon1:40.5, lat0:44.05, lat1:52.5, coslat:0.66556, sp1:45.7, sp2:51};
const MAPW = 20, MAPH = MAPW*META.h/META.w;                            // plate (lon/lat-linear) extent: tile bookkeeping and raster uv only
const KM_PER_UNIT = (META.lon1-META.lon0)*META.coslat*111.32/MAPW;   // ≈ 68.9 km
const SCALE = 1/(KM_PER_UNIT*1000);                                   // scene units per metre
META.scale = SCALE;
const PLINTH = 0.32;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EMBED = /[?&]embed=1/.test(location.search);   // вбудована в модуль (ПС / РВ): без вступної анімації й автообертання
const IN_LAUNCHER = !EMBED && (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const skipIntro = reduced || EMBED;
if (EMBED){ document.body.classList.add('embed'); const cr = document.getElementById('credits'); if (cr) cr.innerHTML = cr.innerHTML.replace(/<br\s*\/?>/g, ' · '); }
if (IN_LAUNCHER) document.body.classList.add('in-launcher');
const ASSET = s => /^(?:[a-z][a-z0-9+.-]*:|\.{0,2}\/)/i.test(s) ? s : './map-assets/' + s;   // усі ресурси карти лежать у map-assets: застосунок працює без мережі
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || innerWidth < 700;
const $ = id => document.getElementById(id);

const DEFAULT_OBLASTS = ['Донецька','Луганська','Дніпропетровська'];
const PEAKS = [['Говерла · 2061 м',24.500,48.160],['Роман-Кош · 1545 м',34.247,44.610]];

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const cssColor = (n) => new THREE.Color(css(n));

// ---------- coordinates ----------
const core = geoCore(); core.setup(META);
const _q = [0, 0];
const toWorld = (lon, lat) => { core.fwd(lon, lat, _q); return new THREE.Vector3(_q[0], 0, _q[1]); };                   // projected scene position
const toPlate = (lon, lat) => ({x:(lon-META.lon0)/(META.lon1-META.lon0)*MAPW - MAPW/2, z:(META.lat1-lat)/(META.lat1-META.lat0)*MAPH - MAPH/2});
const sampleH = core.sampleH;
let heights = null;

// ---------- geodata worker (falls back to the main thread when workers or OffscreenCanvas are unavailable) ----------
function loadBlob(src, onProgress){
  return new Promise((res, rej) => {
    const xhr = new XMLHttpRequest(); xhr.open('GET', ASSET(src)); xhr.responseType = 'blob';
    xhr.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded/e.total); };
    xhr.onload = () => xhr.status >= 400 ? rej(new Error(src+': '+xhr.status)) : res(xhr.response);
    xhr.onerror = () => rej(new Error('Не вдалося завантажити '+src)); xhr.send();
  });
}
function blobImage(blob){ return new Promise((res, rej) => { const img = new Image(), url = URL.createObjectURL(blob); img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Не вдалося розпакувати зображення')); }; img.src = url; }); }
const loadImage = (src, onProgress) => loadBlob(src, onProgress).then(blobImage);
async function fetchJson(src){ const r = await fetch(ASSET(src)); if (!r.ok) throw new Error(src + ': ' + r.status); return r.json(); }
const Geo = (() => {
  let w = null, seq = 0; const pend = new Map();
  async function pixels(blob){ const img = await blobImage(blob), c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', {willReadFrequently:true}); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); }
  async function local(op, a){
    if (op === 'heights'){ const d = await pixels(a.blob); return core.processHeights(d.data, a.grow); }
    if (op === 'grid') return core.buildGrid(a.b, a.nx, a.ny, a.skirt);
    if (op === 'city'){ const d = await pixels(a.blob), u8 = new Uint8Array(d.width*d.height); for (let i = 0; i < u8.length; i++) u8[i] = d.data[i*4]; return core.buildCity(u8, a.c, a.opts); }
  }
  function drop(){ if (!w) return; try { w.terminate(); } catch (e) {} w = null; for (const p of pend.values()) p.retry(); pend.clear(); }
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('no worker support');
    w = new Worker(URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')(' + geoCore.toString() + ');'], {type:'text/javascript'})));
    w.onmessage = e => { const p = pend.get(e.data.id); if (!p) return; pend.delete(e.data.id); if (e.data.err){ console.warn('worker:', e.data.err); p.retry(); } else p.res(e.data.r); };
    w.onerror = e => { console.warn('геодані обробляються в основному потоці', e.message || ''); drop(); };
    w.postMessage({id:0, op:'setup', a:META});
  } catch (e) { w = null; }
  function call(op, a){
    if (!w) return local(op, a);
    return new Promise((res, rej) => { const id = ++seq; pend.set(id, {res, retry:() => local(op, a).then(res, rej)}); w.postMessage({id, op, a}); });
  }
  return {call, get threaded(){ return !!w; }, get pending(){ return pend.size; }};
})();

// ---------- renderer / scene ----------
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance', logarithmicDepthBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile?1.5:2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
stage.appendChild(renderer.domElement);
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth/innerHeight, 0.0005, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI*0.47; controls.minDistance = 0.015; controls.maxDistance = 70;
controls.zoomToCursor = true;   // wheel zooms toward the point under the cursor, like a map
controls.mouseButtons = {LEFT:THREE.MOUSE.PAN, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.ROTATE};   // left drag grabs the map, right drag orbits
controls.touches = {ONE:THREE.TOUCH.PAN, TWO:THREE.TOUCH.DOLLY_ROTATE};
controls.screenSpacePanning = false;   // pan slides along the ground, not the screen plane
controls.panSpeed = 1.2;
renderer.domElement.style.cursor = 'grab';
renderer.domElement.addEventListener('pointerdown', e => { if (e.button === 0) renderer.domElement.style.cursor = 'grabbing'; });
addEventListener('pointerup', () => { renderer.domElement.style.cursor = 'grab'; });
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
controls.autoRotate = !skipIntro; controls.autoRotateSpeed = 0.45;
controls.addEventListener('start', () => {
  if (controls.autoRotate) { controls.autoRotate = false; setPressed(btnRot, false); }
  if (flyTo) flyTo = null;
});

const HOME = {pos:new THREE.Vector3(-3.5, 13.5, 17.5), target:new THREE.Vector3(0, 0, 0.6)};
camera.position.copy(skipIntro ? HOME.pos : new THREE.Vector3(-2, 36, 44));
controls.target.copy(HOME.target);

// ---------- texture bookkeeping: every GPU texture is registered with its estimated size so the profiler can report memory ----------
const liveTex = new Set();
function track(tex, w, h, bytesPerPx, label){ tex.userData.bytes = w*h*bytesPerPx*(tex.generateMipmaps ? 4/3 : 1); tex.userData.label = label; liveTex.add(tex); return tex; }
function dropTex(tex){ if (!tex) return; liveTex.delete(tex); tex.dispose(); }
function imageTexture(img, label, o = {}){
  const tex = new THREE.Texture(img); tex.colorSpace = o.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (o.data) tex.flipY = false;                       // data rasters are sampled by plate uv, row 0 = north
  if (o.red) tex.format = THREE.RedFormat;             // single-channel upload: a quarter of the RGBA footprint
  if (o.mips === false){ tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; } else { tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = ANISO; }
  tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return track(tex, img.naturalWidth || img.width, img.naturalHeight || img.height, o.red ? 1 : 4, label);
}

// ---------- shaders ----------
// Terrain tiles carry their plate uv per vertex; the height comes from the DEM texture, the normal from its precomputed gradient.
// Positions are tile-local and go through modelViewMatrix, so the large scene offset is subtracted in double precision on the CPU.
const vert = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec2 aUv;
  uniform sampler2D uData; uniform float uExag; uniform float uScale; uniform float uLift; uniform float uSkirt; uniform vec4 uRect;
  varying vec2 vUvImg; varying vec2 vUvD; varying float vH; varying vec3 vWorldPos;
  void main(){
    vUvD = aUv;
    vUvImg = vec2((aUv.x - uRect.x)/uRect.z, 1.0 - (aUv.y - uRect.y)/uRect.w);   // this tile's own imagery
    float h = max(texture2D(uData, aUv).r, 0.0); vH = h;
    vec3 p = vec3(position.x, (h + uLift)*uScale*uExag + position.y*uSkirt, position.z);   // uLift (m) keeps finer patches above coarser ones where they overlap
    vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const frag = /* glsl */`
  precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uData; uniform sampler2D uSat; uniform float uExag;
  uniform vec3 uSun; uniform int uMode; uniform vec3 uBg; uniform vec3 uGrid; uniform vec3 uRamp[7];
  uniform vec3 uInk; uniform vec3 uPaper; uniform vec2 uGridDiv;   // режими-креслення: туш, папір і крок сітки каркаса (клітинок на всю плиту)
  uniform vec4 uHoles[48]; uniform int uHoleN; uniform int uCityN; uniform int uFineN; uniform int uHoleMode; uniform sampler2D uBorders; uniform float uBorderOn; uniform float uFrontOn;
  uniform sampler2D uMask; uniform vec2 uMaskTexel;   // precise national outline (OSM), 4096 px
  uniform float uTime; uniform float uAtmo; uniform float uNight;
  varying vec2 vUvImg; varying vec2 vUvD; varying float vH; varying vec3 vWorldPos;
  vec3 ramp(float h){
    float s[7]; s[0]=0.0; s[1]=150.0; s[2]=300.0; s[3]=600.0; s[4]=1000.0; s[5]=1500.0; s[6]=2061.0;
    vec3 c = uRamp[0];
    for(int i=0;i<6;i++){ float t = smoothstep(s[i], s[i+1], h); c = mix(c, uRamp[i+1], t); }
    return c;
  }
  // термоградієнт режиму «Неон»: глибока синь → бірюза → зелень → жовтий → помаранч → малиновий → білий
  vec3 neon(float h){
    vec3 r[7]; r[0]=vec3(0.04,0.10,0.30); r[1]=vec3(0.05,0.62,0.78); r[2]=vec3(0.17,0.83,0.42); r[3]=vec3(0.95,0.85,0.30); r[4]=vec3(1.0,0.42,0.24); r[5]=vec3(1.0,0.18,0.48); r[6]=vec3(1.0);
    float s[7]; s[0]=0.0; s[1]=120.0; s[2]=250.0; s[3]=450.0; s[4]=800.0; s[5]=1300.0; s[6]=2061.0;
    vec3 c = r[0];
    for(int i=0;i<6;i++){ float t = smoothstep(s[i], s[i+1], h); c = mix(c, r[i+1], t); }
    return c;
  }
  // горизонталі: лінія кожні step метрів, завширшки близько пікселя завдяки fwidth
  // Коли на піксель припадає понад чверть кроку (далекий план, крутий схил), лінії зливалися б у шум — там вони згасають.
  float contour(float h, float step){ float c = h/step; float g = fract(c); float d = min(g, 1.0-g); float w = fwidth(c); return (1.0 - smoothstep(0.0, 1.6*w, d)) * (1.0 - smoothstep(0.25, 0.6, w)); }
  void main(){
    #include <logdepthbuf_fragment>
    if (texture2D(uMask, vUvD).r < 0.5) discard;   // clip the surface to the precise outline
    // holes ordered city, fine(z12), coarse(z11): [0,uCityN) [uCityN,uFineN) [uFineN,uHoleN). mode 0 = base (all), 1 = coarse patch (city+fine), 2 = fine patch (city), 3 = city patch (none)
    if (uHoleMode < 3){ int lim = uHoleMode == 0 ? uHoleN : uHoleMode == 1 ? uFineN : uCityN; for (int i = 0; i < 48; i++){ if (i >= lim) break; vec4 hh = uHoles[i]; if (vUvD.x > hh.x && vUvD.x < hh.z && vUvD.y > hh.y && vUvD.y < hh.w) discard; } }
    vec3 L = normalize(uSun);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float camDist = length(cameraPosition - vWorldPos);
    vec3 col;
    vec2 g = texture2D(uData, vUvD).ba * uExag;      // dh/dx, dh/dz in the scene frame, precomputed from the DEM
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    float diff = max(dot(n, L), 0.0);
    float backDiff = max(dot(n, normalize(vec3(-L.x, 0.35, -L.z))), 0.0);
    float hemi = 0.5 + 0.5*n.y;
    float slope = 1.0 - n.y;
    vec3 sunTint = vec3(1.06, 1.01, 0.94);
    vec3 skyTint = mix(vec3(0.76, 0.86, 1.0), vec3(0.54, 0.68, 0.92), uNight);
    if (uMode == 0) {
      vec3 base = texture2D(uSat, vUvImg).rgb;
      vec3 lit = (0.38*hemi*skyTint + 0.80*diff*sunTint + 0.08*backDiff*skyTint);
      col = base * lit * (1.0 - 0.28*slope);
      // water detection & animated specular shimmer for rivers, reservoirs, and bays
      float waterBlue = smoothstep(0.008, 0.075, base.b - base.r*0.90) * smoothstep(0.36, 0.06, base.r);
      float waterDark = smoothstep(0.22, 0.09, max(base.r, base.g)) * smoothstep(0.0, 0.04, base.b - base.r*0.85);
      float waterFlat = (1.0 - smoothstep(0.004, 0.022, slope)) * (1.0 - smoothstep(190.0, 320.0, vH));
      float waterMask = clamp(max(waterBlue, waterDark*0.8), 0.0, 1.0) * waterFlat;
      if (waterMask > 0.01) {
        float w1 = sin(vWorldPos.x*52.0 + vWorldPos.z*18.0 + uTime*1.5)*cos(vWorldPos.z*48.0 - uTime*1.2);
        float w2 = sin(vWorldPos.x*110.0 - vWorldPos.z*76.0 - uTime*2.1)*0.5;
        vec3 wn = normalize(vec3((w1 + w2)*0.024, 1.0, (w2 - w1)*0.022));
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(wn, H), 0.0), 56.0);
        float fres = pow(1.0 - max(dot(wn, V), 0.0), 3.0);
        vec3 deepWater = mix(vec3(0.05, 0.22, 0.36), vec3(0.03, 0.13, 0.25), uNight);
        vec3 skyRef = mix(vec3(0.55, 0.76, 0.96), vec3(0.18, 0.36, 0.62), uNight);
        vec3 wCol = mix(mix(base*0.72, deepWater, 0.42), skyRef, fres*0.48) + sunTint*spec*0.85;
        col = mix(col, wCol, waterMask*0.9);
      }
      // subtle atmospheric aerial perspective when viewing at low angles / long distances
      float viewGrazing = 1.0 - clamp(V.y, 0.0, 1.0);
      float haze = clamp((camDist - 4.0) / 34.0, 0.0, 1.0) * viewGrazing * uAtmo * 0.28;
      vec3 hazeCol = mix(uBg, skyTint * 0.85, 0.35);
      col = mix(col, hazeCol, haze);
    } else if (uMode == 1) {
      vec3 base = ramp(vH);
      vec3 lit = (0.36*hemi*skyTint + 0.82*diff*sunTint + 0.08*backDiff*skyTint);
      col = base * lit * (1.0 - 0.26*slope);
      float topo = contour(vH, 200.0);
      col = mix(col, col * 0.78, topo * 0.22);
      float haze = clamp((camDist - 6.0) / 38.0, 0.0, 1.0) * (1.0 - clamp(V.y, 0.0, 1.0)) * uAtmo * 0.22;
      col = mix(col, uBg, haze);
    } else if (uMode == 2) {
      // Креслення: горизонталі тушшю на папері, легка відмивка схилів, як на топографічному аркуші
      float minor = contour(vH, 50.0), major = contour(vH, 250.0);
      vec3 paper = uPaper * (0.84 + 0.18*diff + 0.06*hemi);
      col = mix(paper, uInk, clamp(minor*0.42 + major*0.9, 0.0, 1.0));
      col = mix(col, uInk, slope*0.28);
    } else if (uMode == 3) {
      // Макет: матовий білий архітектурний макет — м'яке світло, затемнені улоговини
      col = uPaper * (0.52*hemi + 0.50*diff) * (1.0 - 0.45*slope);
    } else if (uMode == 4) {
      // Каркас: темна поверхня, світла сітка з кроком uGridDiv і тонкі горизонталі
      vec2 gc = vUvD * uGridDiv; vec2 a = abs(fract(gc - 0.5) - 0.5) / max(fwidth(gc), vec2(1e-5));
      float fine = 1.0 - min(min(a.x, a.y), 1.0);
      vec2 gc4 = gc / 4.0; vec2 a4 = abs(fract(gc4 - 0.5) - 0.5) / max(fwidth(gc4), vec2(1e-5));
      float coarse = 1.0 - min(min(a4.x, a4.y), 1.0);
      float minor = contour(vH, 100.0);
      col = uBg * 0.9 + uInk * (0.012 + 0.035*diff);
      col = mix(col, uInk, clamp(fine*0.22 + coarse*0.45 + minor*0.28, 0.0, 0.85));
    } else if (uMode == 5) {
      // Відмивка: сіра тінь рельєфу без кольору, як на аналітичній відмивці
      col = uPaper * (0.26 + 0.74*diff) * (1.0 - 0.6*slope);
    } else if (uMode == 6) {
      // Точки: поверхня майже чорна й лише затуляє дальні точки; самі точки малює dotsMat
      col = uBg * 0.6 + uInk * 0.025*diff;
    } else {
      // Неон: термоградієнт за висотою з підсвіченими горизонталями
      float minor = contour(vH, 100.0), major = contour(vH, 500.0);
      col = neon(vH) * (0.32 + 0.80*diff) * (1.0 - 0.25*slope);
      col += vec3(0.55, 0.95, 1.0) * (minor*0.22 + major*0.5);
    }
    // black line along the top edge of the plinth: land mask drops within ~0.7 texel of the border/coast
    float mE = min(min(texture2D(uMask, vUvD + vec2(uMaskTexel.x*3.0, 0.0)).r, texture2D(uMask, vUvD - vec2(uMaskTexel.x*3.0, 0.0)).r),
                   min(texture2D(uMask, vUvD + vec2(0.0, uMaskTexel.y*3.0)).r, texture2D(uMask, vUvD - vec2(0.0, uMaskTexel.y*3.0)).r));
    mE = min(mE, min(texture2D(uMask, vUvD + uMaskTexel*2.2).r, texture2D(uMask, vUvD - uMaskTexel*2.2).r));
    mE = min(mE, min(texture2D(uMask, vUvD + vec2(uMaskTexel.x, -uMaskTexel.y)*2.2).r, texture2D(uMask, vUvD - vec2(uMaskTexel.x, -uMaskTexel.y)*2.2).r));
    col = mix(col, vec3(0.0), smoothstep(0.05, 0.5, 1.0 - mE)*0.95);
    // oblast borders: draped overlay texture, colour chosen per view mode
    vec3 bd = texture2D(uBorders, vUvD).rgb;   // r = oblast lines, g = raion lines, b = line of contact (1.0) / occupied (0.47) / unknown status (0.24)
    float fl = step(0.8, bd.b); float ft = bd.b*(1.0-fl)/0.47;
    col = mix(col, vec3(0.85, 0.12, 0.12), ft*uFrontOn*0.22);                   // occupied territory: light red wash
    // raions: thin white on imagery and ramps, ink on drawings and the model; oblasts: gold on imagery, ink elsewhere, cyan in neon
    bool photo = uMode == 0 || uMode == 1;
    col = mix(col, photo ? vec3(1.0) : uMode == 7 ? vec3(0.6, 1.0, 1.0) : uInk, bd.g*uBorderOn*(photo ? 0.75 : 0.45));
    vec3 bc = uMode == 0 ? vec3(1.0, 0.92, 0.55) : uMode == 1 ? vec3(0.10, 0.13, 0.22) : uMode == 7 ? vec3(0.6, 1.0, 1.0) : uInk;
    col = mix(col, bc, bd.r*uBorderOn*0.9);
    col = mix(col, vec3(1.0, 0.16, 0.12), fl*uFrontOn);                         // line of contact: red
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const rampHex = ['#2f8f5b','#8dc063','#d9d27a','#c99a5b','#a66a4a','#e8d9cc','#ffffff'];
const blackTex = track(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1), 1, 1, 4, 'порожня'); blackTex.needsUpdate = true;   // stands in for an overlay that is not loaded
const uniforms = {
  uData:{value:null}, uSat:{value:null}, uExag:{value:skipIntro?1:0.001}, uScale:{value:SCALE}, uPlinth:{value:PLINTH},
  uSun:{value:new THREE.Vector3(1,1,1)}, uSkirt:{value:220*SCALE}, uRect:{value:new THREE.Vector4(0, 0, 1, 1)},
  uMode:{value:0}, uWall:{value:cssColor('--wall')}, uBg:{value:cssColor('--bg')}, uGrid:{value:cssColor('--grid')},
  uInk:{value:new THREE.Color('#2b2b2b')}, uPaper:{value:new THREE.Color('#f3efe4')}, uGridDiv:{value:new THREE.Vector2((META.lon1-META.lon0)/0.25, (META.lat1-META.lat0)/0.25)},   // сітка каркаса: клітинка 0,25°
  uRamp:{value:rampHex.map(h=>new THREE.Color(h))},
  uHoles:{value:Array.from({length:48}, () => new THREE.Vector4(0,0,0,0))}, uHoleN:{value:0}, uCityN:{value:0}, uFineN:{value:0}, uHoleMode:{value:0}, uLift:{value:0}, uBExag:{value:1},   // real-world scale: no vertical exaggeration for terrain or buildings
  uBorders:{value:blackTex}, uBorderOn:{value:0}, uFrontOn:{value:1}, uMask:{value:null}, uMaskTexel:{value:new THREE.Vector2(1/4096, 1/2796)},
  uTime:{value:0}, uAtmo:{value:1}, uNight:{value:1}
};
const mat = new THREE.ShaderMaterial({uniforms, vertexShader:vert, fragmentShader:frag, side:THREE.DoubleSide});
const wireMat = new THREE.ShaderMaterial({
  uniforms, vertexShader:vert, wireframe:true, transparent:true, depthWrite:false,
  fragmentShader:`#include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uGrid; uniform sampler2D uMask; varying vec2 vUvD; void main(){ #include <logdepthbuf_fragment>
  if(texture2D(uMask, vUvD).r<0.5) discard; gl_FragColor=vec4(uGrid,0.28); #include <colorspace_fragment> }`
});
// Режим «Точки»: та сама сітка рельєфу, намальована точками; розмір точки спадає з відстанню, спідниця й море відкидаються
const dotsMat = new THREE.ShaderMaterial({
  uniforms:{uData:uniforms.uData, uExag:uniforms.uExag, uScale:uniforms.uScale, uLift:{value:0.004}, uMask:uniforms.uMask, uInk:uniforms.uInk, uDot:{value:Math.min(devicePixelRatio || 1, 2)*2.4}},
  transparent:true, depthWrite:false,
  vertexShader:`#include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec2 aUv; uniform sampler2D uData; uniform float uExag; uniform float uScale; uniform float uLift; uniform float uDot;
  varying vec2 vUvD; varying float vH; varying float vSkirt;
  void main(){
    vUvD = aUv; vSkirt = position.y;
    float h = max(texture2D(uData, aUv).r, 0.0); vH = h;
    vec4 mv = modelViewMatrix * vec4(position.x, (h + uLift)*uScale*uExag, position.z, 1.0);
    gl_PointSize = uDot * clamp(7.0 / max(-mv.z, 0.001), 0.4, 2.6);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`,
  fragmentShader:`precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMask; uniform vec3 uInk; varying vec2 vUvD; varying float vH; varying float vSkirt;
  void main(){
    #include <logdepthbuf_fragment>
    if (vSkirt < -0.5 || texture2D(uMask, vUvD).r < 0.5) discard;
    float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.28, r) * mix(0.55, 1.0, clamp(vH/1500.0, 0.0, 1.0));
    gl_FragColor = vec4(uInk, a);
    #include <colorspace_fragment>
  }`
});
let dotsOn = false;
// a patch (regional or city imagery) shares every uniform with the base terrain except its own texture, hole mode, lift and uv rectangle
function patchMaterial(tex, mode, lift, b){
  const u0 = (b[0]-META.lon0)/(META.lon1-META.lon0), v0 = (META.lat1-b[3])/(META.lat1-META.lat0);
  return new THREE.ShaderMaterial({uniforms:{...uniforms, uSat:{value:tex}, uHoleMode:{value:mode}, uLift:{value:lift},
    uRect:{value:new THREE.Vector4(u0, v0, (b[1]-b[0])/(META.lon1-META.lon0), (b[3]-b[2])/(META.lat1-META.lat0))}}, vertexShader:vert, fragmentShader:frag, side:THREE.DoubleSide});
}
function gridGeometry(g){
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3)); geo.setAttribute('aUv', new THREE.BufferAttribute(g.uvg, 2)); geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), g.radius + 0.05);   // heights are displaced in the shader, at most 0.03 units
  return geo;
}

// ---------- base terrain: 6 × 4 chunks, each with three levels of detail picked by camera distance and culled against the view frustum ----------
const SEG = isMobile ? 552 : 1104, SEGY = isMobile ? 376 : 752;   // finest grid across the whole map, divisible by the 6 × 4 regional grid
const CHX = 6, CHY = 4, LOD_STEP = [1, 2, 4], LOD_NEAR = [5, 11];  // a chunk closer than 5 units uses the full grid, closer than 11 half of it, otherwise a quarter
const LOD_TOP = LOD_STEP.length - 1;
const CELL = MAPW/SEG;   // one finest-grid cell in plate units
const chunks = []; let wireOn = false, chunksDrawn = 0, chunkJobs = 0, farMesh = null, farWire = null, farDots = null, farView = false;
const chunkSpec = (ch, lod) => ({b:ch.b, nx:Math.ceil(SEG/CHX/LOD_STEP[lod]), ny:Math.ceil(SEGY/CHY/LOD_STEP[lod]), skirt:true});
function initChunks(){
  if (chunks.length) return;
  const dLon = (META.lon1-META.lon0)/CHX, dLat = (META.lat1-META.lat0)/CHY;
  for (let j = 0; j < CHY; j++) for (let i = 0; i < CHX; i++){
    const ch = {b:[META.lon0 + i*dLon, META.lon0 + (i+1)*dLon, META.lat1 - (j+1)*dLat, META.lat1 - j*dLat], geos:[null, null, null], lod:LOD_TOP, busy:false};
    const s = chunkSpec(ch, LOD_TOP), g = core.buildGrid(s.b, s.nx, s.ny, true), geo = gridGeometry(g);   // the coarsest level is cheap and always kept
    ch.geos[LOD_TOP] = geo; ch.radius = g.radius;
    ch.mesh = new THREE.Mesh(geo, mat); ch.mesh.position.set(g.origin[0], 0, g.origin[1]); ch.mesh.onBeforeRender = () => { chunksDrawn++; };
    ch.wire = new THREE.Mesh(geo, wireMat); ch.wire.position.set(g.origin[0], 0.004, g.origin[1]); ch.wire.visible = wireOn;
    ch.dots = new THREE.Points(geo, dotsMat); ch.dots.position.copy(ch.mesh.position); ch.dots.visible = dotsOn;
    ch.centre = ch.mesh.position.clone(); scene.add(ch.mesh, ch.wire, ch.dots); chunks.push(ch);
  }
  // far view: when every chunk would be at its coarsest level anyway, the whole country is drawn as one merged grid, i.e. one draw call instead of 24
  const g = core.buildGrid([META.lon0, META.lon1, META.lat0, META.lat1], Math.ceil(SEG/LOD_STEP[LOD_TOP]), Math.ceil(SEGY/LOD_STEP[LOD_TOP]), false), geo = gridGeometry(g);
  farMesh = new THREE.Mesh(geo, mat); farMesh.position.set(g.origin[0], 0, g.origin[1]); farMesh.visible = false;
  farWire = new THREE.Mesh(geo, wireMat); farWire.position.set(g.origin[0], 0.004, g.origin[1]); farWire.visible = false;
  farDots = new THREE.Points(geo, dotsMat); farDots.position.copy(farMesh.position); farDots.visible = false; scene.add(farMesh, farWire, farDots);
}
function setChunkLod(ch, lod){ ch.lod = lod; ch.mesh.geometry = ch.wire.geometry = ch.dots.geometry = ch.geos[lod]; }
// Видимість сітки й точок: за перемикачем «Сітка», режимом «Точки» та тим, чи малюється країна однією спільною сіткою
function syncOverlays(){
  if (farWire){ farWire.visible = farView && wireOn; farDots.visible = farView && dotsOn; }
  for (const ch of chunks){ ch.wire.visible = !farView && wireOn; ch.dots.visible = !farView && dotsOn; }
}
function updateChunks(){
  let far = chunks.length > 0;
  for (const ch of chunks){
    const d = Math.max(0, camera.position.distanceTo(ch.centre) - ch.radius);
    let want = d < LOD_NEAR[0] ? 0 : d < LOD_NEAR[1] ? 1 : LOD_TOP;
    if (want > ch.lod && d < LOD_NEAR[ch.lod]*1.3) want = ch.lod;          // hysteresis: only coarsen once clearly outside the range
    if (want !== LOD_TOP || ch.lod !== LOD_TOP) far = false;
    if (want !== ch.lod){
      if (ch.geos[want]) setChunkLod(ch, want);
      else if (!ch.busy && chunkJobs < 3){
        ch.busy = true; chunkJobs++;
        Geo.call('grid', chunkSpec(ch, want)).then(g => { if (ch.geos[want]) ch.geos[want].dispose(); ch.geos[want] = gridGeometry(g); })
          .catch(err => console.warn('чанк рельєфу', err)).finally(() => { ch.busy = false; chunkJobs--; });
      }
    }
    if (!ch.busy) for (let k = 0; k < ch.lod; k++) if (ch.geos[k] && want >= ch.lod){ ch.geos[k].dispose(); ch.geos[k] = null; }   // finer levels are released as soon as the chunk has moved away
  }
  if (far !== farView){
    farView = far; farMesh.visible = far;
    for (const ch of chunks) ch.mesh.visible = !far;
    syncOverlays();
  }
}

// ---------- procedural atmospheric sky dome ----------
const skyMat = new THREE.ShaderMaterial({
  uniforms:{
    uBg:uniforms.uBg, uSun:uniforms.uSun, uNight:uniforms.uNight, uAtmo:uniforms.uAtmo,
    uHorizon:{value:new THREE.Color('#162442')}, uZenith:{value:new THREE.Color('#070b16')}
  },
  side:THREE.BackSide, depthWrite:false, depthTest:false,
  vertexShader:`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader:`precision highp float;
    uniform vec3 uBg; uniform vec3 uSun; uniform float uNight; uniform float uAtmo; uniform vec3 uHorizon; uniform vec3 uZenith;
    varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float h = clamp(d.y * 1.45 + 0.14, 0.0, 1.0);
      vec3 sky = mix(uHorizon, uZenith, pow(h, 0.65));
      float sunAmt = max(dot(d, normalize(uSun)), 0.0);
      vec3 sunGlow = mix(vec3(1.0, 0.88, 0.68), vec3(0.32, 0.56, 0.96), uNight);
      sky += sunGlow * (pow(sunAmt, 14.0)*0.16 + pow(sunAmt, 96.0)*0.22) * uAtmo;
      vec3 col = mix(uBg, sky, uAtmo);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 20), skyMat);
skyMesh.frustumCulled = false; skyMesh.renderOrder = -10;
scene.add(skyMesh);

// ---------- animated Black Sea & Sea of Azov coastal water shelf (clipped strictly outside land mask) ----------
let waterOn = true;
const seaMat = new THREE.ShaderMaterial({
  uniforms:{
    uMask:uniforms.uMask, uMaskTexel:uniforms.uMaskTexel, uSun:uniforms.uSun, uTime:uniforms.uTime,
    uNight:uniforms.uNight, uMode:uniforms.uMode, uBg:uniforms.uBg, uInk:uniforms.uInk
  },
  transparent:true, depthWrite:false, side:THREE.FrontSide,
  vertexShader:`#include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec2 aUv;
    varying vec2 vUvD; varying vec3 vWorldPos;
    void main(){
      vUvD = aUv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader:`precision highp float;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D uMask; uniform vec2 uMaskTexel; uniform vec3 uSun; uniform float uTime;
    uniform float uNight; uniform int uMode; uniform vec3 uBg; uniform vec3 uInk;
    varying vec2 vUvD; varying vec3 vWorldPos;
    void main(){
      #include <logdepthbuf_fragment>
      // Only draw outside Ukraine's land silhouette
      float inBox = step(0.0, vUvD.x)*step(vUvD.x, 1.0)*step(0.0, vUvD.y)*step(vUvD.y, 1.0);
      float land = inBox > 0.5 ? texture2D(uMask, vUvD).r : 0.0;
      if (land > 0.48) discard;
      // Geographic lon/lat reconstructed from plate UV for Black Sea & Sea of Azov basin mask
      float lon = 21.9 + vUvD.x * 18.6;
      float lat = 52.5 - vUvD.y * 8.45;
      // Coastal distance estimate by multi-radius land-mask sampling (organic curved coastal bathymetry, zero straight box edges)
      float near1 = 0.0, near2 = 0.0, near3 = 0.0, near4 = 0.0;
      for (int i = 0; i < 8; i++){
        float ang = float(i) * 0.785398;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 o1 = vUvD + dir * uMaskTexel * 20.0;
        vec2 o2 = vUvD + dir * uMaskTexel * 72.0;
        vec2 o3 = vUvD + dir * uMaskTexel * 165.0;
        vec2 o4 = vUvD + dir * uMaskTexel * 290.0;
        near1 = max(near1, step(0.0, o1.x)*step(o1.x, 1.0)*step(0.0, o1.y)*step(o1.y, 1.0) * texture2D(uMask, clamp(o1, 0.0, 1.0)).r);
        near2 = max(near2, step(0.0, o2.x)*step(o2.x, 1.0)*step(0.0, o2.y)*step(o2.y, 1.0) * texture2D(uMask, clamp(o2, 0.0, 1.0)).r);
        near3 = max(near3, step(0.0, o3.x)*step(o3.x, 1.0)*step(0.0, o3.y)*step(o3.y, 1.0) * texture2D(uMask, clamp(o3, 0.0, 1.0)).r);
        near4 = max(near4, step(0.0, o4.x)*step(o4.x, 1.0)*step(0.0, o4.y)*step(o4.y, 1.0) * texture2D(uMask, clamp(o4, 0.0, 1.0)).r);
      }
      // Restrict sea shelf strictly to southern maritime basins (Black Sea + Sea of Azov), never northern/western land borders
      float southBasin = smoothstep(47.25, 46.55, lat) * smoothstep(29.35, 30.1, lon) * smoothstep(39.0, 37.8, lon);
      float westCut = smoothstep(29.75, 30.45, lon) + smoothstep(46.05, 45.2, lat);
      float eastCut = smoothstep(38.3, 37.3, lon) + smoothstep(46.7, 45.7, lat);
      float basin = clamp(southBasin * min(1.0, westCut) * min(1.0, eastCut), 0.0, 1.0);
      // Purely organic coast-hugging bathymetry envelope + soft radial fade in the open Black Sea
      float shelf = clamp(near1*0.42 + near2*0.30 + near3*0.20 + near4*0.14, 0.0, 1.0);
      vec2 bsCenter = vec2((lon - 33.4)/4.4, (lat - 45.2)/1.85);
      float bsRadial = 1.0 - smoothstep(0.55, 1.15, length(bsCenter));
      float seaEnv = basin * smoothstep(0.04, 0.42, max(shelf, bsRadial * 0.55)) * smoothstep(43.4, 44.3, lat);
      if (seaEnv < 0.01) discard;

      // Multi-octave procedural waves + sun glint + Fresnel sky reflection
      vec2 p = vWorldPos.xz;
      float w1 = sin(p.x*16.0 + p.y*9.0 + uTime*0.9) * cos(p.y*14.0 - p.x*6.0 - uTime*0.75);
      float w2 = sin(p.x*34.0 - p.y*28.0 - uTime*1.35) * 0.5;
      float w3 = cos(p.x*68.0 + p.y*54.0 + uTime*1.9) * 0.25;
      vec3 wn = normalize(vec3((w1 + w2 + w3)*0.028, 1.0, (w2 - w1 + w3)*0.026));
      vec3 L = normalize(uSun);
      vec3 V = normalize(cameraPosition - vWorldPos);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(wn, H), 0.0), 72.0);
      float fres = pow(1.0 - max(dot(wn, V), 0.0), 3.2);

      // Bathymetric colour: luminous turquoise shallows near shore -> rich sapphire/navy deep water
      vec3 shallowCol = mix(vec3(0.14, 0.56, 0.68), vec3(0.06, 0.34, 0.48), uNight);
      vec3 deepCol    = mix(vec3(0.07, 0.24, 0.44), vec3(0.03, 0.11, 0.24), uNight);
      vec3 skyRef     = mix(vec3(0.62, 0.80, 0.96), vec3(0.16, 0.32, 0.56), uNight);
      vec3 col = mix(deepCol, shallowCol, clamp(near1*0.75 + near2*0.25, 0.0, 1.0));
      col = mix(col, skyRef, fres * 0.45);
      col += vec3(1.0, 0.95, 0.84) * spec * mix(0.85, 0.65, uNight);
      // Crisp coastal foam shimmer right next to shore
      float foam = near1 * (0.55 + 0.45*sin(p.x*26.0 + p.y*22.0 - uTime*1.8));
      col = mix(col, mix(vec3(0.88, 0.96, 1.0), vec3(0.42, 0.72, 0.88), uNight), foam * 0.24);

      // Bathymetry contour ripples for stylized modes (Neon / Blueprint)
      float alpha = seaEnv * mix(0.82, 0.86, uNight);
      if (uMode == 7) {
        float ring = smoothstep(0.02, 0.0, abs(fract(shelf * 5.0) - 0.5) - 0.04);
        col = mix(vec3(0.02, 0.08, 0.18), vec3(0.20, 0.88, 1.0), ring * 0.65 + near1 * 0.35);
        alpha = seaEnv * 0.72;
      } else if (uMode == 2) {
        float hatch = smoothstep(0.02, 0.0, abs(fract(shelf * 6.0) - 0.5) - 0.03);
        col = mix(uBg, uInk, hatch * 0.32 + near1 * 0.14);
        alpha = seaEnv * 0.65;
      }
      gl_FragColor = vec4(col, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const seaMesh = (() => {
  const g = core.buildGrid([28.6, 39.8, 43.25, 47.45], 96, 56, false);
  const geo = gridGeometry(g);
  const m = new THREE.Mesh(geo, seaMat);
  m.position.set(g.origin[0], -0.002, g.origin[1]);
  m.renderOrder = -0.5;
  m.frustumCulled = false;
  scene.add(m);
  return m;
})();

// ---------- drop shadow under the plinth ----------
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = 640; shadowCanvas.height = Math.round(640*META.h/META.w);
const shadowTex = new THREE.CanvasTexture(shadowCanvas); shadowTex.colorSpace = THREE.NoColorSpace; track(shadowTex, shadowCanvas.width, shadowCanvas.height, 4, 'тінь');
const shadowMat = new THREE.MeshBasicMaterial({map:shadowTex, transparent:true, depthWrite:false, color:0xffffff});
const SHADOW_PAD = 0.06;   // the silhouette is drawn inset in its canvas so the blur has room; the mesh covers the same padded extent
const shadowPlane = (() => {
  const dl = (META.lon1-META.lon0)*SHADOW_PAD, dp = (META.lat1-META.lat0)*SHADOW_PAD, k = 1 + 2*SHADOW_PAD;
  const g = core.buildGrid([META.lon0-dl, META.lon1+dl, META.lat0-dp, META.lat1+dp], 28, 20, false), uv = new Float32Array(g.uvg.length);
  for (let i = 0; i < uv.length; i += 2){ uv[i] = 0.5 + (g.uvg[i]-0.5)/k; uv[i+1] = 0.5 - (g.uvg[i+1]-0.5)/k; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
  const m = new THREE.Mesh(geo, shadowMat); m.userData.home = new THREE.Vector3(g.origin[0], -PLINTH - 0.02, g.origin[1]); m.position.copy(m.userData.home); m.renderOrder = -1; m.frustumCulled = false; scene.add(m); return m;
})();
function paintShadow(alpha){
  const sImg = new ImageData(META.w, META.h), sd = sImg.data;
  for (let i = 0; i < alpha.length; i++){ sd[i*4] = sd[i*4+1] = sd[i*4+2] = 255; sd[i*4+3] = alpha[i]; }
  const tmp = document.createElement('canvas'); tmp.width = META.w; tmp.height = META.h; tmp.getContext('2d').putImageData(sImg, 0, 0);
  const sctx = shadowCanvas.getContext('2d'), sw = shadowCanvas.width, sh = shadowCanvas.height, inset = 1/(1 + 2*SHADOW_PAD);
  sctx.clearRect(0, 0, sw, sh); sctx.filter = 'blur(10px)'; sctx.globalAlpha = 0.9;
  sctx.drawImage(tmp, sw*(1-inset)/2, sh*(1-inset)/2, sw*inset, sh*inset);
  shadowTex.needsUpdate = true;
}

// ---------- plinth wall along the precise outline (OSM relation 60199): top follows the terrain, black band under the rim ----------
const wallMat = new THREE.ShaderMaterial({
  uniforms:{uExag:uniforms.uExag, uScale:uniforms.uScale, uPlinth:uniforms.uPlinth, uSun:uniforms.uSun, uWall:uniforms.uWall, uMode:uniforms.uMode, uBg:uniforms.uBg, uGrid:uniforms.uGrid},
  vertexShader:`#include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aGround; attribute float aTop; uniform float uExag; uniform float uScale; uniform float uPlinth; varying vec3 vWorld; varying float vTop;
  void main(){ vTop = aTop; vec3 p = position; p.y = aTop > 0.5 ? aGround*uScale*uExag + 0.00005 : -uPlinth;
    vWorld = (modelMatrix * vec4(p, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }`,
  fragmentShader:`precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSun; uniform vec3 uWall; uniform int uMode; uniform vec3 uBg; uniform vec3 uGrid; uniform float uPlinth; varying vec3 vWorld; varying float vTop;
  void main(){
    #include <logdepthbuf_fragment>
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld))); float d = max(dot(n, normalize(uSun)), 0.0);
    float hNorm = clamp((vWorld.y + uPlinth)/max(uPlinth, 0.1), 0.0, 1.0);
    float rim = 0.42 + 0.58*smoothstep(0.0, 1.0, hNorm);
    float bevel = smoothstep(0.90, 0.955, vTop) * (1.0 - smoothstep(0.955, 0.965, vTop));
    vec3 col = uWall * (0.50 + 0.58*d) * rim + vec3(0.18, 0.22, 0.28) * bevel * 0.45;
    if (vTop > 0.955) col = vec3(0.0);   // black band along the top edge (~1 km)
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`, side:THREE.DoubleSide});
function buildCoastWall(rings){
  let np = 0; for (const r of rings) np += r.length;
  const pos = new Float32Array(np*6), grd = new Float32Array(np*2), top = new Float32Array(np*2), idx = new Uint32Array(np*6); let v = 0, k = 0;
  for (const r of rings){
    const base = v, n = r.length;
    for (let i = 0; i < n; i++){ const w = toWorld(r[i][0], r[i][1]); const h = sampleH(r[i][0], r[i][1]);
      for (let t = 0; t < 2; t++){ pos[v*3] = w.x; pos[v*3+1] = 0; pos[v*3+2] = w.z; grd[v] = h; top[v] = 1 - t; v++; } }
    for (let i = 0; i < n; i++){ const j = (i+1) % n, a = base + 2*i, b = base + 2*j; idx[k++] = a; idx[k++] = a+1; idx[k++] = b; idx[k++] = a+1; idx[k++] = b+1; idx[k++] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aGround', new THREE.BufferAttribute(grd, 1)); g.setAttribute('aTop', new THREE.BufferAttribute(top, 1)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.Mesh(g, wallMat); m.frustumCulled = false; return m;
}

// ---------- labels and markers: one instanced draw call ----------
// Glyphs are rasterised once into a signed-distance-field atlas, so text stays sharp at any size and gets its halo in the shader.
// Each frame the candidates (filtered by zoom tier) are walked in priority order and a name is drawn only where its box is still free.
const TIER_RANGE = [1e9, 1e9, 24, 13, 7.5, 1e9];   // camera distance under which a tier appears: 0 oblast centre, 1 ≥100k, 2 30–100k, 3 10–30k, 4 smaller; 5 = oblast names
function tierOf(pop, capital){ return capital ? 0 : pop >= 100000 ? 1 : pop >= 30000 ? 2 : pop >= 10000 ? 3 : 4; }
const Labels = (() => {
  const FS = 32, BUF = 6, GC = FS + 2*BUF, BASE = Math.round(FS*0.8), RAD = 8, CUT = 0.25, EDGE = 1 - CUT, AW = 1024, AH = 1024, PER = Math.floor(AW/GC), DOT_R = 9;
  const data = new Uint8Array(AW*AH);
  const tex = new THREE.DataTexture(data, AW, AH, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.needsUpdate = true; track(tex, AW, AH, 1, 'атлас підписів');
  const cv = document.createElement('canvas'); cv.width = cv.height = GC; const ctx = cv.getContext('2d', {willReadFrequently:true});
  const FONT = `600 ${FS}px Manrope, system-ui, sans-serif`;
  const glyphs = new Map(); let nextSlot = 0;
  const INF = 1e20, gO = new Float64Array(GC*GC), gI = new Float64Array(GC*GC), f = new Float64Array(GC), z = new Float64Array(GC + 1), vv = new Uint16Array(GC);
  function edt1d(grid, off, stride){   // Felzenszwalb–Huttenlocher squared distance transform along one line
    vv[0] = 0; z[0] = -INF; z[1] = INF; f[0] = grid[off];
    for (let q = 1, k = 0, s = 0; q < GC; q++){
      f[q] = grid[off + q*stride]; const q2 = q*q;
      do { const r = vv[k]; s = (f[q] - f[r] + q2 - r*r)/(q - r)/2; } while (s <= z[k] && --k > -1);
      k++; vv[k] = q; z[k] = s; z[k + 1] = INF;
    }
    for (let q = 0, k = 0; q < GC; q++){ while (z[k + 1] < q) k++; const r = vv[k], d = q - r; grid[off + q*stride] = f[r] + d*d; }
  }
  function edt(grid){ for (let x = 0; x < GC; x++) edt1d(grid, x, GC); for (let y = 0; y < GC; y++) edt1d(grid, y*GC, 1); }
  function writeSlot(s, fn){
    const ox = (s % PER)*GC, oy = Math.floor(s/PER)*GC;
    for (let y = 0; y < GC; y++) for (let x = 0; x < GC; x++) data[(oy + y)*AW + ox + x] = Math.max(0, Math.min(255, Math.round(255 - 255*(fn(x, y)/RAD + CUT))));
    tex.needsUpdate = true;
  }
  writeSlot(nextSlot++, (x, y) => Math.hypot(x + 0.5 - GC/2, y + 0.5 - GC/2) - DOT_R);   // slot 0: the round marker
  function glyph(ch){
    let g = glyphs.get(ch); if (g) return g;
    ctx.font = FONT; g = {s:-1, adv:ctx.measureText(ch).width}; glyphs.set(ch, g);
    if (ch.trim() === '' || nextSlot >= PER*Math.floor(AH/GC)) return g;
    ctx.clearRect(0, 0, GC, GC); ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic'; ctx.fillText(ch, BUF, BUF + BASE);
    const img = ctx.getImageData(0, 0, GC, GC).data;
    for (let i = 0; i < GC*GC; i++){ const a = img[i*4 + 3]/255; gO[i] = a === 1 ? 0 : a === 0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2); gI[i] = a === 1 ? INF : a === 0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2); }
    edt(gO); edt(gI);
    g.s = nextSlot++; writeSlot(g.s, (x, y) => Math.sqrt(gO[y*GC + x]) - Math.sqrt(gI[y*GC + x]));
    return g;
  }
  // styles follow the page tokens; rebuilt when the theme changes
  const ST = {}, PRI = {capital:0, obl:1, t1:2, peak:3, t2:4, t3:5, t4:6};
  // `over` — кольори сцени режиму, коли вони не збігаються з темою сторінки (білий макет у темній темі, чорний каркас у світлій)
  function restyle(over = null){
    const fg = over?.fg ?? cssColor('--fg'), bg = over?.bg ?? cssColor('--bg'), muted = over?.muted ?? cssColor('--muted'), gold = cssColor('--gold'), accent = cssColor('--accent'), white = new THREE.Color(1, 1, 1), black = new THREE.Color(0, 0, 0);
    Object.assign(ST, {
      capital:{size:12.5, edge:0.70, fill:white, fa:1, halo:black, ha:1, hw:1.5, dot:9, dfill:white, dring:accent},   // oblast centres: white name with a dark outline, white dot with a blue ring
      t1:{size:11.5, edge:0.71, fill:fg, fa:1, halo:bg, ha:0.95, hw:1.6, dot:7, dfill:gold, dring:bg},
      t2:{size:11, edge:0.74, fill:fg, fa:1, halo:bg, ha:0.95, hw:1.6, dot:7, dfill:gold, dring:bg},
      t3:{size:10.5, edge:0.74, fill:fg, fa:1, halo:bg, ha:0.95, hw:1.5, dot:5, dfill:gold, dring:bg},
      t4:{size:10, edge:0.73, fill:muted, fa:1, halo:bg, ha:0.95, hw:1.5, dot:4, dfill:muted, dring:null},
      obl:{size:10, edge:0.71, fill:fg, fa:0.74, halo:bg, ha:0.85, hw:1.6, dot:0, track:0.18, upper:true, center:true},
      peak:{size:10, edge:0.74, fill:muted, fa:1, halo:bg, ha:0.95, hw:1.5, dot:5, dfill:fg, dring:bg},
    });
  }
  restyle();
  const MAXG = isMobile ? 6000 : 16000, MAXL = isMobile ? 140 : 420, STR = 21, TEXT_DX = 8;
  const buf = new Float32Array(MAXG*STR), ib = new THREE.InstancedInterleavedBuffer(buf, STR); ib.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3)); geo.setIndex([0, 2, 1, 1, 2, 3]);
  [['aAnchor', 3, 0], ['aRect', 4, 3], ['aUvr', 4, 7], ['aFill', 4, 11], ['aHalo', 4, 15], ['aStyle', 2, 19]].forEach(([n, s, o]) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(ib, s, o)));
  geo.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms:{uAtlas:{value:tex}, uView:{value:new THREE.Vector2(innerWidth, innerHeight)}, uDpr:{value:renderer.getPixelRatio()}},
    transparent:true, depthTest:false, depthWrite:false, side:THREE.DoubleSide,
    vertexShader:`attribute vec3 aAnchor; attribute vec4 aRect; attribute vec4 aUvr; attribute vec4 aFill; attribute vec4 aHalo; attribute vec2 aStyle;
    uniform vec2 uView; uniform float uDpr; varying vec2 vUv; varying vec4 vFill; varying vec4 vHalo; varying vec2 vStyle;
    void main(){
      vec4 c = projectionMatrix * viewMatrix * vec4(aAnchor, 1.0);
      vec2 px = floor((c.xy/c.w*0.5 + 0.5)*uView*uDpr + 0.5)/uDpr;                      // anchor snapped to a device pixel: text does not shimmer
      vec2 q = px + vec2(aRect.x + position.x*aRect.z, -(aRect.y + position.y*aRect.w));
      gl_Position = c.w > 0.0 ? vec4(q/uView*2.0 - 1.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
      vUv = aUvr.xy + position.xy*aUvr.zw; vFill = aFill; vHalo = aHalo; vStyle = aStyle;
    }`,
    fragmentShader:`precision highp float;
    uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vFill; varying vec4 vHalo; varying vec2 vStyle;
    void main(){
      float d = texture2D(uAtlas, vUv).r, w = max(fwidth(d)*0.75, 0.002);
      float fill = smoothstep(vStyle.x - w, vStyle.x + w, d), halo = smoothstep(vStyle.y - w, vStyle.y + w, d);
      vec4 c = mix(vec4(vHalo.rgb, halo*vHalo.a), vec4(vFill.rgb, 1.0), fill); c.a *= vFill.a;
      if (c.a < 0.004) discard;
      gl_FragColor = c;
      #include <colorspace_fragment>
    }`});
  const mesh = new THREE.Mesh(geo, material); mesh.frustumCulled = false; mesh.renderOrder = 10; scene.add(mesh);
  const all = []; let dirty = false, n = 0;
  const stats = {shown:0, candidates:0, glyphs:0, total:0};
  function add(name, lon, lat, cls, tier, oblast, pop){
    const st = ST[cls], w = toWorld(lon, lat), text = st.upper ? name.toLocaleUpperCase('uk') : name, k = st.size/FS, gl = []; let pen = 0;
    for (const ch of text){ const g = glyph(ch); gl.push(g, pen); pen += g.adv*k + (st.track || 0)*st.size; }
    const l = {name, lon, lat, cls, tier, oblast, pop:pop || 0, pri:PRI[cls], kind:cls === 'obl' ? 'obl' : 'place', x:w.x, z:w.z, h:heights ? sampleH(lon, lat) : 0, on:true, gl, w:pen - (st.track || 0)*st.size, a:0, da:0, side:1};
    all.push(l); dirty = true; return l;
  }
  function clear(){ all.length = 0; }
  function reheight(){ for (const l of all) l.h = sampleH(l.lon, l.lat); }
  function put(ax, ay, az, rx, ry, rw, rh, s, fill, fa, halo, ha, edge, hedge){
    if (n >= MAXG) return; const o = n++*STR;
    buf[o] = ax; buf[o+1] = ay; buf[o+2] = az; buf[o+3] = rx; buf[o+4] = ry; buf[o+5] = rw; buf[o+6] = rh;
    buf[o+7] = (s % PER)*GC/AW; buf[o+8] = Math.floor(s/PER)*GC/AH; buf[o+9] = GC/AW; buf[o+10] = GC/AH;
    buf[o+11] = fill.r; buf[o+12] = fill.g; buf[o+13] = fill.b; buf[o+14] = fa;
    if (halo){ buf[o+15] = halo.r; buf[o+16] = halo.g; buf[o+17] = halo.b; buf[o+18] = ha; } else { buf[o+15] = fill.r; buf[o+16] = fill.g; buf[o+17] = fill.b; buf[o+18] = 0; }
    buf[o+19] = edge; buf[o+20] = hedge;
  }
  // screen-space occupancy grid for the overlap test; boxes are [x0, y0, x1, y1, kind] with kind 0 = name, 1 = marker
  const CS = 64, cells = [], boxes = []; let gw = 0, gh = 0, cx0 = 0, cx1 = 0, cy0 = 0, cy1 = 0;
  function span(x0, y0, x1, y1){ cx0 = Math.max(0, Math.min(gw-1, Math.floor(x0/CS) + 1)); cx1 = Math.max(0, Math.min(gw-1, Math.floor(x1/CS) + 1)); cy0 = Math.max(0, Math.min(gh-1, Math.floor(y0/CS) + 1)); cy1 = Math.max(0, Math.min(gh-1, Math.floor(y1/CS) + 1)); }
  function hit(x0, y0, x1, y1, skip, namesOnly){
    span(x0, y0, x1, y1);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++){ const c = cells[cy*gw + cx];
      for (let i = 0; i < c.length; i++){ const id = c[i], b = id*5; if (id === skip || (namesOnly && boxes[b+4] === 1)) continue; if (x0 < boxes[b+2] && x1 > boxes[b] && y0 < boxes[b+3] && y1 > boxes[b+1]) return true; } }
    return false;
  }
  function claim(x0, y0, x1, y1, kind){
    span(x0, y0, x1, y1); const id = boxes.length/5; boxes.push(x0, y0, x1, y1, kind);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) cells[cy*gw + cx].push(id);
    return id;
  }
  const vp = new THREE.Matrix4();
  function update(dt, dist, ex, on, oblOn){
    n = 0; let shown = 0, cand = 0;
    if (dirty){ all.sort((a, b) => a.pri - b.pri || b.pop - a.pop); dirty = false; }
    const W = innerWidth, H = innerHeight, step = Math.min(1, dt/0.16);
    gw = Math.floor(W/CS) + 3; gh = Math.floor(H/CS) + 3; while (cells.length < gw*gh) cells.push([]); for (let i = 0; i < gw*gh; i++) cells[i].length = 0; boxes.length = 0;
    camera.updateMatrixWorld(); vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); const e = vp.elements;
    if (on) for (const l of all){
      let vis = l.on && dist < TIER_RANGE[l.tier] && (l.kind !== 'obl' || (oblOn && dist > 1.2)), sx = 0, sy = 0; const y = l.h*SCALE*ex;
      if (vis){
        const cw = e[3]*l.x + e[7]*y + e[11]*l.z + e[15];
        if (cw <= 0) vis = false;
        else { sx = ((e[0]*l.x + e[4]*y + e[8]*l.z + e[12])/cw*0.5 + 0.5)*W; sy = (0.5 - (e[1]*l.x + e[5]*y + e[9]*l.z + e[13])/cw*0.5)*H; if (sx < -80 || sx > W + 80 || sy < -24 || sy > H + 24) vis = false; }
      }
      if (!vis){ l.a = 0; l.da = 0; continue; }
      cand++;
      // Walk order is priority order. A marker survives unless a more important name already covers it;
      // a name is drawn to the right of its marker, or to the left if the right is taken, and only where nothing placed earlier is in the way.
      const st = ST[l.cls], k = st.size/FS, hh = st.size*0.62, r = st.dot/2 + 1.5; let dotId = -1, dotOk = true, ok = false;
      if (st.dot){ dotOk = !hit(sx - r, sy - r, sx + r, sy + r, -1, true); if (dotOk) dotId = claim(sx - r, sy - r, sx + r, sy + r, 1); }
      if (dotOk && shown < MAXL){
        if (st.center){ ok = !hit(sx - l.w/2 - 4, sy - hh, sx + l.w/2 + 4, sy + hh, -1, false); if (ok) claim(sx - l.w/2 - 4, sy - hh, sx + l.w/2 + 4, sy + hh, 0); }
        else for (let t = 0; t < 2 && !ok; t++){
          const side = t === 0 ? l.side : -l.side, x0 = side > 0 ? sx + TEXT_DX - 3 : sx - TEXT_DX - l.w - 4, x1 = side > 0 ? sx + TEXT_DX + l.w + 4 : sx - TEXT_DX + 3;
          if (!hit(x0, sy - hh, x1, sy + hh, dotId, false)){ claim(x0, sy - hh, x1, sy + hh, 0); ok = true; if (side !== l.side){ l.side = side; l.a = 0; } }
        }
      }
      if (ok) shown++;
      l.a += Math.max(-step, Math.min(step, (ok ? 1 : 0) - l.a)); l.da += Math.max(-step, Math.min(step, (dotOk ? 1 : 0) - l.da));
      if (st.dot && l.da > 0.01){ const ds = st.dot/(2*DOT_R), q = GC*ds; put(l.x, y, l.z, -q/2, -q/2, q, q, 0, st.dfill, l.da, st.dring, 1, EDGE, st.dring ? Math.max(0.05, EDGE - 2/(RAD*ds)) : EDGE); }
      if (l.a > 0.01){
        const ox = (st.center ? -l.w/2 : l.side > 0 ? TEXT_DX : -TEXT_DX - l.w) - BUF*k, oy = st.size*0.36 - (BUF + BASE)*k, q = GC*k, hedge = Math.max(0.05, st.edge - st.hw/(RAD*k));
        for (let i = 0; i < l.gl.length; i += 2){ const g = l.gl[i]; if (g.s >= 0) put(l.x, y, l.z, ox + l.gl[i+1], oy, q, q, g.s, st.fill, st.fa*l.a, st.halo, st.ha, st.edge, hedge); }
      }
    }
    geo.instanceCount = n; ib.clearUpdateRanges(); ib.addUpdateRange(0, n*STR); ib.needsUpdate = true; mesh.visible = n > 0;
    stats.shown = shown; stats.candidates = cand; stats.glyphs = n; stats.total = all.length;
  }
  const ready = (document.fonts && document.fonts.load ? Promise.race([document.fonts.load(FONT, 'Київ'), new Promise(r => setTimeout(r, 2500))]) : Promise.resolve()).catch(() => {});
  return {add, clear, reheight, update, restyle, stats, ready, all, material};
})();

// ---------- 3D cities: detail satellite patches + OSM buildings, loaded on approach and released when the camera leaves ----------
const CITY3D = [];                       // registry entries + runtime state
const LOAD_DIST = 3.0, UNLOAD_DIST = 6.0, SHOW_DIST = 2.5;
const sunLight = new THREE.DirectionalLight(0xfff6e8, 2.5);
const rimLight = new THREE.DirectionalLight(0x88b4ff, 0.55);
const hemiLight = new THREE.HemisphereLight(0xdce8ff, 0x6b6054, 1.15);
scene.add(sunLight, rimLight, hemiLight);
const BLD_COLORS = ['#d8c8ae', '#c6ccd6', '#b9bfc8', '#d9b182', '#a39d95'].map(h => new THREE.Color(h));   // houses, apartments, industrial/commercial, public, garages
// Facade tiles (facades.json): per category a repeating texture with its size in metres; UVs are written in tile units so floors stay 2.8 m.
const FACADES = {};
function patchBld(mat, lit = false){
  mat.onBeforeCompile = sh => {
    sh.uniforms.uExag = uniforms.uExag; sh.uniforms.uBExag = uniforms.uBExag; sh.uniforms.uScale = uniforms.uScale;
    sh.uniforms.uNight = uniforms.uNight; sh.uniforms.uLit = {value:lit ? 1 : 0};
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround; uniform float uExag; uniform float uBExag; uniform float uScale; varying float vBldAo; varying float vBldH; varying vec2 vBldPos;')
      .replace('#include <begin_vertex>', 'vBldH = position.y;\nvBldPos = position.xz;\nvBldAo = clamp(0.66 + 0.34 * smoothstep(0.0, 18.0, position.y), 0.66, 1.0);\nvec3 transformed = vec3(position.x, (aGround*uExag + position.y*uBExag)*uScale + 0.00002*uExag, position.z);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBExag; uniform float uNight; uniform float uLit; varying float vBldAo; varying float vBldH; varying vec2 vBldPos;')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n vec4 sampledDiffuseColor = texture2D( map, vec2(vMapUv.x, vMapUv.y*uBExag) );\n diffuseColor *= sampledDiffuseColor;\n#endif\ndiffuseColor.rgb *= vBldAo;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uLit > 0.5 && uNight > 0.5 && vBldH > 3.2){\n  float fl = fract(vBldH / 3.1);\n  float colGrid = fract((vBldPos.x + vBldPos.y) * 9500.0);\n  float win = step(0.28, fl) * step(fl, 0.72) * step(0.22, colGrid) * step(colGrid, 0.78);\n  float cellHash = fract(sin(floor(vBldH / 3.1)*127.1 + floor((vBldPos.x + vBldPos.y)*9500.0)*311.7)*43758.5453);\n  float litWin = win * step(0.64, cellHash);\n  totalEmissiveRadiance += vec3(1.0, 0.78, 0.44) * litWin * 0.38;\n}');
  };
  return mat;
}
const ROOF_COLORS = ['#8a6b50', '#6f6a62', '#8d8f90', '#7d7267', '#6e665c'];
const roofMats = ROOF_COLORS.map(h => patchBld(new THREE.MeshLambertMaterial({color:h, vertexColors:true, flatShading:true})));   // roof colour per category modulated by per-building/apex shading
const wallMats = BLD_COLORS.map((_, idx) => patchBld(new THREE.MeshLambertMaterial({vertexColors:true, flatShading:true}), idx === 1 || idx === 3));
const bldMats = [...roofMats, ...wallMats];
// Режими-креслення малюють забудову без фасадів: білий макет, сіра відмивка, світлий каркас або неоновий каркас
const monoMats = (color, wire = false) => Array.from({length:10}, () => patchBld(wire
  ? new THREE.MeshBasicMaterial({color, wireframe:true, transparent:true, opacity:0.45, depthWrite:false})
  : new THREE.MeshLambertMaterial({color, vertexColors:true, flatShading:true})));
const clayMats = monoMats('#f4f4f2'), paperMats = monoMats('#e9e4d6'), shadeMats = monoMats('#cfcfcf'), wireBld = monoMats('#e6f0ff', true), neonBld = monoMats('#8df3ff', true);
const bldSetFor = m => m === 3 ? clayMats : m === 2 ? paperMats : m === 5 ? shadeMats : m === 4 || m === 6 ? wireBld : m === 7 ? neonBld : bldMats;
async function loadFacades(){
  try {
    const spec = await fetchJson('facades.json');
    for (const k in spec){
      const f = spec[k], tex = imageTexture(await loadImage(f.file), 'фасад'); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      if (FACADES[k]) dropTex(FACADES[k].tex);
      FACADES[k] = {...f, tex};
      wallMats[+k].map = tex; wallMats[+k].needsUpdate = true; roofMats[+k].color.set(f.roof);
    }
  } catch (e) { console.warn('facades.json', e); }
}
const bldOpts = () => { const fac = {}; for (const k in FACADES) fac[k] = [FACADES[k].tileW, FACADES[k].tileH]; return {skipCat:isMobile ? 4 : -1, fac, colors:BLD_COLORS.map(c => [c.r, c.g, c.b])}; };
let bldOn = true, totalBld = 0;
const cityHoles = [], fineHoles = [], coarseHoles = [];
const rectUv = (c, inset) => [(c.tl.x+inset+MAPW/2)/MAPW, (c.tl.z+inset+MAPH/2)/MAPH, (c.br.x-inset+MAPW/2)/MAPW, (c.br.z-inset+MAPH/2)/MAPH];
function syncHoles(){
  const all = cityHoles.concat(fineHoles, coarseHoles).slice(0, 48);
  all.forEach((h, i) => uniforms.uHoles.value[i].set(h[0], h[1], h[2], h[3]));
  uniforms.uHoleN.value = all.length; uniforms.uCityN.value = Math.min(cityHoles.length, 48); uniforms.uFineN.value = Math.min(cityHoles.length + fineHoles.length, 48);
}
function dropHole(list, h){ const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); syncHoles(); }
async function registerCities(){
  await loadFacades();
  const entries = await fetchJson('cities3d.json');
  try { for (const e of await fetchJson('villages.json')) entries.push({...e, kind:'villages'}); } catch (e) { console.warn('villages.json', e); }
  for (const e of entries){
    const [lon0, lon1, lat0, lat1] = e.bbox;
    CITY3D.push({...e, lon0, lon1, lat0, lat1, tl:toPlate(lon0, lat1), br:toPlate(lon1, lat0), centre:toWorld(e.centre[0], e.centre[1]), centre0:e.centre,
      lonM:111320*Math.cos(THREE.MathUtils.degToRad((lat0+lat1)/2)), state:'idle', patch:null, hole:null, bldMesh:null});
  }
  CITY3D.sort((a, b) => b.count - a.count);
  totalBld = CITY3D.reduce((s, c) => s + c.count, 0);
  buildCityPanel();
  $('r-b').textContent = packsSummary();
}
const isVillage = c => c.kind === 'villages';
function packsSummary(){ const cities = CITY3D.filter(c => !isVillage(c)).length, cells = CITY3D.length - cities; return cities + ' міст' + (cells ? ', ' + cells + ' клітинок сіл' : '') + ' · ' + totalBld.toLocaleString('uk-UA'); }
let tgtP = {x:0, z:0};   // look-at point in plate units, refreshed every frame; tile rectangles are tested against it
function packDist(c){ const dx = Math.max(c.tl.x - tgtP.x, 0, tgtP.x - c.br.x), dz = Math.max(c.tl.z - tgtP.z, 0, tgtP.z - c.br.z); return Math.hypot(dx, dz); }
function cityMesh(r){
  const geo = new THREE.BufferGeometry();
  for (const [start, count, m] of r.groups) geo.addGroup(start, count, m);
  geo.setAttribute('position', new THREE.BufferAttribute(r.pos, 3)); geo.setAttribute('aGround', new THREE.BufferAttribute(r.grd, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(r.col, 3, true)); geo.setIndex(new THREE.BufferAttribute(r.idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r.radius + 0.05);
  const m = new THREE.Mesh(geo, bldSetFor(uniforms.uMode.value)); m.position.set(r.origin[0], 0, r.origin[1]); m.visible = false; return m;   // vertices are relative to the pack centre
}
async function loadCity(c){
  c.state = 'loading';
  try {
    if (!c.patch && c.sat){
      const tex = imageTexture(await loadImage(c.sat), 'місто');
      const w = c.br.x - c.tl.x, h = c.br.z - c.tl.z, seg = Math.round(Math.max(120, Math.min(300, w*700)));
      const g = await Geo.call('grid', {b:c.bbox, nx:seg, ny:Math.round(seg*h/w), skirt:true});
      c.patch = new THREE.Mesh(gridGeometry(g), patchMaterial(tex, 3, 0.6, c.bbox)); c.patch.position.set(g.origin[0], 0, g.origin[1]); scene.add(c.patch);
      c.hole = rectUv(c, 0); cityHoles.push(c.hole); syncHoles();   // the base surface is cut out exactly under the patch; the patch skirt closes the seam
    }
    // footprints travel as a lossless grayscale PNG (one byte per pixel) because the host serves images, not raw binaries; decoding and meshing run in the worker
    const r = await Geo.call('city', {blob:await loadBlob(c.bld), c:{b:c.bbox, lonM:c.lonM}, opts:bldOpts()});
    if (c.state !== 'loading') return;   // the layer was reloaded meanwhile
    c.bldMesh = cityMesh(r); scene.add(c.bldMesh); c.state = 'ready';
  } catch (err) { c.state = 'error'; console.error(c.slug, err); }
}
function unloadCity(c){
  if (c.bldMesh){ scene.remove(c.bldMesh); c.bldMesh.geometry.dispose(); c.bldMesh = null; }
  if (c.patch){ scene.remove(c.patch); dropTex(c.patch.material.uniforms.uSat.value); c.patch.geometry.dispose(); c.patch.material.dispose(); c.patch = null; dropHole(cityHoles, c.hole); c.hole = null; }
  c.state = 'idle';
}
let nearestCity = null;
const VIL_MAXY = 0.6, VIL_CAP = isMobile ? 2 : 6;
function updateCities(){
  let best = null, bestD = Infinity, loading = false;
  const y = camera.position.y, vilR = Math.max(0.4, 1.3*y), readyVil = [];
  for (const c of CITY3D){
    if (c.state === 'loading') loading = true;
    if (isVillage(c)){
      const d = packDist(c);
      if (c.state === 'ready'){ c.bldMesh.visible = bldOn && y < VIL_MAXY*1.2; if (y > VIL_MAXY*1.5 || d > vilR*1.7) unloadCity(c); else readyVil.push(c); }
      if (d < bestD && y < VIL_MAXY && d < 0.2){ bestD = d; best = c; }
      continue;
    }
    const d = camera.position.distanceTo(c.centre);
    if (d < bestD){ bestD = d; best = c; }
    if (c.state === 'ready'){ c.bldMesh.visible = bldOn && d < SHOW_DIST; if (d > UNLOAD_DIST) unloadCity(c); }
  }
  if (!loading){
    let pick = null;
    for (const c of CITY3D) if (c.state === 'idle' && !isVillage(c) && camera.position.distanceTo(c.centre) < LOAD_DIST){ pick = c; break; }
    if (!pick && y < VIL_MAXY){
      let bd = vilR;
      for (const c of CITY3D) if (c.state === 'idle' && isVillage(c)){ const d = packDist(c); if (d < bd){ bd = d; pick = c; } }
      if (pick && readyVil.length >= VIL_CAP){ readyVil.sort((a, b) => packDist(b) - packDist(a)); if (packDist(readyVil[0]) > bd) unloadCity(readyVil[0]); else pick = null; }
    }
    if (pick) loadCity(pick);
  }
  if (best !== nearestCity && bestD < SHOW_DIST){ nearestCity = best; $('r-b').textContent = best.name + ' · ' + best.count.toLocaleString('uk-UA'); }
  else if (bestD >= SHOW_DIST && nearestCity){ nearestCity = null; $('r-b').textContent = packsSummary(); }
}
function flyToCity(c){
  const t = c.centre.clone(); t.y = sampleH(c.centre0[0], c.centre0[1])*SCALE*targetExag;
  flyTo = {from:camera.position.clone(), to:t.clone().add(new THREE.Vector3(-0.09, 0.15, 0.22)), tFrom:controls.target.clone(), tTo:t, t0:performance.now(), dur:1150};
  if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); }
  if (c.state === 'idle') loadCity(c);
  togglePop2(false);
}
function flyToPlace(item){
  if (item.city3d){ flyToCity(item.city3d); return; }
  if (item.oblast && CITY_DATA && CITY_DATA[item.oblast] && !selected.has(item.oblast)){
    selected.add(item.oblast);
    const cb = $('ob-' + item.oblast); if (cb) cb.checked = true;
    applyOblasts();
  }
  const t = toWorld(item.lon, item.lat); t.y = sampleH(item.lon, item.lat)*SCALE*targetExag;
  const dist = item.pop >= 100000 ? 0.55 : item.pop >= 25000 ? 0.42 : 0.34;
  flyTo = {from:camera.position.clone(), to:t.clone().add(new THREE.Vector3(-dist*0.38, dist*0.62, dist*0.85)), tFrom:controls.target.clone(), tTo:t, t0:performance.now(), dur:1100};
  if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); }
  togglePop2(false);
}
function buildCityPanel(query = ''){
  const ul = $('cities3d'); if (!ul) return;
  ul.textContent = '';
  const items = searchPlaces(query, CITY3D, CITY_DATA, 36);
  const cnt = $('cities-count');
  if (cnt){
    const q = String(query || '').trim();
    cnt.textContent = q ? (items.length ? 'Знайдено: ' + items.length : 'Нічого не знайдено') : (items.length + ' міст у 3D');
  }
  if (!items.length){
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Спробуйте іншу назву міста чи області';
    ul.append(li); return;
  }
  for (const item of items){
    const li = document.createElement('li');
    const wrap = document.createElement('div'); wrap.className = 'cn-wrap';
    const lab = document.createElement('span'); lab.className = 'cn'; lab.textContent = item.name;
    wrap.append(lab);
    if (item.oblast){ const sub = document.createElement('em'); sub.textContent = item.oblast; wrap.append(sub); }
    const sm = document.createElement('small');
    if (item.city3d){
      const b3 = document.createElement('span'); b3.className = 'badge-3d'; b3.textContent = '3D';
      sm.append(b3, ' ' + item.count3d.toLocaleString('uk-UA'));
    } else if (item.pop > 0){
      sm.textContent = item.pop >= 1000 ? Math.round(item.pop/1000) + ' тис.' : String(item.pop);
    }
    const go = document.createElement('button'); go.className = 'go'; go.type = 'button'; go.textContent = '→'; go.title = 'Перелетіти: ' + item.name;
    go.addEventListener('click', () => flyToPlace(item));
    li.addEventListener('dblclick', () => flyToPlace(item));
    li.append(wrap, sm, go); ul.append(li);
  }
}
const citySearchEl = $('city-search');
if (citySearchEl) citySearchEl.addEventListener('input', () => buildCityPanel(citySearchEl.value));

// ---------- regional imagery tiles: two layers (z11 ≈ 75 m/px, z12 ≈ 38 m/px) around the look-at point ----------
// A tile first arrives at half resolution (a quarter of the GPU memory) and is swapped for the full image only once the camera is low enough to resolve it.
const REG_LAYERS = [
  {name:'coarse', file:'regions.json',   mode:1, lift:0.0, holes:coarseHoles, maxY:4.5, cap:isMobile ? 2 : 6, segX:SEG/6,  segY:SEGY/4, list:[]},
  {name:'fine',   file:'regions12_east.json', mode:2, lift:0.3, holes:fineHoles,   maxY:1.6, cap:isMobile ? 2 : 6, segX:SEG/12, segY:SEGY/8, list:[]},
];
const REGIONS = REG_LAYERS;   // kept for the debug hook
const HALF_ABOVE = 0.5, FULL_BELOW = 0.4;   // fractions of the layer's maxY
async function registerRegions(){
  for (const L of REG_LAYERS){
    try {
      for (const e of await fetchJson(L.file)){ const [lon0, lon1, lat0, lat1] = e.bbox; L.list.push({...e, layer:L, tl:toPlate(lon0, lat1), br:toPlate(lon1, lat0), state:'idle', mesh:null, hole:null, half:false}); }
    } catch (err) { console.warn(L.file, err); }
  }
}
function regDist(rg){ const dx = Math.max(rg.tl.x - tgtP.x, 0, tgtP.x - rg.br.x), dz = Math.max(rg.tl.z - tgtP.z, 0, tgtP.z - rg.br.z); return Math.hypot(dx, dz); }   // from the look-at point, in the plate plane
async function regionTexture(rg, half){
  const img = await loadImage(rg.sat); let src = img;
  if (half){ src = document.createElement('canvas'); src.width = img.naturalWidth >> 1; src.height = img.naturalHeight >> 1; src.getContext('2d').drawImage(img, 0, 0, src.width, src.height); }
  return imageTexture(src, 'тайл ' + rg.layer.name);
}
async function loadRegion(rg, half){
  const L = rg.layer; rg.state = 'loading';
  try {
    const [tex, g] = await Promise.all([regionTexture(rg, half), Geo.call('grid', {b:rg.bbox, nx:L.segX, ny:L.segY, skirt:true})]);
    if (rg.state !== 'loading'){ dropTex(tex); return; }
    rg.mesh = new THREE.Mesh(gridGeometry(g), patchMaterial(tex, L.mode, L.lift, rg.bbox)); rg.mesh.position.set(g.origin[0], 0, g.origin[1]); scene.add(rg.mesh);
    rg.hole = rectUv(rg, 0); L.holes.push(rg.hole); syncHoles(); rg.half = half; rg.state = 'ready';
  } catch (err) { rg.state = 'error'; console.error(rg.slug, err); }
}
async function sharpenRegion(rg){
  rg.state = 'loading';
  try { const tex = await regionTexture(rg, false); if (!rg.mesh){ dropTex(tex); return; } const u = rg.mesh.material.uniforms.uSat; dropTex(u.value); u.value = tex; rg.half = false; rg.state = 'ready'; }
  catch (err) { rg.state = 'ready'; rg.half = false; console.warn(rg.slug, err); }
}
function unloadRegion(rg){
  if (!rg.mesh){ rg.state = 'idle'; return; }
  scene.remove(rg.mesh); dropTex(rg.mesh.material.uniforms.uSat.value); rg.mesh.geometry.dispose(); rg.mesh.material.dispose(); rg.mesh = null;
  dropHole(rg.layer.holes, rg.hole); rg.hole = null; rg.state = 'idle';
}
function updateRegions(){
  const y = camera.position.y;
  for (const L of REG_LAYERS){
    const loadR = Math.max(0.5, 1.3*y);
    let loading = false, ready = [];
    for (const rg of L.list){
      if (rg.state === 'loading') loading = true;
      if (rg.state === 'ready'){ if (y > L.maxY*1.4 || regDist(rg) > loadR*1.7) unloadRegion(rg); else ready.push(rg); }
    }
    if (loading || y > L.maxY) continue;
    let best = null, bd = loadR;
    for (const rg of L.list) if (rg.state === 'idle'){ const d = regDist(rg); if (d < bd){ bd = d; best = rg; } }
    if (best){
      if (ready.length >= L.cap){ ready.sort((a, b) => regDist(b) - regDist(a)); if (regDist(ready[0]) > bd) unloadRegion(ready[0]); else best = null; }
      if (best){ loadRegion(best, y > L.maxY*HALF_ABOVE); continue; }
    }
    if (y < L.maxY*FULL_BELOW){ let up = null, ud = Infinity; for (const rg of ready) if (rg.half){ const d = regDist(rg); if (d < ud){ ud = d; up = rg; } } if (up) sharpenRegion(up); }
  }
}

// ---------- cities by oblast ----------
let CITY_DATA = null; const oblastLabels = new Map(); const centres = new Map(); let selected = new Set(DEFAULT_OBLASTS);
try { const s = JSON.parse(localStorage.getItem('ukr3d.oblasts')); if (Array.isArray(s)) selected = new Set(s); } catch(e){}
function buildOblast(name){
  if (oblastLabels.has(name) || !CITY_DATA[name]) return;
  const list = [];
  for (const [n, lon, lat, pop, place, cap] of CITY_DATA[name]){
    if (cap) continue;                       // oblast centres live in `centres`, always on
    const tier = tierOf(pop, 0);
    list.push(Labels.add(n, lon, lat, 't'+tier, tier, name, pop));
  }
  oblastLabels.set(name, list);
}
function applyOblasts(){
  if (!CITY_DATA) return;
  for (const name of selected) buildOblast(name);
  let count = centres.size;
  for (const [name, list] of oblastLabels){ const on = selected.has(name); for (const l of list) l.on = on; if (on) count += list.length; }
  $('r-n').textContent = String(count);
  try { localStorage.setItem('ukr3d.oblasts', JSON.stringify([...selected])); } catch(e){}
}
function oblastCentroid(name){
  const cs = CITY_DATA[name]; let x = 0, y = 0; for (const c of cs){ x += c[1]; y += c[2]; } return toWorld(x/cs.length, y/cs.length);
}
function buildOblastPanel(){
  const ul = $('obl'); ul.textContent = '';
  const names = Object.keys(CITY_DATA).sort((a, b) => a.localeCompare(b, 'uk'));
  for (const name of names){
    const li = document.createElement('li'); const lab = document.createElement('label'); const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = 'ob-' + name; cb.checked = selected.has(name);
    cb.addEventListener('change', () => { cb.checked ? selected.add(name) : selected.delete(name); applyOblasts(); });
    const sp = document.createElement('span'); sp.textContent = name; const sm = document.createElement('small'); sm.textContent = CITY_DATA[name].length;
    lab.append(cb, sp, sm);
    const go = document.createElement('button'); go.className = 'go'; go.type = 'button'; go.textContent = '→'; go.title = 'Показати область';
    go.addEventListener('click', () => { if (!selected.has(name)){ selected.add(name); cb.checked = true; applyOblasts(); }
      const c = oblastCentroid(name); flyTo = {from:camera.position.clone(), to:c.clone().add(new THREE.Vector3(-1.2, 5.2, 6.2)), tFrom:controls.target.clone(), tTo:c, t0:performance.now()};
      if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); } });
    li.append(lab, go); ul.append(li);
  }
  $('o-all').onclick = () => { selected = new Set(names); ul.querySelectorAll('input').forEach(i => i.checked = true); applyOblasts(); };
  $('o-none').onclick = () => { selected = new Set(); ul.querySelectorAll('input').forEach(i => i.checked = false); applyOblasts(); };
}

// ---------- layers: each one owns its files and GPU resources and can be reloaded on its own, without touching the rest of the scene ----------
const lmsg = $('l-msg'), lbar = $('l-bar');
const setProgress = (p, m) => { lbar.style.setProperty('--p', (p*100).toFixed(0)+'%'); if (m) lmsg.textContent = m; };
const Layers = {}, layerOrder = [];
function defLayer(id, title, load, unload){ Layers[id] = {id, title, load, unload, state:'idle', error:null}; layerOrder.push(id); }
async function loadLayer(id, fatal){
  const L = Layers[id]; if (L.state === 'loading') return; L.state = 'loading'; L.error = null; drawLayerList();
  try { await L.load(); L.state = 'ready'; }
  catch (err) { L.state = 'error'; L.error = err.message; console.warn(L.title, err); if (fatal){ drawLayerList(); throw err; } }
  drawLayerList();
}
async function reloadLayer(id){ const L = Layers[id]; if (!L || L.state === 'loading') return; if (L.unload) L.unload(); await loadLayer(id); if (id === 'terrain' && Layers.boundary.state !== 'loading') await reloadLayer('boundary'); }
let wallMesh = null, booting = true;
defLayer('terrain', 'Рельєф (DEM)', async () => {
  const blob = await loadBlob('heights.png', p => { if (booting) setProgress(p*0.6, 'Завантаження висот…'); });
  if (booting) setProgress(0.62, 'Розпакування рельєфу…');
  const r = await Geo.call('heights', {blob, grow:20});
  heights = r.heights; core.setHeights(heights);
  const dataTex = new THREE.DataTexture(r.half, META.w, META.h, THREE.RGBAFormat, THREE.HalfFloatType);
  dataTex.minFilter = THREE.LinearFilter; dataTex.magFilter = THREE.LinearFilter; dataTex.generateMipmaps = false; dataTex.needsUpdate = true; track(dataTex, META.w, META.h, 8, 'висоти й нормалі');
  dropTex(uniforms.uData.value); uniforms.uData.value = dataTex;
  paintShadow(r.alpha); initChunks(); Labels.reheight();
});
defLayer('boundary', 'Контур і цоколь', async () => {
  const [mimg, rings] = await Promise.all([loadImage('mask.png'), fetchJson('coast.json')]);
  const mt = imageTexture(mimg, 'контур', {data:true, red:true, mips:false});
  dropTex(uniforms.uMask.value); uniforms.uMask.value = mt; uniforms.uMaskTexel.value.set(1/mimg.naturalWidth, 1/mimg.naturalHeight);
  if (wallMesh){ scene.remove(wallMesh); wallMesh.geometry.dispose(); }
  wallMesh = buildCoastWall(rings); scene.add(wallMesh);
});
defLayer('places', 'Міста й підписи', async () => {
  await Labels.ready;
  CITY_DATA = await fetchJson('cities.json');
  selected = new Set([...selected].filter(n => CITY_DATA[n]));
  for (const name in CITY_DATA) for (const [n, lon, lat, pop, place, cap] of CITY_DATA[name]) if (cap && !centres.has(n)) centres.set(n, Labels.add(n, lon, lat, 'capital', 0, name, pop));
  PEAKS.forEach(([n, lon, lat]) => Labels.add(n, lon, lat, 'peak', 1, null, 0));
  try { for (const [name, lon, lat] of await fetchJson('oblasts.json')) Labels.add(name, lon, lat, 'obl', 5, null, 0); } catch (err) { console.warn('назви областей не завантажились', err); }
  buildOblastPanel(); applyOblasts(); buildCityPanel(citySearchEl ? citySearchEl.value : '');
}, () => { Labels.clear(); oblastLabels.clear(); centres.clear(); });
defLayer('imagery', 'Супутникові знімки', async () => {
  const satImg = await loadImage('sat.jpg', p => { if (booting) setProgress(0.7 + p*0.3, 'Завантаження знімків…'); });
  const sat = imageTexture(satImg, 'знімок України'); dropTex(uniforms.uSat.value); uniforms.uSat.value = sat;
  await registerRegions();
}, () => { for (const L of REG_LAYERS){ for (const rg of L.list) unloadRegion(rg); L.list.length = 0; } });
defLayer('borders', 'Кордони та лінія зіткнення', async () => {
  const bt = imageTexture(await loadImage('borders.png'), 'кордони', {data:true});
  if (uniforms.uBorders.value !== blackTex) dropTex(uniforms.uBorders.value);
  uniforms.uBorders.value = bt; uniforms.uBorderOn.value = bordersOn ? 1 : 0;
  fetchJson('front_meta.json').then(m => { $('front-date').textContent = m.datetime.replace(' o ', ' '); }).catch(() => {});
});
defLayer('buildings', 'Забудова', registerCities, () => { for (const c of CITY3D) unloadCity(c); CITY3D.length = 0; nearestCity = null; });

async function init(){
  await loadLayer('terrain', true);
  setProgress(0.64, 'Контур кордону…'); await loadLayer('boundary');
  setProgress(0.68, 'Завантаження міст…'); await loadLayer('places');
  setProgress(0.7, 'Завантаження знімків…'); await loadLayer('imagery', true);
  await loadLayer('borders');
  setProgress(1, 'Готово'); booting = false;
  $('loader').classList.add('off');
  startTime = performance.now(); ready = true;
  if (EMBED) Embed.onReady();
  loadLayer('buildings').then(() => { if (Layers.buildings.state === 'error') $('r-b').textContent = 'не завантажилась'; });
}

// ---------- theme and view modes ----------
// Вигляд: 0 супутник, 1 рельєф (гіпсометрія), 2 креслення (горизонталі на папері), 3 макет (білий архітектурний макет),
// 4 каркас (світла сітка на чорному), 5 відмивка (сіра тінь рельєфу), 6 точки (хмара точок), 7 неон (термоградієнт).
// Перші два беруть кольори з теми сторінки; решта мають власні папір, туш, тло й стіну плінта, однакові в обох темах там,
// де сам вигляд це диктує (чорне тло каркаса), і підлаштовані під тему там, де ні (сіре тло макета).
const MODE = {sat:0, hyp:1, con:2, model:3, wire:4, shade:5, dots:6, neon:7};
const SCENE_STYLES = {
  [MODE.con]:  {light:{bg:'#e9e4d7', paper:'#f4f0e5', ink:'#2b2b2b', wall:'#cfc8b8', fg:'#1a1a1a', muted:'#5a5a5a'}, dark:{bg:'#0b0e15', paper:'#141926', ink:'#c9d2e3', wall:'#1b2130', fg:'#e8edf6', muted:'#8e9ab0'}},
  [MODE.model]:{light:{bg:'#d8dce2', paper:'#f3f3f1', ink:'#7f838a', wall:'#e2e2e0', fg:'#1a1f2b', muted:'#4f5663'}, dark:{bg:'#171b24', paper:'#eeeeec', ink:'#7f838a', wall:'#d6d6d3', fg:'#e8edf6', muted:'#9aa3b5'}},
  [MODE.wire]: {light:{bg:'#04060a', paper:'#0b0e14', ink:'#e6f0ff', wall:'#0c1017', fg:'#eef3ff', muted:'#9fb0c4'}, dark:null},
  [MODE.shade]:{light:{bg:'#cdd0d5', paper:'#d9d9d9', ink:'#3a3a3a', wall:'#9c9c9c', fg:'#1a1a1a', muted:'#555555'}, dark:{bg:'#14161a', paper:'#d2d2d2', ink:'#3a3a3a', wall:'#8c8c8c', fg:'#e8e8e8', muted:'#9a9a9a'}},
  [MODE.dots]: {light:{bg:'#03050a', paper:'#0b0e14', ink:'#ffffff', wall:'#070a10', fg:'#eef3ff', muted:'#9fb0c4'}, dark:null},
  [MODE.neon]: {light:{bg:'#05070d', paper:'#0b0e14', ink:'#8df3ff', wall:'#0a1020', fg:'#eef3ff', muted:'#9fb0c4'}, dark:null},
};
function sceneStyle(m = uniforms.uMode.value){
  const dark = document.documentElement.dataset.theme !== 'light';
  const s = SCENE_STYLES[m]; if (!s) return null;
  return s[dark ? 'dark' : 'light'] || s.light;   // чорні вигляди однакові в обох темах
}
function applyTheme(){
  const s = sceneStyle();
  const dark = document.documentElement.dataset.theme !== 'light';
  const army = document.documentElement.dataset.module === 'army';
  const photo = uniforms.uMode.value === MODE.sat || uniforms.uMode.value === MODE.hyp;
  uniforms.uWall.value = new THREE.Color(s ? s.wall : css('--wall')); uniforms.uBg.value = new THREE.Color(s ? s.bg : css('--bg')); uniforms.uGrid.value = cssColor('--grid');
  uniforms.uInk.value = new THREE.Color(s ? s.ink : css('--grid')); uniforms.uPaper.value = new THREE.Color(s ? s.paper : css('--bg'));
  uniforms.uNight.value = dark ? 1 : 0;
  uniforms.uAtmo.value = photo ? 1 : 0;
  skyMat.uniforms.uHorizon.value.set(dark ? (army ? '#142616' : '#142342') : '#c8daee');
  skyMat.uniforms.uZenith.value.set(dark ? (army ? '#070f08' : '#060a14') : '#e9f0f8');
  seaMesh.visible = waterOn && (photo || uniforms.uMode.value === MODE.neon || uniforms.uMode.value === MODE.con);
  renderer.toneMappingExposure = photo ? (dark ? 1.06 : 1.04) : 1.0;
  renderer.setClearColor(uniforms.uBg.value, 1); shadowMat.color = new THREE.Color(css('--shadow').replace(/rgba\(([^,]+,[^,]+,[^,]+),[^)]*\)/, 'rgb($1)')); shadowMat.opacity = parseFloat(css('--shadow').split(',')[3]) || 0.5;
  shadowPlane.visible = !(s && parseInt(s.bg.slice(1, 3), 16) < 0x10);   // на чорному тлі тінь невидима — не малюємо
  Labels.restyle(s ? {fg:new THREE.Color(s.fg), bg:new THREE.Color(s.bg), muted:new THREE.Color(s.muted)} : null);
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});

// ---------- UI ----------
const setPressed = (b, v) => b.setAttribute('aria-pressed', String(v));
const modeBtns = {[MODE.sat]:$('m-sat'), [MODE.hyp]:$('m-hyp'), [MODE.shade]:$('m-shade'), [MODE.con]:$('m-con'), [MODE.model]:$('m-model'), [MODE.wire]:$('m-wire'), [MODE.dots]:$('m-dots'), [MODE.neon]:$('m-neon')};
function setMode(m){
  if (!(m in modeBtns)) m = MODE.sat;
  uniforms.uMode.value = m; for (const k in modeBtns) setPressed(modeBtns[k], +k === m);
  const legend = $('legend'); legend.style.display = m === MODE.hyp || m === MODE.neon ? 'flex' : 'none'; legend.classList.toggle('neon', m === MODE.neon);
  dotsOn = m === MODE.dots; syncOverlays();
  const set = bldSetFor(m); for (const c of CITY3D) if (c.bldMesh) c.bldMesh.material = set;
  applyTheme();
  try{localStorage.setItem('ukr3d.mode', m)}catch(e){}
}
Object.entries(modeBtns).forEach(([m,b]) => b.addEventListener('click', () => setMode(+m)));
let targetExag = EMBED ? 1 : 2.5;
const exagEl = $('exag'), exagV = $('exag-v');
function setExag(v){
  targetExag = Math.max(1, Math.min(10, Number(v) || 1));
  if (exagEl) exagEl.value = String(targetExag);
  if (exagV) exagV.textContent = targetExag.toLocaleString('uk-UA', {maximumFractionDigits:1}) + '×';
  if (!EMBED) try { localStorage.setItem('ukr3d.exag', String(targetExag)); } catch(e){}
}
if (!EMBED) {
  try { const sv = localStorage.getItem('ukr3d.exag'); if (sv !== null && isFinite(+sv)) targetExag = Math.max(1, Math.min(10, +sv)); } catch(e){}
  if (exagEl){ exagEl.addEventListener('input', () => setExag(exagEl.value)); setExag(targetExag); }
}
function setSun(){ const az = +$('sun').value; $('sun-v').textContent = az+'°'; const a = THREE.MathUtils.degToRad(az), el = THREE.MathUtils.degToRad(36);
  uniforms.uSun.value.set(Math.sin(a)*Math.cos(el), Math.sin(el), Math.cos(a)*Math.cos(el));
  sunLight.position.copy(uniforms.uSun.value).multiplyScalar(50);
  rimLight.position.set(-uniforms.uSun.value.x*40, 22, -uniforms.uSun.value.z*40);
  const home = shadowPlane.userData.home; shadowPlane.position.set(home.x - Math.sin(a)*0.45, home.y, home.z - Math.cos(a)*0.45); }
$('sun').addEventListener('input', setSun); setSun();
$('t-bld').addEventListener('click', e => { bldOn = !bldOn; setPressed(e.currentTarget, bldOn); });
const pop2 = $('pop2'), btnC3d = $('t-c3d');
const pop3 = $('pop3'), btnViews = $('t-views');
const popHd = $('pop-hd'), btnHd = $('t-hd');
function togglePopHd(open){
  if (!popHd || !btnHd) return;
  popHd.hidden = !open; btnHd.setAttribute('aria-expanded', String(open));
  if (open){ togglePop(false); togglePop2(false); togglePop3(false); }
}
function togglePop3(open){ if (!pop3 || !btnViews) return; pop3.hidden = !open; btnViews.setAttribute('aria-expanded', String(open)); btnViews.setAttribute('aria-pressed', String(open)); if (open){ togglePop(false); togglePop2(false); togglePopHd(false); } }
function togglePop2(open){
  pop2.hidden = !open; btnC3d.setAttribute('aria-expanded', String(open)); btnC3d.setAttribute('aria-pressed', String(open));
  if (open){ togglePop(false); togglePop3(false); togglePopHd(false); if (citySearchEl){ buildCityPanel(citySearchEl.value); setTimeout(() => citySearchEl.focus(), 20); } }
}
btnC3d.addEventListener('click', () => togglePop2(pop2.hidden));
document.addEventListener('pointerdown', e => { if (!pop2.hidden && !pop2.contains(e.target) && e.target !== btnC3d) togglePop2(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop2.hidden) togglePop2(false); });
if (btnViews && pop3){
  const VIEWS = [
    ['Вся Україна', null, HOME.pos, HOME.target, 'Огляд'],
    ['Карпати · Говерла', [24.50, 48.16], [-0.95, 1.35, 1.85], null, '2061 м'],
    ['Крим · Роман-Кош', [34.25, 44.61], [-0.85, 1.25, 1.80], null, '1545 м'],
    ['Київ · Дніпро', [30.52, 50.45], [-0.18, 0.32, 0.48], null, 'Столиця'],
    ['Харків · 3D', [36.23, 49.99], [-0.14, 0.24, 0.36], null, 'Місто 3D'],
    ['Дніпро · 3D', [35.04, 48.46], [-0.14, 0.24, 0.36], null, 'Місто 3D'],
    ['Схід · Донбас', [37.80, 48.02], [-0.80, 2.20, 2.80], null, 'Регіон'],
    ['Південь · Одеса', [30.73, 46.48], [-0.40, 1.15, 1.65], null, 'Узбережжя'],
  ];
  const ul = $('views-list');
  for (const [name, ll, off, tgt, tag] of VIEWS){
    const li = document.createElement('li'), sp = document.createElement('span'); sp.className = 'cn'; sp.textContent = name;
    const sm = document.createElement('small'); sm.textContent = tag;
    const go = document.createElement('button'); go.className = 'go'; go.type = 'button'; go.textContent = '→'; go.title = 'Перелетіти: ' + name;
    go.addEventListener('click', () => {
      if (!ll){
        flyTo = {from:camera.position.clone(), to:off.clone(), tFrom:controls.target.clone(), tTo:tgt.clone(), t0:performance.now(), dur:1100};
      } else {
        const c = toWorld(ll[0], ll[1]); c.y = sampleH(ll[0], ll[1])*SCALE*targetExag;
        flyTo = {from:camera.position.clone(), to:c.clone().add(new THREE.Vector3(off[0], off[1], off[2])), tFrom:controls.target.clone(), tTo:c, t0:performance.now(), dur:1150};
      }
      if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); }
      togglePop3(false);
    });
    li.append(sp, sm, go); ul.append(li);
  }
  btnViews.addEventListener('click', () => togglePop3(pop3.hidden));
  document.addEventListener('pointerdown', e => { if (!pop3.hidden && !pop3.contains(e.target) && e.target !== btnViews) togglePop3(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop3.hidden) togglePop3(false); });
}
const btnWater = $('t-water');
if (btnWater) btnWater.addEventListener('click', () => { waterOn = !waterOn; setPressed(btnWater, waterOn); applyTheme(); });
$('t-wire').addEventListener('click', e => { wireOn = !wireOn; syncOverlays(); setPressed(e.currentTarget, wireOn); });
let bordersOn = true, frontOn = true, labelsOn = true;
$('t-front').addEventListener('click', e => { frontOn = !frontOn; uniforms.uFrontOn.value = frontOn ? 1 : 0; setPressed(e.currentTarget, frontOn); });
$('t-brd').addEventListener('click', e => { bordersOn = !bordersOn; uniforms.uBorderOn.value = bordersOn && uniforms.uBorders.value !== blackTex ? 1 : 0; setPressed(e.currentTarget, bordersOn); });
$('t-cities').addEventListener('click', e => { labelsOn = !labelsOn; setPressed(e.currentTarget, labelsOn); });
const pop = $('pop'), btnObl = $('t-obl');
function togglePop(open){ pop.hidden = !open; btnObl.setAttribute('aria-expanded', String(open)); btnObl.setAttribute('aria-pressed', String(open)); }
btnObl.addEventListener('click', () => { togglePop(pop.hidden); if (!pop.hidden){ togglePop2(false); togglePop3(false); togglePopHd(false); } });
document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btnObl) togglePop(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) togglePop(false); });
const btnRot = $('t-rot');
btnRot.addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; setPressed(btnRot, controls.autoRotate); });
setPressed(btnRot, controls.autoRotate);
let flyTo = null;
$('t-reset').addEventListener('click', () => { flyTo = {from:camera.position.clone(), to:HOME.pos.clone(), tFrom:controls.target.clone(), tTo:HOME.target.clone(), t0:performance.now()}; });
try { const m = localStorage.getItem('ukr3d.mode'); if (m !== null) setMode(+m); } catch(e){}

// ---------- profiler: frame time, CPU split, draw calls, triangles, texture and geometry memory, and what limits the frame ----------
const Perf = (() => {
  const N = 120, ft = new Float32Array(N); let fi = 0, filled = 0, upd = 0, ren = 0, cnt = 0, lastDraw = 0, geoBytes = 0;
  const snap = {frame:0, p95:0, fps:0, upd:0, ren:0, calls:0, tris:0, texMB:0, geoMB:0, verdict:'—', state:'ok'};
  function frame(ms, u, r){ ft[fi] = ms; fi = (fi + 1) % N; filled = Math.min(N, filled + 1); upd += u; ren += r; cnt++; }
  function measureGeometry(){
    const seen = new Set(); let b = 0;
    scene.traverse(o => { const g = o.geometry; if (!g || seen.has(g)) return; seen.add(g);
      const bufs = new Set(); for (const k in g.attributes){ const a = g.attributes[k]; bufs.add(a.isInterleavedBufferAttribute ? a.data.array : a.array); }
      if (g.index) bufs.add(g.index.array); for (const x of bufs) b += x.byteLength; });
    return b;
  }
  function read(){
    const s = Array.from(ft.subarray(0, filled)).sort((a, b) => a - b);
    snap.frame = s.length ? s[s.length >> 1] : 0; snap.p95 = s.length ? s[Math.min(s.length - 1, Math.floor(s.length*0.95))] : 0; snap.fps = snap.frame ? 1000/snap.frame : 0;
    snap.upd = cnt ? upd/cnt : 0; snap.ren = cnt ? ren/cnt : 0; upd = ren = cnt = 0;
    snap.calls = renderer.info.render.calls; snap.tris = renderer.info.render.triangles;
    let tb = 0; for (const t of liveTex) tb += t.userData.bytes || 0; snap.texMB = tb/1048576; geoBytes = measureGeometry(); snap.geoMB = geoBytes/1048576;
    const lods = [0, 0, 0]; for (const ch of chunks) lods[ch.lod]++;
    snap.chunks = {drawn:chunksDrawnLast, total:chunks.length, lods, merged:farView};
    let tiles = 0, half = 0; for (const L of REG_LAYERS) for (const rg of L.list) if (rg.mesh){ tiles++; if (rg.half) half++; }
    snap.tiles = {tiles, half, cities:CITY3D.filter(c => c.patch).length, packs:CITY3D.filter(c => c.bldMesh).length};
    snap.labels = {...Labels.stats}; snap.threaded = Geo.threaded;
    // which stage limits the frame: script work before the draw, submitting the draw calls, or the GPU itself
    const cpu = snap.upd + snap.ren;
    if (snap.frame < 18.5){ snap.verdict = 'У межах 60 к/с'; snap.state = 'ok'; }
    else if (snap.upd > 4 && snap.upd >= snap.ren){ snap.verdict = 'Обмежує CPU: оновлення сцени'; snap.state = 'warn'; }
    else if (cpu > snap.frame*0.5){ snap.verdict = 'Обмежує CPU: подання викликів'; snap.state = 'warn'; }
    else { snap.verdict = 'Обмежує GPU: пікселі та вершини'; snap.state = 'warn'; }
    return snap;
  }
  return {frame, read, ft, get index(){ return fi; }, N, snap};
})();
let chunksDrawnLast = 0;
const hud = $('hud'), btnProf = $('t-prof'), fmt = (v, d = 1) => v.toLocaleString('uk-UA', {minimumFractionDigits:d, maximumFractionDigits:d});
const HUD_ROWS = [
  ['Кадр', s => fmt(s.frame) + ' мс · ' + Math.round(s.fps) + ' к/с'],
  ['95-й перцентиль', s => fmt(s.p95) + ' мс'],
  ['CPU: оновлення', s => fmt(s.upd, 2) + ' мс'],
  ['CPU: рендер', s => fmt(s.ren, 2) + ' мс'],
  ['Виклики малювання', s => String(s.calls)],
  ['Трикутники', s => s.tris.toLocaleString('uk-UA')],
  ['Чанки рельєфу', s => s.chunks.merged ? 'одна спільна сітка' : s.chunks.drawn + ' із ' + s.chunks.total + ' · рівні ' + s.chunks.lods.join('/')],
  ['Тайли знімків', s => s.tiles.tiles + (s.tiles.half ? ' (' + s.tiles.half + ' у ½)' : '') + ' · міст ' + s.tiles.cities],
  ['Пам’ять текстур', s => '≈ ' + Math.round(s.texMB) + ' МБ'],
  ['Пам’ять геометрії', s => '≈ ' + fmt(s.geoMB) + ' МБ'],
  ['Підписи', s => s.labels.shown + ' із ' + s.labels.candidates + ' · ' + s.labels.glyphs + ' гліфів'],
  ['Геодані', s => s.threaded ? 'окремий потік' : 'основний потік'],
];
const hudCells = HUD_ROWS.map(([name]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = name; dd.textContent = '—'; $('h-rows').append(dt, dd); return dd; });
function drawSpark(){
  const c = $('h-spark'), dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight; if (!w) return;
  if (c.width !== Math.round(w*dpr)){ c.width = Math.round(w*dpr); c.height = Math.round(h*dpr); }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  let max = 33.4; for (let i = 0; i < Perf.N; i++) max = Math.max(max, Perf.ft[i]);
  const bw = w/Perf.N; x.fillStyle = css('--accent');
  for (let i = 0; i < Perf.N; i++){ const v = Perf.ft[(Perf.index + i) % Perf.N], bh = Math.max(1, v/max*h); x.globalAlpha = v > 18.5 ? 1 : 0.55; x.fillRect(i*bw, h - bh, Math.max(1, bw - 0.5), bh); }
  x.globalAlpha = 1; x.strokeStyle = css('--muted'); x.setLineDash([3, 3]); x.lineWidth = 1; const y = h - 16.7/max*h; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); x.setLineDash([]);
  $('h-scale').textContent = '16,7 мс · шкала до ' + Math.round(max) + ' мс';
}
function drawHud(){
  const s = Perf.read(); if (hud.hidden) return;
  HUD_ROWS.forEach(([, f], i) => { hudCells[i].textContent = f(s); });
  const v = $('h-verdict'); v.textContent = s.verdict; v.dataset.state = s.state; drawSpark();
}
const LAYER_STATE = {idle:'очікує', loading:'завантаження…', ready:'готовий', error:'помилка'};
function drawLayerList(){
  const ul = $('h-layers'); if (!ul) return; ul.textContent = '';
  for (const id of layerOrder){
    const L = Layers[id], li = document.createElement('li'), nm = document.createElement('span'), st = document.createElement('small'), b = document.createElement('button');
    nm.className = 'ln'; nm.textContent = L.title; st.textContent = LAYER_STATE[L.state]; st.dataset.state = L.state; if (L.error) st.title = L.error;
    b.type = 'button'; b.className = 'go'; b.textContent = '↻'; b.title = 'Перезавантажити лише цей шар'; b.setAttribute('aria-label', 'Перезавантажити шар: ' + L.title); b.disabled = L.state === 'loading' || booting;
    b.addEventListener('click', () => reloadLayer(id));
    li.append(nm, st, b); ul.append(li);
  }
}
function toggleHud(open){ hud.hidden = !open; setPressed(btnProf, open); btnProf.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('hud-open', open); if (open){ drawLayerList(); drawHud(); } try { localStorage.setItem('ukr3d.hud', open ? '1' : '0'); } catch (e) {} }
btnProf.addEventListener('click', () => toggleHud(hud.hidden));
$('h-close').addEventListener('click', () => toggleHud(false));
try { if (localStorage.getItem('ukr3d.hud') === '1') toggleHud(true); } catch (e) {}
setInterval(drawHud, 500);

// ---------- cursor readout & ray-march against the heightfield ----------
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let hover = null, lastGeo = null;
function pickGeo(pt){
  if (!pt || !heights) return null;
  ray.setFromCamera(pt, camera); const o = ray.ray.origin, d = ray.ray.direction;
  const ex = uniforms.uExag.value, top = 2100*SCALE*ex;
  if (Math.abs(d.y) < 1e-4) return null;
  let t0 = (top - o.y)/d.y, t1 = (0 - o.y)/d.y; if (t0 < 0) t0 = 0; if (t1 < t0) return null;
  const steps = 160;
  for (let i = 0; i <= steps; i++){
    const t = t0 + (t1-t0)*i/steps; const x = o.x + d.x*t, z = o.z + d.z*t, y = o.y + d.y*t;
    core.inv(x, z, _q); const lon = _q[0], lat = _q[1];
    if (lon < META.lon0 || lon > META.lon1 || lat < META.lat0 || lat > META.lat1) continue;
    const h = sampleH(lon, lat);
    if (y <= h*SCALE*ex) return {lon, lat, h, x, z};
  }
  return null;
}
renderer.domElement.addEventListener('pointermove', e => { ndc.set(e.clientX/innerWidth*2-1, -(e.clientY/innerHeight)*2+1); hover = ndc; });
renderer.domElement.addEventListener('pointerleave', () => { hover = null; lastGeo = null; $('r-pos').textContent = '—'; $('r-h').textContent = '—'; Measure.setPreview(null); });
function pick(){
  const g = pickGeo(hover);
  lastGeo = g;
  if (g){
    $('r-pos').textContent = g.lat.toFixed(3)+'° N  '+g.lon.toFixed(3)+'° E';
    $('r-h').textContent = Math.round(g.h)+' м';
    if (Measure.active) Measure.setPreview(g);
    return;
  }
  $('r-pos').textContent = '—'; $('r-h').textContent = '—';
  if (Measure.active) Measure.setPreview(null);
}

// ---------- measurement tools: geodesic distance, azimuth, area polygon, draped 3D path & elevation profile ----------
const Measure = (() => {
  const panel = $('meas-panel'), btnMeas = $('t-meas');
  const btnDist = $('ms-dist'), btnArea = $('ms-area'), btnClose = $('ms-close');
  const btnUndo = $('ms-undo'), btnClear = $('ms-clear');
  const elHint = $('ms-hint'), elPts = $('ms-pts'), elLenLbl = $('ms-len-lbl'), elLen = $('ms-len');
  const elAzLbl = $('ms-az-lbl'), elAz = $('ms-az'), elAreaLbl = $('ms-area-lbl'), elAreaVal = $('ms-area-val');
  const elElev = $('ms-elev'), profWrap = $('ms-prof-wrap'), profMeta = $('ms-prof-meta'), profCanvas = $('meas-profile');

  let active = false, mode = 'dist';   // 'dist' | 'area'
  const pts = [];                      // [{lon, lat, h}]
  let preview = null, lastExag = -1;

  const group = new THREE.Group();
  group.renderOrder = 45;
  scene.add(group);

  const lineGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.MeshBasicMaterial({color:0x60dde8, side:THREE.DoubleSide, depthTest:false, transparent:true, opacity:0.95});
  const lineObj = new THREE.Mesh(lineGeo, lineMat); lineObj.renderOrder = 48; lineObj.frustumCulled = false;

  const haloGeo = new THREE.BufferGeometry();
  const haloMat = new THREE.MeshBasicMaterial({color:0x081324, side:THREE.DoubleSide, depthTest:false, transparent:true, opacity:0.72});
  const haloObj = new THREE.Mesh(haloGeo, haloMat); haloObj.renderOrder = 47; haloObj.frustumCulled = false;

  const prevGeo = new THREE.BufferGeometry();
  const prevMat = new THREE.MeshBasicMaterial({color:0xffd500, side:THREE.DoubleSide, depthTest:false, transparent:true, opacity:0.82});
  const prevObj = new THREE.Mesh(prevGeo, prevMat); prevObj.renderOrder = 47; prevObj.frustumCulled = false;

  const polyGeo = new THREE.BufferGeometry();
  const polyMat = new THREE.MeshBasicMaterial({color:0x60dde8, transparent:true, opacity:0.22, side:THREE.DoubleSide, depthTest:false, depthWrite:false});
  const polyObj = new THREE.Mesh(polyGeo, polyMat); polyObj.renderOrder = 44; polyObj.frustumCulled = false;

  const pinGeo = new THREE.BufferGeometry();
  const pinMat = new THREE.PointsMaterial({color:0xffd500, size:11, sizeAttenuation:false, depthTest:false, transparent:true, opacity:1});
  const pinObj = new THREE.Points(pinGeo, pinMat); pinObj.renderOrder = 50; pinObj.frustumCulled = false;

  group.add(polyObj, haloObj, lineObj, prevObj, pinObj);

  function toDrapeVec(lon, lat, lift = 0.004){
    const w = toWorld(lon, lat), h = heights ? sampleH(lon, lat) : 0;
    return [w.x, h*SCALE*uniforms.uExag.value + lift, w.z];
  }
  function pushRibbon(arr, a, b, halfW, lift = 0.004){
    const km = haversineKm(a.lon, a.lat, b.lon, b.lat);
    const steps = Math.max(4, Math.min(48, Math.ceil(km / 4)));
    const chain = [];
    for (let i = 0; i <= steps; i++){
      const t = i / steps;
      chain.push(toDrapeVec(a.lon + (b.lon - a.lon)*t, a.lat + (b.lat - a.lat)*t, lift));
    }
    for (let i = 0; i < chain.length - 1; i++){
      const p0 = chain[i], p1 = chain[i + 1];
      let dx = p1[0] - p0[0], dz = p1[2] - p0[2];
      const len = Math.hypot(dx, dz) || 1e-6;
      const nx = (-dz / len) * halfW, nz = (dx / len) * halfW;
      arr.push(
        p0[0] - nx, p0[1], p0[2] - nz,  p0[0] + nx, p0[1], p0[2] + nz,  p1[0] + nx, p1[1], p1[2] + nz,
        p0[0] - nx, p0[1], p0[2] - nz,  p1[0] + nx, p1[1], p1[2] + nz,  p1[0] - nx, p1[1], p1[2] - nz
      );
    }
  }
  function ribbonWidth(){ return Math.max(0.003, Math.min(0.048, camera.position.distanceTo(controls.target) * 0.0022)); }
  function rebuild3d(){
    lastExag = uniforms.uExag.value;
    const verts = [], hVerts = [], w = ribbonWidth();
    const list = pts;
    for (let i = 0; i < list.length - 1; i++){
      pushRibbon(verts, list[i], list[i + 1], w, 0.0045);
      pushRibbon(hVerts, list[i], list[i + 1], w * 1.9, 0.0035);
    }
    if (mode === 'area' && list.length >= 3){
      pushRibbon(verts, list[list.length - 1], list[0], w, 0.0045);
      pushRibbon(hVerts, list[list.length - 1], list[0], w * 1.9, 0.0035);
    }
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    lineGeo.computeBoundingSphere();
    lineObj.visible = verts.length >= 9;
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(hVerts, 3));
    haloGeo.computeBoundingSphere();
    haloObj.visible = hVerts.length >= 9;

    const pVerts = [];
    for (const p of list){ const v = toDrapeVec(p.lon, p.lat, 0.006); pVerts.push(v[0], v[1], v[2]); }
    pinGeo.setAttribute('position', new THREE.Float32BufferAttribute(pVerts, 3));
    pinGeo.computeBoundingSphere();
    pinObj.visible = pVerts.length > 0;

    if (mode === 'area' && list.length >= 3){
      const polyV = [];
      const p0 = toDrapeVec(list[0].lon, list[0].lat, 0.0025);
      for (let i = 1; i < list.length - 1; i++){
        const p1 = toDrapeVec(list[i].lon, list[i].lat, 0.0025);
        const p2 = toDrapeVec(list[i + 1].lon, list[i + 1].lat, 0.0025);
        polyV.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
      }
      polyGeo.setAttribute('position', new THREE.Float32BufferAttribute(polyV, 3));
      polyGeo.computeBoundingSphere();
      polyObj.visible = true;
    } else {
      polyObj.visible = false;
    }
    rebuildPreview();
  }
  function rebuildPreview(){
    if (!active || !preview || !pts.length || haversineKm(pts[pts.length - 1].lon, pts[pts.length - 1].lat, preview.lon, preview.lat) < 0.05){ prevObj.visible = false; return; }
    const pv = [], w = ribbonWidth() * 0.78;
    pushRibbon(pv, pts[pts.length - 1], preview, w, 0.0042);
    if (mode === 'area' && pts.length >= 2) pushRibbon(pv, preview, pts[0], w, 0.0042);
    prevGeo.setAttribute('position', new THREE.Float32BufferAttribute(pv, 3));
    prevGeo.computeBoundingSphere();
    prevObj.visible = pv.length >= 9;
  }
  function drawProfile(prof){
    if (!profCanvas || !profWrap) return;
    if (prof.samples.length < 2){ profWrap.hidden = true; return; }
    profWrap.hidden = false;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = profCanvas.clientWidth || 248, h = profCanvas.clientHeight || 72;
    if (profCanvas.width !== Math.round(w*dpr) || profCanvas.height !== Math.round(h*dpr)){
      profCanvas.width = Math.round(w*dpr); profCanvas.height = Math.round(h*dpr);
    }
    const ctx = profCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padT = 8, padB = 14, padL = 2, padR = 2;
    const iw = w - padL - padR, ih = h - padT - padB;
    const lo = Math.max(0, Math.floor(prof.minH / 50) * 50);
    const hi = Math.max(lo + 100, Math.ceil(prof.maxH / 50) * 50);
    const accent = css('--accent') || '#4c8df2';
    const muted = css('--muted') || '#8f9eb8';
    const line = css('--line') || 'rgba(255,255,255,.15)';

    // Subtle horizontal gridlines
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++){
      const y = padT + ih * (g / 2);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    }
    // Area fill + elevation curve
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, accent); grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    prof.samples.forEach((s, i) => {
      const x = padL + (s.km / Math.max(1e-6, prof.totalKm)) * iw;
      const y = padT + ih - ((s.h - lo) / (hi - lo)) * ih;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(padL + iw, padT + ih); ctx.lineTo(padL, padT + ih); ctx.closePath();
    ctx.globalAlpha = 0.24; ctx.fillStyle = grad; ctx.fill(); ctx.globalAlpha = 1;

    // Labels
    ctx.fillStyle = muted; ctx.font = '500 9.5px ui-monospace, Menlo, monospace';
    ctx.fillText(Math.round(prof.maxH) + ' м', padL + 3, padT + 9);
    ctx.fillText('0 км', padL + 3, h - 2);
    const endTxt = fmt(prof.totalKm, prof.totalKm >= 100 ? 0 : 1) + ' км';
    ctx.fillText(endTxt, w - padR - ctx.measureText(endTxt).width - 2, h - 2);
    if (profMeta) profMeta.textContent = '▲ ' + Math.round(prof.gain) + ' м · ▼ ' + Math.round(prof.loss) + ' м';
  }
  function updateUI(){
    if (!panel) return;
    const usePrev = !!(preview && active && pts.length && haversineKm(pts[pts.length - 1].lon, pts[pts.length - 1].lat, preview.lon, preview.lat) >= 0.05);
    const list = usePrev ? pts.concat([preview]) : pts;
    elPts.textContent = String(pts.length);
    if (btnUndo) btnUndo.disabled = pts.length === 0;
    if (btnClear) btnClear.disabled = pts.length === 0;
    const isArea = mode === 'area';
    if (elLenLbl) elLenLbl.textContent = isArea ? 'Периметр' : 'Відстань';
    if (elAzLbl) elAzLbl.hidden = isArea;
    if (elAz) elAz.hidden = isArea;
    if (elAreaLbl) elAreaLbl.hidden = !isArea;
    if (elAreaVal) elAreaVal.hidden = !isArea;
    if (elHint){
      if (!pts.length) elHint.textContent = isArea ? 'Поставте щонайменше 3 точки для розрахунку площі' : 'Клікайте по карті, щоб виміряти відстань і профіль';
      else if (isArea && pts.length < 3) elHint.textContent = 'Додайте ще ' + (3 - pts.length) + ' т. для замикання контуру';
      else elHint.textContent = 'Клік — нова точка · Backspace — назад · Esc — вихід';
    }
    if (list.length < 2){
      elLen.textContent = '—'; elAz.textContent = '—'; elAreaVal.textContent = '—';
      elElev.textContent = pts.length === 1 ? Math.round(pts[0].h) + ' м' : '—';
      if (profWrap) profWrap.hidden = true;
      return;
    }
    const loopList = isArea && list.length >= 3 ? list.concat([list[0]]) : list;
    const prof = buildElevationProfile(loopList, sampleH, 96);
    elLen.textContent = fmt(prof.totalKm, prof.totalKm >= 100 ? 1 : 2) + ' км';
    const a = list[list.length - 2], b = list[list.length - 1];
    const az = bearingDeg(a.lon, a.lat, b.lon, b.lat);
    elAz.textContent = Math.round(az) + '° (' + compassDirUk(az) + ')';
    elElev.textContent = Math.round(prof.minH) + ' → ' + Math.round(prof.maxH) + ' м';
    if (isArea && list.length >= 3){
      const km2 = polygonAreaKm2(list);
      elAreaVal.textContent = km2 >= 100 ? Math.round(km2).toLocaleString('uk-UA') + ' км²' : fmt(km2, 2) + ' км²';
    } else {
      elAreaVal.textContent = '—';
    }
    drawProfile(prof);
  }
  function setMode(m){
    mode = m === 'area' ? 'area' : 'dist';
    if (btnDist) setPressed(btnDist, mode === 'dist');
    if (btnArea) setPressed(btnArea, mode === 'area');
    rebuild3d(); updateUI();
  }
  function toggle(on){
    if (EMBED || !panel || !btnMeas) return;
    active = on === undefined ? !active : !!on;
    panel.hidden = !active;
    setPressed(btnMeas, active);
    btnMeas.setAttribute('aria-expanded', String(active));
    document.body.classList.toggle('measuring', active);
    if (active){
      togglePop(false); togglePop2(false); togglePop3(false); togglePopHd(false);
      if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); }
      rebuild3d(); updateUI();
    } else {
      preview = null; rebuildPreview();
    }
  }
  function addPoint(g){
    if (!g) return;
    pts.push({lon:g.lon, lat:g.lat, h:g.h});
    rebuild3d(); updateUI();
  }
  function undo(){ if (!pts.length) return; pts.pop(); rebuild3d(); updateUI(); }
  function clear(){ pts.length = 0; preview = null; rebuild3d(); updateUI(); }
  function setPreview(g){
    preview = g;
    if (active && pts.length){ rebuildPreview(); updateUI(); }
  }
  function syncExag(){ if (pts.length && Math.abs(uniforms.uExag.value - lastExag) > 1e-4) rebuild3d(); }

  if (btnMeas) btnMeas.addEventListener('click', () => toggle());
  if (btnClose) btnClose.addEventListener('click', () => toggle(false));
  if (btnDist) btnDist.addEventListener('click', () => setMode('dist'));
  if (btnArea) btnArea.addEventListener('click', () => setMode('area'));
  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnClear) btnClear.addEventListener('click', clear);

  // Clean click detection (pan/drag > 5px is ignored so camera navigation still works while measuring)
  let pDown = null;
  renderer.domElement.addEventListener('pointerdown', e => { pDown = e.button === 0 ? {x:e.clientX, y:e.clientY} : null; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!active || !pDown || e.button !== 0) { pDown = null; return; }
    const moved = Math.hypot(e.clientX - pDown.x, e.clientY - pDown.y);
    pDown = null;
    if (moved > 5) return;
    const pt = new THREE.Vector2(e.clientX/innerWidth*2 - 1, -(e.clientY/innerHeight)*2 + 1);
    const g = pickGeo(pt);
    if (g) addPoint(g);
  });
  // Double-click on terrain flies smoothly closer when not measuring
  renderer.domElement.addEventListener('dblclick', e => {
    if (active || EMBED || !ready) return;
    const pt = new THREE.Vector2(e.clientX/innerWidth*2 - 1, -(e.clientY/innerHeight)*2 + 1);
    const g = pickGeo(pt);
    if (!g) return;
    const t = new THREE.Vector3(g.x, g.h*SCALE*targetExag, g.z);
    const curD = camera.position.distanceTo(controls.target);
    const nextD = Math.max(0.22, curD * 0.42);
    const dir = camera.position.clone().sub(controls.target).normalize();
    flyTo = {from:camera.position.clone(), to:t.clone().add(dir.multiplyScalar(nextD)), tFrom:controls.target.clone(), tTo:t, t0:performance.now(), dur:850};
    if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); }
  });
  document.addEventListener('keydown', e => {
    if (EMBED) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь'){ toggle(); }
    else if (active && (e.key === 'Backspace' || (e.key === 'z' && (e.metaKey || e.ctrlKey)))){ e.preventDefault(); undo(); }
    else if (active && e.key === 'Escape'){ toggle(false); }
  });

  return {get active(){ return active; }, toggle, addPoint, undo, clear, setMode, setPreview, syncExag, get points(){ return pts; }};
})();

// ---------- optional online HD satellite tile streaming (OFF by default — explicit user opt-in) ----------
const HdTiles = (() => {
  const hdOnEl = $('hd-on'), hdSrcEl = $('hd-src'), hdStatusEl = $('hd-status');
  const hdKeyWrap = $('hd-key-wrap'), hdKeyEl = $('hd-key'), hdKeySave = $('hd-key-save'), hdKeyClear = $('hd-key-clear');
  const satSrcEl = $('sat-src');
  const hdGroup = new THREE.Group();
  hdGroup.visible = false;
  scene.add(hdGroup);

  let enabled = false;
  let sourceId = 'esri';
  let apiKey = '';
  let session = null, sessionKey = '', sessionExpiry = 0, sessionPromise = null, lastErr = '';
  const tiles = new Map();       // key -> {key, z, mesh, state, lastUsed, ac}
  let inflight = 0, curZ = 0, frameTick = 0;
  const MAX_TILES = isMobile ? 16 : 36;
  const MAX_INFLIGHT = 6;

  try {
    const savedSrc = localStorage.getItem('ukr3d.hdSrc');
    if (savedSrc && HD_SOURCES[savedSrc]) sourceId = savedSrc;
    apiKey = (localStorage.getItem('ukr3d.googleKey') || '').trim();
  } catch (e) {}

  function source(){ return HD_SOURCES[sourceId] || HD_SOURCES.esri; }
  function updateAttr(){
    if (!satSrcEl) return;
    satSrcEl.textContent = enabled ? source().attr : 'Esri World Imagery';
  }
  function setStatus(msg, isErr = false){
    if (!hdStatusEl) return;
    hdStatusEl.textContent = msg;
    hdStatusEl.dataset.state = isErr ? 'error' : enabled ? 'ok' : '';
  }
  function refreshStatus(){
    if (btnHd) setPressed(btnHd, enabled);
    if (!enabled){ setStatus('Офлайн · 0 запитів'); return; }
    if (lastErr){ setStatus(lastErr, true); return; }
    const src = source();
    if (src.needsKey && !apiKey){ setStatus('Вкажіть Google API-ключ', true); return; }
    if (src.needsKey && !session){ setStatus('Підключення до Google Maps…'); return; }
    if (curZ === 0){ setStatus(src.id === 'google' ? 'Google HD · наблизьте карту' : 'Esri HD · наблизьте карту'); return; }
    let readyCount = 0;
    for (const t of tiles.values()) if (t.state === 'ready') readyCount++;
    const tag = src.id === 'google' ? 'Google HD' : src.id === 'esri_clarity' ? 'Clarity HD' : 'Esri HD';
    setStatus(`${tag} · z${curZ} · ${readyCount} тайлів`);
  }
  function dropTile(t){
    if (t.ac){ try { t.ac.abort(); } catch (e) {} t.ac = null; }
    if (t.mesh){
      hdGroup.remove(t.mesh);
      dropTex(t.mesh.material.uniforms.uSat.value);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      t.mesh = null;
    }
    tiles.delete(t.key);
  }
  function clearTiles(){
    for (const t of Array.from(tiles.values())) dropTile(t);
    inflight = 0; curZ = 0; lastErr = '';
  }
  async function ensureSession(){
    const src = source();
    if (!src.needsKey) return true;
    if (!apiKey){ lastErr = 'Вкажіть Google API-ключ'; refreshStatus(); return false; }
    if (session && sessionKey === apiKey && Date.now() < sessionExpiry - 60000) return true;
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      try {
        lastErr = ''; refreshStatus();
        const r = await fetch(src.sessionUrl(apiKey), {
          method:'POST', mode:'cors',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(src.sessionBody())
        });
        if (!r.ok){
          const txt = await r.text().catch(() => '');
          throw new Error(r.status === 403 || r.status === 401 ? 'Ключ відхилено (' + r.status + ')' : 'Помилка Google API (' + r.status + ')' + (txt ? '' : ''));
        }
        const data = await r.json();
        if (!data || !data.session) throw new Error('Немає токена сесії Google');
        session = data.session;
        sessionKey = apiKey;
        sessionExpiry = data.expiry ? Number(data.expiry) * 1000 : Date.now() + 3600 * 1000;
        lastErr = '';
        refreshStatus();
        return true;
      } catch (err) {
        session = null;
        lastErr = err && err.message ? err.message : 'Не вдалося створити сесію Google';
        refreshStatus();
        return false;
      } finally {
        sessionPromise = null;
      }
    })();
    return sessionPromise;
  }
  async function loadTile(spec){
    const src = source();
    const url = src.tileUrl(spec.z, spec.x, spec.y, {session, apiKey});
    if (!url) return;
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const entry = {key:spec.key, z:spec.z, mesh:null, state:'loading', lastUsed:frameTick, ac};
    tiles.set(spec.key, entry);
    inflight++;
    try {
      const res = await fetch(url, {mode:'cors', signal:ac ? ac.signal : undefined});
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (tiles.get(spec.key) !== entry || !enabled) return;
      const img = await blobImage(blob);
      if (tiles.get(spec.key) !== entry || !enabled) return;
      const tex = imageTexture(img, 'HD z' + spec.z);
      const g = core.buildGrid(spec.bbox, 12, 12, true);
      const lift = 0.72 + (spec.z - 10) * 0.04;
      const mesh = new THREE.Mesh(gridGeometry(g), patchMaterial(tex, 3, lift, spec.bbox));
      mesh.position.set(g.origin[0], 0, g.origin[1]);
      mesh.renderOrder = spec.z - 10;
      entry.mesh = mesh; entry.state = 'ready'; entry.ac = null;
      hdGroup.add(mesh);
      lastErr = '';
    } catch (err) {
      if (entry.ac && entry.ac.signal && entry.ac.signal.aborted){ tiles.delete(spec.key); return; }
      entry.state = 'error'; entry.ac = null;
      if (tiles.get(spec.key) === entry) tiles.delete(spec.key);
      if (!lastErr && enabled) lastErr = 'Немає доступу до тайлів (' + (err.message || 'мережа') + ')';
    } finally {
      inflight = Math.max(0, inflight - 1);
      refreshStatus();
    }
  }
  function update(){
    hdGroup.visible = enabled && uniforms.uMode.value === MODE.sat;
    if (!hdGroup.visible || !ready || EMBED) return;
    frameTick++;
    const src = source();
    if (src.needsKey && !session){
      if (apiKey && !sessionPromise && !lastErr) ensureSession();
      return;
    }
    const z = pickHdZoom(camera.position.y, src.maxZoom, src.minZoom);
    if (z !== curZ){ curZ = z; refreshStatus(); }
    if (!z) return;
    core.inv(controls.target.x, controls.target.z, _q);
    const radius = z >= 15 ? 2 : 1;
    const want = visibleTileSpecs(_q[0], _q[1], z, radius, META);
    const keepKeys = new Set();
    for (const s of want){
      keepKeys.add(s.key);
      const existing = tiles.get(s.key);
      if (existing) existing.lastUsed = frameTick;
    }
    // Evict stale tiles from far-off zooms or beyond GPU tile cap
    if (tiles.size > MAX_TILES){
      const victims = Array.from(tiles.values())
        .filter(t => !keepKeys.has(t.key))
        .sort((a, b) => Math.abs(b.z - z) - Math.abs(a.z - z) || a.lastUsed - b.lastUsed);
      while (tiles.size > MAX_TILES && victims.length) dropTile(victims.shift());
    }
    for (const t of Array.from(tiles.values())){
      if (Math.abs(t.z - z) > 2 && t.state !== 'loading') dropTile(t);
    }
    for (const s of want){
      if (inflight >= MAX_INFLIGHT) break;
      if (tiles.has(s.key)) continue;
      loadTile(s);
    }
  }
  function syncKeyUI(){
    const isGoogle = sourceId === 'google';
    if (hdKeyWrap) hdKeyWrap.hidden = !isGoogle;
    if (hdKeyEl && document.activeElement !== hdKeyEl) hdKeyEl.value = apiKey;
  }
  function setEnabled(on){
    enabled = !!on;
    if (hdOnEl) hdOnEl.checked = enabled;
    lastErr = '';
    if (!enabled) clearTiles();
    else if (source().needsKey) ensureSession();
    hdGroup.visible = enabled && uniforms.uMode.value === MODE.sat;
    updateAttr(); refreshStatus();
  }
  function setSource(id){
    if (!HD_SOURCES[id]) return;
    sourceId = id;
    if (hdSrcEl) hdSrcEl.value = id;
    try { localStorage.setItem('ukr3d.hdSrc', id); } catch (e) {}
    clearTiles(); syncKeyUI(); updateAttr();
    if (enabled && source().needsKey) ensureSession();
    refreshStatus();
  }

  if (btnHd && popHd){
    btnHd.addEventListener('click', () => togglePopHd(popHd.hidden));
    document.addEventListener('pointerdown', e => { if (!popHd.hidden && !popHd.contains(e.target) && e.target !== btnHd) togglePopHd(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !popHd.hidden) togglePopHd(false); });
  }
  if (hdOnEl) hdOnEl.addEventListener('change', () => setEnabled(hdOnEl.checked));
  if (hdSrcEl){ hdSrcEl.value = sourceId; hdSrcEl.addEventListener('change', () => setSource(hdSrcEl.value)); }
  if (hdKeySave) hdKeySave.addEventListener('click', () => {
    apiKey = (hdKeyEl ? hdKeyEl.value : '').trim();
    try { apiKey ? localStorage.setItem('ukr3d.googleKey', apiKey) : localStorage.removeItem('ukr3d.googleKey'); } catch (e) {}
    session = null; lastErr = ''; clearTiles();
    if (enabled && source().needsKey) ensureSession();
    refreshStatus();
  });
  if (hdKeyClear) hdKeyClear.addEventListener('click', () => {
    apiKey = ''; if (hdKeyEl) hdKeyEl.value = '';
    try { localStorage.removeItem('ukr3d.googleKey'); } catch (e) {}
    session = null; lastErr = ''; clearTiles(); refreshStatus();
  });
  syncKeyUI(); updateAttr(); refreshStatus();
  return {update, setEnabled, setSource, clear:clearTiles, get active(){ return enabled; }, get count(){ return tiles.size; }};
})();

// ---------- optional DIMAP.LIVE air-raid alerts panel (explicit opt-in, synced with 3D camera and oblasts) ----------
const Dimap = (() => {
  const panel = $('dimap-panel'), btn = $('t-dimap'), body = $('dm-body');
  const tools = $('dm-tools'), modeEl = $('dm-mode'), regEl = $('dm-reg'), openEl = $('dm-open');
  const btnSync = $('dm-sync'), btnFly = $('dm-fly'), btnReload = $('dm-reload'), btnOff = $('dm-off'), btnClose = $('dm-close');
  if (!panel || !btn || !body) return {open:() => {}, close:() => {}, focusRegion:() => {}, get openState(){ return false; }};

  let st = parseDimapState((() => { try { return localStorage.getItem(DIMAP_STORAGE_KEY); } catch (e) { return null; } })());
  const save = () => { try { localStorage.setItem(DIMAP_STORAGE_KEY, JSON.stringify(st)); } catch (e) {} };
  for (const [val, label] of DIMAP_MODES){ const o = document.createElement('option'); o.value = val; o.textContent = label; modeEl.append(o); }
  for (const r of DIMAP_REGIONS){ const o = document.createElement('option'); o.value = r.slug; o.textContent = r.label; regEl.append(o); }

  function focusRegion(slug){
    const r = findDimapRegion(slug);
    if (!r.slug){
      flyTo = {from:camera.position.clone(), to:HOME.pos.clone(), tFrom:controls.target.clone(), tTo:HOME.target.clone(), t0:performance.now(), dur:950};
      return;
    }
    if (r.oblast && typeof CITY_DATA === 'object' && CITY_DATA && CITY_DATA[r.oblast] && !selected.has(r.oblast)){
      selected.add(r.oblast);
      const cb = document.getElementById('ob-' + r.oblast); if (cb) cb.checked = true;
      applyOblasts();
    }
    const t = toWorld(r.lon, r.lat);
    t.y = (heights ? sampleH(r.lon, r.lat) : 0) * SCALE * targetExag;
    const d = r.dist || 5.5;
    flyTo = {from:camera.position.clone(), to:t.clone().add(new THREE.Vector3(-0.2*d, 0.78*d, 0.9*d)), tFrom:controls.target.clone(), tTo:t, t0:performance.now(), dur:950};
    if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); }
  }

  function syncFromCamera(){
    core.inv(controls.target.x, controls.target.z, _q);
    const camDist = camera.position.distanceTo(controls.target);
    st.r = camDist < 12 ? nearestDimapRegion(_q[0], _q[1]) : '';
    st.m = '/';
    save();
    render();
  }

  function render(){
    body.textContent = '';
    modeEl.value = st.m; regEl.value = st.r; regEl.disabled = st.m !== '/';
    const url = buildDimapUrl(st.m, st.r);
    if (openEl) openEl.href = url;
    tools.hidden = !st.ok;
    if (!st.ok){
      const gate = document.createElement('div'); gate.className = 'dm-gate';
      const card = document.createElement('div'); card.className = 'dm-card';
      const h3 = document.createElement('h3'); h3.textContent = 'Підключення до dimap.live';
      const p1 = document.createElement('p'); p1.textContent = 'Карта тривог — стороння вебслужба. Після дозволу ваш браузер підключиться до dimap.live: сайт побачить вашу IP-адресу й зможе зберігати свої дані у браузері. 3D-карта нічого не передає.';
      const p2 = document.createElement('p'); p2.className = 'dm-warn'; p2.textContent = 'Геолокацію у цьому вікні вимкнено. Не вмикайте GPS-режим поблизу ЛБЗ.';
      const act = document.createElement('div'); act.className = 'dm-act';
      const bOk = document.createElement('button'); bOk.type = 'button'; bOk.className = 'primary'; bOk.textContent = 'Дозволити й завантажити';
      bOk.addEventListener('click', () => { st.ok = true; save(); render(); });
      const aExt = document.createElement('a'); aExt.href = url; aExt.target = '_blank'; aExt.rel = 'noopener noreferrer'; aExt.textContent = 'Відкрити на сайті ↗';
      const bNo = document.createElement('button'); bNo.type = 'button'; bNo.textContent = 'Скасувати';
      bNo.addEventListener('click', () => toggle(false));
      act.append(bOk, aExt, bNo); card.append(h3, p1, p2, act); gate.append(card); body.append(gate);
      return;
    }
    const fr = document.createElement('iframe');
    fr.src = url; fr.title = 'Карта тривог DIMAP.LIVE'; fr.referrerPolicy = 'no-referrer';
    fr.setAttribute('allow', 'fullscreen'); fr.setAttribute('allowfullscreen', 'true');
    fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
    body.append(fr);
  }

  function toggle(open){
    if (open){
      // Перечитати спільний стан (могли змінити у вкладці ПС/РВ)
      st = parseDimapState((() => { try { return localStorage.getItem(DIMAP_STORAGE_KEY); } catch (e) { return null; } })());
      if (st.m === '/' && !st.r){
        core.inv(controls.target.x, controls.target.z, _q);
        if (camera.position.distanceTo(controls.target) < 12) st.r = nearestDimapRegion(_q[0], _q[1]);
      }
      if (hud && !hud.hidden) toggleHud(false);
    } else {
      body.textContent = '';   // вивантажити iframe при закритті панелі
    }
    panel.hidden = !open;
    setPressed(btn, open); btn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('dimap-open', open);
    if (open) render();
  }

  btn.addEventListener('click', () => toggle(panel.hidden));
  if (btnClose) btnClose.addEventListener('click', () => toggle(false));
  modeEl.addEventListener('change', () => { st.m = modeEl.value; save(); render(); });
  regEl.addEventListener('change', () => { st.r = regEl.value; save(); render(); });
  if (btnSync) btnSync.addEventListener('click', syncFromCamera);
  if (btnFly) btnFly.addEventListener('click', () => focusRegion(st.r));
  if (btnReload) btnReload.addEventListener('click', render);
  if (btnOff) btnOff.addEventListener('click', () => { st.ok = false; save(); render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });
  return {open:() => toggle(true), close:() => toggle(false), focusRegion, syncFromCamera, get openState(){ return !panel.hidden; }};
})();

// ---------- loop ----------
let ready = false, startTime = 0, frame = 0, introDone = false, lastNow = performance.now();
const ease = t => 1 - Math.pow(1-t, 3);
function tick(now){
  requestAnimationFrame(tick);
  const frameMs = now - lastNow, dt = Math.min(0.1, frameMs/1000); lastNow = now;
  const t0 = performance.now();
  if (ready && !skipIntro){
    const t = Math.min(1, (now-startTime)/2600);
    if (t < 1){ const k = ease(t); camera.position.lerpVectors(new THREE.Vector3(-2,36,44), HOME.pos, k); uniforms.uExag.value = 0.001 + (targetExag-0.001)*ease(Math.min(1, Math.max(0,(t-0.25)/0.75))); }
    else { if (!introDone){ introDone = true; camera.position.copy(HOME.pos); } uniforms.uExag.value += (targetExag - uniforms.uExag.value)*0.12; }
  } else if (ready) uniforms.uExag.value += (targetExag - uniforms.uExag.value)*0.18;
  if (!reduced) uniforms.uTime.value = now * 0.001;
  if (flyTo){
    const dur = flyTo.dur || 950;
    const raw = Math.min(1, (now - flyTo.t0) / dur);
    const k = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw + 2, 3)/2;
    const arc = Math.sin(raw * Math.PI) * Math.min(2.4, flyTo.from.distanceTo(flyTo.to) * 0.16);
    camera.position.lerpVectors(flyTo.from, flyTo.to, k);
    camera.position.y += arc;
    controls.target.lerpVectors(flyTo.tFrom, flyTo.tTo, k);
    if (raw >= 1) flyTo = null;
  }
  controls.update();
  core.inv(controls.target.x, controls.target.z, _q); tgtP = toPlate(_q[0], _q[1]);
  updateChunks();
  if (CITY3D.length) updateCities();
  updateRegions();
  HdTiles.update();
  Measure.syncExag();
  Labels.update(dt, camera.position.distanceTo(controls.target), uniforms.uExag.value, labelsOn && ready, bordersOn);
  if ((frame++ & 1) === 0) pick();
  const t1 = performance.now();
  chunksDrawn = 0; renderer.render(scene, camera); chunksDrawnLast = chunksDrawn;
  Perf.frame(frameMs, t1 - t0, performance.now() - t1);
}
requestAnimationFrame(tick);
window.__ukr = {REGIONS, CITY3D, camera, controls, renderer, scene, toWorld, chunks, Labels, Measure, HdTiles, Dimap, seaMesh, layers:Layers, reloadLayer, perf:() => Perf.read(), geo:Geo};   // debug hook
addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); Labels.material.uniforms.uView.value.set(innerWidth, innerHeight); });

// ---------- вбудований режим: точки DPI з вікна модуля (ПС / РВ) ----------
// Модуль надсилає список точок; тут вони малюються одним instanced-викликом як маркери постійного екранного розміру
// й стоять на реальній висоті рельєфу. Клік по точці повертається модулю, який відкриває картку виходу.
const Pts = (() => {
  const COL = {hit:[0.216,0.78,0.478], part:[0.957,0.69,0.29], miss:[0.949,0.392,0.353], unk:[0.545,0.596,0.671]};
  const SHAPE = {hit:0, part:1, miss:2, unk:3};
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1,-1, 1,-1, 1,1, -1,1]), 2));
  geo.setIndex([0,1,2, 0,2,3]);
  const mat = new THREE.ShaderMaterial({
    uniforms:{uExag:uniforms.uExag, uScale:uniforms.uScale, uView:{value:new THREE.Vector2(innerWidth, innerHeight)}, uPx:{value:8}},
    vertexShader:`
      attribute vec2 corner; attribute vec3 aPos; attribute vec3 aCol; attribute vec2 aInfo;
      uniform float uExag; uniform float uScale; uniform float uPx; uniform vec2 uView;
      varying vec2 vC; varying vec3 vCol; varying vec2 vI;
      void main(){
        vC = corner*1.3; vCol = aCol; vI = aInfo;
        vec4 c = projectionMatrix*viewMatrix*vec4(aPos.x, aPos.y*uScale*uExag + 0.0004, aPos.z, 1.0);
        float px = uPx*(1.0 + aInfo.y*0.55)*1.3;
        c.xy += corner*px*2.0/uView*c.w;
        gl_Position = c;
      }`,
    fragmentShader:`
      varying vec2 vC; varying vec3 vCol; varying vec2 vI; uniform float uPx;
      void main(){
        float sd;
        if (vI.x < 0.5) sd = length(vC) - 0.72;
        else if (vI.x < 1.5) sd = max(abs(vC.x), abs(vC.y)) - 0.64;
        else if (vI.x < 2.5) sd = abs(vC.x) + abs(vC.y) - 0.92;
        else sd = abs(length(vC) - 0.55) - 0.2;
        float aa = 1.3/uPx;
        float fill = 1.0 - smoothstep(-aa, aa, sd);
        float rim = 1.0 - smoothstep(0.2 - aa, 0.2 + aa, sd);
        vec3 edge = vI.y > 0.5 ? vec3(1.0) : vec3(0.04, 0.06, 0.1);
        float ea = vI.y > 0.5 ? 1.0 : 0.7;
        vec3 col = mix(edge, vCol, fill);
        float a = max(fill, rim*ea);
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }`,
    transparent:true, depthTest:false, depthWrite:false});
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 60; mesh.visible = false; scene.add(mesh);
  let items = [], sel = null, pos = null, col = null, info = null, tmp = new THREE.Vector3();
  function build(){
    const n = items.length;
    pos = new Float32Array(n*3); col = new Float32Array(n*3); info = new Float32Array(n*2);
    items.forEach((it, i) => {
      const w = toWorld(it.lon, it.lat); it.x = w.x; it.z = w.z;
      pos[i*3] = w.x; pos[i*3+1] = heights ? sampleH(it.lon, it.lat) : 0; pos[i*3+2] = w.z;
      const c = COL[it.k] || COL.unk; col.set(c, i*3);
      info[i*2] = SHAPE[it.k] ?? 3; info[i*2+1] = it.id === sel ? 1 : 0;
    });
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2));
    geo.instanceCount = n; mesh.visible = n > 0;
  }
  function set(list){ items = list.filter(p => isFinite(p.lon) && isFinite(p.lat)); build(); }
  function reheight(){ if (!items.length || !pos) return; items.forEach((it, i) => { pos[i*3+1] = sampleH(it.lon, it.lat); }); geo.attributes.aPos.needsUpdate = true; }
  function select(id){ sel = id; if (!info) return; items.forEach((it, i) => { info[i*2+1] = it.id === sel ? 1 : 0; }); geo.attributes.aInfo.needsUpdate = true; }
  function nearest(px, py, max){
    let best = null, bd = max*max;
    items.forEach((it, i) => {
      tmp.set(pos[i*3], pos[i*3+1]*SCALE*uniforms.uExag.value + 0.0004, pos[i*3+2]).project(camera);
      if (tmp.z > 1 || tmp.z < -1) return;
      const dx = (tmp.x*0.5 + 0.5)*innerWidth - px, dy = (-tmp.y*0.5 + 0.5)*innerHeight - py, d = dx*dx + dy*dy;
      if (d < bd){ bd = d; best = it; }
    });
    return best;
  }
  function view(focusId){
    if (!items.length) return;
    let list = items;
    if (focusId != null){ const f = items.find(i => i.id === focusId); if (f) list = [f]; }
    const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f*(a.length - 1))))];
    const xs = list.map(i => i.x).sort((a, b) => a - b), zs = list.map(i => i.z).sort((a, b) => a - b);
    const lo = list.length >= 30 ? 0.02 : 0, hi = 1 - lo;
    const x0 = q(xs, lo), x1 = q(xs, hi), z0 = q(zs, lo), z1 = q(zs, hi);
    const cx = (x0 + x1)/2, cz = (z0 + z1)/2, ext = Math.max(x1 - x0, z1 - z0, list.length === 1 ? 0.05 : 0.08);
    core.inv(cx, cz, _q);
    const t = new THREE.Vector3(cx, sampleH(_q[0], _q[1])*SCALE*targetExag, cz);
    const fov = THREE.MathUtils.degToRad(camera.fov), asp = camera.aspect;
    const dist = Math.max(0.09, ext*0.8/Math.tan(fov/2)/Math.min(1, asp*0.9));
    const to = t.clone().add(new THREE.Vector3(-0.12*dist, 0.84*dist, 0.54*dist));
    flyTo = {from:camera.position.clone(), to, tFrom:controls.target.clone(), tTo:t, t0:performance.now()};
    if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); }
  }
  function screenOf(i){ tmp.set(pos[i*3], pos[i*3+1]*SCALE*uniforms.uExag.value + 0.0004, pos[i*3+2]).project(camera); return {x:(tmp.x*0.5 + 0.5)*innerWidth, y:(-tmp.y*0.5 + 0.5)*innerHeight, z:tmp.z}; }
  return {set, select, nearest, view, reheight, screenOf, mesh, get count(){ return items.length; }};
})();

const Embed = (() => {
  const TO = location.origin === 'null' ? '*' : location.origin;
  const send = m => { try { parent.postMessage(Object.assign({src:'easywar-map'}, m), TO); } catch (e) {} };
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = e.button === 0 ? {x:e.clientX, y:e.clientY} : null; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
    down = null; const it = Pts.nearest(e.clientX, e.clientY, 14);
    if (it){ Pts.select(it.id); send({type:'pick', id:it.id}); }
  });
  addEventListener('resize', () => Pts.mesh.material.uniforms.uView.value.set(innerWidth, innerHeight));
  let wantFit = false;
  addEventListener('message', e => {
    if (e.source !== parent) return;
    const m = e.data; if (!m || m.dst !== 'easywar-map') return;
    if (m.type === 'points'){ Pts.set(m.items || []); Pts.select(m.sel == null ? null : m.sel); if (m.fit) (ready ? Pts.view() : (wantFit = true)); }
    else if (m.type === 'fit') (ready ? Pts.view() : (wantFit = true));
    else if (m.type === 'select'){ Pts.select(m.id); if (m.focus) Pts.view(m.id); }
    else if (m.type === 'zoom'){ const d = camera.position.clone().sub(controls.target); const len = d.length(), nl = THREE.MathUtils.clamp(len/m.k, controls.minDistance, controls.maxDistance); camera.position.copy(controls.target).add(d.multiplyScalar(nl/len)); if (controls.autoRotate){ controls.autoRotate = false; setPressed(btnRot, false); } }
    else if (m.type === 'theme'){ document.documentElement.dataset.theme = m.theme === 'light' ? 'light' : 'dark'; }
    else if (m.type === 'focusRegion'){ Dimap.focusRegion(m.region || ''); }
  });
  send({type:'hello'});
  return {send, onReady(){ Pts.reheight(); if (wantFit){ wantFit = false; Pts.view(); } send({type:'ready'}); }};
})();

window.__ukr.Pts = Pts;
init().catch(err => { lmsg.textContent = 'Помилка завантаження даних: ' + err.message; console.error(err); });
