const { nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const COLORED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#g)"/>
  <path fill="#fff" d="M88 64h80a12 12 0 0 1 0 24h-36v104a12 12 0 0 1-24 0V88H88a12 12 0 0 1 0-24z"/>
</svg>`;

const MAC_TRAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <path fill="#000" d="M4 3.5h10a1 1 0 0 1 0 2H10v9a1 1 0 0 1-2 0v-9H4a1 1 0 0 1 0-2z"/>
</svg>`;

function svgToImage(svg, size) {
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
  return size ? icon.resize({ width: size, height: size }) : icon;
}

function getAppIcon(size = 256) {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    return size ? icon.resize({ width: size, height: size }) : icon;
  }
  return svgToImage(COLORED_SVG, size);
}

function getTrayIcon() {
  if (process.platform === 'darwin') {
    const icon = svgToImage(MAC_TRAY_SVG);
    icon.setTemplateImage(true);
    return icon.resize({ width: 18, height: 18 });
  }
  return getAppIcon(16);
}

module.exports = { getAppIcon, getTrayIcon };
