import { APP_CONFIG } from '../constants/appConfig.js';
import { ExamModel } from '../models/examModel.js';
import { logger } from '../utils/logger.js';
import { appsScriptService } from './appsScriptService.js';
import { getLoggedInUsername } from '../modules/authAndCore.js';

export class AiExamParserService {
  constructor() {
    this.apiKey = APP_CONFIG?.GEMINI_API_KEY || '';
  }

  async parseExamWithAI({ rawText = '', imageBase64 = null, mimeType = null, questions = [] }) {
    // 1. Nạp Key/Token từ Session hoặc LocalStorage
    let activeKey = this.apiKey;
    try {
      const u = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
      if (u.geminiApiKey) activeKey = u.geminiApiKey.trim();
    } catch (e) {}

    // Nếu chưa có khóa, nhắc người dùng dán vào
    if (!activeKey) {
      const userKey = prompt('🔑 Vui lòng dán Mã Xác Thực / API Key Gemini của bạn:');
      if (userKey && userKey.trim()) {
        activeKey = userKey.trim();
        try {
          const u = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
          u.geminiApiKey = activeKey;
          sessionStorage.setItem('currentUser', JSON.stringify(u));
        } catch (e) {}
      }
    }

    const systemPrompt = `
You are an expert AI educational assistant. 
Your task is to review, complete, and correct a multiple-choice exam questionnaire.

STRICT INSTRUCTIONS:
1. REVIEW QUESTIONS: Look at each question stem and its options.
2. FILL MISSING OPTIONS: If any option (A, B, C, D) is blank, empty, missing, or contains generic placeholders like "Phương án C...", "Phương án D...", YOU MUST GENERATE A FACTUALLY ACCURATE AND PLAUSIBLE OPTION text related to the question topic. NEVER leave options empty or with placeholder text.
3. DETERMINE CORRECT ANSWER: Analyze the stem and the 4 options carefully. Select the EXACT correct answer index:
   - 0 for A
   - 1 for B
   - 2 for C
   - 3 for D
4. FORMAT OUTPUT: Return strictly a raw JSON array of objects without markdown formatting or backticks (\`\`\`json).

JSON Output Structure required for each item:
[
  {
    "id": "q_1",
    "stem": "Nội dung câu hỏi...",
    "options": ["Phương án A", "Phương án B", "Phương án C sinh bởi AI", "Phương án D sinh bởi AI"],
    "correctAnswer": 1
  }
]
`;

    try {
      let parsedArray = null;

      if (activeKey) {
        let payloadContents = [];
        if (questions && questions.length > 0) {
          payloadContents = [{
            role: 'user',
            parts: [
              { text: systemPrompt },
              { text: `Dưới đây là danh sách câu hỏi cần bổ sung phương án C, D và chọn đáp án chính xác:\n${JSON.stringify(questions, null, 2)}` }
            ]
          }];
        } else if (imageBase64) {
          payloadContents = [{
            role: 'user',
            parts: [
              { text: systemPrompt },
              { inlineData: { mimeType: mimeType || 'image/png', data: imageBase64 } }
            ]
          }];
        } else {
          payloadContents = [{
            role: 'user',
            parts: [
              { text: systemPrompt },
              { text: `Văn bản thô:\n${rawText}` }
            ]
          }];
        }

        // 2. TỰ ĐỘNG CẤU HÌNH HEADER VÀ ENDPOINT TƯƠNG ỨNG MỖI LOẠI KEY
        let fetchUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
        let fetchHeaders = { 'Content-Type': 'application/json' };

        if (activeKey.startsWith('AQ.') || activeKey.startsWith('ya29.')) {
          // Token dạng OAuth / GCP Access Token -> Truyền qua Header Authorization
          fetchHeaders['Authorization'] = `Bearer ${activeKey}`;
        } else {
          // Khóa API Key AI Studio chuẩn -> Truyền qua URL Param ?key=
          fetchUrl += `?key=${activeKey}`;
        }

        const response = await fetch(fetchUrl, {
          method: 'POST',
          headers: fetchHeaders,
          body: JSON.stringify({ contents: payloadContents })
        });

        if (response.ok) {
          const resData = await response.json();
          const rawResponseText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleanJsonStr = rawResponseText.replace(/```json/gi, '').replace(/```/g, '').trim();
          parsedArray = JSON.parse(cleanJsonStr);
        } else {
          const errBody = await response.text();
          logger.warn(`Lỗi trực tiếp từ Gemini API (${response.status}):`, errBody);
        }
      }

      // 3. Dự phòng gửi qua AppsScript Service Proxy nếu gọi trực tiếp chưa thành công
      if (!parsedArray) {
        logger.info('Đang gửi yêu cầu bóc tách AI qua AppsScript Service Proxy...');
        const proxyRes = await appsScriptService.request('PARSE_EXAM_AI', {
          rawText, imageBase64, mimeType, questions,
          customApiKey: activeKey,
          username: getLoggedInUsername()
        });

        if (proxyRes && proxyRes.questions) {
          parsedArray = proxyRes.questions;
        } else if (proxyRes && proxyRes.message) {
          throw new Error(proxyRes.message);
        }
      }

      if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
        throw new Error('Dữ liệu AI trả về không đúng cấu trúc mảng JSON.');
      }

      // 4. Chuẩn hóa dữ liệu & giữ nguyên cờ cảnh báo để Giảng viên rà soát
      const refinedQuestions = parsedArray.map((q, idx) => {
        const normalized = ExamModel.normalizeQuestion(q, idx);
        normalized.flags = {
          needsUserConfirmation: true,
          isMissingOptions: false,
          isMissingAnswer: false,
          note: '🤖 AI đã sinh phương án & đề xuất đáp án. Giảng viên vui lòng rà soát và duyệt lại.'
        };
        return normalized;
      });

      return {
        success: true,
        message: '🤖 AI đã bổ sung thành công phương án C, D và chọn đáp án đúng! Giảng viên vui lòng kiểm tra lại.',
        isFallback: false,
        questions: refinedQuestions
      };

    } catch (err) {
      logger.error('Lỗi xử lý Gemini AI:', err);
      return {
        success: false,
        message: `⚠️ Lỗi xử lý AI: ${err.message}`,
        isFallback: true,
        questions: this.fallbackParse(questions)
      };
    }
  }

  fallbackParse(questions = []) {
    return questions.map((q, idx) => {
      const normalized = ExamModel.normalizeQuestion(q, idx);
      normalized.flags = {
        needsUserConfirmation: true,
        isMissingOptions: normalized.flags?.isMissingOptions || false,
        isMissingAnswer: normalized.flags?.isMissingAnswer || false,
        note: '⚠️ Chưa thể kết nối AI. Giảng viên cần kiểm tra và chọn đáp án thủ công.'
      };
      return normalized;
    });
  }
}

export const aiExamParserService = new AiExamParserService();
window.aiExamParserService = aiExamParserService;
