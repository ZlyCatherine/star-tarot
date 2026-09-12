import type { AiReadingRequest, AiReadingResponse, AiTarotReading } from './ai-types';

const configuredApiUrl = (import.meta.env.VITE_TAROT_AI_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? '';

export class AiReadingError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 0, code = 'request_failed') {
    super(message);
    this.name = 'AiReadingError';
    this.status = status;
    this.code = code;
  }
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isReading(value: unknown): value is AiTarotReading {
  if (!value || typeof value !== 'object') return false;
  const reading = value as Partial<AiTarotReading>;
  return isNonEmptyText(reading.overview)
    && Array.isArray(reading.positions)
    && reading.positions.every((position) => Boolean(
      position
      && typeof position === 'object'
      && isNonEmptyText(position.positionId)
      && isNonEmptyText(position.title)
      && isNonEmptyText(position.interpretation),
    ))
    && isNonEmptyText(reading.connections)
    && isNonEmptyText(reading.answer)
    && isNonEmptyText(reading.reflection);
}

export function isAiServiceConfigured() {
  return configuredApiUrl.length > 0;
}

export async function requestAiReading(
  payload: AiReadingRequest,
  accessCode: string,
  signal?: AbortSignal,
): Promise<AiReadingResponse> {
  if (!configuredApiUrl) {
    throw new AiReadingError('AI 解牌服务尚未配置。', 0, 'not_configured');
  }

  let response: Response;
  try {
    response = await fetch(`${configuredApiUrl}/interpret`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tarot-Access-Code': accessCode,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AiReadingError('暂时无法连接 AI 解牌服务，请稍后再试。', 0, 'network_error');
  }

  const data = await response.json().catch(() => null) as ({ error?: { code?: string; message?: string } } & Partial<AiReadingResponse>) | null;
  if (!response.ok) {
    throw new AiReadingError(
      data?.error?.message || 'AI 解牌服务暂时不可用，请稍后再试。',
      response.status,
      data?.error?.code || 'request_failed',
    );
  }

  if (!data || !isReading(data.reading) || !isNonEmptyText(data.model)) {
    throw new AiReadingError('AI 返回的解读格式不完整，请重新生成。', 502, 'invalid_response');
  }

  return {
    reading: data.reading,
    model: data.model,
    usage: data.usage,
  };
}
