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

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
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
  if (resultText) {
    resultBox.classList.remove('empty');
    resultBox.textContent = resultText;
  }
}

function resetDialog() {
  resultText = '';
  status = 'running';
  resultBox.textContent = '等待接口返回…';
  resultBox.classList.add('empty');
  errorBox.style.display = 'none';
  errorBox.textContent = '';
  setStatus('正在请求接口…', true);
}

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
