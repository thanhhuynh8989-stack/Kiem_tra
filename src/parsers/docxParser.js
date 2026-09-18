import { REGEX_PATTERNS } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';
import { ImageCompressor } from '../utils/imageCompressor.js';
import { geminiService } from '../services/geminiService.js';

/**
 * Service handling DOCX parsing using Mammoth.js and AI formatting.
 */
export class DocxParser {
  /**
   * Reads a DOCX file, extracts HTML, embedded images, and parses into raw question structures.
   * @param {File} file - DOCX file from file input
   * @param {boolean} enableAIKaTeX - Automatically convert formulas to KaTeX via Gemini
   * @returns {Promise<Array>} Parsed raw questions array
   */
  static async parseDocxFile(file, enableAIKaTeX = true) {
    if (!file) throw new Error('Không tìm thấy file DOCX cần bóc tách.');

    logger.info(`Bắt đầu xử lý file DOCX: ${file.name} (${Math.round(file.size / 1024)} KB)`);

    const mammothLib = typeof window !== 'undefined' && window.mammoth ? window.mammoth : (typeof mammoth !== 'undefined' ? mammoth : null);
    if (!mammothLib) {
      throw new Error('Thư viện Mammoth.js chưa được nạp vào trang.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const imagesExtracted = [];

    const options = {
      convertImage: mammothLib.images.imgElement((image) => {
        return image.read("base64").then(async (imageBuffer) => {
          const mimeType = image.contentType || "image/png";
          const rawBase64 = `data:${mimeType};base64,${imageBuffer}`;
          let compressed = rawBase64;

          try {
            if (ImageCompressor && typeof ImageCompressor.compressBase64Image === 'function') {
              compressed = await ImageCompressor.compressBase64Image(rawBase64);
            }
          } catch (compressErr) {
            logger.warn('Nén ảnh thất bại, giữ nguyên ảnh gốc:', compressErr);
          }

          imagesExtracted.push(compressed);
          const imageIndex = imagesExtracted.length - 1;

          return {
            src: compressed,
            'data-img-index': imageIndex
          };
        });
      })
    };

    const result = await mammothLib.convertToHtml({ arrayBuffer }, options);
    const htmlContent = result && result.value ? result.value : '';

    if (!htmlContent.trim()) {
      logger.warn('Không trích xuất được nội dung HTML từ file DOCX.');
      return [];
    }

    logger.debug('Nội dung HTML thô từ DOCX đã được chuyển đổi.');

    const parsedQuestions = await this.parseHTMLToQuestions(htmlContent, enableAIKaTeX);
    logger.info(`Bóc tách DOCX thành công: Tìm thấy ${parsedQuestions.length} câu hỏi.`);

    return parsedQuestions;
  }

  /**
   * Converts raw DOCX HTML string to an array of standardized question objects.
   */
  static async parseHTMLToQuestions(htmlContent, enableAIKaTeX = true) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    const children = Array.from(tempDiv.children);
    const questions = [];
    let currentQuestion = null;

    const questionStartRegex = REGEX_PATTERNS?.QUESTION_START || /^Câu\s+\d+/i;
    const optionStartRegex = REGEX_PATTERNS?.OPTION_START || /^[A-D]\.\s*/i;

    for (const node of children) {
      const text = node.textContent.trim();

      if (!text && !node.querySelector('img')) continue;

      const isQuestionHeader = questionStartRegex.test(text);

      if (isQuestionHeader) {
        if (currentQuestion) {
          questions.push(currentQuestion);
        }

        const stemClean = text.replace(questionStartRegex, '').replace(/^[:.]?\s*/, '').trim();
        const images = this._extractImagesFromNode(node);

        currentQuestion = {
          id: `q_${questions.length + 1}`,
          stem: stemClean,
          options: [],
          correctAnswer: 0,
          explanation: '',
          images: images,
          imageUrl: images.length > 0 ? images[0] : null,
          hasImage: images.length > 0
        };
        continue;
      }

      const isOption = optionStartRegex.test(text);

      if (isOption && currentQuestion) {
        const optionClean = text.replace(optionStartRegex, '').trim();
        const optionImages = this._extractImagesFromNode(node);
        
        currentQuestion.options.push(optionClean);
        if (optionImages.length > 0) {
          currentQuestion.images.push(...optionImages);
          if (!currentQuestion.imageUrl) {
            currentQuestion.imageUrl = optionImages[0];
            currentQuestion.hasImage = true;
          }
        }

        if (text.includes('*') || text.toLowerCase().includes('[x]')) {
          currentQuestion.correctAnswer = currentQuestion.options.length - 1;
        }
        continue;
      }

      if (currentQuestion) {
        const ansMatch = REGEX_PATTERNS?.ANSWER_KEY ? text.match(REGEX_PATTERNS.ANSWER_KEY) : null;
        if (ansMatch) {
          const letter = ansMatch[1].toUpperCase();
          currentQuestion.correctAnswer = letter.charCodeAt(0) - 65;
        } else if (text.toLowerCase().startsWith('lời giải:') || text.toLowerCase().startsWith('mô tả:')) {
          currentQuestion.explanation = text.replace(/^(lời giải|mô tả)\s*:\s*/i, '').trim();
        } else {
          currentQuestion.stem += (currentQuestion.stem ? '\n' : '') + text;
        }

        const extraImages = this._extractImagesFromNode(node);
        if (extraImages.length > 0) {
          currentQuestion.images.push(...extraImages);
          if (!currentQuestion.imageUrl) {
            currentQuestion.imageUrl = extraImages[0];
            currentQuestion.hasImage = true;
          }
        }
      }
    }

    if (currentQuestion) {
      questions.push(currentQuestion);
    }

    if (enableAIKaTeX && geminiService && typeof geminiService.convertToLaTeX === 'function') {
      for (const q of questions) {
        if (q.stem && (q.stem.includes('$') || q.stem.includes('\\'))) {
          try {
            q.stem = await geminiService.convertToLaTeX(q.stem);
          } catch (latexErr) {
            logger.warn(`Chuyển đổi KaTeX thất bại cho câu hỏi "${q.id}":`, latexErr);
          }
        }
      }
    }

    return questions;
  }

  static _extractImagesFromNode(node) {
    const imgs = node.querySelectorAll('img');
    const imageList = [];
    imgs.forEach((img) => {
      if (img.src && img.src.startsWith('data:image')) {
        imageList.push(img.src);
      }
    });
    return imageList;
  }
}

// Export named function để tương thích với import { parseDocxFile } từ app.js
export const parseDocxFile = DocxParser.parseDocxFile.bind(DocxParser);
