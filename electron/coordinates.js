const { screen } = require('electron');

function toElectronPoint(point) {
  if (!point || point.x == null || point.y == null) return null;

  const x = Math.round(point.x);
  const y = Math.round(point.y);

  if (process.platform === 'darwin') {
    return { x, y };
  }

  if (typeof screen.screenToDipPoint === 'function') {
    return screen.screenToDipPoint({ x, y });
  }

  return { x, y };
}

function toElectronRect(rect) {
  if (!rect) return null;

  const topLeft = toElectronPoint({ x: rect.left, y: rect.top });
  const bottomRight = toElectronPoint({ x: rect.right, y: rect.bottom });
  if (!topLeft || !bottomRight) return null;

  return {
    left: Math.min(topLeft.x, bottomRight.x),
    right: Math.max(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    bottom: Math.max(topLeft.y, bottomRight.y),
  };
}

function isPointOnScreen(x, y) {
  return screen.getAllDisplays().some((display) => {
    const { x: dx, y: dy, width, height } = display.bounds;
    return x >= dx - 80 && x <= dx + width + 80 && y >= dy - 80 && y <= dy + height + 80;
  });
}

function getCursorPoint() {
  return screen.getCursorScreenPoint();
}

function isPointInWorkArea(x, y) {
  if (x == null || y == null) return false;
  return screen.getAllDisplays().some((display) => {
    const wa = display.workArea;
    return x >= wa.x && x <= wa.x + wa.width && y >= wa.y && y <= wa.y + wa.height;
  });
}

function getScreenCenterPoint() {
  const cursor = getCursorPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  return {
    x: Math.round(wa.x + wa.width / 2),
    y: Math.round(wa.y + wa.height / 2),
    rect: null,
  };
}

function normalizeKeyboardAnchor() {
  const cursor = getCursorPoint();
  if (isPointInWorkArea(cursor.x, cursor.y)) {
    return { x: cursor.x, y: cursor.y, rect: null };
  }
  return getScreenCenterPoint();
}

function normalizeAnchor(anchor) {
  if (!anchor) {
    const cursor = getCursorPoint();
    return { x: cursor.x, y: cursor.y, rect: null };
  }

  const point = toElectronPoint({ x: anchor.x, y: anchor.y });
  let rect = anchor.rect ? toElectronRect(anchor.rect) : null;

  if (rect) {
    const anchorX = (rect.left + rect.right) / 2;
    if (!isPointInWorkArea(anchorX, rect.top)) {
      rect = null;
    }
  }

  if (!point || !isPointOnScreen(point.x, point.y)) {
    const cursor = getCursorPoint();
    return { x: cursor.x, y: cursor.y, rect: null };
  }

  return { x: point.x, y: point.y, rect };
}

module.exports = {
  toElectronPoint,
  toElectronRect,
  normalizeAnchor,
  normalizeKeyboardAnchor,
  getCursorPoint,
  getScreenCenterPoint,
  isPointInWorkArea,
};
