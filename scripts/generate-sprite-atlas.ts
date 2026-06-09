#!/usr/bin/env node
/**
 * Generate sprite atlas for DrawRace.
 *
 * Creates a 2048x1024 PNG sprite atlas containing:
 * - Car chassis (120x90, 2 variants: player + ghost)
 * - Far hills silhouette (1024x256)
 * - Near hills silhouette (1024x256)
 * - Cross-hatch tile (256x256, tileable)
 * - Grass tuft variants (4 x 48x48)
 * - Confetti pieces (8 x 24x24)
 * - Ink splatter FX (6 x 64x64)
 * - Logo wheel (512x512)
 *
 * Output: apps/web/public/assets/sprite-atlas.png
 * Metadata: apps/web/public/assets/sprite-atlas.json
 */

import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';

const PPM = 30; // Pixels per meter (matches Renderer.ts)
const ATLAS_WIDTH = 2048;
const ATLAS_HEIGHT = 1024;

// Deterministic PRNG (mulberry32) - matches Renderer.ts
function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sprite atlas layout
interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasLayout {
  chassis: { player: SpriteRect; ghost: SpriteRect };
  hills: { far: SpriteRect; near: SpriteRect };
  crossHatch: SpriteRect;
  grassTufts: SpriteRect[];
  confetti: SpriteRect[];
  inkSplatters: SpriteRect[];
  logo: SpriteRect;
}

// Layout configuration (packed into 2048x1024)
const LAYOUT: AtlasLayout = {
  // Row 0: Hills (1024+1024=2048 wide, 256 tall)
  hills: {
    far: { x: 0, y: 0, w: 1024, h: 256 },
    near: { x: 1024, y: 0, w: 1024, h: 256 },
  },
  // Row 1: Logo (512x512) + chassis sprites (120x90 each, side by side)
  logo: { x: 0, y: 256, w: 512, h: 512 },
  chassis: {
    player: { x: 520, y: 290, w: 120, h: 90 },  // Centered vertically in row 1
    ghost: { x: 660, y: 290, w: 120, h: 90 },
  },
  // Row 2: Cross-hatch (256x256) + grass tufts (4x48x48 = 192 wide) + confetti (8x24x24 = 192 wide)
  crossHatch: { x: 0, y: 768, w: 256, h: 256 },
  grassTufts: [
    { x: 256, y: 768, w: 48, h: 48 },
    { x: 304, y: 768, w: 48, h: 48 },
    { x: 352, y: 768, w: 48, h: 48 },
    { x: 400, y: 768, w: 48, h: 48 },
  ],
  confetti: [
    { x: 456, y: 768, w: 24, h: 24 },
    { x: 480, y: 768, w: 24, h: 24 },
    { x: 504, y: 768, w: 24, h: 24 },
    { x: 528, y: 768, w: 24, h: 24 },
    { x: 552, y: 768, w: 24, h: 24 },
    { x: 576, y: 768, w: 24, h: 24 },
    { x: 600, y: 768, w: 24, h: 24 },
    { x: 624, y: 768, w: 24, h: 24 },
  ],
  // Row 2 continued: Ink splatters (6x64x64 = 384 wide)
  inkSplatters: [
    { x: 660, y: 768, w: 64, h: 64 },
    { x: 724, y: 768, w: 64, h: 64 },
    { x: 788, y: 768, w: 64, h: 64 },
    { x: 852, y: 768, w: 64, h: 64 },
    { x: 916, y: 768, w: 64, h: 64 },
    { x: 980, y: 768, w: 64, h: 64 },
  ],
};

