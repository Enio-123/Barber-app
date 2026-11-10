// Gera os ícones do app (tela inicial do celular e aba do navegador): nome em letra cursiva sobre o camuflado.
// Uso: node tools/icones.mjs   (precisa do Playwright instalado no computador)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = readFileSync(join(root, 'node_modules/@fontsource/kaushan-script/files/kaushan-script-latin-400-normal.woff2')).toString('base64');
const camo = readFileSync(join(root, 'src/assets/camo.webp')).toString('base64');

const html = (size, scale, tile) => `<!doctype html><html><head><style>
@font-face { font-family: K; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;
  background: radial-gradient(90% 90% at 50% 46%, rgba(10,11,9,.18) 0%, rgba(10,11,9,.55) 100%),
    url(data:image/webp;base64,${camo}) 0 0 / ${tile}px ${tile}px repeat, #6e764e}
.w{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:K;color:#fff;line-height:.86;
  transform:translateY(${-size * 0.02}px);text-shadow:0 ${Math.max(1, size * 0.012)}px 0 rgba(0,0,0,.55),0 0 ${size * 0.05}px rgba(0,0,0,.55)}
.w span{font-size:${size * scale}px;letter-spacing:.01em}
.w span:last-child{margin-left:${size * scale * 0.55}px}
</style></head><body><div class="w"><span>Easy</span><span>Cut</span></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, scale, tile] of [
  ['icon-512.png', 512, 0.36, 520],
  ['icon-192.png', 192, 0.36, 200],
  ['apple-touch-icon.png', 180, 0.33, 190],
  ['icon-maskable-512.png', 512, 0.27, 520],
  ['favicon-32.png', 32, 0.42, 60],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, scale, tile));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(root, 'public', name) });
}
await browser.close();
console.log('ícones gerados em public/');
