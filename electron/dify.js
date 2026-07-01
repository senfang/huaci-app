function parseSSEChunk(buffer) {
  const events = [];
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // skip malformed chunk
    }
  }

  return { events, remainder };
}

async function runDifyWorkflow(profile, text, onEvent, signal) {
  if (!profile?.apiKey) {
    throw new Error('请先在设置中配置 Dify API Key');
  }

  const baseUrl = (profile.apiBaseUrl || '').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/workflows/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: { [profile.inputVariable || 'query']: text },
      response_mode: 'streaming',
      user: profile.userId || 'huaci-app-user',
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Dify API 错误 (${response.status}): ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSSEChunk(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      onEvent(event);
    }
  }
}

module.exports = { runDifyWorkflow };
