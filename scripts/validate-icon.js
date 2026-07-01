const fs = require('fs');
const path = require('path');

const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
const buffer = fs.readFileSync(iconPath);

if (buffer.length < 1000) {
  throw new Error(`icon.png too small (${buffer.length} bytes)`);
}

const width = buffer.readUInt32BE(16);
const height = buffer.readUInt32BE(20);

if (width < 512 || height < 512) {
  throw new Error(`icon.png must be at least 512x512, got ${width}x${height}`);
}

console.log(`icon.png OK: ${width}x${height}`);
