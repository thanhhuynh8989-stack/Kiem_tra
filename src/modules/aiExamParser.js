import { parseDocxFile } from '../parsers/docxParser.js';
import { parsePdfFile } from '../parsers/pdfParser.js';
import { aiExamParserService } from '../services/aiExamParserService.js';
import { appsScriptService } from '../services/appsScriptService.js';
import { renderKaTeX } from '../utils/domHelper.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, escapeHtml } from './authAndCore.js';
import { ExamModel } from '../models/examModel.js';

let currentEditingQuestions = [];
let currentFileName = '';
let currentEditingExamId = null; // null = tạo mới, string = đang sửa đề cũ

/**
 * 1. NẠP FILE MẶC ĐỊNH - ƯU TIÊN CODE THUẦN (THỦ CÔNG 100%, KHÔNG TỰ GỌI AI)
 */
export async function handleExamFileUpload(file) {
  if (!file) {
    alert('Vui lòng chọn một file đề thi (DOCX, PDF hoặc Ảnh)!');
    return;
  }

  currentFileName = file.name;
  const fileName = file.name.toLowerCase();
  showAppLoading(`⏳ Đang bóc tách thủ công nội dung file [${file.name}]...`);

  try {
    let rawQuestions = [];

    if (fileName.endsWith('.docx')) {
      rawQuestions = await parseDocxFile(file);
    } else if (fileName.endsWith('.pdf')) {
      rawQuestions = await parsePdfFile(file, true);
    } else {
      throw new Error('Định dạng file không được hỗ trợ. Vui lòng chọn file .docx hoặc .pdf!');
    }

    hideAppLoading();

    // Chuẩn hóa câu hỏi bằng Code thuần local
    currentEditingQuestions = (rawQuestions || []).map((q, idx) => {
      const norm = ExamModel.normalizeQuestion(q, idx);
      norm.flags = {
        needsUserConfirmation: true,
        note: '📄 Đã bóc tách bằng Code thuần. Giảng viên có thể chỉnh sửa thủ công hoặc bấm nút AI để tự động hoàn thiện.'
      };
      return norm;
    });

    renderExamEditorScreen(
      file.name, 
      currentEditingQuestions, 
      '📄 Đã bóc tách thành công bằng Code thuần. Bạn có thể chỉnh sửa thủ công hoặc bấm nút bên dưới để dùng AI phân tích.', 
      true
    );

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi bóc tách file: ${err.message}`);
  }
}

/**
 * 2. GIAO DIỆN BIÊN TẬP ĐỀ THI
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
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" onclick="handleRefineQuestionsWithAI()" style="background:#8b5cf6; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px;">
            🤖 AI Phân Tích & Bổ Sung Đáp Án
          </button>

          <button type="button" onclick="handleSaveAndPublishExamUI()" style="background:#16a34a; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
            💾 Lưu & Xuất Bản Đề Thi
          </button>
        </div>
      </div>

      ${statusMessage ? `
        <div style="background:${isFallback ? '#eff6ff' : '#f0fdf4'}; border:1px solid ${isFallback ? '#bfdbfe' : '#86efac'}; padding:10px 14px; border-radius:6px; font-size:13px; color:${isFallback ? '#1e40af' : '#15803d'}; margin-bottom:16px;">
          ${escapeHtml(statusMessage)}
        </div>
      ` : ''}

      <div id="questionsEditorList">
        ${questions.map((q, idx) => renderQuestionItemEditor(q, idx)).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
  
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
              <input type="text" value="${escapeHtml(optText)}" placeholder="Phương án ${letter}..." onchange="updateQuestionOption(${idx}, ${oIdx}, this.value)" style="width:100%; border:none; outline:none; font-size:13px;">
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/**
 * 3. CHỈ KHI NGƯỜI DÙNG BẤM NÚT NÀY MỚI GỌI API GEMINI
 */
export async function handleRefineQuestionsWithAI() {
  if (!currentEditingQuestions || currentEditingQuestions.length === 0) {
    alert('Không có dữ liệu câu hỏi để AI xử lý!');
    return;
  }

  showAppLoading('🤖 Đang kết nối Gemini AI để phân tích và bổ sung câu hỏi...');

  try {
    const result = await aiExamParserService.parseExamWithAI({
      questions: currentEditingQuestions
    });

    hideAppLoading();

    if (result.success && result.questions) {
      currentEditingQuestions = result.questions;
      renderExamEditorScreen(
        currentFileName || 'Đề thi', 
        currentEditingQuestions, 
        '🎉 Gemini AI đã phân tích, sinh đầy đủ các phương án C, D còn thiếu và đề xuất đáp án đúng!', 
        false
      );
    } else {
      alert(result.message || 'Không thể thực hiện phân tích AI.');
    }

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi AI: ${err.message}`);
  }
}

window.updateQuestionStem = function(index, newText) {
  if (currentEditingQuestions[index]) currentEditingQuestions[index].stem = newText;
};

window.updateQuestionOption = function(qIdx, optIdx, newText) {
  if (currentEditingQuestions[qIdx] && currentEditingQuestions[qIdx].options) {
    currentEditingQuestions[qIdx].options[optIdx] = newText;
  }
};

