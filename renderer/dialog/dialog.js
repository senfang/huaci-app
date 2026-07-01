'use strict';

const nodeMap = new Map();
let resultText = '';
let status = 'idle';
let currentProfileId = null;

const dialogTitle = document.getElementById('dialogTitle');
const dialogSubtitle = document.getElementById('dialogSubtitle');
const processList = document.getElementById('processList');
const resultBox = document.getElementById('resultBox');
const errorBox = document.getElementById('errorBox');
const statusText = document.getElementById('statusText');
const spinner = document.getElementById('spinner');
const stopBtn = document.getElementById('stopBtn');
const closeBtn = document.getElementById('closeBtn');

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function extractOutputText(outputs) {
  if (typeof outputs === 'string') return outputs;
  const keys = ['text', 'result', 'answer', 'output', 'content'];
  for (const key of keys) {
    if (outputs[key]) return String(outputs[key]);
  }
  const values = Object.values(outputs).filter((v) => typeof v === 'string' && v.trim());
  return values.join('\n');
}

function setStatus(msg, running) {
  statusText.textContent = msg;
  spinner.style.display = running ? 'inline-block' : 'none';
  stopBtn.style.display = running ? 'block' : 'none';
}

function showError(msg) {
  errorBox.style.display = 'block';
  errorBox.textContent = msg;
  setStatus('执行失败', false);
  status = 'failed';
}

function updateResult() {
  if (resultText) {
    resultBox.classList.remove('empty');
    resultBox.textContent = resultText;
  }
}

function resetDialog() {
  nodeMap.clear();
  resultText = '';
  status = 'running';
  processList.innerHTML = '';
  resultBox.textContent = '等待工作流输出…';
  resultBox.classList.add('empty');
  errorBox.style.display = 'none';
  errorBox.textContent = '';
  setStatus('正在调用 Dify 工作流…', true);
}

function handleEvent(event) {
  const type = event.event;

  if (type === 'workflow_started') {
    setStatus('工作流已启动…', true);
  }

  if (type === 'node_started') {
    const { node_id, title, node_type } = event.data || {};
    const li = document.createElement('li');
    li.className = 'process-item running';
    li.dataset.nodeId = node_id;
    li.innerHTML = `
      <span class="process-dot"></span>
      <div>
        <div class="process-name">${escapeHtml(title || node_type || '节点')}</div>
        <div class="process-meta">执行中…</div>
      </div>
    `;
    processList.appendChild(li);
    nodeMap.set(node_id, li);
    setStatus(`正在执行：${title || node_type}`, true);
  }

  if (type === 'text_chunk') {
    const chunk = event.data?.text || '';
    resultText += chunk;
    updateResult();
  }

  if (type === 'node_finished') {
    const { node_id, title, status: nodeStatus, elapsed_time, outputs } = event.data || {};
    let li = nodeMap.get(node_id);
    if (!li) {
      li = document.createElement('li');
      li.className = 'process-item';
      li.dataset.nodeId = node_id;
      li.innerHTML = `
        <span class="process-dot"></span>
        <div>
          <div class="process-name">${escapeHtml(title || '节点')}</div>
          <div class="process-meta"></div>
        </div>
      `;
      processList.appendChild(li);
    }
    li.classList.remove('running');
    li.classList.add(nodeStatus === 'succeeded' ? 'done' : 'failed');
    const meta = li.querySelector('.process-meta');
    const timeStr = elapsed_time != null ? `${elapsed_time.toFixed(2)}s` : '';
    meta.textContent = nodeStatus === 'succeeded'
      ? `完成 ${timeStr}`
      : `失败 ${timeStr}`;

    if (outputs && typeof outputs === 'object') {
      const outputText = extractOutputText(outputs);
      if (outputText && !resultText.includes(outputText)) {
        if (resultText) resultText += '\n\n';
        resultText += outputText;
        updateResult();
      }
    }
  }

  if (type === 'workflow_finished') {
    const { status: wfStatus, outputs, error } = event.data || {};
    if (wfStatus === 'failed') {
      showError(error || '工作流执行失败');
      return;
    }
    if (outputs) {
      const outputText = extractOutputText(outputs);
      if (outputText) {
        resultText = outputText;
        updateResult();
      }
    }
    setStatus('解读完成', false);
    status = 'done';
  }
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
  if (msg.type === 'event') handleEvent(msg.event);
  if (msg.type === 'error') showError(msg.message);
  if (msg.type === 'done') {
    if (status === 'running') setStatus('解读完成', false);
  }
  if (msg.type === 'aborted') setStatus('已停止', false);
});
