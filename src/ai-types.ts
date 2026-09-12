export type AiReadingCardInput = {
  positionId: string;
  position: string;
  helper: string;
  cardId: string;
  nameZh: string;
  nameEn: string;
  orientation: 'upright' | 'reversed';
  keywords: string[];
  baseMeaning: string;
};

export type AiReadingRequest = {
  question: string;
  spreadId: string;
  spreadName: string;
  cards: AiReadingCardInput[];
};

export type AiPositionReading = {
  positionId: string;
  title: string;
  interpretation: string;
};

export type AiTarotReading = {
  overview: string;
  positions: AiPositionReading[];
  connections: string;
  answer: string;
  reflection: string;
};

export type AiReadingResponse = {
  reading: AiTarotReading;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};
