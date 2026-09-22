import { http } from '../http';

const BASE_URL = 'https://open.vectcut.com/lago/projects';
const SUBTITLE_PRICING_URL = 'https://open.vectcut.com/llm/asr/asr_llm/submit_task/billing_prices';

export async function getProjectPricing() {
  return http.getJson(`${BASE_URL}/pricing`);
}

// Returns ASR/STA tier prices and the minimum-minute and rounding rules.
export async function getSubtitleRecognitionPricing() {
  return http.getJson(SUBTITLE_PRICING_URL);
}
