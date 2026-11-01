import { appsScriptService } from '../services/appsScriptService.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, escapeHtml } from './authAndCore.js';

// =========================================================================
// I. TẦNG GIAO DIỆN (UI RENDERING LAYER)
// =========================================================================

/**
 * Render Khung Bảng Điểm Bài Thi
 */
export function renderSubmissionsUI(examId, submissions = [], container) {
  const targetContainer = container || document.getElementById('submissionsContainer') || document.getElementById('mainContentArea');
  if (!targetContainer) return;

  window.currentSubmissionsData = submissions;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid #e2e8f0; margin-top:16px;">
      
      <!-- HEADING & BUTTON XUẤT CSV -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="margin:0; font-size:18px; color:#0f172a;">📊 Bảng Điểm Chi Tiết: <span style="color:#2563eb;">${escapeHtml(examId)}</span></h3>
          <small style="color:#64748b;">Tổng số bài nộp: <strong>${submissions.length}</strong></small>
        </div>

        <div style="display:flex; gap:8px;">
          <button type="button" onclick="exportSubmissionsToCSV('${escapeHtml(examId)}', window.currentSubmissionsData)" style="background:#16a34a; color:#fff; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600; font-size:13px;">
            📥 Xuất Bảng Điểm (.csv)
          </button>
        </div>
      </div>

      <!-- BẢNG ĐIỀU KHIỂN ĐẦY ĐỦ CÁC CỘT -->
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
          <thead>
            <tr style="background:#f1f5f9; color:#334155; border-bottom:2px solid #cbd5e1;">
              <th style="padding:10px;">Mã SV</th>
              <th style="padding:10px;">Họ và Tên</th>
              <th style="padding:10px;">Lớp</th>
              <th style="padding:10px; text-align:center;">Số câu đúng</th>
              <th style="padding:10px; text-align:center;">Điểm số</th>
              <th style="padding:10px; text-align:center;">Số vi phạm</th>
              <th style="padding:10px; text-align:center;">Tự động nộp</th>
              <th style="padding:10px;">Ghi chú</th>
              <th style="padding:10px;">Thời gian nộp</th>
              <th style="padding:10px; text-align:center;">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${submissions.length === 0 
              ? `<tr><td colspan="10" style="text-align:center; padding:30px; color:#94a3b8;">📭 Chưa có sinh viên nào nộp bài thi này.</td></tr>`
              : submissions.map(sub => renderSubmissionRow(examId, sub)).join('')
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  targetContainer.innerHTML = html;
}

/**
 * Render từng dòng thông tin bài nộp
 */
function renderSubmissionRow(examId, sub) {
  const isViolated = Number(sub.violationCount) > 0;
  const isAutoSubmitted = String(sub.autoSubmitted).toLowerCase() === 'có' || Number(sub.violationCount) >= 3;
  const studentCode = sub.studentId || sub.studentCode || '';
  const studentName = sub.fullName || sub.studentName || '';

  return `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:10px; font-weight:600; color:#2563eb;">${escapeHtml(studentCode)}</td>
      <td style="padding:10px; font-weight:600; color:#0f172a;">${escapeHtml(studentName)}</td>
      <td style="padding:10px; color:#475569;">${escapeHtml(sub.className || 'N/A')}</td>
      <td style="padding:10px; text-align:center;">${sub.correctCount}/${sub.totalQuestions || '--'}</td>
      <td style="padding:10px; text-align:center; font-weight:700; color:#16a34a; font-size:14px;">${sub.score}</td>
      <td style="padding:10px; text-align:center; font-weight:700; color:${isViolated ? '#dc2626' : '#64748b'};">
        ${sub.violationCount || 0} lần
      </td>
      <td style="padding:10px; text-align:center;">
        <span style="padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; background:${isAutoSubmitted ? '#fee2e2' : '#dcfce7'}; color:${isAutoSubmitted ? '#dc2626' : '#15803d'};">
          ${isAutoSubmitted ? '⚠️ Tự động' : 'Tự nộp'}
        </span>
      </td>
      <td style="padding:10px; font-size:12px; color:#64748b;">${escapeHtml(sub.submitNote || 'Nộp bài thi')}</td>
      <td style="padding:10px; font-size:12px; color:#64748b;">${escapeHtml(sub.submittedAt || '--')}</td>
      <td style="padding:10px; text-align:center;">
        <div style="display:flex; gap:6px; justify-content:center;">
          <button type="button" onclick="handleReviewSubmittedExam('${escapeHtml(examId)}', '${escapeHtml(studentCode)}')" style="background:#2563eb; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">
            👁️ Xem bài
          </button>
          <button type="button" onclick="handleResetStudentSubmission('${escapeHtml(examId)}', '${escapeHtml(studentCode)}', '${escapeHtml(studentName)}')" style="background:#d97706; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;">
            🔄 Cho làm lại
          </button>
        </div>
      </td>
    </tr>
  `;
}

// =========================================================================
// II. TẦNG XỬ LÝ THỰC THI (EXECUTION LOGIC LAYER)
// =========================================================================

/**
 * 1. Tải danh sách bài nộp và gọi render UI
 */
export async function handleViewExamSubmissions(examId) {
  if (!examId) return;

  const currentLecturer = getLoggedInUsername();
  showAppLoading(`⏳ Đang tải bảng điểm bài thi [${examId}]...`);

  try {
    const res = await appsScriptService.request('GET_SUBMISSIONS', {
      examId: examId,
      uploadedBy: currentLecturer
    });
    hideAppLoading();

    const submissions = (res && res.submissions) ? res.submissions : [];
    renderSubmissionsUI(examId, submissions);

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi tải bảng điểm: ${err.message}`);
  }
}

/**
 * 2. Tác vụ Giảng viên cho Sinh viên Làm Lại Bài
 */
export async function handleResetStudentSubmission(examId, studentCode, studentName) {
  const isConfirm = confirm(`⚠️ CẢNH BÁO LÀM LẠI BÀI THI:\n\nBạn có chắc chắn muốn xóa bài làm của sinh viên "${studentName}" (${studentCode})?\n\nSau khi xóa, bài thi sẽ quay về trạng thái chưa làm để sinh viên thực hiện lại.`);
  if (!isConfirm) return;

  showAppLoading(`⏳ Đang xóa bài nộp cũ của sinh viên [${studentCode}]...`);
  try {
    const res = await appsScriptService.request('RESET_STUDENT_SUBMISSION', {
      examId: examId,
      studentCode: studentCode
    });
    hideAppLoading();

    if (res && res.status === 'success') {
      alert(res.message || '✅ Cho làm lại bài thành công!');
      // Tải lại danh sách bảng điểm
      handleViewExamSubmissions(examId);
    } else {
      alert(`❌ Không thể reset bài làm: ${res?.message || 'Lỗi hệ thống'}`);
    }
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi kết nối Server: ${err.message}`);
  }
}

