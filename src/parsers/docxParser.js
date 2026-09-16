import { REGEX_PATTERNS } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';
import { ImageCompressor } from '../utils/imageCompressor.js';
import { geminiService } from '../services/geminiService.js';

/

Service handling DOCX parsing using Mammoth.js and AI formatting.
/
export class DocxParser {
/*

Reads a DOCX file, extracts HTML, embedded images, and parses into raw question structures.

@param {File} file - DOCX file from file input

@param {boolean} enableAIKaTeX - Automatically convert formulas to KaTeX via Gemini

@returns {Promise<Array>} Parsed raw questions array
*/
static async parseDocxFile(file, enableAIKaTeX = true) {
if (!file) throw new Error('Không tìm thấy file DOCX cần bóc tách.');

logger.info(Bắt đầu xử lý file DOCX: ${file.name} (${Math.round(file.size / 1024)} KB));

const arrayBuffer = await file.arrayBuffer();
const imagesExtracted = [];

// Mammoth.js configuration for image handling and HTML transformation
const options = {
convertImage: mammoth.images.imgElement((image) => {
return image.read("base64").then(async (imageBuffer) => {
const mimeType = image.contentType || "image/png";
const rawBase64 = data:${mimeType};base64,${imageBuffer};

   // Compress embedded images immediately
   const compressed = await ImageCompressor.compressBase64Image(rawBase64);
   imagesExtracted.push(compressed);
   const imageIndex = imagesExtracted.length - 1;

   return {
     src: compressed,
     'data-img-index': imageIndex
   };
 });


})
};

if (typeof mammoth === 'undefined') {
throw new Error('Thư viện Mammoth.js chưa được nạp vào trang.');
}

const result = await mammoth.convertToHtml({ arrayBuffer }, options);
const htmlContent = result.value;

logger.debug('Nội dung HTML thô từ DOCX đã được chuyển đổi.');

const parsedQuestions = await this.parseHTMLToQuestions(htmlContent, enableAIKaTeX);
logger.info(Bóc tách DOCX thành công: Tìm thấy ${parsedQuestions.length} câu hỏi.);

return parsedQuestions;
}

/

Converts raw DOCX HTML string to an array of standardized question objects.

@param {string} htmlContent - HTML string from Mammoth

@param {boolean} enableAIKaTeX - Enable KaTeX processing via AI

@returns {Promise<Array>}
*/
static async parseHTMLToQuestions(htmlContent, enableAIKaTeX = true) {
const tempDiv = document.createElement('div');
tempDiv.innerHTML = htmlContent;

const children = Array.from(tempDiv.children);
const questions = [];
let currentQuestion = null;

for (const node of children) {
  const text = node.textContent.trim();

  if (!text && !node.querySelector('img')) continue;

  // Check if current line marks the start of a new question
  const isQuestionHeader = REGEX_PATTERNS.QUESTION_START.test(text);

  if (isQuestionHeader) {
    if (currentQuestion) {
      questions.push(currentQuestion);
    }

    const stemClean = text.replace(REGEX_PATTERNS.QUESTION_START, '').trim();
    const images = this._extractImagesFromNode(node);

    currentQuestion = {
      stem: stemClean,
      options: [],
      correctAnswer: null,
      explanation: '',
      images: images
    };
    continue;
  }

  // Check if line represents an option choice (e.g. "A. ", "B) ")
  const isOption = REGEX_PATTERNS.OPTION_START.test(text);

  if (isOption && currentQuestion) {
    const optionClean = text.replace(REGEX_PATTERNS.OPTION_START, '').trim();
    const optionImages = this._extractImagesFromNode(node);
    
    currentQuestion.options.push(optionClean);
    if (optionImages.length > 0) {
      currentQuestion.images.push(...optionImages);
    }

    // Check if option is explicitly marked correct (e.g., contains asterisk or [X])
    if (text.includes('*') || text.toLowerCase().includes('[x]')) {
      currentQuestion.correctAnswer = currentQuestion.options.length - 1;
    }
    continue;
  }

  // Check for answer keys or explanation markers
  if (currentQuestion) {
    const ansMatch = text.match(REGEX_PATTERNS.ANSWER_KEY);
    if (ansMatch) {
      const letter = ansMatch[1].toUpperCase();
      currentQuestion.correctAnswer = letter.charCodeAt(0) - 65; // 'A' -> 0, 'B' -> 1
    } else if (text.toLowerCase().startsWith('lời giải:') || text.toLowerCase().startsWith('mô tả:')) {
      currentQuestion.explanation = text.replace(/^(lời giải|mô tả)\s*:\s*/i, '').trim();
    } else {
      currentQuestion.stem += `\n${text}`;
    }
  }
}

if (currentQuestion) {
  questions.push(currentQuestion);
}

// Convert math equations to KaTeX using Gemini AI if enabled
if (enableAIKaTeX) {
  for (const q of questions) {
    if (q.stem.includes('$') || q.stem.includes('\\')) {
      q.stem = await geminiService.convertToLaTeX(q.stem);
    }
  }
}

return questions;


}

/

Helper extracting Base64 image sources from a DOM element.
*/
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
