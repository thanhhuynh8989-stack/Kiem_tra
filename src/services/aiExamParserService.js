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
    // 1. Kiểm tra API Key
    let activeKey = this.apiKey;
    try {
      const u = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
      if (u.geminiApiKey) activeKey = u.geminiApiKey;
    } catch (e) {}

    // Nếu chưa có API Key, chủ động yêu cầu Giảng viên nhập
    if (!activeKey) {
      const userKey = prompt('🔑 Hệ thống chưa phát hiện Gemini API Key. Vui lòng dán khóa Gemini API Key (bắt đầu bằng AIzaSy...) để kích hoạt AI:');
      if (userKey && userKey.trim()) {
        activeKey = userKey.trim();
        // Lưu vào Session dùng cho các lần sau
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

      // 2. Ưu tiên gọi trực tiếp Gemini API nếu có API Key
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

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeKey}`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: payloadContents })
        });

        if (response.ok) {
          const resData = await response.json();
          const rawResponseText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleanJsonStr = rawResponseText.replace(/```json/gi, '').replace(/```/g, '').trim();
          parsedArray = JSON.parse(cleanJsonStr);
        }
      }

      // 3. Nếu không có Key trực tiếp, thử qua AppsScript Service Proxy
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

      // 4. Chuẩn hóa và giữ cờ cảnh báo màu vàng cho Giảng viên duyệt
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
      logger.error('Lỗi Gemini AI:', err);
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
