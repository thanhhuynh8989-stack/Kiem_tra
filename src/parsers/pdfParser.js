import { REGEX_PATTERNS } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';
import { geminiService } from '../services/geminiService.js';

/**
 * Service parsing exam documents from PDF files using PDF.js & Gemini Vision OCR.
 */
export class PdfParser {
  /**
   * Reads and extracts exam questions from a PDF file.
   * @param {File} file - PDF file from HTML input
   * @param {boolean} useVisionFallback - Fall back to Gemini Vision OCR for scanned PDFs
   * @returns {Promise<Array>} Extracted questions array
   */
  static async parsePdfFile(file, useVisionFallback = true) {
    if (!file) throw new Error('File PDF không tồn tại.');

    logger.info(`Bắt đầu xử lý file PDF: ${file.name}`);

    if (typeof pdfjsLib === 'undefined') {
      throw new Error('Thư viện PDF.js chưa được nạp vào trang web.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfDocument = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdfDocument.numPages;

    logger.info(`Tổng số trang PDF: ${totalPages}`);

    let extractedFullText = '';
    const pageCanvasImages = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = textContent.items.map((item) => item.str).join(' ');
      extractedFullText += `\n--- Trang ${pageNum} ---\n` + pageText;

      if (useVisionFallback) {
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const pageImageBase64 = canvas.toDataURL('image/jpeg', 0.8);
        pageCanvasImages.push(pageImageBase64);
      }
    }

    if (extractedFullText.trim().length < 100 && pageCanvasImages.length > 0) {
      logger.warn('PDF không chứa văn bản dạng text (Scanned PDF). Đang chuyển sang Gemini Vision OCR...');
      return await this._parseScannedPdfWithVision(pageCanvasImages);
    }

    return this.parseTextToQuestions(extractedFullText);
  }

  /**
   * Parses raw extracted PDF string into question structures.
   */
  static parseTextToQuestions(rawText) {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const questions = [];
    let currentQuestion = null;

    for (const line of lines) {
      if (line.startsWith('--- Trang')) continue;

      const isQuestionHeader = REGEX_PATTERNS.QUESTION_START ? REGEX_PATTERNS.QUESTION_START.test(line) : /^Câu\s+\d+/i.test(line);

      if (isQuestionHeader) {
        if (currentQuestion) {
          questions.push(currentQuestion);
        }

        const stemClean = line.replace(REGEX_PATTERNS.QUESTION_START || /^Câu\s+\d+[:.]?\s*/i, '').trim();

        currentQuestion = {
          stem: stemClean,
          options: [],
          correctAnswer: null,
          explanation: '',
          images: []
        };
        continue;
      }

      const isOption = REGEX_PATTERNS.OPTION_START ? REGEX_PATTERNS.OPTION_START.test(line) : /^[A-D]\.\s*/i.test(line);

      if (isOption && currentQuestion) {
        const optionClean = line.replace(REGEX_PATTERNS.OPTION_START || /^[A-D]\.\s*/i, '').trim();
        currentQuestion.options.push(optionClean);
        continue;
      }

      if (currentQuestion) {
        const ansMatch = REGEX_PATTERNS.ANSWER_KEY ? line.match(REGEX_PATTERNS.ANSWER_KEY) : null;
        if (ansMatch) {
          const letter = ansMatch[1].toUpperCase();
          currentQuestion.correctAnswer = letter.charCodeAt(0) - 65;
        } else {
          currentQuestion.stem += ` ${line}`;
        }
      }
    }

    if (currentQuestion) {
      questions.push(currentQuestion);
    }

    logger.info(`Đã phân tích văn bản PDF thành ${questions.length} câu hỏi.`);
    return questions;
  }

  /**
   * Processes scanned PDF page images using Gemini Vision API.
   */
  static async _parseScannedPdfWithVision(pageImages = []) {
    const questions = [];

    for (let i = 0; i < pageImages.length; i++) {
      const pageImg = pageImages[i];
      logger.info(`Đang gọi Gemini OCR cho trang PDF ${i + 1}/${pageImages.length}...`);

      const prompt = `
Bạn là một công cụ OCR chuyên nghiệp bóc tách đề thi trắc nghiệm.
Hãy trích xuất tất cả câu hỏi, phương án (A, B, C, D) và đáp án đúng (nếu có) từ hình ảnh trang đề thi này.
Hãy trả về dưới dạng mảng JSON duy nhất theo định dạng:
[
  {
    "stem": "Nội dung câu hỏi...",
    "options": ["Phương án A", "Phương án B", "Phương án C", "Phương án D"],
    "correctAnswer": 0,
    "explanation": ""
  }
]
Ghi chú: Giữ nguyên định dạng công thức toán dưới dạng KaTeX ($...$).
`;

      try {
        const aiResponse = await geminiService.generateContent(prompt, [pageImg]);
        const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsedPageQuestions = JSON.parse(jsonMatch[0]);
          questions.push(...parsedPageQuestions);
        }
      } catch (err) {
        logger.error(`Lỗi OCR trang PDF ${i + 1}:`, err);
      }
    }

    return questions;
  }
}

// Export named function để tương thích với import { parsePdfFile } từ app.js
export const parsePdfFile = PdfParser.parsePdfFile.bind(PdfParser);
