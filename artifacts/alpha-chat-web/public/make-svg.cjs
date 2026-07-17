// PASSO 1: Generate master-flat.svg from logo.png
const sharp = require('/home/runner/workspace/.config/npm/node_global/lib/node_modules/sharp');
const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, 'logo.png');
const OUT_FLAT = path.join(__dirname, 'master-flat.svg');
const OUT_3D = path.join(__dirname, 'master-3d.svg');

async function main() {
  const img = sharp(INPUT);
  const meta = await img.metadata();
  const W = meta.width;
  const H = meta.height;

  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels; // 4 (RGBA)

  // Build per-row bounding info and color sampling
  const rowLeft = new Int32Array(H).fill(-1);
  const rowRight = new Int32Array(H).fill(-1);

  // Also sample colors from visible pixels
  let rSum = 0, gSum = 0, bSum = 0, count = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * channels;
      const a = data[idx + 3];
      if (a > 10) {
        if (rowLeft[y] === -1) rowLeft[y] = x;
        rowRight[y] = x;
        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];
        count++;
      }
    }
  }

  // Average color
  const avgR = Math.round(rSum / count);
  const avgG = Math.round(gSum / count);
  const avgB = Math.round(bSum / count);
  const avgHex = `#${avgR.toString(16).padStart(2,'0')}${avgG.toString(16).padStart(2,'0')}${avgB.toString(16).padStart(2,'0')}`;
  console.log('Average color:', avgHex, `(${avgR},${avgG},${avgB})`);

  // Sample more colors at strategic zones: top-center, mid-left, mid-right, bottom-center
  function sampleColor(fy, fx) {
    const y = Math.min(H - 1, Math.max(0, Math.round(fy * H)));
    const x = Math.min(W - 1, Math.max(0, Math.round(fx * W)));
    const idx = (y * W + x) * channels;
    return { r: data[idx], g: data[idx+1], b: data[idx+2], a: data[idx+3] };
  }

  // Find overall bounding box
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) {
    if (rowLeft[y] !== -1) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (rowLeft[y] < minX) minX = rowLeft[y];
      if (rowRight[y] > maxX) maxX = rowRight[y];
    }
  }
  console.log('BBox:', minX, minY, maxX, maxY);

  // Build SVG path from scanlines using run-length approach
  // We'll create outline polygon by collecting left/right edges
  // Then build a closed SVG polygon path
  
  // Collect scanlines with valid rows
  const validRows = [];
  for (let y = minY; y <= maxY; y++) {
    if (rowLeft[y] !== -1) {
      validRows.push({ y, left: rowLeft[y], right: rowRight[y] });
    }
  }

  // Build outline path: go down left edges, then up right edges
  // Use sub-sampling for smoother result (every Nth row)
  const STEP = 1; // use every row for accuracy
  const leftPoints = [];
  const rightPoints = [];

  for (let i = 0; i < validRows.length; i += STEP) {
    const row = validRows[i];
    leftPoints.push([row.left, row.y]);
    rightPoints.push([row.right, row.y]);
  }
  // Make sure last row is included
  if (validRows.length > 0) {
    const lastRow = validRows[validRows.length - 1];
    if (leftPoints[leftPoints.length - 1][1] !== lastRow.y) {
      leftPoints.push([lastRow.left, lastRow.y]);
      rightPoints.push([lastRow.right, lastRow.y]);
    }
  }

  // Smooth the path by averaging 3-row windows
  function smooth(pts, winSize = 3) {
    return pts.map((p, i) => {
      let sx = 0, sy = 0, n = 0;
      for (let d = -winSize; d <= winSize; d++) {
        const idx = i + d;
        if (idx >= 0 && idx < pts.length) {
          sx += pts[idx][0];
          sy += pts[idx][1];
          n++;
        }
      }
      return [sx / n, sy / n];
    });
  }

  const smoothedLeft = smooth(leftPoints, 5);
  const smoothedRight = smooth(rightPoints, 5);

  // Combine into one closed path: left top→bottom, right bottom→top
  const outlinePoints = [
    ...smoothedLeft,
    ...[...smoothedRight].reverse()
  ];

  // Convert to SVG path with bezier curves for smoothness
  function pointsToPath(pts) {
    if (pts.length === 0) return '';
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
    }
    d += ' Z';
    return d;
  }

  // For a richer representation, let's also detect distinct "lobes" or segments
  // of the ribbon by looking at horizontal gaps within each row
  // This builds multiple paths for the ribbon structure

  // Let's do a more detailed scan: detect disconnected segments per row
  const rowSegments = [];
  for (let y = minY; y <= maxY; y++) {
    const segs = [];
    let inSeg = false;
    let segStart = -1;
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * channels;
      const a = data[idx + 3];
      if (a > 10) {
        if (!inSeg) { inSeg = true; segStart = x; }
      } else {
        if (inSeg) { segs.push([segStart, x - 1]); inSeg = false; }
      }
    }
    if (inSeg) segs.push([segStart, W - 1]);
    rowSegments.push(segs);
  }

  // Find max number of segments in any row
  const maxSegs = Math.max(...rowSegments.map(s => s.length));
  console.log('Max segments per row:', maxSegs);

  // Group contiguous rows with same segment count into "bands"
  // Build separate paths per band/segment group
  const pathGroups = [];
  
  // Simpler approach: track up to 3 segments, build paths for each
  // For each segment index (0, 1, 2, ...) collect scanline runs
  for (let segIdx = 0; segIdx < maxSegs; segIdx++) {
    let currentRun = null;
    const runs = [];
    
    for (let ry = 0; ry < rowSegments.length; ry++) {
      const y = minY + ry;
      const segs = rowSegments[ry];
      if (segIdx < segs.length) {
        const [sl, sr] = segs[segIdx];
        if (!currentRun) {
          currentRun = { startY: y, rows: [] };
        }
        currentRun.rows.push({ y, left: sl, right: sr });
      } else {
        if (currentRun && currentRun.rows.length > 2) {
          runs.push(currentRun);
        }
        currentRun = null;
      }
    }
    if (currentRun && currentRun.rows.length > 2) {
      runs.push(currentRun);
    }
    
    for (const run of runs) {
      pathGroups.push({ segIdx, rows: run.rows });
    }
  }

  console.log('Path groups:', pathGroups.length);

  // Build SVG paths for each group
  const svgPaths = pathGroups.map((group, gi) => {
    const rows = group.rows;
    // Sub-sample for performance
    const step = Math.max(1, Math.floor(rows.length / 200));
    const sampled = [];
    for (let i = 0; i < rows.length; i += step) sampled.push(rows[i]);
    if (sampled[sampled.length - 1] !== rows[rows.length - 1]) {
      sampled.push(rows[rows.length - 1]);
    }

    const leftPts = sampled.map(r => [r.left, r.y]);
    const rightPts = sampled.map(r => [r.right, r.y]);

    // Smooth edges
    const sl = smooth(leftPts, 3);
    const sr = smooth(rightPts, 3);

    // Build closed path
    const allPts = [...sl, ...[...sr].reverse()];
    const d = pointsToPath(allPts);

    // Sample color from middle of this group
    const midRow = rows[Math.floor(rows.length / 2)];
    const midX = Math.round((midRow.left + midRow.right) / 2);
    const pidx = (midRow.y * W + midX) * channels;
    const cr = data[pidx], cg = data[pidx+1], cb = data[pidx+2];
    const hex = `#${cr.toString(16).padStart(2,'0')}${cg.toString(16).padStart(2,'0')}${cb.toString(16).padStart(2,'0')}`;

    return { d, hex, gi };
  });

  // Generate flat SVG
  const flatSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <title>Alpha Chat Logo (Flat)</title>
  <defs>
    <style>
      .ribbon { fill-rule: evenodd; }
    </style>
  </defs>
