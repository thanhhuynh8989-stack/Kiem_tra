import { API_ENDPOINTS } from '../constants/apiEndpoints.js';
import { fetchWithRetry, AppError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { ImageCompressor } from '../utils/imageCompressor.js';

/

Service managing Gemini Vision & Text API integrations.
*/
export class GeminiService {
constructor(apiKey = null, model = API_ENDPOINTS.GEMINI.DEFAULT_MODEL) {
this.apiKey = apiKey || localStorage.getItem('gemini_api_key');
this.model = model || localStorage.getItem('gemini_model') || API_ENDPOINTS.GEMINI.DEFAULT_MODEL;
}

setApiKey(key) {
this.apiKey = key;
localStorage.setItem('gemini_api_key', key);
}

setModel(model) {
this.model = model;
localStorage.setItem('gemini_model', model);
}

/

Generates content using Gemini API with automatic retry and rate-limit handling.
*/
async generateContent(prompt, base64Images = []) {
if (!this.apiKey) {
throw new AppError('Gemini API Key chưa được cấu hình.', 'MISSING_API_KEY');
}

const endpoint = `${API_ENDPOINTS.GEMINI.BASE_URL}/models/${this.model}:generateContent?key=${this.apiKey}`;

const parts = [{ text: prompt }];

for (const img of base64Images) {
  let compressed = img;
  if (img.startsWith('data:image')) {
    compressed = await ImageCompressor.compressBase64Image(img);
  }
  const cleanBase64 = compressed.replace(/^data:image\/\w+;base64,/, '');
  parts.push({
    inline_data: {
      mime_type: 'image/jpeg',
      data: cleanBase64
    }
  });
}

const requestBody = {
  contents: [{ parts }],
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 2048
  }
};

return fetchWithRetry(async () => {
  logger.info(`Đang gửi yêu cầu Gemini AI (Model: ${this.model})...`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errMsg = errorData.error?.message || `HTTP Error ${response.status}`;
    logger.error('Lỗi từ Gemini API:', errorData);
    throw new Error(`Gemini API Error: ${errMsg}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  logger.debug('Kết quả từ Gemini API:', text);
  return text;
});


}

/

Converts mathematical expression in image/text to standardized KaTeX format.
*/
async convertToLaTeX(rawText, base64Image = null) {
const prompt = `
Bạn là một trợ lý giáo dục chuyên về định dạng câu hỏi trắc nghiệm.
Hãy chuyển đổi toàn bộ công thức toán học/hóa học trong văn bản sau thành chuẩn KaTeX:

Dùng $...$ cho công thức inline (nằm trên cùng dòng).

Dùng 

$$...$$

 cho công thức block (dòng riêng).

Giữ nguyên nội dung Tiếng Việt và cấu trúc câu.

Không thêm bất kỳ giải thích nào khác ngoài văn bản đã chuyển đổi.

Văn bản gốc:
${rawText}
`;

const images = base64Image ? [base64Image] : [];
return await this.generateContent(prompt, images);


}

/

Analyzes question stem & options to suggest the correct answer key (A, B, C, D).
*/
async suggestAnswerKey(questionStem, options = []) {
const optionsText = options.map((opt, idx) => ${String.fromCharCode(65 + idx)}. ${opt}).join('\n');
const prompt = `
Hãy giải câu hỏi trắc nghiệm sau và chỉ ra đáp án đúng nhất (A, B, C, hoặc D).
Trả về kết quả theo định dạng JSON duy nhất:
{"suggestedAnswer": "A", "explanation": "Giải thích ngắn gọn lý do chọn đáp án này."}

Câu hỏi:
${questionStem}

Các lựa chọn:
${optionsText}
`;

try {
  const responseText = await this.generateContent(prompt);
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return { suggestedAnswer: null, explanation: 'Không thể phân tích phản hồi AI' };
} catch (error) {
  logger.error('Lỗi khi gợi ý đáp án:', error);
  return { suggestedAnswer: null, explanation: error.message };
}


}
}

export const geminiService = new GeminiService();