async function main() {
  console.log('Generating sprite atlas...');

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Create a page with canvas for sprite generation
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head><style>body { margin: 0; }</style></head>
    <body>
      <canvas id="atlas" width="${ATLAS_WIDTH}" height="${ATLAS_HEIGHT}"></canvas>
      <script>
        const atlas = document.getElementById('atlas').getContext('2d');

        // Deterministic PRNG
        function mulberry32(seed) {
          let s = seed | 0;
          return function() {
            s |= 0;
            s = (s + 0x6d2b79f5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        }

        // Expose drawing functions to Node
        window.spriteAPI = {
          drawChassis: (x, y, w, h, isGhost) => {
            atlas.save();
            atlas.translate(x + w/2, y + h/2);

            const bw = w * 0.95;
            const bh = h * 0.8;

            // Base body
            atlas.fillStyle = isGhost ? '#8896A3' : '#FBF4E3';
            atlas.fillRect(-bw/2, -bh/2, bw, bh);

            // Ink outline
            atlas.strokeStyle = '#2B2118';
            atlas.lineWidth = 2;
            atlas.strokeRect(-bw/2, -bh/2, bw, bh);

            // Player details
            if (!isGhost) {
              // Windshield
              atlas.fillStyle = 'rgba(111, 168, 201, 0.4)';
              atlas.fillRect(-bw * 0.15, -bh/2 + 2, bw * 0.35, bh - 6);

              // Eye
              atlas.fillStyle = '#2B2118';
              atlas.beginPath();
              atlas.ellipse(bw * 0.05, -bh * 0.1, 5, 6, 0, 0, Math.PI * 2);
              atlas.fill();

              // Grinning mouth
              atlas.strokeStyle = '#2B2118';
              atlas.lineWidth = 1;
              atlas.beginPath();
              atlas.arc(bw * 0.05, -bh * 0.02, 3, 0, Math.PI);
              atlas.stroke();
            }

            // Undercarriage shadow
            atlas.fillStyle = isGhost ? 'rgba(0,0,0,0.1)' : '#E9DEC3';
            atlas.fillRect(-bw/2, bh/2 - 4, bw, 4);

            atlas.restore();
          },

          drawCrossHatch: (x, y, w, h) => {
            atlas.save();
            atlas.translate(x, y);

            atlas.strokeStyle = 'rgba(43, 33, 24, 0.06)';
            atlas.lineWidth = 1;
            atlas.lineCap = 'round';

            // Diagonal lines (20° from horizontal)
            for (let i = -256; i < 512; i += 12) {
              atlas.beginPath();
              atlas.moveTo(i, h);
              atlas.lineTo(i + h * Math.tan(20 * Math.PI / 180), 0);
              atlas.stroke();
            }

            // Cross diagonal (25° from horizontal)
            for (let i = -256; i < 512; i += 18) {
              atlas.beginPath();
              atlas.moveTo(i, 0);
              atlas.lineTo(i + h * Math.tan(25 * Math.PI / 180), h);
              atlas.stroke();
            }

            atlas.restore();
          },

          drawGrassTuft: (x, y, w, h, variant) => {
            atlas.save();
            atlas.translate(x + w/2, y + h - 4);
            atlas.scale(w/16, h/24); // Scale from base 16x24

            const rng = mulberry32(12345 + variant);
            atlas.strokeStyle = '#7CA05C';
            atlas.lineWidth = 1.5;
            atlas.lineCap = 'round';

            const blades = 2 + Math.floor(rng() * 2);
            for (let b = 0; b < blades; b++) {
              const bx = 4 + rng() * 8;
              const lean = (rng() - 0.5) * 6;
              atlas.beginPath();
              atlas.moveTo(bx, 24);
              atlas.quadraticCurveTo(bx + lean * 0.5, 12, bx + lean, 2 + rng() * 4);
              atlas.stroke();
            }

            atlas.restore();
          },

          drawConfetti: (x, y, w, h, variant) => {
            atlas.save();
            atlas.translate(x + w/2, y + h/2);

            const colors = ['#D94F3A', '#E8B64C', '#6FA8C9', '#7CA05C'];
            const rng = mulberry32(5000 + variant);

            atlas.fillStyle = colors[variant % colors.length];
            atlas.rotate((rng() - 0.5) * Math.PI / 4);

            // Rectangular confetti piece
            atlas.fillRect(-w/2, -h/3, w, h * 0.6);

            atlas.restore();
          },

          drawInkSplatter: (x, y, w, h, variant) => {
            atlas.save();
            atlas.translate(x + w/2, y + h/2);
            atlas.scale(w/24, h/24); // Scale from base 24x24

            const rng = mulberry32(9000 + variant);
            atlas.fillStyle = 'rgba(43, 33, 24, 0.7)';

            // Irregular ink blot shape
            atlas.beginPath();
            const points = 8;
            for (let i = 0; i < points; i++) {
              const angle = (i / points) * Math.PI * 2;
              const r = 8 + (rng() - 0.5) * 6;
              const px = 12 + Math.cos(angle) * r;
              const py = 12 + Math.sin(angle) * r;
              if (i === 0) atlas.moveTo(px, py);
              else atlas.lineTo(px, py);
            }
            atlas.closePath();
            atlas.fill();

            atlas.restore();
          },

          drawLogoWheel: (x, y, w, h) => {
            atlas.save();
            atlas.translate(x + w/2, y + h/2);

            const r = Math.min(w, h) * 0.45;

            // Outer ring
            atlas.strokeStyle = '#2B2118';
            atlas.lineWidth = 3;
            atlas.beginPath();
            atlas.arc(0, 0, r, 0, Math.PI * 2);
            atlas.stroke();

            // Inner decorative ring
            atlas.strokeStyle = '#D94F3A';
            atlas.lineWidth = 2;
            atlas.beginPath();
            atlas.arc(0, 0, r * 0.85, 0, Math.PI * 2);
            atlas.stroke();

            // Center fill
            atlas.fillStyle = '#FBF4E3';
            atlas.beginPath();
            atlas.arc(0, 0, r * 0.7, 0, Math.PI * 2);
            atlas.fill();
            atlas.strokeStyle = '#2B2118';
            atlas.lineWidth = 2;
            atlas.stroke();

            // Spokes (8 spokes like a wheel)
            atlas.strokeStyle = '#2B2118';
            atlas.lineWidth = 1.5;
            for (let i = 0; i < 8; i++) {
              const angle = (i / 8) * Math.PI * 2;
              atlas.beginPath();
              atlas.moveTo(0, 0);
              atlas.lineTo(Math.cos(angle) * r * 0.7, Math.sin(angle) * r * 0.7);
              atlas.stroke();
            }

            // Center hub
            atlas.fillStyle = '#D94F3A';
            atlas.beginPath();
            atlas.arc(0, 0, r * 0.15, 0, Math.PI * 2);
            atlas.fill();

            atlas.restore();
          },

          clearAtlas: () => {
            atlas.clearRect(0, 0, ${ATLAS_WIDTH}, ${ATLAS_HEIGHT});
          },

          loadSvgToImage: async (svgString) => {
            const img = document.createElement('img');
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);

            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              img.src = url;
            });

            URL.revokeObjectURL(url);
            return img;
          },

          drawImage: (img, x, y, w, h) => {
            atlas.drawImage(img, x, y, w, h);
          }
        };
      </script>
    </body>
    </html>
  `);

  // Wait for the page to be ready
  await page.waitForLoadState('networkidle');

  // Clear the atlas
  console.log('Clearing atlas...');
  await page.evaluate(() => {
    (window as any).spriteAPI.clearAtlas();
  });

  // 1. Load and draw hills from SVG
  console.log('  Drawing hills...');
  const svgBasePath = path.join(process.cwd(), 'apps/web/public/assets');

  const farHillSvg = await fs.readFile(path.join(svgBasePath, 'far-hills.svg'), 'utf-8');
  const nearHillSvg = await fs.readFile(path.join(svgBasePath, 'near-hills.svg'), 'utf-8');

  // Expose the SVG data to the page and load it
  await page.evaluate(`
    window.svgData = {
      far: ${JSON.stringify(farHillSvg)},
      near: ${JSON.stringify(nearHillSvg)}
    };
  `);

  // Use page.addInitScript or exposeFunction for complex operations
  await page.evaluate(async () => {
    const api = (window as any).spriteAPI;
    const [farImg, nearImg] = await Promise.all([
      api.loadSvgToImage((window as any).svgData.far),
      api.loadSvgToImage((window as any).svgData.near)
    ]);

    // Store images for later drawing
    (window as any).hillImages = { far: farImg, near: nearImg };
  });

  // Draw hills
  await page.evaluate((layout) => {
    const api = (window as any).spriteAPI;
    api.drawImage((window as any).hillImages.far, layout.hills.far.x, layout.hills.far.y, layout.hills.far.w, layout.hills.far.h);
    api.drawImage((window as any).hillImages.near, layout.hills.near.x, layout.hills.near.y, layout.hills.near.w, layout.hills.near.h);
  }, LAYOUT);

  // 2. Draw chassis sprites
  console.log('  Drawing chassis...');
  await page.evaluate((layout) => {
    const api = (window as any).spriteAPI;
    api.drawChassis(layout.chassis.player.x, layout.chassis.player.y, layout.chassis.player.w, layout.chassis.player.h, false);
    api.drawChassis(layout.chassis.ghost.x, layout.chassis.ghost.y, layout.chassis.ghost.w, layout.chassis.ghost.h, true);
  }, LAYOUT);

  // 3. Draw cross-hatch pattern
  console.log('  Drawing cross-hatch pattern...');
  await page.evaluate((layout) => {
    const api = (window as any).spriteAPI;
    api.drawCrossHatch(layout.crossHatch.x, layout.crossHatch.y, layout.crossHatch.w, layout.crossHatch.h);
  }, LAYOUT);

  // 4. Draw grass tufts
  console.log('  Drawing grass tufts...');
  await page.evaluate((layout) => {
    const api = (window as any).spriteAPI;
    layout.grassTufts.forEach((rect, i) => {
      api.drawGrassTuft(rect.x, rect.y, rect.w, rect.h, i);
    });
  }, LAYOUT);

  // 5. Draw confetti
  console.log('  Drawing confetti...');
  await page.evaluate((layout) => {
    const api = (window as any).spriteAPI;
    layout.confetti.forEach((rect, i) => {
      api.drawConfetti(rect.x, rect.y, rect.w, rect.h, i);
    });
  }, LAYOUT);

  // 6. Draw ink splatters
  console.log('  Drawing ink splatters...');
  await page.evaluate((layout) => {
    const api = (window as any).spriteAPI;
    layout.inkSplatters.forEach((rect, i) => {
      api.drawInkSplatter(rect.x, rect.y, rect.w, rect.h, i);
    });
  }, LAYOUT);

  // 7. Draw logo wheel
  console.log('  Drawing logo wheel...');
  await page.evaluate((layout) => {
    const api = (window as any).spriteAPI;
    api.drawLogoWheel(layout.logo.x, layout.logo.y, layout.logo.w, layout.logo.h);
  }, LAYOUT);

  // Export the atlas as PNG
  console.log('Exporting atlas...');
  const pngBuffer = await page.evaluate(async () => {
    const canvas = document.getElementById('atlas');
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const arrayBuffer = await blob.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  });

  await browser.close();

  // Write PNG file
  const outputPath = path.join(process.cwd(), 'apps/web/public/assets/sprite-atlas.png');
  await fs.writeFile(outputPath, Buffer.from(pngBuffer));
  console.log(`Wrote ${outputPath}`);

  // Write metadata JSON
  const metadataPath = path.join(process.cwd(), 'apps/web/public/assets/sprite-atlas.json');
  await fs.writeFile(metadataPath, JSON.stringify(LAYOUT, null, 2));
  console.log(`Wrote ${metadataPath}`);

  // Check file size
  const stats = await fs.stat(outputPath);
  const sizeKB = stats.size / 1024;
  console.log(`Atlas size: ${sizeKB.toFixed(1)} KB`);

  if (sizeKB > 256) {
    console.warn(`WARNING: Atlas exceeds 256KB target (${sizeKB.toFixed(1)} KB)`);
  } else {
    console.log('Atlas within size target (<=256KB)');
  }

  console.log('Sprite atlas generation complete!');
}

main().catch(console.error);