${svgPaths.map(p => `  <path class="ribbon" d="${p.d}" fill="${p.hex}" />`).join('\n')}
</svg>`;

  fs.writeFileSync(OUT_FLAT, flatSVG, 'utf8');
  console.log('PASSO 1 complete: master-flat.svg written,', svgPaths.length, 'paths');
  console.log('File size:', fs.statSync(OUT_FLAT).size, 'bytes');

  // ─────────────────────────────────────────────────────────────
  // PASSO 2: Generate master-3d.svg
  // ─────────────────────────────────────────────────────────────

  const flatContent = fs.readFileSync(OUT_FLAT, 'utf8');

  // Extract all path tags verbatim
  const pathTagRegex = /<path\b[^>]*\/>/g;
  const pathTags = flatContent.match(pathTagRegex) || [];
  console.log('Paths found in flat SVG:', pathTags.length);

  // Build duplicate path tags for highlight overlay (same d, different fill)
  const highlightPaths = pathTags.map(tag => {
    // Replace fill attr with highlight gradient
    return tag
      .replace(/fill="[^"]*"/, 'fill="url(#grad-highlight)"')
      .replace(/class="[^"]*"/, 'class="ribbon highlight"');
  });

  // Main paths with gradient fill and shadow filter
  const mainPaths = pathTags.map(tag => {
    return tag
      .replace(/fill="[^"]*"/, 'fill="url(#grad-ribbon)"')
      .replace(/>$/, ' filter="url(#shadow-inner)"/>');
  });

  const threeDSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <title>Alpha Chat Logo (3D Premium)</title>
  <defs>
    <!-- Ribbon gradient: light violet top → deep violet bottom -->
    <linearGradient id="grad-ribbon" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#7c3aed" />
      <stop offset="30%"  stop-color="#5b21b6" />
      <stop offset="70%"  stop-color="#2e1065" />
      <stop offset="100%" stop-color="#130828" />
    </linearGradient>

    <!-- Radial highlight: white/translucent at top-center -->
    <radialGradient id="grad-highlight" cx="50%" cy="20%" r="60%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.55" />
      <stop offset="40%"  stop-color="#c4b5fd" stop-opacity="0.20" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.00" />
    </radialGradient>

    <!-- Inner shadow / depth filter -->
    <filter id="shadow-inner" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.45" result="shadow" />
      <feDropShadow dx="0" dy="-2" stdDeviation="2" flood-color="#7c3aed" flood-opacity="0.30" result="innerGlow" />
    </filter>

    <!-- Gloss / satin finish filter -->
    <filter id="gloss" x="-5%" y="-5%" width="110%" height="110%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Layer 1: Main ribbon with gradient + shadow -->
${mainPaths.join('\n')}

  <!-- Layer 2: Highlight gloss overlay (same paths, semi-transparent) -->
  <g opacity="0.35" filter="url(#gloss)">
${highlightPaths.join('\n')}
  </g>
</svg>`;

  fs.writeFileSync(OUT_3D, threeDSVG, 'utf8');
  console.log('PASSO 2 complete: master-3d.svg written');
  console.log('File size:', fs.statSync(OUT_3D).size, 'bytes');

  // ─────────────────────────────────────────────────────────────
  // VERIFICA FINALE
  // ─────────────────────────────────────────────────────────────
  console.log('\n─── VERIFICA FINALE ───');

  const flatVerify = fs.readFileSync(OUT_FLAT, 'utf8');
  const threeDVerify = fs.readFileSync(OUT_3D, 'utf8');

  const countPaths = (content) => (content.match(/<path\b/g) || []).length;
  const countPolygons = (content) => (content.match(/<polygon\b/g) || []).length;

  const flatPaths = countPaths(flatVerify);
  const flatPolys = countPolygons(flatVerify);
  const tdPaths = countPaths(threeDVerify);
  const tdPolys = countPolygons(threeDVerify);

  console.log(`master-flat.svg  : ${flatPaths} <path> + ${flatPolys} <polygon> = ${flatPaths + flatPolys} shapes`);
  console.log(`master-3d.svg    : ${tdPaths} <path> + ${tdPolys} <polygon> = ${tdPaths + tdPolys} shapes`);

  // 3D has 2x paths (main + highlight layer)
  const expectedTD = (flatPaths + flatPolys) * 2;
  if (tdPaths + tdPolys !== expectedTD) {
    console.warn(`⚠ 3D shape count ${tdPaths + tdPolys} != expected ${expectedTD} (2× flat)`);
  } else {
    console.log('✓ Shape counts match (3D = 2× flat layers)');
  }

  // Verify coordinates: extract 'd' attributes from flat and compare with main layer in 3D
  const extractDAttrs = (content) => {
    const matches = [];
    const re = /\bd="([^"]+)"/g;
    let m;
    while ((m = re.exec(content)) !== null) matches.push(m[1]);
    return matches;
  };

  const flatDs = extractDAttrs(flatVerify);
  const tdDs = extractDAttrs(threeDVerify);

  // First N 'd' values in 3D should match flat (main layer comes first)
  let coordsMatch = true;
  for (let i = 0; i < flatDs.length; i++) {
    if (tdDs[i] !== flatDs[i]) {
      console.error(`✗ Coordinate mismatch at path index ${i}`);
      coordsMatch = false;
      break;
    }
  }
  if (coordsMatch) console.log('✓ All path coordinates are IDENTICAL between flat and 3D main layer');

  // Print first 100 chars of first path in each file
  const firstFlatPath = (flatVerify.match(/<path\b[^>]*\/>/) || [''])[0];
  const firstTDPath = (threeDVerify.match(/<path\b[^>]*\/>/) || [''])[0];
  console.log('\nFirst path flat (100 chars):', firstFlatPath.substring(0, 100));
  console.log('First path 3D   (100 chars):', firstTDPath.substring(0, 100));

  console.log('\n✓ All done!');
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
