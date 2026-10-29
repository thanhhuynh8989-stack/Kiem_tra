import { appsScriptService } from '../services/appsScriptService.js';
import { githubService } from '../services/githubService.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, getLoggedInRole, escapeHtml } from './authAndCore.js';

/**
 * LECTURER DASHBOARD MODULE - QUẢN LÝ ĐỀ THI VÀ XEM ĐIỂM SỐ BÀI NỘP
 */

// =========================================================================
// 1. NẠP DANH SÁCH ĐỀ THI CỦA GIẢNG VIÊN / ADMIN
// =========================================================================
export async function handleLoadLecturerDashboard() {
  const container = document.getElementById('lecturerDashboardContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  showAppLoading('⏳ Đang tải danh sách đề thi của bạn...');
  try {
    const username = getLoggedInUsername();
    const role = getLoggedInRole();

    const res = await appsScriptService.request('GET_MY_EXAMS', {
      lecturerCode: username,
      username: username,
      role: role
    });

    hideAppLoading();
    const exams = res.exams || res.data || [];
    renderLecturerDashboardUI(exams);
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi nạp danh sách đề thi: ${err.message}`);
  }
}

// =========================================================================
// 2. HIỂN THỊ DẠNG BẢNG DANH SÁCH ĐỀ THI
// =========================================================================
export function renderLecturerDashboardUI(exams = []) {
  const container = document.getElementById('lecturerDashboardContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid var(--border); margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
        <h3 style="margin:0; font-size:18px; color:#0f172a;">📚 Danh Sách Đề Thi Đã Tạo (${exams.length})</h3>
        <button type="button" onclick="handleLoadLecturerDashboard()" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; font-size:12px; cursor:pointer;">🔄 Tải lại</button>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap:14px;">
        ${exams.length === 0 ? `
          <div style="grid-column:1/-1; text-align:center; padding:30px; color:#94a3b8; background:#f8fafc; border-radius:8px; border:1px dashed #cbd5e1;">
            Bạn chưa tạo đề thi nào. Hãy bấm "Tải đề thi" để bắt đầu bóc tách và xuất bản đề mới!
          </div>
        ` : exams.map(ex => `
          <div style="border:1px solid #cbd5e1; border-radius:8px; padding:14px; background:#fff; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
            <div>
              <strong style="font-size:15px; color:#0f172a; display:block; margin-bottom:4px;">${escapeHtml(ex.title)}</strong>
              <div style="font-size:12px; color:#64748b;">Mã đề: <code style="background:#f1f5f9; padding:2px 4px; border-radius:4px;">${escapeHtml(ex.examId)}</code></div>
              <div style="font-size:12px; color:#64748b; margin-top:2px;">⏱️ ${ex.durationMinutes} phút | 👤 ${escapeHtml(ex.createdBy)}</div>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:6px; border-top:1px solid #f1f5f9; padding-top:10px;">
              <button type="button" onclick="handleViewExamSubmissions('${ex.examId}')" style="background:#0284c7; color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; cursor:pointer; flex:1;">📊 Xem điểm</button>
              <button type="button" onclick="handleDeleteExamUI('${ex.examId}')" style="background:#ef4444; color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:12px; cursor:pointer;">🗑️ Xóa</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <div id="submissionsDetailSection" style="margin-top:16px;"></div>
  `;

  container.innerHTML = html;
}

// =========================================================================
// 3. XEM BẢNG ĐIỂM BÀI NỘP CỦA SINH VIÊN (GET_SUBMISSIONS)
// =========================================================================
export async function handleViewExamSubmissions(examId) {
  const detailContainer = document.getElementById('submissionsDetailSection');
  if (!detailContainer) return;

  showAppLoading(`⏳ Đang nạp danh sách kết quả cho bài thi [${examId}]...`);
  try {
    const username = getLoggedInUsername();
    const role = getLoggedInRole();

    const res = await appsScriptService.request('GET_SUBMISSIONS', {
      examId: examId,
      username: username,
      role: role
    });

    hideAppLoading();
    const submissions = res.data || [];
    renderSubmissionsTable(examId, submissions);
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi nạp danh sách kết quả: ${err.message}`);
  }
}

export function renderSubmissionsTable(examId, submissions = []) {
  const container = document.getElementById('submissionsDetailSection');
  if (!container) return;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid var(--border);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
        <h4 style="margin:0; font-size:16px; color:#0f172a;">📊 Bảng Điểm Bài Nộp - Mã đề: ${escapeHtml(examId)} (${submissions.length} lượt nộp)</h4>
        <button type="button" onclick="document.getElementById('submissionsDetailSection').innerHTML=''" style="background:#64748b; color:#fff; border:none; padding:4px 10px; border-radius:6px; font-size:12px; cursor:pointer;">✖️ Đóng bảng điểm</button>
      </div>

      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
          <thead>
            <tr style="background:#f1f5f9; color:#334155;">
              <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Mã SV</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Họ và Tên</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Lớp</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; text-align:center;">Số câu đúng</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; text-align:center;">Điểm số</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; text-align:center;">Vi phạm</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1;">Thời gian nộp</th>
            </tr>
          </thead>
          <tbody>
            ${submissions.length === 0 ? `
              <tr><td colspan="7" style="padding:20px; text-align:center; color:#94a3b8;">Chưa có sinh viên nào nộp bài thi này.</td></tr>
            ` : submissions.map(s => `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:10px; font-weight:600;">${escapeHtml(s.studentCode)}</td>
                <td style="padding:10px;">${escapeHtml(s.studentName)}</td>
                <td style="padding:10px;">${escapeHtml(s.studentClass || 'N/A')}</td>
                <td style="padding:10px; text-align:center;">${s.correctCount}/${s.totalQuestions}</td>
                <td style="padding:10px; text-align:center;"><strong style="color:#15803d; font-size:14px;">${s.grade}</strong></td>
                <td style="padding:10px; text-align:center;">
                  <span style="color:${Number(s.violationCount) > 0 ? '#dc2626' : '#16a34a'}; font-weight:600;">${s.violationCount || 0} lần</span>
                </td>
                <td style="padding:10px; color:#64748b; font-size:12px;">${escapeHtml(s.timestamp)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;
  container.scrollIntoView({ behavior: 'smooth' });
}

// =========================================================================
// 4. XÓA ĐỀ THI KHỎI HỆ THỐNG
// =========================================================================
export async function handleDeleteExamUI(examId) {
  if (!confirm(`Bạn có chắc chắn muốn XÓA vĩnh viễn đề thi [${examId}]?`)) return;

  showAppLoading(`⏳ Đang xóa đề thi [${examId}]...`);
  try {
    const res = await appsScriptService.request('DELETE_EXAM', { examId });
    hideAppLoading();
    alert(res.message || '✅ Đã xóa đề thi thành công!');
    handleLoadLecturerDashboard();
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi xóa đề thi: ${err.message}`);
  }
}

window.handleLoadLecturerDashboard = handleLoadLecturerDashboard;
window.handleViewExamSubmissions = handleViewExamSubmissions;
window.handleDeleteExamUI = handleDeleteExamUI;
