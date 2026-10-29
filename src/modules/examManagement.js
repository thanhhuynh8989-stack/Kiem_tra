import { appsScriptService } from '../services/appsScriptService.js';
import { loadExamForEditing } from './aiExamParser.js';
import { showAppLoading, hideAppLoading, escapeHtml } from './authAndCore.js';

/**
 * 1. TẢI DANH SÁCH ĐỀ THI TỪ APPS SCRIPT / GOOGLE SHEET
 */
export async function loadExamList() {
  const container = document.getElementById('examListContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  container.innerHTML = `<div style="padding:20px; text-align:center; color:#64748b;">⏳ Đang tải danh sách đề thi...</div>`;

  try {
    const res = await appsScriptService.request('GET_EXAM_LIST', {});
    
    if (!res || !res.exams || res.exams.length === 0) {
      container.innerHTML = `
        <div style="background:#fff; border-radius:8px; padding:30px; text-align:center; border:1px solid #e2e8f0; margin-top:16px;">
          <p style="color:#64748b; margin-bottom:12px;">📭 Chưa có đề thi nào được tạo.</p>
          <button onclick="document.querySelector('[data-tab=\\'tab-parser\\']')?.click()" style="background:#2563eb; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
            ➕ Bóc Tách / Tạo Đề Thi Mới
          </button>
        </div>
      `;
      return;
    }

    renderExamList(res.exams, container);

  } catch (err) {
    container.innerHTML = `<div style="padding:20px; color:#ef4444;">⚠️ Lỗi tải danh sách đề thi: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * 2. RENDER DANH SÁCH THẺ ĐỀ THI
 */
export function renderExamList(exams = [], container) {
  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid #e2e8f0; margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
        <h3 style="margin:0; font-size:18px; color:#0f172a;">📊 Danh Sách Đề Thi Đã Tạo (${exams.length})</h3>
        <button type="button" onclick="loadExamList()" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px;">
          🔄 Tải lại
        </button>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:16px;">
        ${exams.map(exam => renderExamCard(exam)).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * 3. RENDER TỪNG THẺ ĐỀ THI (CÓ NÚT ✏️ SỬA)
 */
export function renderExamCard(exam) {
  return `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:16px; width:280px; box-shadow:0 1px 3px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between;">
      <div>
        <h4 style="margin:0 0 8px 0; color:#0f172a; font-size:15px; font-weight:700;">${escapeHtml(exam.title || 'Chưa có tiêu đề')}</h4>
        <p style="margin:0 0 12px 0; font-size:12px; color:#64748b; line-height:1.5;">
          Mã đề: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:600; color:#2563eb;">${escapeHtml(exam.examId)}</code><br>
          ⏱️ ${exam.durationMinutes || 45} phút | 👤 ${escapeHtml(exam.createdBy || 'Giảng viên')}
        </p>
      </div>

      <div style="display:flex; gap:6px; margin-top:8px;">
        <button type="button" onclick="viewExamScores('${escapeHtml(exam.examId)}')" style="flex:1; background:#2563eb; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          📊 Điểm
        </button>

        <button type="button" onclick="handleEditExam('${escapeHtml(exam.examId)}')" style="background:#f59e0b; color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          ✏️ Sửa
        </button>

        <button type="button" onclick="deleteExam('${escapeHtml(exam.examId)}')" style="background:#ef4444; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          🗑️ Xóa
        </button>
      </div>
    </div>
  `;
}

/**
 * 4. XỬ LÝ KHI BẤM NÚT "✏️ SỬA" ĐỀ THI
 */
export async function handleEditExam(examId) {
  showAppLoading(`⏳ Đang tải nội dung đề thi [${examId}]...`);

  try {
    const res = await appsScriptService.request('GET_EXAM_DETAIL', { examId });
    hideAppLoading();

    if (!res || !res.examData) {
      alert('Không thể tải chi tiết câu hỏi của đề thi này!');
      return;
    }

    // Chuyển sang Tab "Bóc Tách / Tạo Đề Thi"
    const tabBtn = document.querySelector('[data-tab="tab-parser"]') || document.querySelectorAll('nav button')[2];
    if (tabBtn) tabBtn.click();

    // Nạp dữ liệu vào bộ biên tập
    loadExamForEditing(res.examData);

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi khi tải đề thi: ${err.message}`);
  }
}

/**
 * 5. XỬ LÝ XÓA ĐỀ THI
 */
export async function deleteExam(examId) {
  if (!confirm(`Bạn có chắc chắn muốn xóa đề thi [${examId}] không? Thao tác này không thể hoàn tác!`)) {
    return;
  }

  showAppLoading(`⏳ Đang xóa đề thi [${examId}]...`);

  try {
    const res = await appsScriptService.request('DELETE_EXAM', { examId });
    hideAppLoading();

    if (res && res.status === 'success') {
      alert('🗑️ Xóa đề thi thành công!');
      loadExamList(); // Tải lại danh sách
    } else {
      alert(`Không thể xóa đề thi: ${res?.message || 'Lỗi không xác định'}`);
    }

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi khi xóa đề thi: ${err.message}`);
  }
}

// Bắt buộc gán vào window để các sự kiện onclick trên HTML hoạt động mượt mà
window.loadExamList = loadExamList;
window.handleEditExam = handleEditExam;
window.deleteExam = deleteExam;
