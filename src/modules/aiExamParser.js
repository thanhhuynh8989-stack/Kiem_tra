import { parseDocxFile } from '../parsers/docxParser.js';
import { parsePdfFile } from '../parsers/pdfParser.js';
import { aiExamParserService } from '../services/aiExamParserService.js';
import { appsScriptService } from '../services/appsScriptService.js';
import { renderKaTeX } from '../utils/domHelper.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, escapeHtml } from './authAndCore.js';
import { ExamModel } from '../models/examModel.js';

// Các biến lưu trạng thái biên tập
let currentEditingQuestions = [];
let currentFileName = '';
let currentEditingExamId = null; // null = Tạo đề mới, string = Đang chỉnh sửa đề cũ

/**
 * 1. NẠP FILE TẠO ĐỀ MỚI - THỦ CÔNG 100% (KHÔNG TỰ GỌI AI)
 */
export async function handleExamFileUpload(file) {
  if (!file) {
    alert('Vui lòng chọn một file đề thi (DOCX hoặc PDF)!');
    return;
  }

  currentEditingExamId = null; // Đặt lại về null vì đây là tải file mới
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
        note: '📄 Bóc tách thủ công bằng Code thuần. Hãy chỉnh sửa hoặc bấm nút bên dưới để nhờ AI phân tích.'
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
 * 2. NẠP ĐỀ THI ĐÃ TỒN TẠI ĐỂ CHỈNH SỬA
 */
export function loadExamForEditing(examData) {
  currentEditingExamId = examData.examId || null;
  currentFileName = examData.title || `Đề thi ${examData.examId}`;
  currentEditingQuestions = (examData.questions || []).map((q, idx) => ExamModel.normalizeQuestion(q, idx));

  renderExamEditorScreen(
    currentFileName,
    currentEditingQuestions,
    `✏️ Đang chỉnh sửa đề thi [Mã đề: ${currentEditingExamId}]. Bạn có thể chọn "Lưu Đề" để cập nhật hoặc "Lưu Thành Đề Mới".`,
    false
  );
}

/**
 * 3. GIAO DIỆN BIÊN TẬP VÀ DUYỆT ĐỀ THI
 */
export function renderExamEditorScreen(fileName, questions = [], statusMessage = '', isFallback = false) {
  const container = document.getElementById('examEditorContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid var(--border); margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px;">
        <div>
          <h3 style="margin:0; font-size:18px; color:#0f172a;">🛠️ Biên Tập & Duyệt Đề Thi (${questions.length} câu)</h3>
          <small style="color:var(--text-muted);">Đang biên tập: <strong>${escapeHtml(fileName)}</strong> ${currentEditingExamId ? `<code style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px;">[Mã: ${escapeHtml(currentEditingExamId)}]</code>` : '<span style="color:#16a34a;">(Đề mới)</span>'}</small>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" onclick="handleRefineQuestionsWithAI()" style="background:#8b5cf6; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
            🤖 AI Phân Tích & Bổ Sung
          </button>

          ${currentEditingExamId ? `
            <!-- LỰA CHỌN KHI ĐANG SỬA ĐỀ CỦ -->
            <button type="button" onclick="handleSaveAndPublishExamUI(false)" style="background:#0284c7; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
              💾 Lưu Đề (Cập nhật)
            </button>
            <button type="button" onclick="handleSaveAndPublishExamUI(true)" style="background:#16a34a; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
              ➕ Lưu Thành Đề Mới
            </button>
          ` : `
            <!-- LỰA CHỌN KHI NẠP TỆP MỚI -->
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
  
  setTimeout(() => {
    renderKaTeX(container);
  }, 100);
}

/**
 * 4. RENDER CHI TIẾT TỪNG CÂU HỎI TRONG BỘ BIÊN TẬP
 */
function renderQuestionItemEditor(q, idx) {
  const needsWarning = q.flags && q.flags.needsUserConfirmation;
  
  return `
    <div id="q_box_${idx}" style="background:#f8fafc; border:1px solid ${needsWarning ? '#f59e0b' : '#cbd5e1'}; border-radius:8px; padding:14px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <strong style="color:#0f172a; font-size:14px;">Câu hỏi ${idx + 1}:</strong>
        ${needsWarning ? `<span style="font-size:11px; background:#fef3c7; color:#d97706; padding:2px 8px; border-radius:4px; font-weight:600;">⚠️ ${escapeHtml(q.flags.note || 'Cần rà soát')}</span>` : ''}
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
 * 5. KÍCH HOẠT GEMINI AI PHÂN TÍCH & BỔ SUNG
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
        result.message || '🎉 AI đã phân tích hoàn tất! Đã gắn cờ cảnh báo đối với các câu hỏi được AI chỉnh sửa.', 
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

/**
 * 6. XỬ LÝ LƯU & XUẤT BẢN ĐỀ THI (Phân biệt Lưu Cập nhật vs Lưu Đề Mới)
 */
export async function handleSaveAndPublishExamUI(isSaveAsNew = false) {
  if (!currentEditingQuestions || currentEditingQuestions.length === 0) {
    alert('Không có dữ liệu câu hỏi nào để lưu!');
    return;
  }

  let targetExamId = currentEditingExamId;
  let defaultTitle = (currentFileName || 'Kiểm tra trắc nghiệm').replace(/\.[^/.]+$/, '');

  // Nếu chọn Lưu Thành Đề Mới hoặc chưa có ID -> Ép buộc sinh Mã ID mới và gợi ý tên bản sao
  if (isSaveAsNew || !targetExamId) {
    targetExamId = `exam_${Math.random().toString(36).substring(2, 10)}`;
    if (currentEditingExamId) {
      defaultTitle = `${defaultTitle} (Bản sao)`;
    }
  }

  const promptTitle = isSaveAsNew 
    ? '➕ [LƯU THÀNH ĐỀ MỚI] Nhập Tên / Tiêu đề cho đề thi mới:' 
    : `💾 [CẬP NHẬT ĐỀ THI ${targetExamId}] Nhập Tên / Tiêu đề đề thi:`;

  const title = prompt(promptTitle, defaultTitle);
  if (!title) return;

  const durationStr = prompt('Nhập thời gian làm bài (Phút):', '45');
  const duration = parseInt(durationStr) || 45;
  const username = getLoggedInUsername();

  const publicExamData = {
    examId: targetExamId,
    title: title,
    durationMinutes: duration,
    createdBy: username,
    createdAt: new Date().toISOString(),
    questions: currentEditingQuestions
  };

  showAppLoading(`⏳ Đang ${isSaveAsNew ? 'xuất bản đề thi mới' : 'cập nhật đề [' + targetExamId + ']'} lên Server...`);

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
    alert(`🎉 ${isSaveAsNew ? 'Tạo đề thi mới' : 'Cập nhật đề thi'} thành công!\nMã đề: ${targetExamId}`);

    // Cập nhật lại ID và tên file hiện tại
    currentEditingExamId = targetExamId;
    currentFileName = title;

    // Render lại giao diện thanh công cụ để cập nhật mã đề mới
    renderExamEditorScreen(
      currentFileName,
      currentEditingQuestions,
      `✅ Đã xuất bản thành công [Mã đề: ${targetExamId}].`,
      false
    );

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi lưu đề thi: ${err.message}`);
  }
}

/**
 * 7. RENDER MÀN HÌNH TẢI FILE MẶC ĐỊNH
 */
export function renderDefaultUploadScreen() {
  const container = document.getElementById('mainContentArea');
  if (!container) return;

  container.innerHTML = `
    <div style="background:#fff; border-radius:10px; padding:24px; border:1px solid #e2e8f0; margin-top:16px; text-align:center;">
      <h3 style="margin:0 0 8px 0; color:#0f172a; font-size:18px;">📄 Bóc Tách / Tạo Đề Thi Mới</h3>
      <p style="margin:0 0 20px 0; font-size:13px; color:#64748b;">Tải lên tệp đề thi dạng <strong>DOCX</strong> hoặc <strong>PDF</strong> để hệ thống bóc tách tự động.</p>
      
      <div style="background:#f8fafc; border:2px dashed #cbd5e1; border-radius:8px; padding:30px; max-width:500px; margin:0 auto;">
        <input type="file" id="examFileInput" accept=".docx, .pdf" style="display:none;" onchange="handleExamFileUpload(this.files[0])">
        <button type="button" onclick="document.getElementById('examFileInput').click()" style="background:#2563eb; color:#fff; border:none; padding:10px 20px; border-radius:6px; font-weight:600; font-size:14px; cursor:pointer;">
          📁 Chọn File Đề Thi (.docx, .pdf)
        </button>
      </div>

      <div id="examEditorContainer" style="margin-top:20px;"></div>
    </div>
  `;
}

// Bắt sự kiện thay đổi dữ liệu câu hỏi từ ô Input DOM
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

// Gắn hàm vào global window để gọi inline từ button HTML
window.renderDefaultUploadScreen = renderDefaultUploadScreen;
window.handleExamFileUpload = handleExamFileUpload;
window.loadExamForEditing = loadExamForEditing;
window.handleRefineQuestionsWithAI = handleRefineQuestionsWithAI;
window.handleSaveAndPublishExamUI = handleSaveAndPublishExamUI;