window.updateQuestionCorrectAnswer = function(qIdx, optIdx) {
  if (currentEditingQuestions[qIdx]) currentEditingQuestions[qIdx].correctAnswer = Number(optIdx);
};

/**
 * Nạp đề thi đã có vào trình biên tập
 */
export function loadExamForEditing(examData) {
  currentEditingExamId = examData.examId || null;
  currentFileName = examData.title || `Đề thi ${examData.examId}`;
  currentEditingQuestions = examData.questions || [];

  renderExamEditorScreen(
    currentFileName,
    currentEditingQuestions,
    `✏️ Đang chỉnh sửa đề thi [Mã: ${currentEditingExamId}]. Bạn có thể chọn "Lưu Đề" để ghi đè hoặc "Lưu Thành Đề Mới".`,
    false
  );
}

/**
 * Render Giao diện Biên Tập Đề Thi
 */
export function renderExamEditorScreen(fileName, questions = [], statusMessage = '', isFallback = false) {
  const container = document.getElementById('examEditorContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid var(--border); margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px;">
        <div>
          <h3 style="margin:0; font-size:18px; color:#0f172a;">🛠️ Biên Tập & Duyệt Đề Thi (${questions.length} câu)</h3>
          <small style="color:var(--text-muted);">Đang biên tập: ${escapeHtml(fileName)}</small>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" onclick="handleRefineQuestionsWithAI()" style="background:#8b5cf6; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
            🤖 AI Phân Tích & Bổ Sung
          </button>

          ${currentEditingExamId ? `
            <!-- LỰA CHỌN KHI ĐANG SỬA ĐỀ CŨ -->
            <button type="button" onclick="handleSaveAndPublishExamUI(false)" style="background:#0284c7; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
              💾 Lưu Đề (Cập nhật)
            </button>
            <button type="button" onclick="handleSaveAndPublishExamUI(true)" style="background:#16a34a; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
              ➕ Lưu Thành Đề Mới
            </button>
          ` : `
            <!-- LỰA CHỌN KHI BÓC TÁCH TỆP MỚI -->
            <button type="button" onclick="handleSaveAndPublishExamUI(true)" style="background:#16a34a; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
              💾 Lưu & Xuất Bản Đề Thi
            </button>
          `}
        </div>
      </div>

      ${statusMessage ? `
        <div style="background:${isFallback ? '#eff6ff' : '#f0fdf4'}; border:1px solid ${isFallback ? '#bfdbfe' : '#86efac'}; padding:10px 14px; border-radius:6px; font-size:13px; color:${isFallback ? '#1e40af' : '#15803d'}; margin-bottom:16px;">
          ${escapeHtml(statusMessage)}
        </div>
      ` : ''}

      <div id="questionsEditorList">
        ${questions.map((q, idx) => renderQuestionItemEditor(q, idx)).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Xử lý Lưu đề thi (isSaveAsNew = true: tạo mã mới | false: giữ mã cũ để ghi đè)
 */
export async function handleSaveAndPublishExamUI(isSaveAsNew = false) {
  if (!currentEditingQuestions || currentEditingQuestions.length === 0) {
    alert('Không có dữ liệu câu hỏi nào để lưu!');
    return;
  }

  const defaultTitle = currentFileName.replace(/\.[^/.]+$/, '') || 'Kiểm tra trắc nghiệm';
  const title = prompt('Nhập Tên / Tiêu đề đề thi:', defaultTitle);
  if (!title) return;

  const durationStr = prompt('Nhập thời gian làm bài (Phút):', '45');
  const duration = parseInt(durationStr) || 45;

  const username = getLoggedInUsername();

  // Xác định ID: Nếu chọn tạo mới hoặc chưa có ID -> Sinh ID ngẫu nhiên mới
  let targetExamId = currentEditingExamId;
  if (isSaveAsNew || !targetExamId) {
    targetExamId = `exam_${Math.random().toString(36).substring(2, 10)}`;
  }

  const publicExamData = {
    examId: targetExamId,
    title: title,
    durationMinutes: duration,
    createdBy: username,
    createdAt: new Date().toISOString(),
    questions: currentEditingQuestions
  };

  showAppLoading(`⏳ Đang ${isSaveAsNew || !currentEditingExamId ? 'tạo đề mới' : 'cập nhật đề'} lên Server...`);

  try {
    const res = await appsScriptService.request('SAVE_AND_PUBLISH_EXAM', {
      examId: targetExamId,
      examCode: `${targetExamId}.json`,
      publicExamData: publicExamData,
      filePath: `exams/${targetExamId}.json`,
      username: username,
      isUpdate: !isSaveAsNew && !!currentEditingExamId
    });

    hideAppLoading();
    alert(`🎉 ${isSaveAsNew || !currentEditingExamId ? 'Tạo đề thi mới thành công!' : 'Cập nhật đề thi thành công!'}\nMã đề: ${targetExamId}`);

    // Cập nhật lại ID đang chỉnh sửa
    currentEditingExamId = targetExamId;

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi lưu đề thi: ${err.message}`);
  }
}

window.handleExamFileUpload = handleExamFileUpload;
window.handleRefineQuestionsWithAI = handleRefineQuestionsWithAI;
window.handleSaveAndPublishExamUI = handleSaveAndPublishExamUI;
window.loadExamForEditing = loadExamForEditing;
