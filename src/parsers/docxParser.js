import { logger } from '../utils/logger.js';
import { ImageCompressor } from '../utils/imageCompressor.js';

export class DocxParser {
  static _safeString(val) {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object') {
      if (typeof val.value === 'string') return val.value;
      if (typeof val.src === 'string') return val.src;
      if (typeof val.text === 'string') return val.text;
    }
    return String(val || '');
  }

  static async parseDocxFile(file) {
    if (!file) throw new Error('Không tìm thấy file DOCX cần bóc tách.');

    const mammothLib = typeof window !== 'undefined' && window.mammoth ? window.mammoth : (typeof mammoth !== 'undefined' ? mammoth : null);
    if (!mammothLib) throw new Error('Thư viện Mammoth.js chưa được nạp vào trang.');

    const arrayBuffer = await file.arrayBuffer();

    const options = {
      convertImage: mammothLib.images.imgElement((image) => {
        return image.read("base64").then(async (imageBuffer) => {
          const mimeType = image.contentType || "image/png";
          const rawBase64 = `data:${mimeType};base64,${imageBuffer}`;
          let compressed = rawBase64;
          try {
            if (ImageCompressor && typeof ImageCompressor.compressBase64Image === 'function') {
              compressed = await ImageCompressor.compressBase64Image(DocxParser._safeString(rawBase64));
            }
          } catch (e) {}
          return { src: DocxParser._safeString(compressed) };
        });
      })
    };

    const result = await mammothLib.convertToHtml({ arrayBuffer }, options);
    const htmlContent = DocxParser._safeString(result?.value);

    if (!htmlContent.trim()) return [];

    return await this.parseHTMLToQuestions(htmlContent);
  }

  static async parseHTMLToQuestions(htmlContent) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    const children = Array.from(tempDiv.children);
    const questions = [];
    let currentQuestion = null;

    const questionStartRegex = /^(?:Câu\s+\d+|Question\s+\d+|Bài\s+\d+|\d+[\.\)])[\s:.]*/i;
    const optionStartRegex = /^\s*\*?\s*([A-E])[\.\)]\s*/i;
    const ansInTextRegex = /(?:Đáp\s*án|ĐA|Đáp\s*án\s*đúng)\s*[:=]?\s*([A-E])/i;

    const finalizeQuestion = (q) => {
      if (!q) return;

      let foundAnsIdx = q.detectedAnswerIndex;
      if (foundAnsIdx === null || foundAnsIdx === undefined || foundAnsIdx === -1) {
        const textToSearch = `${q.stem} ${q.explanation}`;
        const stemAnsMatch = textToSearch.match(ansInTextRegex);
        if (stemAnsMatch) {
          foundAnsIdx = stemAnsMatch[1].toUpperCase().charCodeAt(0) - 65;
        }
      }

      const rawOptions = q.rawOptions || [];
      const originalOptionCount = rawOptions.length;

      let finalOptions = [...rawOptions];
      let finalCorrectAnswer = (foundAnsIdx !== null && foundAnsIdx !== undefined && foundAnsIdx >= 0) ? foundAnsIdx : 0;
      let isMissingAnswer = (foundAnsIdx === null || foundAnsIdx === undefined || foundAnsIdx === -1);

      // Chuẩn hóa 5 phương án về 4 phương án
      if (originalOptionCount === 5) {
        if (foundAnsIdx === 4) { 
          finalOptions = [rawOptions[0], rawOptions[1], rawOptions[2], rawOptions[4]];
          finalCorrectAnswer = 3;
        } else {
          finalOptions = rawOptions.slice(0, 4);
          if (finalCorrectAnswer > 3) finalCorrectAnswer = 0;
        }
      }

      // ĐỂ TRỐNG Ô PHƯƠNG ÁN NẾU ĐỀ GỐC THIẾU (Dành cho Giảng viên tự điền)
      while (finalOptions.length < 4) {
        finalOptions.push('');
      }

      const isMissingOptions = originalOptionCount < 4;

      let notes = [];
      if (isMissingOptions) {
        notes.push(`Đề gốc chỉ có ${originalOptionCount}/4 phương án. Ô phương án thiếu đã được để trống.`);
      }
      if (isMissingAnswer) {
        notes.push(`Chưa nhận diện được đáp án đúng từ đề gốc (Đang tạm chọn A).`);
      }

      q.options = finalOptions.slice(0, 4);
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

      if (questionStartRegex.test(text)) {
        if (currentQuestion) finalizeQuestion(currentQuestion);

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

        if (optionImages.length > 0 && !currentQuestion.imageUrl) {
          currentQuestion.imageUrl = optionImages[0];
          currentQuestion.hasImage = true;
        }

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
      }
    }

    if (currentQuestion) finalizeQuestion(currentQuestion);
    return questions;
  }

  static _extractImagesFromNode(node) {
    const imgs = node.querySelectorAll('img');
    const imageList = [];
    imgs.forEach((img) => {
      let src = DocxParser._safeString(img.getAttribute('src') || img.src);
      if (src && src.startsWith('data:image')) imageList.push(src);
    });
    return imageList;
  }
}

export const parseDocxFile = DocxParser.parseDocxFile.bind(DocxParser);
