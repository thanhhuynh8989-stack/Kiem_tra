import { REGEX_PATTERNS } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';
import { ImageCompressor } from '../utils/imageCompressor.js';
import { geminiService } from '../services/geminiService.js';

/**
 * Service handling DOCX parsing using Mammoth.js and AI formatting.
 */
export class DocxParser {
  /**
   * Ép kiểu dữ liệu sang chuỗi an toàn, chống lỗi value.replace is not a function
   */
  static _safeString(val) {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object') {
      if (typeof val.value === 'string') return val.value;
      if (typeof val.src === 'string') return val.src;
      if (typeof val.text === 'string') return val.text;
    }
    return String(val || '');
  }

  /**
   * Reads a DOCX file, extracts HTML, embedded images, and parses into raw question structures.
   */
  static async parseDocxFile(file, enableAIKaTeX = true) {
    if (!file) throw new Error('Không tìm thấy file DOCX cần bóc tách.');

    logger.info(`Bắt đầu xử lý file DOCX: ${file.name} (${Math.round(file.size / 1024)} KB)`);

    const mammothLib = typeof window !== 'undefined' && window.mammoth ? window.mammoth : (typeof mammoth !== 'undefined' ? mammoth : null);
    if (!mammothLib) {
      throw new Error('Thư viện Mammoth.js chưa được nạp vào trang.');
    }

    const arrayBuffer = await file.arrayBuffer();

    const options = {
      convertImage: mammothLib.images.imgElement((image) => {
        return image.read("base64").then(async (imageBuffer) => {
          const mimeType = image.contentType || "image/png";
          const rawBase64 = `data:${mimeType};base64,${imageBuffer}`;
          let compressed = rawBase64;

          try {
            if (ImageCompressor && typeof ImageCompressor.compressBase64Image === 'function') {
              const safeBase64 = DocxParser._safeString(rawBase64);
              compressed = await ImageCompressor.compressBase64Image(safeBase64);
            }
          } catch (compressErr) {
            logger.warn('Nén ảnh thất bại, giữ nguyên ảnh gốc:', compressErr);
          }

          return {
            src: DocxParser._safeString(compressed)
          };
        });
      })
    };

    const result = await mammothLib.convertToHtml({ arrayBuffer }, options);
    const htmlContent = DocxParser._safeString(result?.value);

    if (!htmlContent.trim()) {
      logger.warn('Không trích xuất được nội dung HTML từ file DOCX.');
      return [];
    }

    const parsedQuestions = await this.parseHTMLToQuestions(htmlContent, enableAIKaTeX);
    logger.info(`Bóc tách DOCX thành công: Tìm thấy ${parsedQuestions.length} câu hỏi.`);

    return parsedQuestions;
  }

  /**
   * Bóc tách danh sách câu hỏi từ chuỗi HTML
   */
  static async parseHTMLToQuestions(htmlContent, enableAIKaTeX = true) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    const children = Array.from(tempDiv.children);
    const questions = [];
    let currentQuestion = null;

    // Regex linh hoạt: Nhận diện cả "1. ", "1) ", "Câu 1:", "Question 1.", "Bài 1:"
    const questionStartRegex = /^(?:Câu\s+\d+|Question\s+\d+|Bài\s+\d+|\d+[\.\)])[\s:.]*/i;
    // Regex nhận diện đáp án: "A. ", "A) ", "B. ", "B) "
    const optionStartRegex = /^[A-D][\.\)]\s*/i;

    for (const node of children) {
      const text = DocxParser._safeString(node.textContent).trim();

      if (!text && !node.querySelector('img')) continue;

      const isQuestionHeader = questionStartRegex.test(text);

      if (isQuestionHeader) {
        if (currentQuestion) {
          questions.push(currentQuestion);
        }

        const stemClean = text.replace(questionStartRegex, '').trim();
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
        if (text.toLowerCase().startsWith('lời giải:') || text.toLowerCase().startsWith('mô tả:')) {
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
      let src = img.getAttribute('src') || img.src;
      src = DocxParser._safeString(src);
      if (src && src.startsWith('data:image')) {
        imageList.push(src);
      }
    });
    return imageList;
  }
}

export const parseDocxFile = DocxParser.parseDocxFile.bind(DocxParser);