/**
 * 3. Xuất Bảng Điểm Ra File CSV Mở Trực Tiếp Trên Excel (.csv UTF-8 BOM)
 */
export function exportSubmissionsToCSV(examId, submissions = []) {
  if (!submissions || submissions.length === 0) {
    alert('Chưa có dữ liệu bài nộp để xuất bảng điểm!');
    return;
  }

  let csvContent = "\uFEFF"; // UTF-8 BOM chống lỗi tiếng Việt trên Excel
  csvContent += "Thời gian nộp,Mã Đề Thi,Mã Sinh Viên,Họ và Tên,Lớp,Số câu đúng,Số câu đã làm,Tổng số câu,Điểm số,Số lần vi phạm,Tự động nộp,Ghi chú,Đáp án JSON\n";

  submissions.forEach(sub => {
    const row = [
      `"${sub.submittedAt || ''}"`,
      `"${sub.examId || examId}"`,
      `"${sub.studentId || sub.studentCode || ''}"`,
      `"${sub.fullName || sub.studentName || ''}"`,
      `"${sub.className || ''}"`,
      sub.correctCount || 0,
      sub.answeredCount || 0,
      sub.totalQuestions || 0,
      sub.score !== undefined ? sub.score : 0,
      sub.violationCount || 0,
      `"${sub.autoSubmitted || 'Không'}"`,
      `"${(sub.submitNote || '').replace(/"/g, '""')}"`,
      `"${(sub.answersJson || '').replace(/"/g, '""')}"`
    ];
    csvContent += row.join(",") + "\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Bang_Diem_${examId}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Window Bindings
window.handleViewExamSubmissions = handleViewExamSubmissions;
window.handleResetStudentSubmission = handleResetStudentSubmission;
window.exportSubmissionsToCSV = exportSubmissionsToCSV;
