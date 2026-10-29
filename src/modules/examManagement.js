import { appsScriptService } from '../services/appsScriptService.js';
import { loadExamForEditing } from './aiExamParser.js';
import { showAppLoading, hideAppLoading, escapeHtml } from './authAndCore.js';

/**
 * Render thẻ đề thi trong danh sách (Bổ sung nút ✏️ Sửa)
 */
export function renderExamCard(exam) {
  return `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:16px; width:300px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <h4 style="margin:0 0 8px 0; color:#0f172a; font-size:16px;">${escapeHtml(exam.title || 'Chưa có tiêu đề')}</h4>
      <p style="margin:0 0 12px 0; font-size:12px; color:#64748b;">
        Mã đề: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px;">${escapeHtml(exam.examId)}</code><br>
        ⏱️ ${exam.durationMinutes || 45} phút | 👤 ${escapeHtml(exam.createdBy || '')}
      </p>

      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button type="button" onclick="viewExamScores('${escapeHtml(exam.examId)}')" style="flex:1; background:#2563eb; color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          📊 Xem điểm
        </button>

        <!-- NÚT ✏️ SỬA ĐỀ THI -->
        <button type="button" onclick="handleEditExam('${escapeHtml(exam.examId)}')" style="background:#f59e0b; color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          ✏️ Sửa
        </button>

        <button type="button" onclick="deleteExam('${escapeHtml(exam.examId)}')" style="background:#ef4444; color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          🗑️ Xóa
        </button>
      </div>
    </div>
  `;
}

/**
 * Xử lý khi nhấn nút "Sửa" đề thi
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

window.handleEditExam = handleEditExam;
