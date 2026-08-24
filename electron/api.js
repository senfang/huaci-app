function formatApiResponse(data) {
  if (typeof data === 'string') return data;
  if (data == null) return '';

  const keys = ['text', 'result', 'answer', 'output', 'content', 'data'];
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  if (typeof data === 'object') {
    return JSON.stringify(data, null, 2);
  }

  return String(data);
}

async function runApiRequest(profile, text, signal) {
  const url = (profile?.url || '').trim();
  if (!url) {
    throw new Error('请先在设置中配置接口地址');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`接口错误 (${response.status}): ${errText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return formatApiResponse(await response.json());
  }

  return (await response.text()).trim();
}

module.exports = { runApiRequest, formatApiResponse };
