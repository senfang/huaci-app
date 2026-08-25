'use strict';

let resultText = '';
let status = 'idle';
let currentProfileId = null;

const dialogTitle = document.getElementById('dialogTitle');
const dialogSubtitle = document.getElementById('dialogSubtitle');
const resultBox = document.getElementById('resultBox');
const errorBox = document.getElementById('errorBox');
const statusText = document.getElementById('statusText');
const spinner = document.getElementById('spinner');
const stopBtn = document.getElementById('stopBtn');
const closeBtn = document.getElementById('closeBtn');

if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true });
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    return escapeHtml(text);
  }

  const html = marked.parse(text);
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
  });
}

function setStatus(msg, running) {
  statusText.textContent = msg;
  spinner.style.display = running ? 'inline-block' : 'none';
  stopBtn.style.display = running ? 'block' : 'none';
}

function showError(msg) {
  errorBox.style.display = 'block';
  errorBox.textContent = msg;
  setStatus('请求失败', false);
  status = 'failed';
}

function updateResult() {
  if (!resultText) return;

  resultBox.classList.remove('empty');
  resultBox.classList.add('markdown-body');
  resultBox.innerHTML = renderMarkdown(resultText);

  resultBox.querySelectorAll('a[href]').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
}

function resetDialog() {
  resultText = '';
  status = 'running';
  resultBox.classList.remove('markdown-body');
  resultBox.textContent = '等待接口返回…';
  resultBox.classList.add('empty');
  errorBox.style.display = 'none';
  errorBox.textContent = '';
  setStatus('正在请求接口…', true);
}

resultBox.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  e.preventDefault();
  window.huaci.openExternal(link.href);
});

closeBtn.addEventListener('click', () => window.huaci.close());
stopBtn.addEventListener('click', () => window.huaci.abort());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.huaci.close();
});

window.huaci.onOpen(({ text, title, profileId }) => {
  currentProfileId = profileId;
  dialogTitle.textContent = title || 'AI 解读';
  dialogSubtitle.textContent = `「${truncate(text, 80)}」`;
  resetDialog();
  if (profileId) {
    window.huaci.run(text, profileId);
  }
});

window.huaci.onEvent((msg) => {
  if (msg.type === 'result') {
    resultText = msg.text || '';
    updateResult();
  }
  if (msg.type === 'error') showError(msg.message);
  if (msg.type === 'done') {
    if (status === 'running') setStatus('完成', false);
    status = 'done';
  }
  if (msg.type === 'aborted') setStatus('已停止', false);
});
