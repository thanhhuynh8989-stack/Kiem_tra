import { parseDocxFile } from '../parsers/docxParser.js';
import { parsePdfFile } from '../parsers/pdfParser.js';
import { aiExamParserService } from '../services/aiExamParserService.js';
import { appsScriptService } from '../services/appsScriptService.js';
import { renderKaTeX, sanitizeHTML } from '../utils/domHelper.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, escapeHtml } from './authAndCore.js';
import { APP_CONFIG } from '../constants/appConfig.js';

// Mảng lưu trữ trạng thái danh sách câu hỏi đang biên tập
let currentEditingQuestions = [];

/**
 * 1. XỬ LÝ KHI GIẢNG VIÊN TẢI FILE ĐỀ THI LÊN (WORD, PDF, ẢNH)
 */
export async function handleExamFileUpload(file) {
  if (!file) {
    alert('Vui lòng chọn một file đề thi (DOCX, PDF hoặc Ảnh)!');
    return;
  }

  const fileName = file.name.toLowerCase();
  showAppLoading(`⏳ Đang đọc nội dung file [${file.name}]...`);

  try {
    let rawQuestions = [];
    let imageBase64 = null;
    let mimeType = file.type || 'image/png';

    // A. BÓC TÁCH THEO ĐỊNH DẠNG FILE
    if (fileName.endsWith('.docx')) {
      rawQuestions = await parseDocxFile(file);
    } else if (fileName.endsWith('.pdf')) {
      rawQuestions = await parsePdfFile(file, true);
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      imageBase64 = await new Promise((resolve) => {
        reader.onload = (e) => resolve(e.target.result.split(',')[1]);
        reader.readAsDataURL(file);
      });
    } else {
      throw new Error('Định dạng file không được hỗ trợ. Vui lòng chọn file .docx, .pdf hoặc hình ảnh!');
    }

    showAppLoading('🤖 Đang gửi sang Gemini AI để chuẩn hóa & hiển thị công thức...');

    // B. GỬI SANG AI SERVICE ĐỂ CHUẨN HÓA (CÓ FALLBACK VỀ CODE THUẦN)
    const result = await aiExamParserService.parseExamWithAI({
      rawText: '',
      imageBase64: imageBase64,
      mimeType: mimeType,
      questions: rawQuestions
    });

    hideAppLoading();

    currentEditingQuestions = result.questions || [];
    renderExamEditorScreen(file.name, currentEditingQuestions, result.message, result.isFallback);

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi xử lý file: ${err.message}`);
  }
}

/**
 * 2. GIAO DIỆN BIÊN TẬP & DUYỆT ĐỀ THI TRƯỚC KHI XUẤT BẢN
 */
export function renderExamEditorScreen(fileName, questions = [], statusMessage = '', isFallback = false) {
  const container = document.getElementById('examEditorContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid var(--border); margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px;">
        <div>
          <h3 style="margin:0; font-size:18px; color:#0f172a;">🛠️ Biên Tập & Duyệt Đề Thi (${questions.length} câu)</h3>
          <small style="color:var(--text-muted);">Tệp gốc: ${escapeHtml(fileName)}</small>
        </div>
        <div style="display:flex; gap:10px;">
          <button type="button" onclick="handleSaveAndPublishExamUI()" style="background:#16a34a; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
            💾 Lưu & Xuất Bản Đề Thi
          </button>
        </div>
      </div>

      ${statusMessage ? `
        <div style="background:${isFallback ? '#fffbeb' : '#f0fdf4'}; border:1px solid ${isFallback ? '#fcd34d' : '#86efac'}; padding:10px 14px; border-radius:6px; font-size:13px; color:${isFallback ? '#b45309' : '#15803d'}; margin-bottom:16px;">
          ${escapeHtml(statusMessage)}
        </div>
      ` : ''}

      <div id="questionsEditorList">
        ${questions.map((q, idx) => renderQuestionItemEditor(q, idx)).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
  
  // Render lại công thức toán KaTeX cho toàn bộ vùng biên tập
  setTimeout(() => {
    renderKaTeX(container);
  }, 100);
}

function renderQuestionItemEditor(q, idx) {
  const needsWarning = q.flags && q.flags.needsUserConfirmation;
  
  return `
    <div id="q_box_${idx}" style="background:#f8fafc; border:1px solid ${needsWarning ? '#f59e0b' : '#cbd5e1'}; border-radius:8px; padding:14px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <strong style="color:#0f172a; font-size:14px;">Câu hỏi ${idx + 1}:</strong>
        ${needsWarning ? `<span style="font-size:11px; background:#fef3c7; color:#d97706; padding:2px 8px; border-radius:4px; font-weight:600;">⚠️ ${escapeHtml(q.flags.note || 'Cần kiểm tra')}</span>` : ''}
      </div>

      <textarea onchange="updateQuestionStem(${idx}, this.value)" style="width:100%; min-height:60px; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-family:inherit; font-size:13px; margin-bottom:10px;">${escapeHtml(q.stem)}</textarea>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
        ${(q.options || []).map((optText, oIdx) => {
          const letter = String.fromCharCode(65 + oIdx);
          const isCorrect = q.correctAnswer === oIdx;

          return `
            <div style="display:flex; align-items:center; gap:8px; background:#fff; padding:6px 10px; border-radius:6px; border:1px solid ${isCorrect ? '#22c55e' : '#e2e8f0'};">
              <input type="radio" name="correct_ans_${idx}" value="${oIdx}" ${isCorrect ? 'checked' : ''} onchange="updateQuestionCorrectAnswer(${idx}, ${oIdx})">
              <strong style="color:${isCorrect ? '#16a34a' : '#475569'};">${letter}.</strong>
              <input type="text" value="${escapeHtml(optText)}" onchange="updateQuestionOption(${idx}, ${oIdx}, this.value)" style="width:100%; border:none; outline:none; font-size:13px;">
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// =========================================================================
// 3. TIỆN ÍCH CẬP NHẬT DỮ LIỆU BIÊN TẬP TỰ ĐỘNG
// =========================================================================
window.updateQuestionStem = function(index, newText) {
  if (currentEditingQuestions[index]) {
    currentEditingQuestions[index].stem = newText;
  }
};

window.updateQuestionOption = function(qIdx, optIdx, newText) {
  if (currentEditingQuestions[qIdx] && currentEditingQuestions[qIdx].options) {
    currentEditingQuestions[qIdx].options[optIdx] = newText;
  }
};

window.updateQuestionCorrectAnswer = function(qIdx, optIdx) {
  if (currentEditingQuestions[qIdx]) {
    currentEditingQuestions[qIdx].correctAnswer = Number(optIdx);
  }
};

// =========================================================================
// 4. LƯU & XUẤT BẢN ĐỀ THI LÊN APPS SCRIPT VÀ GITHUB CDN
// =========================================================================
export async function handleSaveAndPublishExamUI() {
  if (!currentEditingQuestions || currentEditingQuestions.length === 0) {
    alert('Không có dữ liệu câu hỏi nào để lưu!');
    return;
  }

  const title = prompt('Nhập Tên / Tiêu đề cho đề thi này:', 'Kiểm tra trắc nghiệm');
  if (!title) return;

  const durationStr = prompt('Nhập thời gian làm bài (Phút):', '45');
  const duration = parseInt(durationStr) || 45;

  const username = getLoggedInUsername();
  const shortId = `exam_${Math.random().toString(36).substring(2, 10)}`;

  const publicExamData = {
    examId: shortId,
    title: title,
    durationMinutes: duration,
    createdBy: username,
    createdAt: new Date().toISOString(),
    questions: currentEditingQuestions
  };

  showAppLoading('⏳ Đang xuất bản đề thi lên GitHub CDN & Google Sheets...');

  try {
    const res = await appsScriptService.request('SAVE_AND_PUBLISH_EXAM', {
      examId: shortId,
      examCode: `${shortId}.json`,
      publicExamData: publicExamData,
      filePath: `exams/${shortId}.json`,
      username: username
    });

    hideAppLoading();
    alert(`🎉 Xuất bản thành công!\n${res.message || 'Đề thi đã sẵn sàng giao cho sinh viên.'}`);

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi xuất bản đề thi: ${err.message}`);
  }
}

window.handleExamFileUpload = handleExamFileUpload;
window.handleSaveAndPublishExamUI = handleSaveAndPublishExamUI;
