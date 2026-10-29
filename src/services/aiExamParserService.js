import { APP_CONFIG } from '../constants/appConfig.js';
import { ExamModel } from '../models/examModel.js';
import { logger } from '../utils/logger.js';

export class AiExamParserService {
  constructor() {
    this.apiKey = APP_CONFIG?.GEMINI_API_KEY || '';
  }

  async parseExamWithAI({ questions = [] }) {
    // 1. Lấy API Key từ bộ nhớ
    let activeKey = this.apiKey;
    try {
      const u = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
      if (u.geminiApiKey) activeKey = u.geminiApiKey.trim();
    } catch (e) {}

    // 2. Nếu chưa có API Key, yêu cầu người dùng nhập
    if (!activeKey) {
      activeKey = prompt('🔑 Vui lòng nhập Gemini API Key hợp lệ (bắt đầu bằng AIzaSy...):');
      if (!activeKey || !activeKey.trim()) {
        return {
          success: false,
          message: '⚠️ Chưa nhập Gemini API Key. Thao tác phân tích AI đã bị hủy.'
        };
      }
      activeKey = activeKey.trim();
    }

    const systemPrompt = `
You are an expert AI educational assistant. 
Your task is to review, complete, and correct a multiple-choice exam questionnaire.

STRICT INSTRUCTIONS:
1. REVIEW QUESTIONS: Look at each question stem and its options.
2. FILL MISSING OPTIONS: If any option (A, B, C, D) is blank, empty, missing, or contains generic placeholders like "Phương án C...", "Phương án D...", YOU MUST GENERATE A FACTUALLY ACCURATE AND PLAUSIBLE OPTION text related to the question topic. NEVER leave options empty or with placeholder text.
3. DETERMINE CORRECT ANSWER: Analyze the stem and the 4 options carefully. Select the EXACT correct answer index (0 for A, 1 for B, 2 for C, 3 for D).
4. FORMAT OUTPUT: Return strictly a raw JSON array of objects without markdown formatting or backticks (\`\`\`json).

JSON Output Structure:
[
  {
    "id": "q_1",
    "stem": "Nội dung câu hỏi...",
    "options": ["Phương án A", "Phương án B", "Phương án C sinh bởi AI", "Phương án D sinh bởi AI"],
    "correctAnswer": 1
  }
]
`;

    // 3. Tiến hành gọi API
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      
      const payloadContents = [{
        role: 'user',
        parts: [
          { text: systemPrompt },
          { text: `Danh sách câu hỏi cần hoàn thiện:\n${JSON.stringify(questions, null, 2)}` }
        ]
      }];

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeKey}`;

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: payloadContents })
        });

        // Nếu lỗi 401 (Unauthorized / Invalid Credentials / Blocked Key)
        if (response.status === 401 || response.status === 403) {
          const newKey = prompt('⚠️ API Key hiện tại không hợp lệ hoặc bị khóa (Lỗi 401: Unauthorized).\nVui lòng dán Gemini API Key hợp lệ mới từ Google AI Studio (bắt đầu bằng AIzaSy...):');
          if (newKey && newKey.trim()) {
            activeKey = newKey.trim();
            // Lưu lại Key mới
            try {
              const u = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
              u.geminiApiKey = activeKey;
              sessionStorage.setItem('currentUser', JSON.stringify(u));
            } catch (e) {}
            continue; // Chạy lại vòng lặp với Key mới
          } else {
            return {
              success: false,
              message: '⚠️ API Key không hợp lệ. Vui lòng lấy Key mới tại https://aistudio.google.com/'
            };
          }
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const resData = await response.json();
        const rawResponseText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanJsonStr = rawResponseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsedArray = JSON.parse(cleanJsonStr);

        if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
          throw new Error('Cấu trúc dữ liệu AI trả về không phải là mảng JSON hợp lệ.');
        }

        // Chuẩn hóa và gắn nhãn thành công
        const refinedQuestions = parsedArray.map((q, idx) => {
          const normalized = ExamModel.normalizeQuestion(q, idx);
          normalized.flags = {
            needsUserConfirmation: true,
            note: '🤖 AI đã sinh phương án & đề xuất đáp án. Giảng viên vui lòng rà soát và duyệt lại.'
          };
          return normalized;
        });

        return {
          success: true,
          questions: refinedQuestions
        };

      } catch (err) {
        logger.error('Lỗi kết nối Gemini AI:', err);
        return {
          success: false,
          message: `⚠️ Không thể gọi AI: ${err.message}`
        };
      }
    }

    return {
      success: false,
      message: '⚠️ Không thể kết nối với Gemini AI.'
    };
  }
}

export const aiExamParserService = new AiExamParserService();
window.aiExamParserService = aiExamParserService;
