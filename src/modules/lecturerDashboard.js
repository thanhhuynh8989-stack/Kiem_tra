import { appsScriptService } from '../services/appsScriptService.js';
import { handleEditExam, deleteExam } from './examManagement.js';
import { showAppLoading, hideAppLoading, escapeHtml } from './authAndCore.js';

/**
 * 1. TẢI VÀ RENDER DASHBOARD GIẢNG VIÊN
 */
export async function handleLoadLecturerDashboard() {
  const mainContentArea = document.getElementById('mainContentArea');
  if (!mainContentArea) return;

  showAppLoading('⏳ Đang tải danh sách đề thi...');

  try {
    const res = await appsScriptService.request('GET_EXAM_LIST', {});
    hideAppLoading();

    const exams = (res && res.exams) ? res.exams : [];
    renderLecturerDashboard(exams, mainContentArea);

  } catch (err) {
    hideAppLoading();
    mainContentArea.innerHTML = `<div style="padding:20px; color:#ef4444;">⚠️ Lỗi tải danh sách đề thi: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * 2. RENDER KHUNG DANH SÁCH ĐỀ THI
 */
export function renderLecturerDashboard(exams = [], container) {
  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid #e2e8f0; margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
        <h3 style="margin:0; font-size:18px; color:#0f172a;">📊 Danh Sách Đề Thi Đã Tạo (${exams.length})</h3>
        <button type="button" onclick="handleLoadLecturerDashboard()" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px;">
          🔄 Tải lại
        </button>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:16px;">
        ${exams.length === 0 
          ? '<p style="color:#64748b;">Chưa có đề thi nào được tạo.</p>' 
          : exams.map(exam => renderExamCardItem(exam)).join('')
        }
      </div>
    </div>
    <div id="examScoresContainer" style="margin-top:20px;"></div>
  `;

  container.innerHTML = html;
}

/**
 * 3. RENDER TỪNG THẺ ĐỀ THI (BỔ SUNG NÚT ✏️ SỬA)
 */
function renderExamCardItem(exam) {
  const examId = escapeHtml(exam.examId || '');
  const title = escapeHtml(exam.title || 'Chưa có tiêu đề');
  const duration = exam.durationMinutes || 45;
  const createdBy = escapeHtml(exam.createdBy || '');

  return `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:16px; width:280px; box-shadow:0 1px 3px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between;">
      <div>
        <h4 style="margin:0 0 8px 0; color:#0f172a; font-size:15px; font-weight:700;">${title}</h4>
        <p style="margin:0 0 12px 0; font-size:12px; color:#64748b; line-height:1.5;">
          Mã đề: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:600; color:#2563eb;">${examId}</code><br>
          ⏱️ ${duration} phút | 👤 ${createdBy}
        </p>
      </div>

      <div style="display:flex; gap:6px; margin-top:8px;">
        <button type="button" onclick="viewExamScores('${examId}')" style="flex:1; background:#2563eb; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          📊 Xem điểm
        </button>

        <!-- NÚT ✏️ SỬA ĐỀ THI ĐÃ BỔ SUNG -->
        <button type="button" onclick="handleEditExam('${examId}')" style="background:#f59e0b; color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          ✏️ Sửa
        </button>

        <button type="button" onclick="deleteExam('${examId}')" style="background:#ef4444; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          🗑️ Xóa
        </button>
      </div>
    </div>
  `;
}

window.handleLoadLecturerDashboard = handleLoadLecturerDashboard;
