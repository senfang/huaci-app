'use strict';

let currentText = '';

const toolbarEl = document.getElementById('toolbar');

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderButtons(buttons) {
  const parts = [];
  buttons.forEach((btn, index) => {
    if (index > 0) parts.push('<div class="toolbar-divider"></div>');
    const cls = btn.primary ? 'toolbar-btn primary' : 'toolbar-btn';
    const icon = btn.icon ? `<span>${escapeHtml(btn.icon)}</span> ` : '';
    parts.push(
      `<button class="${cls}" data-id="${escapeHtml(btn.id)}" data-type="${escapeHtml(btn.type)}">${icon}${escapeHtml(btn.label)}</button>`
    );
  });
  toolbarEl.innerHTML = parts.join('');
}

toolbarEl.addEventListener('mousedown', (e) => e.preventDefault());

toolbarEl.addEventListener('click', (e) => {
  const target = e.target.closest('[data-id]');
  if (!target) return;
  window.huaci.action(target.dataset.id, target.dataset.type, currentText);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.huaci.hide();
});

window.huaci.onShow(({ text, buttons }) => {
  currentText = text;
  renderButtons(buttons || []);
  requestAnimationFrame(() => {
    const rect = toolbarEl.getBoundingClientRect();
    window.huaci.resize(rect.width + 4, rect.height + 4);
  });
});
