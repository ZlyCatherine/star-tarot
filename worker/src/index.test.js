import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { normalizeReading, validateReadingRequest } from './index.js';

const validPayload = {
  question: '今天适合关注什么？',
  spreadId: 'daily',
  spreadName: '今日指引',
  cards: [{
    positionId: 'guidance',
    position: '今日指引',
    helper: '此刻最值得你留意的讯息',
    cardId: 'm14',
    nameZh: '节制',
    nameEn: 'Temperance',
    orientation: 'upright',
    keywords: ['平衡', '调和', '疗愈'],
    baseMeaning: '耐心地调和差异。',
  }],
};

test('accepts a valid reading request', () => {
  assert.equal(validateReadingRequest(validPayload), null);
});

test('rejects cards in an invalid spread order', () => {
  const payload = structuredClone(validPayload);
  payload.cards[0].positionId = 'future';
  assert.equal(validateReadingRequest(payload), '牌位顺序与牌阵不一致。');
});

test('normalizes a complete DeepSeek JSON response', () => {
  const result = normalizeReading({
    overview: '整体主题',
    positions: [{ positionId: 'guidance', title: '今日指引', interpretation: '牌位解读' }],
    connections: '牌面联系',
    answer: '综合回应',
    reflection: '留意方向',
  }, validPayload.cards);
  assert.deepEqual(result, {
    overview: '整体主题',
    positions: [{ positionId: 'guidance', title: '今日指引', interpretation: '牌位解读' }],
    connections: '牌面联系',
    answer: '综合回应',
    reflection: '留意方向',
  });
});

test('rejects a response with mismatched positions', () => {
  const result = normalizeReading({
    overview: '整体主题',
    positions: [{ positionId: 'future', title: '未来', interpretation: '牌位解读' }],
    connections: '牌面联系',
    answer: '综合回应',
    reflection: '留意方向',
  }, validPayload.cards);
  assert.equal(result, null);
});

test('rejects an invalid access code before calling DeepSeek', async () => {
  let providerCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerCalled = true;
    return new Response();
  };

  try {
    const request = new Request('https://star-tarot-api.example/interpret', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://zlycatherine.github.io',
        'X-Tarot-Access-Code': 'wrong-code',
      },
      body: JSON.stringify(validPayload),
    });
    const response = await worker.fetch(request, {
      DEEPSEEK_API_KEY: 'test-api-key',
      TAROT_ACCESS_CODE: 'friend-code',
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://zlycatherine.github.io');
    assert.equal(body.error.code, 'invalid_access_code');
    assert.equal(providerCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends a validated JSON-mode request to DeepSeek', async () => {
  const originalFetch = globalThis.fetch;
  let providerRequest;
  globalThis.fetch = async (url, init) => {
    providerRequest = { url, init, body: JSON.parse(init.body) };
    return Response.json({
      model: 'deepseek-flash',
      choices: [{
        message: {
          content: JSON.stringify({
            overview: '整体主题',
            positions: [{ positionId: 'guidance', title: '今日指引', interpretation: '牌位解读' }],
            connections: '牌面联系',
            answer: '综合回应',
            reflection: '留意方向',
          }),
        },
      }],
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    });
  };

  try {
    const request = new Request('https://star-tarot-api.example/interpret', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://127.0.0.1:4173',
        'X-Tarot-Access-Code': 'friend-code',
      },
      body: JSON.stringify(validPayload),
    });
    const response = await worker.fetch(request, {
      DEEPSEEK_API_KEY: 'test-api-key',
      TAROT_ACCESS_CODE: 'friend-code',
      DEEPSEEK_API_BASE: 'https://gateway.ai.cloudflare.com/v1/account/star-tarot/deepseek/',
      DEEPSEEK_MODEL: 'deepseek-flash',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(providerRequest.url, 'https://gateway.ai.cloudflare.com/v1/account/star-tarot/deepseek/chat/completions');
    assert.equal(providerRequest.init.headers.Authorization, 'Bearer test-api-key');
    assert.equal(providerRequest.body.model, 'deepseek-flash');
    assert.deepEqual(providerRequest.body.thinking, { type: 'disabled' });
    assert.deepEqual(providerRequest.body.response_format, { type: 'json_object' });
    assert.equal(providerRequest.body.max_tokens, 1_800);
    assert.equal(providerRequest.body.temperature, 0.75);
    assert.equal(providerRequest.body.stream, false);
    assert.equal(body.reading.answer, '综合回应');
    assert.equal(body.usage.totalTokens, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
