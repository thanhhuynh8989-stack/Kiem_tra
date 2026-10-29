import { APP_CONFIG } from '../constants/appConfig.js';
import { ExamModel } from '../models/examModel.js';
import { logger } from '../utils/logger.js';
import { appsScriptService } from './appsScriptService.js';
import { getLoggedInUsername } from '../modules/authAndCore.js';

/**
 * AI EXAM PARSER SERVICE
 * Dịch vụ tương tác với Gemini AI để bóc tách, bổ sung phương án thiếu và xác định đáp án đúng.
 */
export class AiExamParserService {
  constructor() {
    this.apiKey = APP_CONFIG?.GEMINI_API_KEY || '';
  }

  /**
   * Gọi Gemini AI để bóc tách hoặc bổ sung/hoàn thiện danh sách câu hỏi
   */
  async parseExamWithAI({ rawText = '', imageBase64 = null, mimeType = null, questions = [] }) {
    // 1. Lấy API Key từ Session / LocalStorage / AppConfig
    let activeKey = this.apiKey;
    try {
      const u = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
      if (u.geminiApiKey) activeKey = u.geminiApiKey;
    } catch (e) {}

    // 2. Xây dựng Prompt ép AI sinh phương án thực tế & chọn đáp án đúng
    const systemPrompt = `
You are an expert AI educational assistant. 
Your task is to review, complete, and correct a multiple-choice exam questionnaire.

STRICT INSTRUCTIONS:
1. REVIEW QUESTIONS: Look at each question stem and its options.
2. FILL MISSING OPTIONS: If any option (A, B, C, D) is blank, empty, missing, or contains generic placeholders like "Phương án C...", "Phương án D...", "Option C", "...", YOU MUST GENERATE A SCIENTIFICALLY/FACTUALLY ACCURATE AND PLAUSIBLE OPTION text related to the question topic. NEVER leave options empty or with placeholder text.
3. DETERMINE CORRECT ANSWER: Analyze the stem and the 4 options carefully. Select the EXACT correct answer index:
   - 0 for A
   - 1 for B
   - 2 for C
   - 3 for D
4. FORMAT OUTPUT: Return strictly a raw JSON array of objects without markdown formatting or backticks (\`\`\`json).

JSON Output Structure required for each item:
{
  "id": "q_1",
  "stem": "Nội dung câu hỏi...",
  "options": [
    "Phương án A",
    "Phương án B",
    "Phương án C (Được AI sinh bổ sung)",
    "Phương án D (Được AI sinh bổ sung)"
  ],
  "correctAnswer": 1
}
`;

    try {
      let parsedArray = null;

      // Ưu tiên gọi trực tiếp Gemini API nếu có API Key
      if (activeKey) {
        let payloadContents = [];
        if (questions && questions.length > 0) {
          payloadContents = [
            {
              role: 'user',
              parts: [
                { text: systemPrompt },
                { text: `Dưới đây là danh sách câu hỏi cần hoàn thiện:\n${JSON.stringify(questions, null, 2)}` }
              ]
            }
          ];
        } else if (imageBase64) {
          payloadContents = [
            {
              role: 'user',
              parts: [
                { text: systemPrompt },
                {
                  inlineData: {
                    mimeType: mimeType || 'image/png',
                    data: imageBase64
                  }
                }
              ]
            }
          ];
        } else {
          payloadContents = [
            {
              role: 'user',
              parts: [
                { text: systemPrompt },
                { text: `Nội dung văn bản đề thi thô:\n${rawText}` }
              ]
            }
          ];
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

      // Nếu chưa thu được kết quả, thử qua AppsScript Service Proxy
      if (!parsedArray) {
        logger.info('Đang gửi yêu cầu bóc tách AI qua AppsScript Service Proxy...');
        const proxyRes = await appsScriptService.request('PARSE_EXAM_AI', {
          rawText,
          imageBase64,
          mimeType,
          questions,
          customApiKey: activeKey,
          username: getLoggedInUsername()
        });

        if (proxyRes && proxyRes.questions) {
          parsedArray = proxyRes.questions;
        }
      }

      if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
        throw new Error('Dữ liệu AI trả về không phải là mảng JSON hợp lệ.');
      }

      // 3. Chuẩn hóa lại cấu trúc dữ liệu - GIỮ NGUYÊN CỜ CẢNH BÁO MÀU VÀNG
      // Giúp Giảng viên dễ dàng kiểm tra, đối soát và quyết định phê duyệt
      const refinedQuestions = parsedArray.map((q, idx) => {
        const normalized = ExamModel.normalizeQuestion(q, idx);
        
        // LUÔN GIỮ CỜ CẢNH BÁO GIẢNG VIÊN XEM LẠI
        normalized.flags = {
          needsUserConfirmation: true, // Giữ cờ cảnh báo màu vàng
          isMissingOptions: false,
          isMissingAnswer: false,
          note: '🤖 AI đã sinh phương án & đề xuất đáp án. Giảng viên vui lòng rà soát và duyệt lại.'
        };
        return normalized;
      });

      return {
        success: true,
        message: '🤖 AI đã tự động bổ sung phương án & gợi ý đáp án! Cờ cảnh báo màu vàng được giữ nguyên để Giảng viên rà soát lại.',
        isFallback: false,
        questions: refinedQuestions
      };

    } catch (err) {
      logger.error('Lỗi khi xử lý với Gemini AI:', err);
      // Khi AI thất bại, trả về danh sách có cảnh báo rõ ràng
      return {
        success: false,
        message: `⚠️ Lỗi gọi AI (${err.message}). Đã chuyển sang bóc tách bằng Code thuần.`,
        isFallback: true,
        questions: this.fallbackParse(questions)
      };
    }
  }

  /**
   * Phương thức dự phòng bằng Code thuần khi không gọi được Gemini
   */
  fallbackParse(questions = []) {
    return questions.map((q, idx) => {
      const normalized = ExamModel.normalizeQuestion(q, idx);
      normalized.flags = {
        needsUserConfirmation: true,
        isMissingOptions: normalized.flags?.isMissingOptions || false,
        isMissingAnswer: normalized.flags?.isMissingAnswer || false,
        note: '⚠️ Bóc tách bằng Code thuần. Giảng viên cần kiểm tra và chọn đáp án chính xác.'
      };
      return normalized;
    });
  }
}

export const aiExamParserService = new AiExamParserService();
window.aiExamParserService = aiExamParserService;
