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

    // Xuất HTML để giữ các thẻ <b>, <u>, <strong> từ file Word
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
   * Bóc tách danh sách câu hỏi từ chuỗi HTML bằng thuật toán Code-First
   */
  static async parseHTMLToQuestions(htmlContent, enableAIKaTeX = true) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    const children = Array.from(tempDiv.children);
    const questions = [];
    let currentQuestion = null;

    // Regex nhận diện đầu câu hỏi: "1. ", "Câu 1:", "Question 1.", "Bài 1:"
    const questionStartRegex = /^(?:Câu\s+\d+|Question\s+\d+|Bài\s+\d+|\d+[\.\)])[\s:.]*/i;
    // Regex nhận diện phương án (A đến E): "A. ", "A) ", "*A. ", "B. "
    const optionStartRegex = /^\s*\*?\s*([A-E])[\.\)]\s*/i;
    // Regex quét chữ "Đáp án: B", "ĐA: C", "Đáp án đúng: A" trong văn bản
    const ansInTextRegex = /(?:Đáp\s*án|ĐA|Đáp\s*án\s*đúng)\s*[:=]?\s*([A-E])/i;

    /**
     * Hàm chốt dữ liệu, đếm phương án và cắm cờ cảnh báo (Code-First)
     */
    const finalizeQuestion = (q) => {
      if (!q) return;

      // 1. Quét tìm "Đáp án: X" trong Stem hoặc Explanation nếu chưa bắt được từ phương án
      let foundAnsIdx = q.detectedAnswerIndex;
      if (foundAnsIdx === null || foundAnsIdx === undefined || foundAnsIdx === -1) {
        const textToSearch = `${q.stem} ${q.explanation}`;
        const stemAnsMatch = textToSearch.match(ansInTextRegex);
        if (stemAnsMatch) {
          const letter = stemAnsMatch[1].toUpperCase();
          foundAnsIdx = letter.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3, E=4
        }
      }

      const rawOptions = q.rawOptions || [];
      const originalOptionCount = rawOptions.length;

      let finalOptions = [...rawOptions];
      let finalCorrectAnswer = (foundAnsIdx !== null && foundAnsIdx !== undefined && foundAnsIdx >= 0) ? foundAnsIdx : 0;
      let isMissingAnswer = (foundAnsIdx === null || foundAnsIdx === undefined || foundAnsIdx === -1);

      // 2. Xử lý chuẩn hóa câu có 5 phương án (A-E) về 4 phương án (A-D)
      if (originalOptionCount === 5) {
        if (foundAnsIdx === 4) { 
          // Nếu E là đáp án đúng -> Giữ lại A, B, C và E (E chuyển thành vị trí D, index 3)
          finalOptions = [rawOptions[0], rawOptions[1], rawOptions[2], rawOptions[4]];
          finalCorrectAnswer = 3;
        } else {
          // Đáp án nằm trong A-D hoặc chưa có đáp án -> Lấy 4 phương án đầu (0, 1, 2, 3)
          finalOptions = rawOptions.slice(0, 4);
          if (finalCorrectAnswer > 3) finalCorrectAnswer = 0;
        }
      } else if (originalOptionCount > 5) {
        finalOptions = rawOptions.slice(0, 4);
        if (finalCorrectAnswer >= 4) finalCorrectAnswer = 0;
      }

      // 3. Đếm & cắm cờ cảnh báo bằng Code thuần
      const isMissingOptions = originalOptionCount < 4;

      let notes = [];
      if (isMissingOptions) {
        notes.push(`Đề gốc chỉ có ${originalOptionCount}/4 phương án lựa chọn.`);
      }
      if (isMissingAnswer) {
        notes.push(`Chưa nhận diện được đáp án đúng từ đề gốc (Đang tạm chọn A).`);
      }

      q.options = finalOptions;
      q.originalOptionCount = originalOptionCount;
      q.correctAnswer = finalCorrectAnswer;
      q.flags = {
        needsUserConfirmation: isMissingOptions || isMissingAnswer,
        isMissingOptions: isMissingOptions,
        isMissingAnswer: isMissingAnswer,
        note: notes.join(' ') || 'Đã kiểm tra hoàn thiện.'
      };

      delete q.rawOptions;
      delete q.detectedAnswerIndex;
      questions.push(q);
    };

    for (const node of children) {
      const text = DocxParser._safeString(node.textContent).trim();
      const innerHtml = node.innerHTML || '';

      if (!text && !node.querySelector('img')) continue;

      const isQuestionHeader = questionStartRegex.test(text);

      if (isQuestionHeader) {
        if (currentQuestion) {
          finalizeQuestion(currentQuestion);
        }

        const stemClean = text.replace(questionStartRegex, '').trim();
        const images = this._extractImagesFromNode(node);

        currentQuestion = {
          id: `q_${questions.length + 1}`,
          stem: stemClean,
          rawOptions: [],
          detectedAnswerIndex: -1,
          explanation: '',
          images: images,
          imageUrl: images.length > 0 ? images[0] : null,
          hasImage: images.length > 0
        };
        continue;
      }

      const optionMatch = text.match(optionStartRegex);

      if (optionMatch && currentQuestion) {
        const optionClean = text.replace(optionStartRegex, '').trim();
        const optionImages = this._extractImagesFromNode(node);

        currentQuestion.rawOptions.push(optionClean);

        if (optionImages.length > 0) {
          currentQuestion.images.push(...optionImages);
          if (!currentQuestion.imageUrl) {
            currentQuestion.imageUrl = optionImages[0];
            currentQuestion.hasImage = true;
          }
        }

        // Nhận diện đáp án đúng qua các dấu hiệu trong HTML / Text:
        // 1. Dấu * hoặc [x]
        // 2. Thẻ in đậm <b>/<strong> hoặc gạch chân <u> bọc ký tự lựa chọn
        const isMarkedWithStarOrX = text.startsWith('*') || text.includes('[x]') || text.includes('[X]');
        const isBoldOrUnderlinedOpt = /<(b|strong|u)>\s*\*?\s*[A-E][\.\)]/i.test(innerHtml) || 
                                     /<(b|strong|u)>[A-E]<\/\1>/i.test(innerHtml);

        if (isMarkedWithStarOrX || isBoldOrUnderlinedOpt) {
          currentQuestion.detectedAnswerIndex = currentQuestion.rawOptions.length - 1;
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
      finalizeQuestion(currentQuestion);
    }

    // Xử lý AI chuyển đổi LaTeX nếu có nhu cầu
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
