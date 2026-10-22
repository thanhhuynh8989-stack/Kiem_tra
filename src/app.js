import { appsScriptService } from './services/appsScriptService.js';
import { githubService } from './services/githubService.js';
import { parseDocxFile } from './parsers/docxParser.js';
import { parsePdfFile } from './parsers/pdfParser.js';
import { renderKaTeX } from './utils/domHelper.js';
import { aiExamParserService } from './services/aiExamParserService.js';
import { examModel } from './models/examModel.js';
import { logger } from './utils/logger.js';
import { APP_CONFIG } from './constants/appConfig.js';

let currentUser = null;
let currentExamState = null;
let currentExamData = null;
const studentAnswers = {};

let violationCount = 0;
let isExamActive = false;

// Biến quản lý Timer AI
let aiTimerInterval = null;
let aiSecondsElapsed = 0;

/**
 * Hàm chuẩn hóa dữ liệu User thông minh (Bóc tách đa tầng)
 */
function normalizeUserData(raw) {
  if (!raw) return null;

  let obj = raw;
  if (obj.data && typeof obj.data === 'object') obj = obj.data;
  if (obj.user && typeof obj.user === 'object') obj = obj.user;
  if (obj.userData && typeof obj.userData === 'object') obj = obj.userData;
  if (obj.userInfo && typeof obj.userInfo === 'object') obj = obj.userInfo;
  if (Array.isArray(obj)) obj = obj[0] || {};

  let rawRole = obj.role || obj.Role || obj.ROLE || obj.userRole || 
                raw.role || raw.Role || raw.ROLE || '';
  let normalizedRole = String(rawRole).toUpperCase().trim();

  let username = obj.username || obj.User || obj.user || 
                 raw.username || raw.User || '';
  if (typeof username === 'object') username = '';

  let fullName = obj.fullName || obj['Full name'] || obj.fullname || obj.Fullname || obj['full_name'] ||
                 obj.name || obj.Name ||
                 raw.fullName || raw['Full name'] || raw.fullname || '';

  if (typeof fullName === 'object') fullName = '';

  const knownRoles = ['ADMIN', 'LECTURER', 'STUDENT'];
  
  if (!fullName || knownRoles.includes(String(fullName).toUpperCase().trim())) {
    fullName = (username && !knownRoles.includes(String(username).toUpperCase().trim())) 
               ? username 
               : (normalizedRole === 'ADMIN' ? 'Quản trị hệ thống' : 
                  normalizedRole === 'LECTURER' ? 'Giảng viên' : 'Sinh viên');
  }

  if (!normalizedRole || !knownRoles.includes(normalizedRole)) {
    if (knownRoles.includes(String(obj.Role || raw.Role).toUpperCase().trim())) {
      normalizedRole = String(obj.Role || raw.Role).toUpperCase().trim();
    } else if (knownRoles.includes(String(username).toUpperCase().trim())) {
      normalizedRole = String(username).toUpperCase().trim();
    }
  }

  return {
    authenticated: raw.authenticated !== undefined ? raw.authenticated : true,
    username: String(username),
    fullName: String(fullName),
    role: normalizedRole
  };
}

/**
 * Gọi API có cơ chế thử lại (Retry)
 */
async function requestWithRetry(action, payload, retries = 2, delay = 1500) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await appsScriptService.request(action, payload);
    } catch (err) {
      if (attempt === retries) throw err;
      if (typeof logger !== 'undefined' && logger.warn) {
        logger.warn(`Lần thử action '${action}' thứ ${attempt + 1} thất bại. Đang thử lại...`);
      }
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

/**
 * Xử lý Đăng nhập
 */
export async function handleLogin() {
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');

  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!username || !password) {
    return alert('Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu!');
  }

  const originalBtnText = loginBtn ? loginBtn.innerText : 'Đăng Nhập';
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.innerText = '⏳ Đang kết nối...';
  }

  try {
    const res = await requestWithRetry('AUTH_LECTURER', { username, password });

    sessionStorage.removeItem('currentUser');
    sessionStorage.removeItem('userSession');

    currentUser = normalizeUserData(res);

    if (currentUser && currentUser.role) {
      sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      sessionStorage.setItem('userSession', JSON.stringify(currentUser));

      alert(`Đăng nhập thành công!\nXin chào ${currentUser.fullName}!`);

      if (currentUser.role === 'ADMIN' || currentUser.role === 'LECTURER') {
        if (!document.getElementById('adminView') && !document.getElementById('lecturerView')) {
          window.location.href = 'index.html';
        } else {
          showView(currentUser.role === 'ADMIN' ? 'adminView' : 'lecturerView');
        }
      } else {
        showView('studentView');
      }
    } else {
      alert(res.message || 'Tên đăng nhập hoặc mật khẩu không chính xác!');
    }
  } catch (err) {
    console.error('Login Error:', err);
    alert('Không thể kết nối đến Máy chủ! Vui lòng kiểm tra lại đường truyền mạng.');
  } finally {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerText = originalBtnText;
    }
  }
}

export function handleLogout() {
  currentUser = null;
  sessionStorage.removeItem('currentUser');
  sessionStorage.removeItem('userSession');

  if (typeof stopViolationTracking === 'function') {
    stopViolationTracking();
  }

  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';

  showView('authView');
}

/**
 * Hiển thị View theo quyền truy cập
 */
export function showView(viewId) {
  const targetView = document.getElementById(viewId);
  
  if (targetView) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    targetView.classList.add('active');
  }

  const userInfo = document.getElementById('userInfo');
  const userBadge = document.getElementById('userBadge');

  if (currentUser) {
    if (userInfo) userInfo.style.display = 'flex';
    
    const roleTitle = currentUser.role === 'ADMIN' ? 'Quản trị hệ thống' : 
                      currentUser.role === 'LECTURER' ? 'Giảng viên' : 'Sinh viên';

    if (userBadge) {
      userBadge.textContent = `${currentUser.fullName} (${roleTitle})`;
    }

    if (viewId === 'lecturerView' && typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }
  } else if (viewId === 'studentView') {
    if (userInfo) userInfo.style.display = 'flex';
    if (userBadge) userBadge.textContent = 'HỌC SINH / SINH VIÊN';
  } else {
    if (userInfo) userInfo.style.display = 'none';
  }
}

// Xuất hàm ra phạm vi Window
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.showView = showView;
window.saveAns = (qId, key) => { studentAnswers[qId] = key; };

/**
 * Gán sự kiện cho các thẻ HTML
 */
function bindEvents() {
  const rawSession = sessionStorage.getItem('currentUser') || sessionStorage.getItem('userSession');
  
  if (rawSession) {
    try {
      currentUser = normalizeUserData(JSON.parse(rawSession));

      sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      sessionStorage.setItem('userSession', JSON.stringify(currentUser));

      const role = currentUser.role;
      if (role === 'ADMIN') {
        if (!document.getElementById('adminView') && window.location.pathname.includes('exam.html')) {
          window.location.href = 'index.html';
          return;
        }
        showView('adminView');
      } else if (role === 'LECTURER') {
        if (!document.getElementById('lecturerView') && window.location.pathname.includes('exam.html')) {
          window.location.href = 'index.html';
          return;
        }
        showView('lecturerView');
      } else {
        showView('studentView');
      }

    } catch (e) {
      console.error("Lỗi khôi phục session user:", e);
      sessionStorage.removeItem('currentUser');
      sessionStorage.removeItem('userSession');
      currentUser = null;
      showView('authView');
    }
  } else {
    showView('authView');
  }

  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.onclick = handleLogin;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = handleLogout;

  const gotoStudentBtn = document.getElementById('gotoStudentBtn');
  if (gotoStudentBtn) {
    gotoStudentBtn.onclick = (e) => {
      e.preventDefault();
      showView('studentView');
    };
  }

  document.querySelectorAll('.backToAuthLink').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      showView('authView');
    };
  });

  document.getElementById('loadExamBtn')?.addEventListener('click', handleLoadExam);
  document.getElementById('submitExamBtn')?.addEventListener('click', () => handleSubmitExam(false));

  document.getElementById('processExamBtn')?.addEventListener('click', handleProcessExamWithAI);
  document.getElementById('publishExamBtn')?.addEventListener('click', handlePublishExam);
  document.getElementById('loadMyExamsBtn')?.addEventListener('click', handleLoadMyExams);

  document.getElementById('loadUsersBtn')?.addEventListener('click', handleLoadUsers);
  document.getElementById('gotoLecturerPortalBtn')?.addEventListener('click', () => showView('lecturerView'));
  document.getElementById('uploadStudentsBtn')?.addEventListener('click', handleUploadStudentsExcel);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindEvents);
} else {
  bindEvents();
}

async function handleLoadUsers() {
  try {
    const res = await appsScriptService.request('GET_USERS_LIST');
    const users = res.data || res || [];
    
    let html = '<table border="1" style="width:100%; border-collapse:collapse; text-align:left;"><tr><th style="padding:8px;">Username</th><th style="padding:8px;">Họ tên</th><th style="padding:8px;">Vai trò</th></tr>';
    
    const userArray = Array.isArray(users) ? users : [users];
    userArray.forEach(u => {
      const normUser = normalizeUserData(u);
      html += `<tr><td style="padding:8px;">${normUser.username}</td><td style="padding:8px;">${normUser.fullName}</td><td style="padding:8px;">${normUser.role}</td></tr>`;
    });
    
    html += '</table>';
    const usersContainer = document.getElementById('usersListTable');
    if (usersContainer) {
      usersContainer.innerHTML = html;
    }
  } catch (err) {
    console.error("Lỗi tải danh sách người dùng:", err);
    alert('Lỗi tải danh sách người dùng!');
  }
}

/* ==========================================================================
   CƠ CHẾ GIÁM SÁT VI PHẠM (RỜI TAB / BLUR TRÌNH DUYỆT)
   ========================================================================== */

function startViolationTracking() {
  violationCount = 0;
  isExamActive = true;

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', handleWindowBlur);
}

function stopViolationTracking() {
  isExamActive = false;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('blur', handleWindowBlur);
}

function handleVisibilityChange() {
  if (document.hidden && isExamActive) {
    processViolation();
  }
}

function handleWindowBlur() {
  if (isExamActive) {
    processViolation();
  }
}

function processViolation() {
  if (!isExamActive) return;
  violationCount++;

  const max = parseInt(currentExamData?.maxViolations || 3, 10);

  if (max <= 1 || violationCount >= max) {
    alert(`⚠️ VI PHẠM QUY CHẾ (${violationCount}/${max}): Bạn đã rời khỏi màn hình làm bài!\nHệ thống TỰ ĐỘNG NỘP BÀI TỨC THỜI.`);
    stopViolationTracking();
    handleSubmitExam(true);
  } else if (violationCount === max - 1) {
    alert(`⚠️ CẢNH BÁO VI PHẠM (${violationCount}/${max}): Bạn vừa rời khỏi màn hình thi!\nNếu vi phạm thêm 1 lần nữa, bài thi của bạn sẽ bị TỰ ĐỘNG NỘP NGAY LẬP TỨC.`);
  } else {
    alert(`⚠️ VI PHẠM (${violationCount}/${max}): Vui lòng không chuyển tab hoặc rời khỏi giao diện làm bài!`);
  }
}

/**
 * Sinh viên: Tải đề thi từ GitHub & Kích hoạt giám sát
 */
async function handleLoadExam() {
  const code = document.getElementById('examCodeInput').value.trim();
  if (!code) return alert('Nhập mã đề thi!');

  try {
    const filename = code.endsWith('.json') ? code : `${code}.json`;
    currentExamData = await githubService.getExam(filename);

    document.getElementById('examTitle').textContent = currentExamData.title || 'Bài Thi Trực Tuyến';
    renderQuestions(currentExamData.questions);

    document.getElementById('examSearchSection').style.display = 'none';
    document.getElementById('examContainer').style.display = 'block';
    renderKaTeX(document.getElementById('questionsList'));

    startViolationTracking();
  } catch (err) {
    alert('Không tìm thấy đề thi!');
  }
}

/**
 * Render đề thi cho Học sinh (Nút radio phía trước đáp án)
 */
function renderQuestions(questions = []) {
  const container = document.getElementById('questionsList');
  container.innerHTML = '';
  questions.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.style.cssText = 'border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #fff;';

    let html = `<p style="font-weight: 600; font-size: 15px; margin-bottom: 12px;"><strong>Câu ${index + 1}:</strong> ${q.stem}</p>`;

    if (q.imageUrl) {
      html += `<div style="margin: 8px 0;"><img src="${q.imageUrl}" style="max-width: 100%; max-height: 200px; border-radius: 6px; border: 1px solid #e2e8f0;" /></div>`;
    }

    (q.options || []).forEach((opt, oIdx) => {
      const optKey = String.fromCharCode(65 + oIdx);
      const optText = typeof opt === 'string' ? opt : (opt?.text || opt?.content || String(opt || ''));
      const inputId = `q_${q.id}_opt_${oIdx}`;

      html += `
        <div style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer;">
          <input type="radio" 
                 id="${inputId}" 
                 name="q_${q.id}" 
                 value="${optKey}" 
                 style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0;"
                 onchange="window.saveAns('${q.id}', '${optKey}')">
          <label for="${inputId}" style="cursor: pointer; font-size: 14px; line-height: 1.4;">
            <strong>${optKey}.</strong> ${optText}
          </label>
        </div>
      `;
    });
    card.innerHTML = html;
    container.appendChild(card);
  });
}

/**
 * Thu thập đáp án hiện tại và Nộp bài
 */
async function handleSubmitExam(isAutoSubmitted = false) {
  if (!currentExamData || !currentExamData.questions) {
    return alert('Không tìm thấy dữ liệu bài thi!');
  }

  const studentNameInput = document.getElementById('studentName');
  const studentCodeInput = document.getElementById('studentCode');
  
  const studentName = studentNameInput?.value.trim() || 'Thí sinh';
  const studentCode = studentCodeInput?.value.trim() || 'N/A';

  if (!isAutoSubmitted && (!studentName || !studentCode)) {
    return alert('Vui lòng điền đầy đủ Họ tên và Mã sinh viên trước khi nộp bài!');
  }

  const collectedAnswers = {};
  currentExamData.questions.forEach((q, idx) => {
    const qId = q.id || `q_${idx + 1}`;
    const selectedRadio = document.querySelector(`input[name="q_${q.id}"]:checked`) || 
                          document.querySelector(`input[name="${qId}"]:checked`) ||
                          document.querySelector(`input[name="q_${idx}"]:checked`);
    
    if (selectedRadio) {
      collectedAnswers[qId] = selectedRadio.value;
    } else if (studentAnswers[qId] !== undefined) {
      collectedAnswers[qId] = studentAnswers[qId];
    }
  });

  const btnSubmit = document.getElementById('submitExamBtn');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = '⏳ Đang chấm điểm & gửi bài...';
  }

  stopViolationTracking();

  try {
    const examId = currentExamData.id || currentExamData.examId;
    const studentInfo = { name: studentName, code: studentCode };
    const violationInfo = {
      violationCount: violationCount,
      isAutoSubmitted: isAutoSubmitted,
      reason: isAutoSubmitted ? 'Tự động nộp do vi phạm quy chế rời màn hình' : 'Nộp bài tự nguyện'
    };

    const result = await appsScriptService.submitExamAnswers(examId, studentInfo, collectedAnswers, violationInfo);

    document.getElementById('examContainer').style.display = 'none';
    const resultContainer = document.getElementById('resultContainer');
    if (resultContainer) {
      resultContainer.style.display = 'block';
      const scoreText = document.getElementById('scoreText');
      if (scoreText) {
        scoreText.innerHTML = `
          ${isAutoSubmitted ? '<p style="color:#dc2626; font-size:16px;">⚠️ BÀI THI BỊ ÉP NỘP DO VI PHẠM MÀN HÌNH</p>' : ''}
          Điểm số: <span style="color:#2563eb; font-size:32px;">${result.data?.finalGrade || result.finalGrade || '0.00'}</span> / 10<br>
          <small style="font-size:16px; color:#475569;">(Đúng ${result.data?.score || result.score || 0}/${result.data?.totalQuestions || result.totalQuestions || 0} câu)</small>
        `;
      }
    }

  } catch (err) {
    alert('Lỗi khi nộp bài: ' + err.message);
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Nộp Bài Thi';
    }
  }
}

/* ==========================================================================
   QUẢN LÝ TIẾN TRÌNH VÀ BỘ ĐẾM THỜI GIAN AI (AI LOADING PROGRESS)
   ========================================================================== */

function startAILoading() {
  const loadingContainer = document.getElementById('aiLoadingContainer');
  const progressBar = document.getElementById('aiProgressBar');
  const timerText = document.getElementById('aiTimerText');
  const uploadStatus = document.getElementById('uploadStatus');

  if (uploadStatus) uploadStatus.innerHTML = '';
  if (loadingContainer) loadingContainer.style.display = 'block';

  aiSecondsElapsed = 0;
  if (timerText) timerText.textContent = '⏱️ 0s';
  if (progressBar) progressBar.style.width = '10%';

  clearInterval(aiTimerInterval);
  aiTimerInterval = setInterval(() => {
    aiSecondsElapsed++;
    if (timerText) timerText.textContent = `⏱️ ${aiSecondsElapsed}s`;

    if (progressBar) {
      let simulatedPercent = Math.min(90, 10 + Math.floor(aiSecondsElapsed * 2.5));
      progressBar.style.width = `${simulatedPercent}%`;
    }
  }, 1000);
}

function stopAILoading(isSuccess = true) {
  clearInterval(aiTimerInterval);
  const loadingContainer = document.getElementById('aiLoadingContainer');
  const progressBar = document.getElementById('aiProgressBar');

  if (isSuccess && progressBar) {
    progressBar.style.width = '100%';
  }

  setTimeout(() => {
    if (loadingContainer) loadingContainer.style.display = 'none';
  }, 800);
}

/* ==========================================================================
   HÀM TIỆN ÍCH TRÍCH XUẤT ẢNH VÀ CẮT ẢNH CANVAS
   ========================================================================== */

async function extractImagesFromDocx(file) {
  if (!window.JSZip) return [];
  try {
    const zip = await JSZip.loadAsync(file);
    const images = [];
    const mediaFiles = Object.keys(zip.files).filter(fileName =>
      fileName.startsWith('word/media/') && !zip.files[fileName].dir
    );

    for (const fileName of mediaFiles) {
      const base64 = await zip.files[fileName].async('base64');
      const ext = fileName.split('.').pop().toLowerCase();
      const mimeType = (ext === 'png') ? 'image/png' : 'image/jpeg';
      images.push({ imageBase64: base64, mimeType });
    }
    return images;
  } catch (e) {
    logger.error('Lỗi trích xuất ảnh DOCX:', e);
    return [];
  }
}

async function renderPdfPageToCanvas(file, pageNum = 1) {
  if (!window.pdfjsLib) return null;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNum);

  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function cropImageFromBox(sourceCanvas, box) {
  if (!box || !Array.isArray(box) || box.length !== 4) return null;

  const [ymin, xmin, ymax, xmax] = box;
  const imgWidth = sourceCanvas.width;
  const imgHeight = sourceCanvas.height;

  const cropX = Math.max(0, (xmin / 1000) * imgWidth);
  const cropY = Math.max(0, (ymin / 1000) * imgHeight);
  const cropWidth = Math.min(imgWidth - cropX, ((xmax - xmin) / 1000) * imgWidth);
  const cropHeight = Math.min(imgHeight - cropY, ((ymax - ymin) / 1000) * imgHeight);

  if (cropWidth <= 10 || cropHeight <= 10) return null;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;

  const ctx = cropCanvas.getContext('2d');
  ctx.drawImage(
    sourceCanvas,
    cropX, cropY, cropWidth, cropHeight,
    0, 0, cropWidth, cropHeight
  );

  return cropCanvas.toDataURL('image/png');
}

async function createCanvasFromBase64(base64Data, mimeType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = (err) => reject(err);
    img.src = `data:${mimeType};base64,${base64Data}`;
  });
}

/**
 * LƯU GEMINI API KEY CÁ NHÂN VÀO CẢ LOCALSTORAGE VÀ GOOGLE SHEETS
 */
window.saveUserApiKey = async function() {
  const input = document.getElementById('userGeminiApiKey');
  if (!input) return;

  const apiKey = input.value.trim();
  if (!apiKey) {
    alert('Vui lòng dán Gemini API Key của bạn (bắt đầu bằng AIzaSy... hoặc AQ...).');
    return;
  }

  // 1. Lưu ngay vào LocalStorage trình duyệt để sử dụng tức thì
  localStorage.setItem('userGeminiApiKey', apiKey);
  localStorage.setItem('custom_gemini_api_key', apiKey);

  // 2. Cập nhật Badge trên giao diện
  const badge = document.getElementById('aiQuotaBadge');
  if (badge) {
    badge.style.background = '#dcfce7';
    badge.style.color = '#15803d';
    badge.innerHTML = '🔑 API Key cá nhân: Đang kích hoạt (Không giới hạn)';
  }

  // 3. Đọc Username linh hoạt từ mọi kiểu lưu trữ của currentUser
  const userObj = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const username = userObj.username || userObj.user || userObj.User || 'admin';

  try {
    const res = await appsScriptService.saveUserApiKey(username, apiKey);
    alert(res.message || 'Đã lưu API Key cá nhân thành công lên Hệ thống!');
  } catch (err) {
    console.warn('Key đã được lưu tại Trình duyệt. Đồng bộ Hệ thống thất bại:', err.message);
    alert(`Đã lưu Key tại trình duyệt! (Lưu ý đồng bộ Hệ thống: ${err.message})`);
  }
};

/**
 * TỰ ĐỘNG ĐỒNG BỘ API KEY TỪ BACKEND KHI ĐĂNG NHẬP THÀNH CÔNG
 */
function syncUserApiKeyAfterLogin(userData) {
  if (!userData) return;

  const keyInput = document.getElementById('userGeminiApiKey');
  
  if (userData.geminiApiKey) {
    localStorage.setItem('custom_gemini_api_key', userData.geminiApiKey);
    if (keyInput) keyInput.value = userData.geminiApiKey;
  } else {
    const localKey = localStorage.getItem('custom_gemini_api_key');
    if (localKey && keyInput) keyInput.value = localKey;
  }

  updateAIQuotaBadge(userData.aiUsageCount);
}

function updateAIQuotaBadge(serverUsageCount = null) {
  const badge = document.getElementById('aiQuotaBadge');
  const userKey = localStorage.getItem('custom_gemini_api_key');

  if (!badge) return;

  if (userKey) {
    badge.style.background = '#d1fae5';
    badge.style.color = '#047857';
    badge.textContent = '🔑 API Key cá nhân: Đang kích hoạt (Không giới hạn)';
  } else if (serverUsageCount !== null) {
    if (serverUsageCount >= 1) {
      badge.style.background = '#fee2e2';
      badge.style.color = '#b91c1c';
      badge.textContent = '⚠️ AI Hệ thống: 0/1 lượt (Chế độ Code thuần)';
    } else {
      badge.style.background = '#dbeafe';
      badge.style.color = '#1d4ed8';
      badge.textContent = '🎁 AI Hệ thống: 1/1 lượt miễn phí';
    }
  } else {
    badge.style.background = '#e2e8f0';
    badge.style.color = '#475569';
    badge.textContent = '🎁 AI Hệ thống: 1 lượt miễn phí (Hoặc nhập Key cá nhân)';
  }
}

async function handleProcessExamWithAI() {
  const fileInput = document.getElementById('examFileInput');
  const rawTextarea = document.getElementById('rawExamText');
  let rawText = rawTextarea?.value.trim() || '';
  let imageBase64 = null;
  let mimeType = 'image/jpeg';
  let sourceCanvas = null;
  let parsedQuestionsFromDocx = null;

  if (fileInput?.files.length > 0) {
    const file = fileInput.files[0];
    setUploadStatus('📂 Đang bóc tách tệp bằng Code thuần...', 'color: #2563eb');
    try {
      if (file.name.endsWith('.docx')) {
        parsedQuestionsFromDocx = await parseDocxFile(file);
        const docxImages = await extractImagesFromDocx(file);
        if (docxImages.length > 0) {
          imageBase64 = docxImages[0].imageBase64;
          mimeType = docxImages[0].mimeType;
          sourceCanvas = await createCanvasFromBase64(imageBase64, mimeType);
        }
      } else if (file.name.endsWith('.pdf')) {
        rawText = await extractTextFromFile(file);
        sourceCanvas = await renderPdfPageToCanvas(file, 1);
        if (sourceCanvas) {
          imageBase64 = sourceCanvas.toDataURL('image/jpeg').split(',')[1];
          mimeType = 'image/jpeg';
        }
      }
    } catch (err) {
      setUploadStatus(`❌ Lỗi đọc tệp: ${err.message}`, 'color: #ef4444');
      return;
    }
  }

  if (!rawText && !imageBase64 && (!parsedQuestionsFromDocx || parsedQuestionsFromDocx.length === 0)) {
    return alert('Vui lòng chọn tệp (.docx, .pdf) hoặc dán văn bản đề thi vào ô nhập!');
  }

  startAILoading();

  try {
    // 1. Lấy API Key cá nhân từ localStorage (Kiểm tra cả 2 tên key dự phòng)
    const customApiKey = localStorage.getItem('userGeminiApiKey') || localStorage.getItem('custom_gemini_api_key') || '';
    const username = currentUser ? currentUser.username : '';

    // 2. Gọi API Backend (Sử dụng model gemini-2.0-flash để đảm bảo tương thích 100%)
    const response = await appsScriptService.parseExamAI(
      rawText, 
      imageBase64, 
      mimeType, 
      'gemini-2.0-flash', 
      parsedQuestionsFromDocx,
      customApiKey,
      username
    );

    // 3. Bóc tách linh hoạt cấu trúc trả về từ Server (tránh lỗi undefined)
    const resData = response.data || response;
    const questionsRaw = resData.questions || (Array.isArray(resData) ? resData : null);

    if (!questionsRaw || !Array.isArray(questionsRaw)) {
      throw new Error('Dữ liệu câu hỏi trả về từ Server không hợp lệ.');
    }

    let questions = questionsRaw;

    // 4. Cập nhật lượt dùng trên Badge giao diện
    const aiUsageCount = resData.aiUsageCount !== undefined ? resData.aiUsageCount : response.aiUsageCount;
    if (aiUsageCount !== undefined && typeof updateAIQuotaBadge === 'function') {
      updateAIQuotaBadge(aiUsageCount);
    }

    // 5. Cắt ảnh từ Canvas nếu câu hỏi có cờ imageBox
    if (sourceCanvas) {
      questions = questions.map(q => {
        if (q.hasImage && q.imageBox && typeof cropImageFromBox === 'function') {
          q.imageUrl = cropImageFromBox(sourceCanvas, q.imageBox);
        }
        return q;
      });
    }

    // 6. Khởi tạo đề thi chuẩn hóa (Giữ nguyên cờ flags & originalOptionCount)
    currentExamState = examModel.createStandardExam(
      { title: 'Đề thi phân tích AI' },
      questions
    );

    stopAILoading(true);

    // 7. Đếm chính xác số câu chưa hoàn thiện (cần duyệt lại)
    const needReviewCount = currentExamState.questions.filter(q => {
      const hasEmptyOpt = Array.isArray(q.options) && q.options.some(opt => !String(opt || '').trim());
      return Boolean(q.flags?.needsUserConfirmation) || hasEmptyOpt || Boolean(q.flags?.isMissingOptions) || Boolean(q.flags?.isMissingAnswer);
    }).length;

    const isFallback = Boolean(resData.isFallback || response.isFallback);
    const serverMsg = resData.message || response.message;

    let successMsg = `✅ Hoàn tất sau ${aiSecondsElapsed}s! Bóc tách ${questions.length} câu hỏi (${needReviewCount} câu cần duyệt lại).`;
    if (isFallback) {
      successMsg = `⚠️ ${serverMsg || 'Đã dùng hết 1 lượt AI miễn phí. Hệ thống bóc tách bằng Code thuần (Vui lòng điền các ô lựa chọn bị trống).'}`;
    }

    setUploadStatus(successMsg, isFallback ? 'color: #d97706' : 'color: #10b981');
    renderQuestionListForReview(currentExamState.questions);

  } catch (err) {
    stopAILoading(false);
    if (typeof logger !== 'undefined' && logger.error) {
      logger.error('AI Process Error:', err);
    }
    setUploadStatus(`❌ Lỗi xử lý: ${err.message}`, 'color: #ef4444');
  }
}

/**
 * Render danh sách câu hỏi AI bóc tách (Ưu tiên viền cam cảnh báo cho ô trống)
 */
function renderQuestionListForReview(questions = []) {
  const reviewSection = document.getElementById('aiReviewSection');
  const container = document.getElementById('questionsReviewList');
  const summaryText = document.getElementById('reviewSummaryText');

  if (!reviewSection || !container) return;

  reviewSection.style.display = 'block';
  container.innerHTML = '';

  let needReviewCount = 0;

  questions.forEach((q, idx) => {
    const optionsList = Array.isArray(q.options) ? [...q.options] : ['', '', '', ''];
    while (optionsList.length < 4) optionsList.push('');
    q.options = optionsList.slice(0, 4);

    // 1. KIỂM TRA ĐIỀU KIỆN CẢNH BÁO
    const hasEmptyOption = q.options.some(opt => !String(opt || '').trim());
    const isMissingOpts = Boolean(q.flags?.isMissingOptions) || (q.originalOptionCount !== undefined && q.originalOptionCount < 4) || hasEmptyOption;
    const isMissingAns = Boolean(q.flags?.isMissingAnswer);
    const isWarning = Boolean(q.flags?.needsUserConfirmation) || isMissingOpts || isMissingAns;

    if (isWarning) needReviewCount++;

    const card = document.createElement('div');
    card.className = `question-card ${isWarning ? 'card-needs-review' : ''}`;
    
    const cardBorderColor = isWarning ? '#f59e0b' : '#10b981';
    const cardBgColor = isWarning ? '#fffbeb' : '#ffffff';

    card.style.cssText = `border: 2px solid ${cardBorderColor}; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: ${cardBgColor}; width: 100%; box-sizing: border-box;`;
    card.id = `review-card-${q.id || `q_${idx + 1}`}`;

    let optionsHtml = '';
    q.options.forEach((opt, oIdx) => {
      const optLetter = String.fromCharCode(65 + oIdx);
      const isCorrect = Number(q.correctAnswer) === oIdx;
      const optText = typeof opt === 'string' ? opt : (opt?.text || opt?.content || String(opt || ''));
      const isEmpty = !optText.trim();

      let inputBorder = '#d1d5db';
      let inputBg = '#ffffff';

      if (isEmpty) {
        inputBorder = '#f59e0b';
        inputBg = '#fff7ed';
      } else if (isCorrect) {
        inputBorder = isMissingAns ? '#f59e0b' : '#10b981'; // Viền cam nếu tạm chọn do thiếu đáp án
        inputBg = isMissingAns ? '#fff7ed' : '#f0fdf4';
      }

      optionsHtml += `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; width: 100%;">
          <input type="radio" 
                 name="correct_opt_${q.id || idx}" 
                 id="opt_radio_${q.id || idx}_${oIdx}" 
                 value="${oIdx}" 
                 ${isCorrect ? 'checked' : ''} 
                 style="flex-shrink: 0; cursor: pointer; width: 18px; height: 18px;"
                 onchange="window.updateCorrectAnswer('${q.id}', ${oIdx})">
          <label for="opt_radio_${q.id || idx}_${oIdx}" style="font-weight: bold; min-width: 20px; flex-shrink: 0; cursor: pointer;">${optLetter}.</label>
          <input type="text" 
                 placeholder="${isEmpty ? '⚠️ Ô trống - Vui lòng gõ phương án ' + optLetter + '...' : ''}"
                 style="flex: 1; min-width: 0; padding: 8px 12px; border: 2px solid ${inputBorder}; border-radius: 6px; background-color: ${inputBg}; font-size: 14px; box-sizing: border-box;" 
                 value="${escapeHtml(optText)}" 
                 onchange="window.updateOptionText('${q.id}', ${oIdx}, this.value)">
        </div>
      `;
    });

    // 2. TẠO THẺ HUY HIỆU CẢNH BÁO
    let warningBadges = '';
    if (isMissingOpts) {
      warningBadges += `<span style="background:#fee2e2; color:#dc2626; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600; margin-left: 6px;">⚠️ Thiếu phương án</span>`;
    }
    if (isMissingAns) {
      warningBadges += `<span style="background:#fef3c7; color:#d97706; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600; margin-left: 6px;">⚠️ Chưa có đáp án gốc (Tạm chọn A)</span>`;
    }

    const headerBadge = isWarning 
      ? `<span style="background:#fef3c7; color:#d97706; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600;">⚠️ Cần xác nhận</span>`
      : `<span style="background:#d1fae5; color:#059669; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600;">✓ Hoàn Thiện</span>`;

    // 3. NỘI DUNG GHI CHÚ HƯỚNG DẪN
    let noteContent = q.flags?.note || '';
    if (isMissingAns) {
      noteContent = '🔍 <strong>Cảnh báo đáp án:</strong> Đề gốc chưa đánh dấu đáp án đúng (hệ thống tạm chọn A). Vui lòng tích chọn lại đáp án chuẩn xác.';
    } else if (isMissingOpts) {
      noteContent = '🔍 <strong>Ghi chú:</strong> Vui lòng điền nội dung cho các ô lựa chọn bị trống.';
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
        <div>
          <strong style="font-size: 15px;">Câu ${idx + 1}:</strong>
          ${warningBadges}
        </div>
        ${headerBadge}
      </div>

      <div style="margin-bottom: 12px;">
        <label style="display:block; font-size: 12px; color: #6b7280; margin-bottom: 4px; font-weight: 500;">Nội dung câu hỏi:</label>
        <textarea style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box;" 
                  rows="2" 
                  onchange="window.updateQuestionStem('${q.id}', this.value)">${escapeHtml(q.stem || '')}</textarea>
      </div>

      <div>
        <label style="display:block; font-size: 12px; color: #6b7280; margin-bottom: 6px; font-weight: 500;">Các phương án (Tích chọn đáp án đúng):</label>
        ${optionsHtml}
      </div>

      ${isWarning ? `
        <div style="margin-top: 12px; padding: 10px; background: #ffffff; border: 1px solid #fcd34d; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 13px; color: #92400e;">
          ${noteContent}
        </div>
        <button type="button" 
                style="margin-top: 10px; background: #059669; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;" 
                onclick="window.confirmQuestionItem('${q.id}')">✓ Đã Kiểm Tra & Xác Nhận</button>
      ` : ''}
    `;

    container.appendChild(card);
  });

  if (summaryText) {
    summaryText.innerHTML = `Tổng số <strong>${questions.length}</strong> câu hỏi. Có <strong style="color:#d97706;">${needReviewCount}</strong> câu thiếu đáp án gốc hoặc chưa hoàn thiện cần bạn kiểm tra.`;
  }

  renderKaTeX(container);
}

// HANDLERS CẬP NHẬT TRẠNG THÁI GIAO DIỆN
window.updateQuestionStem = (qId, val) => {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === qId);
  if (q) q.stem = val;
};

window.updateOptionText = (qId, optIdx, val) => {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === qId);
  if (q && q.options) q.options[optIdx] = val;
};

window.updateCorrectAnswer = function(qId, selectedIdx) {
  if (!currentExamState || !currentExamState.questions) return;
  const q = currentExamState.questions.find(item => String(item.id) === String(qId));
  if (q) {
    q.correctAnswer = selectedIdx;
    if (q.flags) {
      q.flags.isMissingAnswer = false;
    }
    renderQuestionListForReview(currentExamState.questions);
  }
};

window.confirmQuestionItem = function(qId) {
  if (!currentExamState || !currentExamState.questions) return;
  const q = currentExamState.questions.find(item => String(item.id) === String(qId));
  if (q) {
    const hasEmpty = q.options.some(opt => !String(opt || '').trim());
    if (hasEmpty) {
      alert('Vui lòng nhập đầy đủ 4 phương án trước khi xác nhận câu hỏi này!');
      return;
    }
    if (q.flags) {
      q.flags.needsUserConfirmation = false;
      q.flags.isMissingOptions = false;
      q.flags.isMissingAnswer = false;
    }
    renderQuestionListForReview(currentExamState.questions);
  }
};

window.removeQuestionImage = (qId) => {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === qId);
  if (q) {
    q.imageUrl = null;
    q.hasImage = false;
    renderQuestionListForReview(currentExamState.questions);
  }
};

/**
 * Xuất bản đề thi (Đã tích hợp ràng buộc kiểm tra ô trống & cuộn tới câu lỗi)
 */
async function handlePublishExam() {
  if (!currentExamState || !currentExamState.questions || currentExamState.questions.length === 0) {
    return alert('Chưa có dữ liệu đề thi để xuất bản!');
  }

  const examTitleInput = document.getElementById('examTitleInput');
  const examTitle = examTitleInput?.value.trim();
  const durationMinutes = parseInt(document.getElementById('examDurationInput')?.value || '45', 10);
  const maxViolations = parseInt(document.getElementById('examMaxViolationsInput')?.value || '3', 10);

  if (!examTitle) {
    if (examTitleInput) examTitleInput.focus();
    return alert('Vui lòng nhập Tên đề thi trước khi xuất bản!');
  }

  // 1. RÀNG BUỘC KIỂM TRA PHƯƠNG ÁN BỊ TRỐNG ("")
  let hasEmptyOption = false;
  let emptyQuestionIndex = -1;
  let emptyQuestionId = null;

  for (let idx = 0; idx < currentExamState.questions.length; idx++) {
    const q = currentExamState.questions[idx];
    const options = q.options || [];
    for (let oIdx = 0; oIdx < options.length; oIdx++) {
      const opt = options[oIdx];
      const text = typeof opt === 'string' ? opt : (opt?.text || opt?.content || '');
      if (!text || !text.trim()) {
        hasEmptyOption = true;
        emptyQuestionIndex = idx + 1;
        emptyQuestionId = q.id || `q_${idx + 1}`;
        break;
      }
    }
    if (hasEmptyOption) break;
  }

  // NẾU CÓ Ô LỰA CHỌN BỊ TRỐNG -> CHẶN XUẤT BẢN & CUỘN TỚI CÂU LỖI
  if (hasEmptyOption) {
    alert(`⚠️ KHÔNG THỂ XUẤT BẢN!\nCâu hỏi số ${emptyQuestionIndex} đang có phương án lựa chọn bị TRỐNG.\nVui lòng nhập đầy đủ nội dung cho tất cả 4 phương án trước khi xuất bản!`);
    
    const targetCard = document.getElementById(`review-card-${emptyQuestionId}`) || 
                       document.getElementById(`review-card-q_${emptyQuestionIndex}`);
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetCard.style.boxShadow = '0 0 0 3px #ef4444';
      setTimeout(() => { targetCard.style.boxShadow = 'none'; }, 3500);
    }
    return;
  }

  // 2. CẢNH BÁO CÁC CÂU CẦN GIẢNG VIÊN DUYỆT THỦ CÔNG
  const unconfirmedCount = currentExamState.questions.filter(q => q.flags?.needsUserConfirmation).length;
  if (unconfirmedCount > 0) {
    const autoConfirm = confirm(`Vẫn còn ${unconfirmedCount} câu hỏi được đánh dấu cần duyệt thủ công. Bạn có chắc chắn muốn tiếp tục xuất bản không?`);
    if (!autoConfirm) return;
  }

  // 3. THỰC HIỆN TẠO VÀ XUẤT BẢN ĐỀ THI
  try {
    setUploadStatus('⏳ Đang tạo đề thi và lưu lên kho dữ liệu...', 'color: #2563eb');

    currentExamState.title = examTitle;
    currentExamState.durationMinutes = durationMinutes;
    currentExamState.maxViolations = maxViolations;
    currentExamState.createdBy = currentUser ? currentUser.username : 'anonymous';
    currentExamState.createdByName = currentUser ? currentUser.fullName : 'Vô danh';

    const { studentExam, masterKey } = examModel.splitExamForPublishing(currentExamState);

    const rawId = String(studentExam.examId || `exam_${Date.now()}`);
    const cleanExamCode = rawId.replace(/^exam_/, '');
    const fileNameOnGithub = `exam_${cleanExamCode.slice(0, 8)}.json`;

    await appsScriptService.saveAndPublishExam(
      studentExam.examId,
      masterKey,
      studentExam,
      `exams/${fileNameOnGithub}`,
      currentUser?.username
    );

    setUploadStatus(`🎉 Xuất bản thành công! Mã đề thi: <strong>${fileNameOnGithub}</strong>`, 'color: #10b981');
    alert(`🎉 Xuất bản đề thi thành công!\nMã đề thi: ${fileNameOnGithub}`);

    if (typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }
  } catch (err) {
    if (typeof logger !== 'undefined' && logger.error) {
      logger.error('Publish Error:', err);
    }
    setUploadStatus(`❌ Lỗi xuất bản: ${err.message}`, 'color: #ef4444');
  }
}

/**
 * Hàm hỗ trợ mã hóa ký tự HTML an toàn (Tránh lỗi escapeHtml is not defined)
 */
function safeEscapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
/**
 * Trích xuất tên Username đăng nhập từ mọi vị trí Storage có thể
 */
function getLoggedInUsername() {
  const possibleKeys = ['currentUser', 'user', 'loggedInUser', 'username', 'auth_user', 'account'];
  
  for (const key of possibleKeys) {
    // Quét cả localStorage lẫn sessionStorage
    const rawVal = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!rawVal) continue;

    try {
      const parsed = JSON.parse(rawVal);
      if (typeof parsed === 'string' && parsed.trim()) {
        return parsed.trim();
      }
      if (typeof parsed === 'object' && parsed !== null) {
        const name = parsed.username || parsed.user || parsed.User || parsed.Fullname || parsed.fullName || parsed.name || parsed.studentCode;
        if (name && String(name).trim()) return String(name).trim();
      }
    } catch (e) {
      // Nếu là chuỗi thuần (ví dụ: "admin" hoặc "thanh")
      if (typeof rawVal === 'string' && rawVal.trim() && rawVal !== 'null' && rawVal !== 'undefined' && rawVal !== '{}') {
        return rawVal.replace(/"/g, '').trim();
      }
    }
  }

  return '';
}

// Biến toàn cục lưu danh sách đề thi gốc để phục vụ lọc dữ liệu
window.rawFetchedExams = [];

/**
 * TẢI VÀ HIỂN THỊ DANH SÁCH ĐỀ THI (Hỗ trợ Admin Filter & Action Buttons)
 */
async function handleLoadMyExams() {
  console.log('🚀 [DEBUG] Bắt đầu gọi handleLoadMyExams()');

  const container = document.getElementById('myExamsListTable') || document.getElementById('myExamsList');
  const btnReload = document.getElementById('loadMyExamsBtn');
  const filterWrapper = document.getElementById('adminAuthorFilterWrapper');
  const filterSelect = document.getElementById('filterAuthorSelect');

  if (btnReload) {
    btnReload.disabled = true;
    btnReload.innerText = '⏳ Đang tải...';
  }

  if (!container) {
    console.error('❌ Không tìm thấy thẻ container hiển thị danh sách đề!');
    if (btnReload) {
      btnReload.disabled = false;
      btnReload.innerText = '🔄 Tải lại';
    }
    return;
  }

  container.innerHTML = '<p style="color: #2563eb; font-size: 13px; padding: 10px 0;">🔄 Đang kết nối máy chủ lấy danh sách đề thi...</p>';

  try {
    // 1. Quét tìm username từ tất cả Storage
    const username = getLoggedInUsername();
    console.log('🔍 Username phát hiện được từ Storage:', username);

    if (!username) {
      container.innerHTML = '<p style="color: #ef4444; font-size: 13px;">⚠️ Chưa tìm thấy phiên đăng nhập. Vui lòng đăng nhập lại tài khoản!</p>';
      return;
    }

    console.log(`📡 Đang gọi API lấy danh sách đề thi cho User: [${username}]`);

    // 2. Gọi Backend Apps Script
    const response = await appsScriptService.getLecturerExams(username);
    console.log('📦 Dữ liệu nhận từ Apps Script:', response);

    const exams = Array.isArray(response.exams) 
      ? response.exams 
      : (Array.isArray(response.data) ? response.data : []);

    // Lưu vào biến toàn cục để dùng cho bộ lọc Admin
    window.rawFetchedExams = exams;

    // 3. Xử lý Bộ Lọc Người Tạo cho Admin
    const isAdmin = String(username).trim().toLowerCase() === 'admin';
    if (isAdmin && filterWrapper && filterSelect) {
      filterWrapper.style.display = 'flex';

      // Trích xuất danh sách người tạo duy nhất
      const authors = [...new Set(exams.map(e => e.createdBy || 'N/A'))];
      let optionsHtml = '<option value="ALL">-- Tất cả người tạo --</option>';
      authors.forEach(author => {
        optionsHtml += `<option value="${escapeHtml(author)}">${escapeHtml(author)}</option>`;
      });
      filterSelect.innerHTML = optionsHtml;
    } else if (filterWrapper) {
      filterWrapper.style.display = 'none';
    }

    // 4. Render danh sách đề thi
    renderExamsList(exams, username);

  } catch (err) {
    console.error('❌ Lỗi tải danh sách đề:', err);
    container.innerHTML = `<p style="color: #ef4444; font-size: 13px; padding: 10px 0;">❌ Lỗi kết nối: ${err.message}</p>`;
  } finally {
    if (btnReload) {
      btnReload.disabled = false;
      btnReload.innerText = '🔄 Tải lại';
    }
  }
}

/**
 * HÀM RENDER DANH SÁCH ĐỀ THI RA THẺ CARD KÈM NÚT SỬA / XÓA / GIAO ĐỀ
 */
function renderExamsList(exams, currentUsername = '') {
  const container = document.getElementById('myExamsListTable') || document.getElementById('myExamsList');
  if (!container) return;

  if (!exams || exams.length === 0) {
    container.innerHTML = `<p style="color: #64748b; font-size: 13px; padding: 10px 0;">Chưa có đề thi nào phù hợp.</p>`;
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">';
  
  exams.forEach((ex) => {
    const examId = escapeHtml(ex.examId || '');
    const examCode = escapeHtml(ex.examCode || ex.examId || 'N/A');
    const title = escapeHtml(ex.title || 'Đề thi trắc nghiệm');
    const duration = ex.durationMinutes || 45;
    const createdBy = escapeHtml(ex.createdBy || currentUsername || 'N/A');
    const createdAt = escapeHtml(ex.createdAt || 'N/A');

    html += `
      <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); flex-wrap: wrap; gap: 10px;">
        <!-- THÔNG TIN ĐỀ THI -->
        <div>
          <strong style="font-size: 15px; color: #0f172a;">${title}</strong>
          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
            Mã đề: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; color:#2563eb; font-weight:600;">${examCode}</code> 
            | Thời gian: <strong>${duration} phút</strong> 
            | Người tạo: <strong style="color: #d97706;">${createdBy}</strong>
            | Ngày tạo: ${createdAt}
          </div>
        </div>

        <!-- CÁC NÚT THAO TÁC: GIAO ĐỀ / SỬA / XÓA -->
        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" onclick="handleOpenAssignModal('${examId}', '${title}')" title="Giao đề cho Lớp / Sinh viên" style="background: #059669; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
            📤 Giao đề
          </button>
          <button type="button" onclick="handleEditExam('${ex.examId}', '${ex.examCode || ''}')" title="Chỉnh sửa nội dung đề" style="background: #d97706; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
            ✏️ Sửa
          </button>
          <button type="button" onclick="handleDeleteExam('${examId}')" title="Xóa đề thi này" style="background: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
            🗑️ Xóa
          </button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

// Gán hàm ra window
window.handleLoadMyExams = handleLoadMyExams;
window.renderExamsList = renderExamsList;

// -------------------------------------------------------------
// SỰ KIỆN TOÀN CỤC (EVENT LISTENERS)
// -------------------------------------------------------------

// 1. Lắng nghe click nút #loadMyExamsBtn
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#loadMyExamsBtn');
  if (btn) {
    e.preventDefault();
    console.log('👉 Click nút #loadMyExamsBtn!');
    handleLoadMyExams();
  }
});

// 2. Lắng nghe thay đổi Lọc theo Người tạo (Admin Author Filter)
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'filterAuthorSelect') {
    const selectedAuthor = e.target.value;
    console.log(`🔍 Đang lọc đề thi theo tác giả: [${selectedAuthor}]`);

    if (selectedAuthor === 'ALL') {
      renderExamsList(window.rawFetchedExams);
    } else {
      const filtered = window.rawFetchedExams.filter(ex => 
        String(ex.createdBy || '').toLowerCase() === selectedAuthor.toLowerCase()
      );
      renderExamsList(filtered);
    }
  }
});

// -------------------------------------------------------------
// HÀM PHỤ TRỢ THAO TÁC NÚT BẤM (XÓA / SỬA / GIAO ĐỀ)
// -------------------------------------------------------------

window.handleDeleteExam = async function(examId) {
  if (!confirm(`Bạn có chắc chắn muốn XÓA vĩnh viễn đề thi [${examId}]?`)) return;
  
  try {
    const username = getLoggedInUsername();
    const res = await appsScriptService.deleteExam(examId, username);
    alert(res.message || 'Đã xóa đề thi thành công!');
    handleLoadMyExams(); // Tải lại danh sách sau khi xóa
  } catch (err) {
    alert('Lỗi khi xóa đề thi: ' + err.message);
  }
};

// Lưu trữ thông tin đề thi đang chỉnh sửa vào bộ nhớ tạm
window.currentEditingExamContext = null;

/**
 * 1. TẢI ĐÚNG CÂU HỎI VÀ ĐÁP ÁN ĐANG TỒN TẠI TỪ FILE JSON
 */
window.handleEditExam = async function(examId, examCode = '') {
  console.log('✏️ Bắt đầu nạp đề thi hiện tại. ID:', examId, 'Code:', examCode);

  const btn = event?.target?.closest('button');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Đang nạp đề hiện tại...';
  }

  try {
    const config = (typeof APP_CONFIG !== 'undefined') ? APP_CONFIG : (window.APP_CONFIG || {
      GITHUB: { OWNER: 'thanhhuynh8989-stack', REPO: 'Kiem_tra', BRANCH: 'main' }
    });

    // Xác định tên file chuẩn (Ví dụ: exam_75ceb91a.json)
    let rawName = String(examCode || examId).trim();
    if (rawName.includes('-')) {
      rawName = rawName.split('-')[0];
    }
    if (!rawName.endsWith('.json')) {
      rawName = `${rawName}.json`;
    }

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/${config.GITHUB.OWNER}/${config.GITHUB.REPO}/${config.GITHUB.BRANCH}/${filePath}?t=${Date.now()}`;
    
    console.log('📡 Đang nạp tệp JSON thực tế từ GitHub CDN:', cdnUrl);

    let examData = null;

    // Tải nội dung tệp JSON lưu gần nhất từ CDN
    try {
      const res = await fetch(cdnUrl);
      if (res.ok) {
        examData = await res.json();
      }
    } catch (e) {
      console.warn('⚠️ GitHub CDN chưa phản hồi, thử tải từ Backend...');
    }

    // Dự phòng gọi Backend nếu CDN báo 404
    if (!examData && typeof appsScriptService !== 'undefined') {
      const backendRes = await appsScriptService.request('GET_EXAM_DETAIL', { examId, examCode, filePath });
      if (backendRes.status === 'success' && backendRes.examData) {
        examData = backendRes.examData;
      }
    }

    if (!examData) {
      throw new Error(`Không tìm thấy dữ liệu tệp [${filePath}]. Hãy chắc chắn đề thi đã được Xuất bản!`);
    }

    // Lấy chính xác danh sách câu hỏi trong JSON hiện tại
    const currentQuestions = Array.isArray(examData) 
      ? examData 
      : (examData.questions || examData.data?.questions || []);

    if (!Array.isArray(currentQuestions) || currentQuestions.length === 0) {
      throw new Error('Tệp JSON đề thi không có câu hỏi hợp lệ.');
    }

    console.log(`✅ Nạp thành công ${currentQuestions.length} câu hỏi hiện có từ tệp ${filePath}`);

    // Ghi nhớ Context của đề thi đang sửa để chuẩn bị cho việc GHI ĐÈ
    window.currentEditingExamContext = {
      examId: examId,
      examCode: rawName,
      filePath: filePath,
      title: examData.title || 'Đề thi trắc nghiệm',
      durationMinutes: examData.durationMinutes || 45
    };

    if (window.examModel) {
      window.examModel.setQuestions(currentQuestions);
    }

    // Nạp câu hỏi và đáp án thực tế lên màn hình chỉnh sửa
    if (typeof renderFullQuestionEditor === 'function') {
      renderFullQuestionEditor(currentQuestions, rawName);
    }

    // Cuộn trang mượt đến vị trí Trình chỉnh sửa
    const targetElement = document.getElementById('reviewQuestionsContainer') || document.getElementById('myExamsListTable');
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

  } catch (err) {
    console.error('❌ Lỗi nạp đề thi:', err);
    alert(`Không thể nạp đề thi hiện tại: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '✏️ Sửa';
    }
  }
};

/**
 * 2. LƯU THAY ĐỔI VÀ GHI ĐÈ NỘI DUNG LÊN TỆP JSON CŨ
 */
window.handleSaveEditedExam = async function() {
  const context = window.currentEditingExamContext;
  if (!context || !context.examId) {
    alert('⚠️ Chưa xác định được đề thi đang chỉnh sửa!');
    return;
  }

  const saveBtns = document.querySelectorAll('button[onclick*="handleSaveEditedExam"]');
  saveBtns.forEach(btn => {
    btn.disabled = true;
    btn.innerText = '⏳ Đang ghi đè dữ liệu...';
  });

  try {
    const cards = document.querySelectorAll('.question-editor-card');
    if (!cards || cards.length === 0) {
      throw new Error('Không có dữ liệu câu hỏi trên màn hình.');
    }

    // Thu thập dữ liệu đã sửa đổi từ giao diện
    const updatedQuestions = Array.from(cards).map((card, idx) => {
      const stemInput = card.querySelector('.q-stem-input');
      const stemText = stemInput ? stemInput.value.trim() : '';

      const checkedRadio = card.querySelector('.q-radio-ans:checked');
      const answerKey = checkedRadio ? checkedRadio.value : 'A';

      const optionInputs = card.querySelectorAll('.q-option-input');
      const options = Array.from(optionInputs).map(optEl => optEl.value.trim());

      while (options.length < 4) {
        options.push('');
      }

      return {
        id: idx + 1,
        stem: stemText,
        options: options.slice(0, 4),
        answerKey: answerKey
      };
    });

    const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : 'admin';

    console.log(`💾 Tiến hành GHI ĐÈ ${updatedQuestions.length} câu hỏi lên file [${context.filePath}]...`);

    // Gọi API lưu và GHI ĐÈ lên chính examId và filePath cũ
    const res = await appsScriptService.saveAndPublishExam(
      context.examId,
      'MASTER_KEY',
      { 
        title: context.title,
        durationMinutes: context.durationMinutes,
        questions: updatedQuestions 
      },
      context.filePath, // Giữ nguyên đường dẫn tệp JSON cũ
      username
    );

    alert(res.message || `✅ Đã ghi đè và cập nhật thành công tệp [${context.filePath}]!`);

    if (window.examModel) {
      window.examModel.setQuestions(updatedQuestions);
    }

    // Tải lại danh sách đề thi
    if (typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }

  } catch (err) {
    console.error('❌ Lỗi ghi đè đề thi:', err);
    alert(`Lỗi ghi đè đề thi: ${err.message}`);
  } finally {
    saveBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerText = '💾 Lưu thay đổi đề thi';
    });
  }
};

/**
 * 2. TRÌNH DỰNG GIAO DIỆN CHỈNH SỬA CÂU HỎI ĐẦY ĐỦ (TỐI ƯU DOM & PERFORMANCE)
 */
function renderFullQuestionEditor(questions, fileName) {
  const reviewContainer = document.getElementById('reviewQuestionsContainer') || document.getElementById('myExamsListTable');
  if (!reviewContainer) return;

  if (!Array.isArray(questions) || questions.length === 0) {
    reviewContainer.innerHTML = '<p style="color: #ef4444; font-size: 13px; padding: 12px;">⚠️ Không có dữ liệu câu hỏi để hiển thị.</p>';
    return;
  }

  const escapeFn = typeof escapeHtml === 'function' ? escapeHtml : safeEscapeHtml;

  // 1. Header công cụ
  const headerHtml = `
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 14px 18px; border-radius: 8px; color: #1e40af; font-weight: 600; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
      <span>📝 Đang chỉnh sửa Đề thi: <strong style="color: #2563eb;">[${escapeFn(fileName)}]</strong> (${questions.length} câu hỏi)</span>
      <button type="button" onclick="handleSaveEditedExam()" style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
        💾 Lưu thay đổi đề thi
      </button>
    </div>
  `;

  // 2. Render danh sách thẻ câu hỏi bằng map().join('')
  const cardsHtml = questions.map((q, idx) => {
    const stemText = q.stem || q.text || q.value || '';
    const optionsList = Array.isArray(q.options) ? q.options : (Array.isArray(q.choices) ? q.choices : []);
    const answerKey = String(q.answerKey || q.answer || q.key || '').trim().toUpperCase();

    // Chuẩn hóa 4 đáp án A, B, C, D
    const formattedOptions = ['', '', '', ''];
    optionsList.forEach((opt, oIdx) => {
      if (oIdx < 4) {
        let optStr = typeof opt === 'string' ? opt : (opt.text || opt.content || String(opt || ''));
        formattedOptions[oIdx] = optStr.replace(/^[A-D][.:)]\s*/i, '').trim();
      }
    });

    const isAnswerMissing = !['A', 'B', 'C', 'D'].includes(answerKey);

    const optionsHtml = formattedOptions.map((optVal, oIdx) => {
      const letter = String.fromCharCode(65 + oIdx);
      const isChecked = (answerKey === letter) || (isAnswerMissing && letter === 'A');

      return `
        <div style="display: flex; align-items: center; gap: 10px;">
          <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #334155; min-width: 40px; cursor: pointer;">
            <input type="radio" name="correct_ans_${idx}" class="q-radio-ans" value="${letter}" ${isChecked ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;">
            ${letter}.
          </label>
          <input type="text" class="q-option-input" value="${escapeFn(optVal)}" placeholder="Lựa chọn ${letter}..." style="flex: 1; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; background: #ffffff;">
        </div>
      `;
    }).join('');

    return `
      <div class="question-editor-card" data-idx="${idx}" style="background: #ffffff; border: ${isAnswerMissing ? '2px solid #f97316' : '1px solid #cbd5e1'}; border-radius: 10px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <strong style="font-size: 15px; color: #0f172a;">Câu ${idx + 1}:</strong>
          <span class="badge-ans-status" style="${isAnswerMissing ? 'background: #ffedd5; color: #c2410c; border: 1px solid #fed7aa;' : 'background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;'} padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;">
            ${isAnswerMissing ? '⚠️ Chưa chọn đáp án gốc (Tạm chọn A)' : `✅ Đáp án đúng: ${answerKey}`}
          </span>
        </div>

        <textarea class="q-stem-input" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-family: inherit; font-size: 14px; margin-bottom: 12px; min-height: 60px; line-height: 1.4;">${escapeFn(stemText)}</textarea>

        <div style="display: flex; flex-direction: column; gap: 8px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #f1f5f9;">
          <span style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 4px;">Các lựa chọn đáp án (Tích chọn nút tròn để xác định đáp án đúng):</span>
          ${optionsHtml}
        </div>
      </div>
    `;
  }).join('');

  // 3. Footer Lưu
  const footerHtml = `
    <div style="text-align: right; margin-top: 16px; margin-bottom: 30px;">
      <button type="button" onclick="handleSaveEditedExam()" style="background: #2563eb; color: white; border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
        💾 Lưu thay đổi đề thi
      </button>
    </div>
  `;

  reviewContainer.innerHTML = headerHtml + cardsHtml + footerHtml;
}

window.renderFullQuestionEditor = renderFullQuestionEditor;

/**
 * CẬP NHẬT BADGE ĐÁP ÁN THỜI GIAN THỰC KHI THAY ĐỔI RADIO
 */
document.addEventListener('change', (e) => {
  if (e.target && e.target.classList.contains('q-radio-ans')) {
    const card = e.target.closest('.question-editor-card');
    if (!card) return;

    const badge = card.querySelector('.badge-ans-status');
    const selectedLetter = e.target.value;

    if (badge) {
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
      badge.style.border = '1px solid #bbf7d0';
      badge.innerHTML = `✅ Đáp án đúng: ${selectedLetter}`;
    }
    card.style.border = '1px solid #cbd5e1';
  }
});

/**
 * TỐI ƯU HÀM LƯU THAY ĐỔI ĐỀ THI (DUYỆT THEO CLASS SELECTOR)
 */
window.handleSaveEditedExam = async function() {
  const context = window.currentEditingExamContext;
  if (!context || !context.examId) {
    alert('⚠️ Chưa xác định được đề thi đang chỉnh sửa!');
    return;
  }

  const saveBtns = document.querySelectorAll('button[onclick*="handleSaveEditedExam"]');
  saveBtns.forEach(btn => {
    btn.disabled = true;
    btn.innerText = '⏳ Đang ghi đè dữ liệu...';
  });

  try {
    const cards = document.querySelectorAll('.question-editor-card');
    if (!cards || cards.length === 0) {
      throw new Error('Không có dữ liệu câu hỏi trên màn hình.');
    }

    // Thu thập dữ liệu đã sửa đổi từ giao diện
    const updatedQuestions = Array.from(cards).map((card, idx) => {
      const stemInput = card.querySelector('.q-stem-input');
      const stemText = stemInput ? stemInput.value.trim() : '';

      const checkedRadio = card.querySelector('.q-radio-ans:checked');
      const answerKey = checkedRadio ? checkedRadio.value : 'A';

      const optionInputs = card.querySelectorAll('.q-option-input');
      const options = Array.from(optionInputs).map(optEl => optEl.value.trim());

      while (options.length < 4) {
        options.push('');
      }

      return {
        id: idx + 1,
        stem: stemText,
        options: options.slice(0, 4),
        answerKey: answerKey
      };
    });

    const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : 'admin';

    console.log(`💾 Tiến hành GHI ĐÈ ${updatedQuestions.length} câu hỏi lên file [${context.filePath}]...`);

    // Gọi API lưu và GHI ĐÈ lên chính examId và filePath cũ
    const res = await appsScriptService.saveAndPublishExam(
      context.examId,
      'MASTER_KEY',
      { 
        title: context.title,
        durationMinutes: context.durationMinutes,
        questions: updatedQuestions 
      },
      context.filePath, // Giữ nguyên đường dẫn tệp JSON cũ
      username
    );

    alert(res.message || `✅ Đã ghi đè và cập nhật thành công tệp [${context.filePath}]!`);

    if (window.examModel) {
      window.examModel.setQuestions(updatedQuestions);
    }

    // Tải lại danh sách đề thi
    if (typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }

  } catch (err) {
    console.error('❌ Lỗi ghi đè đề thi:', err);
    alert(`Lỗi ghi đè đề thi: ${err.message}`);
  } finally {
    saveBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerText = '💾 Lưu thay đổi đề thi';
    });
  }
};
/**
 * 2. QUẢN LÝ SINH VIÊN VÀ BẢNG ĐIỂM THI
 */
async function handleLoadStudentsAndGrades() {
  console.log('🚀 [DEBUG] Kích hoạt handleLoadStudentsAndGrades()');

  const container = document.getElementById('studentsAndGradesTable');
  const btn = event?.target?.closest('button');

  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Đang nạp bảng điểm...';
  }

  if (!container) {
    console.error('❌ Không tìm thấy khung #studentsAndGradesTable!');
    if (btn) { btn.disabled = false; btn.innerText = '📊 Tải Bảng Điểm & Sinh Viên'; }
    return;
  }

  container.innerHTML = '<p style="color: #2563eb; font-size: 13px; padding: 12px 0;">🔄 Đang lấy danh sách Sinh viên và Bảng điểm từ máy chủ...</p>';

  try {
    // Gọi song song danh sách Sinh viên và Lịch sử làm bài
    const [stRes, subRes] = await Promise.all([
      appsScriptService.getStudents(),
      appsScriptService.getSubmissions()
    ]);

    const students = Array.isArray(stRes.students) ? stRes.students : (Array.isArray(stRes.data) ? stRes.data : []);
    const submissions = Array.isArray(subRes.submissions) ? subRes.submissions : (Array.isArray(subRes.data) ? subRes.data : []);

    if (students.length === 0 && submissions.length === 0) {
      container.innerHTML = '<p style="color: #64748b; font-size: 13px; padding: 12px 0;">Chưa có dữ liệu sinh viên hoặc bài nộp nào trong hệ thống.</p>';
      return;
    }

    let html = `
      <div style="overflow-x: auto; margin-top: 10px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #1e293b;">
              <th style="padding: 12px;">Mã Sinh Viên</th>
              <th style="padding: 12px;">Họ và Tên</th>
              <th style="padding: 12px;">Lớp</th>
              <th style="padding: 12px;">Đề thi đã làm</th>
              <th style="padding: 12px;">Điểm số</th>
              <th style="padding: 12px;">Thời gian nộp</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (students.length > 0) {
      students.forEach(st => {
        const studentSubs = submissions.filter(sub => String(sub.studentCode || '').toLowerCase() === String(st.studentCode || '').toLowerCase());

        if (studentSubs.length > 0) {
          studentSubs.forEach(sub => {
            html += `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">${escapeHtml(st.studentCode)}</td>
                <td style="padding: 10px 12px;">${escapeHtml(st.fullName)}</td>
                <td style="padding: 10px 12px;"><span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: 500;">${escapeHtml(st.className)}</span></td>
                <td style="padding: 10px 12px; color: #2563eb; font-weight: 500;">${escapeHtml(sub.examId)}</td>
                <td style="padding: 10px 12px; font-weight: 700; color: #059669;">${sub.score} / 10</td>
                <td style="padding: 10px 12px; color: #64748b;">${escapeHtml(sub.submittedAt)}</td>
              </tr>
            `;
          });
        } else {
          html += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">${escapeHtml(st.studentCode)}</td>
              <td style="padding: 10px 12px;">${escapeHtml(st.fullName)}</td>
              <td style="padding: 10px 12px;"><span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: 500;">${escapeHtml(st.className)}</span></td>
              <td style="padding: 10px 12px; color: #94a3b8; font-style: italic;">Chưa nộp bài nào</td>
              <td style="padding: 10px 12px; color: #94a3b8;">-</td>
              <td style="padding: 10px 12px; color: #94a3b8;">-</td>
            </tr>
          `;
        }
      });
    } else {
      // Hiển thị trực tiếp nếu chưa có danh sách sinh viên nhưng có kết quả thi
      submissions.forEach(sub => {
        html += `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">${escapeHtml(sub.studentCode)}</td>
            <td style="padding: 10px 12px;">${escapeHtml(sub.studentName || sub.studentCode)}</td>
            <td style="padding: 10px 12px;">-</td>
            <td style="padding: 10px 12px; color: #2563eb; font-weight: 500;">${escapeHtml(sub.examId)}</td>
            <td style="padding: 10px 12px; font-weight: 700; color: #059669;">${sub.score} / 10</td>
            <td style="padding: 10px 12px; color: #64748b;">${escapeHtml(sub.submittedAt)}</td>
          </tr>
        `;
      });
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;

  } catch (err) {
    console.error('❌ Lỗi nạp dữ liệu sinh viên:', err);
    container.innerHTML = `<p style="color: #ef4444; font-size: 13px; padding: 12px 0;">❌ Không thể kết nối dữ liệu: ${err.message}</p>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '📊 Tải Bảng Điểm & Sinh Viên';
    }
  }
}

// 3. XUẤT HÀM RA WINDOW TOÀN CỤC ĐỂ HTML NÚT BẤM GỌI ĐƯỢC TRỰC TIẾP
window.handleLoadStudentsAndGrades = handleLoadStudentsAndGrades;

window.handleOpenAssignModal = async function(examId, examTitle = '') {
  console.log('📤 Mở modal giao đề thi:', examId);

  // 1. Đảm bảo có danh sách Sinh viên mới nhất
  let students = window.currentStudentsList || [];
  if (!students || students.length === 0) {
    if (typeof showAppLoading === 'function') showAppLoading('⏳ Đang tải danh sách Lớp & Sinh viên...');
    try {
      const res = await appsScriptService.request('GET_STUDENTS', {});
      students = res.students || res.data || [];
      window.currentStudentsList = students;
    } catch (e) {
      console.warn('Không tải được sinh viên:', e);
    } finally {
      if (typeof hideAppLoading === 'function') hideAppLoading();
    }
  }

  // 2. Tách danh sách Lớp duy nhất (Unique Class List)
  const classList = [...new Set(students.map(s => String(s.className || s.class || '').trim()).filter(Boolean))];

  // 3. Xóa Modal cũ nếu có
  const oldModal = document.getElementById('assignExamModalOverlay');
  if (oldModal) oldModal.remove();

  // 4. Dựng Modal Overlay
  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'assignExamModalOverlay';
  modalOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px);
    z-index: 99999; display: flex; justify-content: center; align-items: center;
    font-family: system-ui, -apple-system, sans-serif; padding: 16px; box-sizing: border-box;
  `;

  modalOverlay.innerHTML = `
    <div style="background: #ffffff; width: 100%; max-width: 520px; border-radius: 16px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); border: 1px solid #e2e8f0;">
      
      <!-- HEADER -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
        <h3 style="margin: 0; font-size: 18px; color: #0f172a; display: flex; align-items: center; gap: 8px;">
          📤 Giao Đề Thi
        </h3>
        <button type="button" onclick="document.getElementById('assignExamModalOverlay').remove()" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #64748b;">✕</button>
      </div>

      <!-- TÊN ĐỀ THI -->
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 14px; border-radius: 8px; color: #1e40af; font-weight: 600; font-size: 13px; margin-bottom: 16px;">
        📖 Bài thi: <span style="color: #2563eb;">[${escapeHtml(examTitle || examId)}]</span>
      </div>

      <!-- HÌNH THỨC GIAO ĐỀ -->
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 8px;">Chọn phạm vi giao đề:</label>
        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; cursor: pointer; color: #1e293b;">
            <input type="radio" name="assignTypeRadio" value="CLASS" checked onchange="toggleAssignTypeFields('CLASS')" style="cursor: pointer;">
            Theo Lớp
          </label>
          <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; cursor: pointer; color: #1e293b;">
            <input type="radio" name="assignTypeRadio" value="STUDENT" onchange="toggleAssignTypeFields('STUDENT')" style="cursor: pointer;">
            Theo Sinh Viên cụ thể
          </label>
          <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; cursor: pointer; color: #1e293b;">
            <input type="radio" name="assignTypeRadio" value="ALL" onchange="toggleAssignTypeFields('ALL')" style="cursor: pointer;">
            Tất cả Sinh Viên
          </label>
        </div>
      </div>

      <!-- KHUNG 1: DROPDOWN CHỌN LỚP -->
      <div id="assignClassContainer" style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 6px;">Chọn Lớp học từ danh sách:</label>
        <select id="assignClassSelect" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; background: #ffffff;">
          <option value="">-- Chọn Lớp học --</option>
          ${classList.length === 0 ? '<option value="" disabled>Chưa có dữ liệu Lớp. Hãy tải danh sách SV!</option>' : ''}
          ${classList.map(c => `<option value="${escapeHtml(c)}">🏫 Lớp: ${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>

      <!-- KHUNG 2: DROPDOWN CHỌN SINH VIÊN CỤ THỂ -->
      <div id="assignStudentContainer" style="display: none; margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 6px;">Chọn Sinh viên từ danh sách:</label>
        <select id="assignStudentSelect" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; background: #ffffff;">
          <option value="">-- Chọn Sinh Viên --</option>
          ${students.map(s => {
            const u = s.username || s.user;
            const name = s.fullName || u;
            const cName = s.className || s.class || 'N/A';
            return `<option value="${escapeHtml(u)}">🎓 ${u} - ${escapeHtml(name)} (${escapeHtml(cName)})</option>`;
          }).join('')}
        </select>
      </div>

      <!-- NÚT XÁC NHẬN -->
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;">
        <button type="button" onclick="document.getElementById('assignExamModalOverlay').remove()" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 10px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">
          Hủy bỏ
        </button>
        <button type="button" onclick="handleConfirmAssignExam('${examId}')" style="background: #059669; color: #ffffff; border: none; padding: 10px 22px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 4px rgba(5,150,105,0.2);">
          🚀 Xác nhận Giao đề
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modalOverlay);
};

/**
 * 2. CHUYỂN ĐỔI BẬT/ẨN CÁC Ô NHẬP THEO RADIO BUTTON
 */
window.toggleAssignTypeFields = function(type) {
  const classBox = document.getElementById('assignClassContainer');
  const studentBox = document.getElementById('assignStudentContainer');

  if (classBox) classBox.style.display = type === 'CLASS' ? 'block' : 'none';
  if (studentBox) studentBox.style.display = type === 'STUDENT' ? 'block' : 'none';
};

/**
 * 3. XÁC NHẬN LỆNH GIAO ĐỀ VÀ GỬI LÊN SERVER
 */
window.handleConfirmAssignExam = async function(examId) {
  const selectedType = document.querySelector('input[name="assignTypeRadio"]:checked')?.value || 'CLASS';
  let targetValue = '';
  let targetStudents = [];

  if (selectedType === 'CLASS') {
    const classSel = document.getElementById('assignClassSelect');
    targetValue = classSel ? classSel.value.trim() : '';
    if (!targetValue) {
      alert('⚠️ Vui lòng chọn Lớp cần giao đề!');
      return;
    }
  } else if (selectedType === 'STUDENT') {
    const studentSel = document.getElementById('assignStudentSelect');
    const stUser = studentSel ? studentSel.value.trim() : '';
    if (!stUser) {
      alert('⚠️ Vui lòng chọn Sinh viên cần giao đề!');
      return;
    }
    targetStudents = [stUser];
  }

  const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : 'admin';

  if (typeof showAppLoading === 'function') showAppLoading('⏳ Đang lưu thông tin giao đề...');

  try {
    const res = await appsScriptService.request('ASSIGN_EXAM', {
      examId: examId,
      assignType: selectedType,
      targetValue: targetValue,
      targetStudents: targetStudents,
      assignedBy: username
    });

    if (typeof hideAppLoading === 'function') hideAppLoading();

    alert(res.message || '✅ Đã giao đề thi thành công!');

    // Đóng Modal
    const modal = document.getElementById('assignExamModalOverlay');
    if (modal) modal.remove();

  } catch (err) {
    if (typeof hideAppLoading === 'function') hideAppLoading();
    alert(`Lỗi giao đề thi: ${err.message}`);
  }
};

window.closeAssignModal = function() {
  const modal = document.getElementById('assignExamModal');
  if (modal) modal.style.display = 'none';
};

// Hàm escape HTML an toàn cho chuỗi
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Tự động tải dữ liệu khi khung chứa vừa xuất hiện trên màn hình
setInterval(() => {
  const container = document.getElementById('myExamsListTable') || document.getElementById('myExamsList');
  if (container && container.children.length === 0 && container.innerHTML.trim() === '') {
    handleLoadMyExams();
  }
}, 1500);

/**
 * Trích xuất văn bản từ tệp .docx hoặc .pdf
 */
async function extractTextFromFile(file) {
  let parsed;
  if (file.name.endsWith('.docx')) {
    parsed = await parseDocxFile(file);
  } else if (file.name.endsWith('.pdf')) {
    parsed = await parsePdfFile(file);
  } else {
    throw new Error('Định dạng tệp không được hỗ trợ. Chỉ nhận .docx hoặc .pdf');
  }

  if (!parsed) return '';

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'value' in parsed) {
    parsed = parsed.value;
  }

  if (typeof parsed === 'string') return parsed;

  if (Array.isArray(parsed)) {
    return parsed.map((q, idx) => {
      if (typeof q === 'string') return q;

      const stemRaw = q.raw || q.stem || q.value || '';
      const stemText = typeof stemRaw === 'string' ? stemRaw : (stemRaw?.text || String(stemRaw || ''));

      let optsText = '';
      if (Array.isArray(q.options) && q.options.length > 0) {
        optsText = q.options.map((opt, oIdx) => {
          const optStr = typeof opt === 'string' ? opt : (opt?.text || opt?.content || String(opt || ''));
          const letter = String.fromCharCode(65 + oIdx);
          const cleanOpt = optStr.replace(/^[A-D]\.\s*/i, '').trim();
          return `${letter}. ${cleanOpt}`;
        }).join('\n');
      }

      return `${stemText}\n${optsText}`.trim();
    }).filter(text => text.length > 0).join('\n\n');
  }

  return String(parsed || '');
}

/**
 * Tải danh sách Sinh viên bằng Excel (.xlsx)
 */
window.handleUploadStudentExcel = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (typeof XLSX === 'undefined') {
    alert('⚠️ Chưa nạp thư viện đọc Excel!');
    return;
  }

  if (typeof showAppLoading === 'function') {
    showAppLoading(`📂 Đang đọc file Excel: <strong>${file.name}</strong>...`);
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', raw: false, cellText: true });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // Lấy dạng mảng 2 chiều [[dòng 1], [dòng 2], ...]
      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
      if (!jsonRows || jsonRows.length < 2) {
        throw new Error('File Excel rỗng!');
      }

      const parsedStudents = [];

      // BỎ QUA DÒNG 1 TIÊU ĐỀ (index 0). Bắt đầu đọc dữ liệu từ Dòng 2 (index 1 trở đi)
      for (let i = 1; i < jsonRows.length; i++) {
        const row = jsonRows[i];
        if (!row || row.length === 0) continue;

        // BẤT KỂ TÊN TIÊU ĐỀ LÀ GÌ, LẤY ĐÚNG VỊ TRÍ 4 CỘT ĐẦU TIÊN
        const studentCode = forcePlainText(row[0]);             // Cột A (0)
        const fullName = forcePlainText(row[1]) || studentCode; // Cột B (1)
        const className = forcePlainText(row[2]);            // Cột C (2)
        const password = forcePlainText(row[3]) || '123456'; // Cột D (3)

        if (studentCode && studentCode.toLowerCase() !== 'undefined') {
          parsedStudents.push({
            studentCode: studentCode,
            username: studentCode,
            fullName: fullName,
            className: className,
            password: password
          });
        }
      }

      console.log(`📌 Bóc tách thành công ${parsedStudents.length} sinh viên. Mẫu dòng 1:`, parsedStudents[0]);

      if (parsedStudents.length === 0) {
        throw new Error('Không tìm thấy sinh viên nào có Mã SV!');
      }

      if (typeof showAppLoading === 'function') {
        showAppLoading(`🚀 Đang ghi <strong>${parsedStudents.length} sinh viên</strong> lên Google Sheets...`);
      }

      const res = await appsScriptService.request('SAVE_STUDENT_LIST', { students: parsedStudents });

      if (typeof hideAppLoading === 'function') hideAppLoading();
      alert(res.message || '✅ Đã tải lên danh sách sinh viên thành công!');

      // Tải lại danh sách để cập nhật lên màn hình ngay lập tức
      if (typeof handleLoadStudents === 'function') {
        handleLoadStudents();
      }

    } catch (err) {
      if (typeof hideAppLoading === 'function') hideAppLoading();
      alert(`Lỗi đọc file Excel: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  };

  reader.readAsArrayBuffer(file);
};

function setUploadStatus(text, style) {
  const el = document.getElementById('uploadStatus');
  if (el) {
    el.innerHTML = text;
    el.setAttribute('style', `margin-top: 12px; font-weight: 600; ${style}`);
  }
}

// Biến lưu trữ trạng thái danh sách sinh viên hiện tại
window.currentStudentsList = [];

/**
 * HELPER: CHUYỂN BẤT KỲ DỮ LIỆU NÀO SANG PLAIN TEXT STRING NGUYÊN BẢN (GIỮ SỐ 0 ĐẦU)
 */
function forcePlainText(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.startsWith("'")) str = str.substring(1);
  return str;
}

/**
 * 1. ĐỌC FILE EXCEL TỰ ĐỘNG BỎ LỌC SỐ, LẤY ĐÚNG CHUỖI VĂN BẢN (PLAIN TEXT)
 */
window.handleUploadStudentExcel = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (typeof XLSX === 'undefined') {
    alert('⚠️ Chưa nạp thư viện đọc Excel (SheetJS)!');
    return;
  }

  if (typeof showAppLoading === 'function') {
    showAppLoading(`📂 Đang đọc file Excel: <strong>${file.name}</strong>...`);
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', raw: false, cellText: true });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
      if (!jsonRows || jsonRows.length < 2) {
        throw new Error('File Excel rỗng hoặc không đúng định dạng!');
      }

      // 1. TỰ ĐỘNG QUÉT VỊ TRÍ CỘT DỰA TRÊN DÒNG 1 (HEADER)
      const headerRow = jsonRows[0].map(cell => String(cell || '').trim().toLowerCase());
      
      let userIdx = headerRow.findIndex(h => h.includes('mã') || h.includes('user') || h.includes('sv'));
      let nameIdx = headerRow.findIndex(h => h.includes('họ') || h.includes('tên') || h.includes('name'));
      let classIdx = headerRow.findIndex(h => h.includes('lớp') || h.includes('class'));
      let passIdx = headerRow.findIndex(h => h.includes('mật') || h.includes('pass'));

      // Dự phòng nếu file không có dòng tiêu đề chuẩn
      if (userIdx === -1) userIdx = 0;
      if (nameIdx === -1) nameIdx = 1;
      if (classIdx === -1) classIdx = 2;
      if (passIdx === -1) passIdx = 3;

      console.log(`📌 Phát hiện chỉ số cột Excel -> Mã SV: [${userIdx}], Họ Tên: [${nameIdx}], Lớp: [${classIdx}], Pass: [${passIdx}]`);

      const parsedStudents = [];

      // Đọc dữ liệu từ dòng 2 (index 1)
      for (let i = 1; i < jsonRows.length; i++) {
        const row = jsonRows[i];
        if (!row || row.length === 0) continue;

        const username = forcePlainText(row[userIdx]);
        const fullName = forcePlainText(row[nameIdx]) || username;
        const className = forcePlainText(row[classIdx]);
        const password = forcePlainText(row[passIdx]) || '123456';

        if (username && username.toLowerCase() !== 'undefined') {
          parsedStudents.push({
            username: username,
            fullName: fullName,
            className: className,
            password: password
          });
        }
      }

      if (parsedStudents.length === 0) {
        throw new Error('Không tìm thấy dòng dữ liệu sinh viên nào hợp lệ!');
      }

      // In log dòng đầu tiên ra Console để kiểm tra chính xác trước khi gửi
      console.log('📦 Dữ liệu chuẩn bị gửi sang Sheet Students:', parsedStudents[0]);

      if (typeof showAppLoading === 'function') {
        showAppLoading(`🚀 Đang ghi <strong>${parsedStudents.length} sinh viên</strong> vào sheet 'Students'...`);
      }

      const res = await appsScriptService.request('SAVE_STUDENT_LIST', { students: parsedStudents });

      if (typeof hideAppLoading === 'function') hideAppLoading();
      alert(res.message || '✅ Tải lên danh sách sinh viên thành công!');

      if (typeof handleLoadStudents === 'function') {
        handleLoadStudents();
      }

    } catch (err) {
      if (typeof hideAppLoading === 'function') hideAppLoading();
      alert(`Lỗi đọc file Excel: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  };

  reader.readAsArrayBuffer(file);
};

/**
 * 2. THÊM SINH VIÊN THỦ CÔNG KÈM LỚP (PLAIN TEXT)
 */
window.handlePromptAddStudent = async function() {
  const username = prompt('Nhập Mã Sinh Viên (Username):');
  if (!username) return;

  const fullName = prompt('Nhập Họ và Tên Sinh Viên:', username) || username;
  const className = prompt('Nhập Lớp học:', '') || '';
  const password = prompt('Nhập Mật khẩu tài khoản (Giữ nguyên số 0 đầu nếu có):', '123456') || '123456';

  try {
    const res = await appsScriptService.request('SAVE_STUDENT_LIST', {
      students: [{
        username: forcePlainText(username),
        fullName: forcePlainText(fullName),
        className: forcePlainText(className),
        password: forcePlainText(password)
      }]
    });
    alert(res.message || '✅ Đã thêm sinh viên mới!');
    
    if (typeof handleLoadStudents === 'function') {
      handleLoadStudents();
    }
  } catch (err) {
    alert(`Lỗi thêm sinh viên: ${err.message}`);
  }
};

/**
 * 3. GIAO DIỆN BẢNG QUẢN LÝ SINH VIÊN (HIỂN THỊ CỘT LỚP)
 */
window.renderStudentManagementUI = function(students = []) {
  window.currentStudentsList = students;
  const container = document.getElementById('studentManagementContainer') || document.getElementById('myExamsListTable');
  if (!container) return;

  container.innerHTML = `
    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-top: 20px;">
      
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; font-size: 18px; color: #0f172a;">🎓 Quản Lý Sinh Viên (${students.length})</h3>
        
        <div style="display: flex; gap: 10px;">
          <label style="background: #16a34a; color: white; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;">
            📁 Nhập Danh Sách (Excel)
            <input type="file" accept=".xlsx, .xls, .csv" onchange="handleUploadStudentExcel(event)" style="display: none;">
          </label>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
              <th style="padding: 10px;">Mã SV</th>
              <th style="padding: 10px;">Họ và Tên</th>
              <th style="padding: 10px;">Lớp</th>
              <th style="padding: 10px; text-align: right;">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${students.length === 0 ? `
              <tr><td colspan="4" style="text-align: center; padding: 20px; color: #94a3b8;">Chưa có dữ liệu sinh viên</td></tr>
            ` : students.map((st) => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px; font-weight: 600; font-family: monospace;">${forcePlainText(st.username)}</td>
                <td style="padding: 10px;">${forcePlainText(st.fullName)}</td>
                <td style="padding: 10px; color: #2563eb; font-weight: 600;">${forcePlainText(st.className || '--')}</td>
                <td style="padding: 10px; text-align: right;">
                  <button type="button" onclick="handleDeleteStudentUI('${st.username}')" style="background: #ef4444; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">🗑️ Xóa</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

    </div>
  `;
};

/**
 * 4. XÓA SINH VIÊN
 */
window.handleDeleteStudentUI = async function(username) {
  if (!confirm(`Bạn có chắc chắn muốn xóa sinh viên [${username}]?`)) return;

  try {
    const res = await appsScriptService.request('DELETE_STUDENT', { username });
    alert(res.message || '✅ Đã xóa sinh viên!');

    if (typeof handleLoadStudents === 'function') {
      handleLoadStudents();
    }
  } catch (err) {
    alert(`Lỗi khi xóa sinh viên: ${err.message}`);
  }
};

/**
 * 5. MỞ DIALOG GÁN ĐỀ THI CHO SINH VIÊN DƯỢC CHỌN HOẶC TOÀN BỘ
 */
window.handleOpenAssignExamModal = async function() {
  // Lấy các sinh viên được chọn từ Checkbox
  const checkedBoxes = document.querySelectorAll('.student-select-cb:checked');
  let selectedUsers = Array.from(checkedBoxes).map(cb => cb.value);

  if (selectedUsers.length === 0) {
    if (confirm('Bạn chưa chọn sinh viên cụ thể nào. Bạn có muốn GÁN ĐỀ THI CHO TOÀN BỘ sinh viên trong danh sách không?')) {
      selectedUsers = window.currentStudentsList.map(s => s.username);
    } else {
      return;
    }
  }

  if (selectedUsers.length === 0) {
    alert('⚠️ Danh sách sinh viên rỗng, không thể thực hiện gán đề!');
    return;
  }

  const examId = prompt(`Gán đề thi cho ${selectedUsers.length} sinh viên.\nNhập Mã đề thi (Ví dụ: exam_75ceb91a.json):`);
  if (!examId) return;

  try {
    const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : 'admin';
    
    // Gọi API Assign Exam
    const res = await appsScriptService.request('ASSIGN_EXAM', {
      examId: examId.trim(),
      targetStudents: selectedUsers,
      assignedBy: username
    });

    alert(res.message || `✅ Đã gán thành công đề thi [${examId}] cho ${selectedUsers.length} sinh viên!`);
  } catch (err) {
    alert(`Lỗi gán đề thi: ${err.message}`);
  }
};

/**
 * HELPER: CHỌN / BỎ CHỌN TẤT CẢ CHECKBOX SINH VIÊN
 */
window.toggleSelectAllStudents = function(masterCb) {
  const cbs = document.querySelectorAll('.student-select-cb');
  cbs.forEach(cb => cb.checked = masterCb.checked);
};

/**
 * TẢI VÀ HIỂN THỊ DANH SÁCH SINH VIÊN TỪ SERVER
 */
window.handleLoadStudents = async function() {
  const container = document.getElementById('studentManagementContainer');
  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #2563eb; font-weight: 600;">
        ⏳ Đang tải danh sách sinh viên từ hệ thống...
      </div>
    `;
  }

  try {
    // Gọi API lấy danh sách Sinh viên từ Apps Script (Role = STUDENT)
    const res = await appsScriptService.request('GET_STUDENTS', {});
    
    const students = res.students || res.data || [];
    console.log(`✅ Đã tải ${students.length} sinh viên từ máy chủ.`, students);

    // Hiển thị giao diện bảng quản lý sinh viên
    renderStudentManagementUI(students);

  } catch (err) {
    console.error('❌ Lỗi tải danh sách sinh viên:', err);
    if (container) {
      container.innerHTML = `
        <div style="padding: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #dc2626; font-size: 14px;">
          ❌ Lỗi nạp danh sách sinh viên: ${err.message}. Vui lòng thử lại!
        </div>
      `;
    }
  }
};

// Tự động gọi tải danh sách sinh viên khi trang web được nạp xong (nếu ở giao diện Giảng viên)
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (document.getElementById('studentManagementContainer')) {
      handleLoadStudents();
    }
  }, 500);
});

/**
 * TIỆN ÍCH: HIỂN THỊ / ẨN MÀN HÌNH LOADING TOÀN CỤC (PROGRESS OVERLAY)
 */
window.showAppLoading = function(message = 'Đang xử lý dữ liệu...') {
  let overlay = document.getElementById('globalAppLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'globalAppLoadingOverlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(4px);
      z-index: 99999; display: flex; flex-direction: column;
      justify-content: center; align-items: center; color: #ffffff;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background: #1e293b; border: 1px solid #334155; padding: 28px 36px; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); text-align: center; max-width: 400px; width: 90%;">
        <div class="loading-spinner" style="width: 44px; height: 44px; border: 4px solid #38bdf8; border-top-color: transparent; border-radius: 50%; margin: 0 auto 16px auto; animation: spin 0.8s linear infinite;"></div>
        <div id="loadingOverlayMsg" style="font-weight: 600; font-size: 15px; color: #f8fafc; line-height: 1.5;">${message}</div>
      </div>
      <style>
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(overlay);
  } else {
    const msgEl = document.getElementById('loadingOverlayMsg');
    if (msgEl) msgEl.innerHTML = message;
    overlay.style.display = 'flex';
  }
};

window.hideAppLoading = function() {
  const overlay = document.getElementById('globalAppLoadingOverlay');
  if (overlay) overlay.style.display = 'none';
};

/**
 * ĐỌC FILE EXCEL & TẢI LÊN (CÓ THANH LOADING CHỐNG NGHẼN MẠNG)
 */
window.handleUploadStudentExcel = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (typeof XLSX === 'undefined') {
    alert('⚠️ Chưa nạp thư viện đọc file Excel (SheetJS). Vui lòng kiểm tra lại index.html!');
    return;
  }

  showAppLoading(`📂 Đang đọc dữ liệu từ file Excel: <strong>${file.name}</strong>...`);

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (jsonRows.length < 2) {
        throw new Error('File Excel rỗng hoặc không có cột dữ liệu!');
      }

      const parsedStudents = [];
      for (let i = 1; i < jsonRows.length; i++) {
        const row = jsonRows[i];
        if (!row || row.length === 0) continue;

        const username = String(row[0] || '').trim();
        const fullName = String(row[1] || username).trim();
        const password = String(row[2] || '123456').trim();

        if (username && username.toLowerCase() !== 'undefined') {
          parsedStudents.push({ username, fullName, password });
        }
      }

      if (parsedStudents.length === 0) {
        throw new Error('Không tìm thấy dòng dữ liệu sinh viên hợp lệ trong file Excel!');
      }

      // Cập nhật thông báo tiến độ trên màn hình Loading
      showAppLoading(`🚀 Đang đồng bộ <strong>${parsedStudents.length} sinh viên</strong> vào hệ thống...<br><span style="font-size:12px; color:#94a3b8; margin-top:6px; display:block;">Xử lý siêu tốc hàng loạt (Bulk API)...</span>`);

      // Gửi danh sách lên Google Apps Script
      const res = await appsScriptService.request('SAVE_STUDENT_LIST', { students: parsedStudents });

      hideAppLoading();
      alert(res.message || '✅ Đã tải lên danh sách sinh viên thành công!');

      // Tải lại danh sách ngay lập tức
      if (typeof handleLoadStudents === 'function') {
        handleLoadStudents();
      }

    } catch (err) {
      hideAppLoading();
      console.error('❌ Lỗi đọc file Excel:', err);
      alert(`Lỗi xử lý file Excel: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  };

  reader.onerror = function() {
    hideAppLoading();
    alert('Không thể đọc file Excel. Vui lòng thử lại!');
  };

  reader.readAsArrayBuffer(file);
};

// =========================================================================
// 1. QUẢN LÝ BỘ NHỚ TẠM (LOCALSTORAGE DRAFT) - CHỐNG MẤT MẠNG / F5
// =========================================================================
window.ExamDraftManager = {
  getDraftKey(username, examId) {
    return `exam_draft_${String(username).trim()}_${String(examId).trim()}`;
  },

  // Lưu tiến trình làm bài dở
  saveDraft(username, examId, userAnswers, remainingSeconds) {
    if (!username || !examId) return;
    const key = this.getDraftKey(username, examId);
    const draftData = {
      answers: userAnswers,
      remainingSeconds: remainingSeconds,
      updatedAt: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(draftData));
  },

  // Lấy bài làm dở
  getDraft(username, examId) {
    if (!username || !examId) return null;
    const key = this.getDraftKey(username, examId);
    const item = localStorage.getItem(key);
    if (!item) return null;
    try {
      return JSON.parse(item);
    } catch (e) {
      return null;
    }
  },

  // Xóa bài dở sau khi đã nộp bài thành công
  clearDraft(username, examId) {
    if (!username || !examId) return;
    const key = this.getDraftKey(username, examId);
    localStorage.removeItem(key);
  }
};

// =========================================================================
// 2. BẢNG ĐIỀU KHIỂN SINH VIÊN (CÓ NÚT "XEM LẠI BÀI LÀM")
// =========================================================================
window.renderStudentDashboard = function(exams = []) {
  const container = document.getElementById('studentExamContainer') || document.getElementById('appMainContent');
  if (!container) return;

  let html = `
    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
        <h2 style="margin: 0; font-size: 20px; color: #0f172a; display: flex; align-items: center; gap: 8px;">
          📝 Danh Sách Bài Thi Được Gán (${exams.length})
        </h2>
        <button type="button" onclick="handleLoadStudentDashboard()" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;">
          🔄 Tải lại
        </button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;">
  `;

  if (exams.length === 0) {
    html += `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #94a3b8; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
        🎓 Hiện tại bạn chưa có bài thi nào được gán.
      </div>
    `;
  } else {
    const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : '';

    exams.forEach(ex => {
      const hasScore = ex.score !== null && ex.score !== undefined && ex.score !== '';
      const isCompleted = ex.isCompleted || hasScore;
      const displayScore = hasScore ? `${ex.score} / 10` : '--';

      // Kiểm tra xem bài này có bản lưu dở không
      const draft = ExamDraftManager.getDraft(username, ex.examId);
      const hasDraft = !isCompleted && draft && Object.keys(draft.answers || {}).length > 0;

      html += `
        <div style="border: 1px solid ${isCompleted ? '#bbf7d0' : (hasDraft ? '#fde68a' : '#e2e8f0')}; background: ${isCompleted ? '#f0fdf4' : '#ffffff'}; border-radius: 10px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between;">
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            ${isCompleted ? `
              <span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700;">
                ✅ Đã hoàn thành
              </span>
            ` : (hasDraft ? `
              <span style="background: #fef3c7; color: #b45309; border: 1px solid #fcd34d; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700;">
                ⚠️ Đang làm dở (Cần làm tiếp)
              </span>
            ` : `
              <span style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700;">
                ⏳ Chưa làm bài
              </span>
            `)}
            <span style="font-size: 12px; color: #64748b; font-weight: 600;">⏱️ ${ex.durationMinutes} phút</span>
          </div>

          <div style="margin-bottom: 16px;">
            <h3 style="margin: 0 0 6px 0; font-size: 16px; color: #0f172a;">${escapeHtml(ex.title)}</h3>
            <p style="margin: 0; font-size: 12px; color: #64748b; font-family: monospace;">Mã đề: ${ex.examCode || ex.examId}</p>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 12px; margin-top: auto;">
            <div>
              <span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; display: block;">Điểm số</span>
              <strong style="font-size: 18px; color: ${hasScore ? '#15803d' : '#94a3b8'};">${displayScore}</strong>
            </div>

            <div>
              ${isCompleted ? `
                <!-- NÚT XEM LẠI BÀI LÀM -->
                <button type="button" onclick="handleReviewSubmittedExam('${ex.examId}', '${ex.examCode}')" style="background: #0d9488; color: #ffffff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; box-shadow: 0 2px 4px rgba(13,148,136,0.2);">
                  👁️ Xem lại bài làm
                </button>
              ` : `
                <!-- NÚT LÀM BÀI HOẶC LÀM TIẾP BÀI DỞ -->
                <button type="button" onclick="handleStartTakeExam('${ex.examId}', '${ex.examCode}')" style="background: ${hasDraft ? '#d97706' : '#2563eb'}; color: #ffffff; border: none; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;">
                  ${hasDraft ? '🔄 Làm tiếp bài dở' : '✍️ Làm bài'}
                </button>
              `}
            </div>
          </div>

        </div>
      `;
    });
  }

  html += `</div></div>`;
  container.innerHTML = html;
};

// =========================================================================
// 3. LOGIC LÀM BÀI THI & TỰ ĐỘNG KHÔI PHỤC BÀI DỞ KHI MẤT MẠNG / REFRESH
// =========================================================================
window.handleStartTakeExam = async function(examId, examCode = '') {
  const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : '';
  
  if (typeof showAppLoading === 'function') showAppLoading('⏳ Đang tải nội dung đề thi...');

  try {
    // 1. Tải đề thi từ GitHub CDN
    let rawName = String(examCode || examId).trim();
    if (rawName.includes('-')) rawName = rawName.split('-')[0];
    if (!rawName.endsWith('.json')) rawName = `${rawName}.json`;

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/${filePath}?v=${Date.now()}`;
    
    const res = await fetch(cdnUrl);
    if (!res.ok) throw new Error('Không thể tải bài thi từ hệ thống.');
    const examData = await res.json();
    const questions = examData.questions || examData;

    if (typeof hideAppLoading === 'function') hideAppLoading();

    // 2. Kiểm tra bản lưu dở từ LocalStorage
    const draft = ExamDraftManager.getDraft(username, examId);
    let initialAnswers = {};
    let initialTimeSeconds = (examData.durationMinutes || 45) * 60;

    if (draft) {
      const confirmResume = confirm('Hệ thống phát hiện bạn có bài làm dở chưa nộp. Bạn có muốn tiếp tục bài làm này không?');
      if (confirmResume) {
        initialAnswers = draft.answers || {};
        if (draft.remainingSeconds && draft.remainingSeconds > 0) {
          initialTimeSeconds = draft.remainingSeconds;
        }
      } else {
        ExamDraftManager.clearDraft(username, examId);
      }
    }

    // 3. Khởi chạy giao diện làm bài thi cho SV
    renderTakeExamScreen(examId, rawName, questions, initialAnswers, initialTimeSeconds);

  } catch (err) {
    if (typeof hideAppLoading === 'function') hideAppLoading();
    alert(`Lỗi khi mở bài thi: ${err.message}`);
  }
};

/**
 * RENDER MÀN HÌNH LÀM BÀI KÈM CƠ CHẾ AUTO-SAVE DRAFT BẤT CỨ KHI NÀO CHỌN ĐÁP ÁN
 */
function renderTakeExamScreen(examId, fileName, questions, savedAnswers = {}, totalSeconds = 2700) {
  const container = document.getElementById('studentExamContainer') || document.getElementById('appMainContent');
  if (!container) return;

  const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : '';
  let currentAnswers = { ...savedAnswers };
  let remainingSeconds = totalSeconds;

  // Render HTML bài thi
  let html = `
    <div style="background: #ffffff; border-radius: 12px; padding: 20px; border: 1px solid #cbd5e1;">
      <!-- TIMER BAR -->
      <div style="position: sticky; top: 10px; z-index: 100; background: #0f172a; color: white; padding: 12px 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <span style="font-weight: 600; font-size: 15px;">📝 ${escapeHtml(fileName)}</span>
        <div style="font-size: 18px; font-weight: 700; color: #38bdf8;" id="examTimerDisplay">⏱️ 00:00</div>
      </div>

      <!-- QUESTIONS LIST -->
      <div id="takeExamQuestionsList">
        ${questions.map((q, idx) => {
          const selectedAns = currentAnswers[idx + 1] || '';
          const options = q.options || [];

          return `
            <div class="take-q-card" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <strong style="color: #0f172a; font-size: 15px;">Câu ${idx + 1}:</strong>${escapeHtml(q.stem || q.text || '')}
              
              <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
                ${options.map((opt, oIdx) => {
                  const letter = String.fromCharCode(65 + oIdx);
                  const isChecked = selectedAns === letter;

                  return `
                    <label style="display: flex; align-items: center; gap: 10px; background: #ffffff; padding: 10px; border-radius: 6px; border: 1px solid ${isChecked ? '#2563eb' : '#e2e8f0'}; cursor: pointer;">
                      <input type="radio" name="take_ans_${idx}" value="${letter}" ${isChecked ? 'checked' : ''} onchange="handleStudentSelectOption('${examId}', ${idx + 1}, '${letter}')" style="width: 18px; height: 18px;">
                      <strong>${letter}.</strong> ${escapeHtml(String(opt).replace(/^[A-D][.:)]\s*/i, ''))}
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div style="text-align: right; margin-top: 20px;">
        <button type="button" onclick="handleConfirmSubmitExam('${examId}', ${questions.length})" style="background: #16a34a; color: white; border: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 4px rgba(22,163,74,0.2);">
          🚀 Nộp bài thi
        </button>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Lắng nghe sự kiện chọn đáp án để AUTO-SAVE DRAFT ngay lập tức
  window.handleStudentSelectOption = function(eId, qNum, letter) {
    currentAnswers[qNum] = letter;
    // Tự động lưu dở ngay vào LocalStorage
    ExamDraftManager.saveDraft(username, eId, currentAnswers, remainingSeconds);
  };

  // Đồng hồ đếm ngược
  const timerEl = document.getElementById('examTimerDisplay');
  const timerInterval = setInterval(() => {
    remainingSeconds--;
    
    // Lưu thời gian làm dở mỗi 5 giây
    if (remainingSeconds % 5 === 0) {
      ExamDraftManager.saveDraft(username, examId, currentAnswers, remainingSeconds);
    }

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      alert('⏰ Đã hết thời gian làm bài! Hệ thống sẽ tự động nộp bài.');
      executeSubmitExam(examId, questions, currentAnswers);
      return;
    }

    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    if (timerEl) {
      timerEl.innerText = `⏱️ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }, 1000);

  window.activeExamTimer = timerInterval;
}

// XÁC NHẬN VÀ NỘP BÀI THI
window.handleConfirmSubmitExam = async function(examId, totalQuestions) {
  if (confirm(`Bạn có chắc chắn muốn NỘP BÀI THI ngay bây giờ?`)) {
    if (window.activeExamTimer) clearInterval(window.activeExamTimer);
    
    // Thu thập toàn bộ đáp án đã chọn
    const username = getLoggedInUsername();
    const draft = ExamDraftManager.getDraft(username, examId);
    const answers = draft ? draft.answers : {};

    executeSubmitExam(examId, window.examModel?.questions || [], answers);
  }
};

// THỰC THI NỘP BÀI VÀ TÍNH ĐIỂM DYNAMIC
async function executeSubmitExam(examId, questions, answers) {
  if (typeof showAppLoading === 'function') showAppLoading('⏳ Đang tính điểm và gửi bài làm...');

  try {
    const username = getLoggedInUsername();
    let correctCount = 0;

    questions.forEach((q, idx) => {
      const qNum = idx + 1;
      const userAns = String(answers[qNum] || '').trim().toUpperCase();
      const keyAns = String(q.answerKey || q.answer || '').trim().toUpperCase();

      if (userAns && userAns === keyAns) {
        correctCount++;
      }
    });

    // Thang điểm 10
    const totalQ = questions.length || 1;
    const finalScore = Math.round((correctCount / totalQ) * 10 * 10) / 10; // Làm tròn 1 chữ số thập phân

    // Gửi kết quả lên Google Sheets (Submissions Tab)
    const res = await appsScriptService.request('SUBMIT_EXAM', {
      examId: examId,
      username: username,
      score: finalScore,
      answers: answers
    });

    // Xóa bài dở trong LocalStorage vì đã nộp thành công
    ExamDraftManager.clearDraft(username, examId);

    if (typeof hideAppLoading === 'function') hideAppLoading();

    alert(`🎉 Bạn đã nộp bài thành công!\nĐiểm số của bạn: ${finalScore} / 10 (Đúng ${correctCount}/${totalQ} câu)`);

    // Tải lại Bảng điều khiển Sinh viên
    if (typeof handleLoadStudentDashboard === 'function') {
      handleLoadStudentDashboard();
    }

  } catch (err) {
    if (typeof hideAppLoading === 'function') hideAppLoading();
    alert(`Lỗi khi nộp bài: ${err.message}`);
  }
}

// =========================================================================
// 4. CHỨC NĂNG "XEM LẠI BÀI LÀM" (REVIEW SUBMITTED EXAM)
// =========================================================================
window.handleReviewSubmittedExam = async function(examId, examCode = '') {
  const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : '';

  if (typeof showAppLoading === 'function') showAppLoading('🔍 Đang tải bài làm đã nộp...');

  try {
    // 1. Tải đề gốc từ GitHub CDN
    let rawName = String(examCode || examId).trim();
    if (rawName.includes('-')) rawName = rawName.split('-')[0];
    if (!rawName.endsWith('.json')) rawName = `${rawName}.json`;

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/${filePath}?v=${Date.now()}`;
    
    const resExam = await fetch(cdnUrl);
    if (!resExam.ok) throw new Error('Không tìm thấy đề thi gốc.');
    const examData = await resExam.json();
    const questions = examData.questions || examData;

    // 2. Lấy đáp án đã nộp từ Server
    const resSub = await appsScriptService.request('GET_SUBMISSION_DETAIL', { examId, username });
    if (typeof hideAppLoading === 'function') hideAppLoading();

    if (resSub.status !== 'success') {
      throw new Error(resSub.message || 'Không thể lấy bài làm đã nộp.');
    }

    const studentAnswers = resSub.answers || {};
    const score = resSub.score;
    const submittedAt = resSub.submittedAt;

    // 3. Render giao diện Xem lại bài
    renderExamReviewUI(rawName, questions, studentAnswers, score, submittedAt);

  } catch (err) {
    if (typeof hideAppLoading === 'function') hideAppLoading();
    alert(`Không thể xem lại bài làm: ${err.message}`);
  }
};

/**
 * GIAO DIỆN XEM LẠI BÀI LÀM (TÔ MÀU ĐÁP ÁN ĐÚNG/SAI CỦA SINH VIÊN)
 */
function renderExamReviewUI(fileName, questions, studentAnswers, score, submittedAt) {
  const container = document.getElementById('studentExamContainer') || document.getElementById('appMainContent');
  if (!container) return;

  let html = `
    <div style="background: #ffffff; border-radius: 12px; padding: 20px; border: 1px solid #cbd5e1;">
      
      <!-- HEADER BÀI LÀM -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div>
          <h2 style="margin: 0 0 6px 0; font-size: 18px; color: #0f172a;">👁️ Xem lại Bài làm: [${escapeHtml(fileName)}]</h2>
          <span style="font-size: 13px; color: #64748b;">Thời gian nộp: ${submittedAt || '--'}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
          <div style="text-align: right;">
            <span style="font-size: 12px; color: #64748b; font-weight: 600; display: block;">Điểm số đạt được</span>
            <strong style="font-size: 22px; color: #15803d;">${score} / 10</strong>
          </div>
          <button type="button" onclick="handleLoadStudentDashboard()" style="background: #2563eb; color: white; border: none; padding: 8px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">
            ↩️ Quay lại
          </button>
        </div>
      </div>

      <!-- DANH SÁCH CÂU HỎI & ĐÁP ÁN -->
      <div>
        ${questions.map((q, idx) => {
          const qNum = idx + 1;
          const userAns = String(studentAnswers[qNum] || '').trim().toUpperCase();
          const keyAns = String(q.answerKey || q.answer || '').trim().toUpperCase();
          const isCorrect = userAns && userAns === keyAns;

          return `
            <div style="background: #ffffff; border: 2px solid ${isCorrect ? '#86efac' : (userAns ? '#fca5a5' : '#cbd5e1')}; border-radius: 10px; padding: 16px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <strong style="font-size: 15px; color: #0f172a;">Câu ${qNum}:</strong>${isCorrect ? `
                  <span style="background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 700;">
                    ✅ Đúng (+${Math.round((10 / questions.length) * 10) / 10} đ)
                  </span>
                ` : `
                  <span style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 700;">
                    ${userAns ? '❌ Sai' : '⚠️ Bỏ trống'}
                  </span>
                `}
              </div>

              <div style="font-size: 14px; color: #1e293b; margin-bottom: 12px;">${escapeHtml(q.stem || q.text || '')}</div>

              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${(q.options || []).map((opt, oIdx) => {
                  const letter = String.fromCharCode(65 + oIdx);
                  const isStudentChoice = userAns === letter;
                  const isKey = keyAns === letter;

                  let optionBg = '#f8fafc';
                  let optionBorder = '#e2e8f0';
                  let badgeText = '';

                  if (isKey) {
                    optionBg = '#dcfce7';
                    optionBorder = '#86efac';
                    badgeText = ' (Đáp án đúng)';
                  }
                  if (isStudentChoice && !isKey) {
                    optionBg = '#fee2e2';
                    optionBorder = '#fca5a5';
                    badgeText = ' (Lựa chọn của bạn)';
                  } else if (isStudentChoice && isKey) {
                    badgeText = ' (Lựa chọn đúng của bạn)';
                  }

                  return `
                    <div style="background: ${optionBg}; border: 1px solid ${optionBorder}; padding: 10px 14px; border-radius: 6px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
                      <span><strong>${letter}.</strong> ${escapeHtml(String(opt).replace(/^[A-D][.:)]\s*/i, ''))}</span>
                      <strong style="font-size: 12px; color: ${isKey ? '#15803d' : '#dc2626'};">${badgeText}</strong>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>

    </div>
  `;

  container.innerHTML = html;
}

/**
 * TỰ ĐỘNG ĐIỀU HƯỚNG GIAO DIỆN THEO VAI TRÒ (ROLE-BASED ROUTING)
 */
window.checkAndRouteUserView = function() {
  const userRole = (localStorage.getItem('userRole') || sessionStorage.getItem('userRole') || '').toUpperCase();
  const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : '';

  if (!username) {
    // Chưa đăng nhập -> Hiện Form Đăng nhập
    showSection('loginSection');
    return;
  }

  // 1. Nếu là Sinh viên -> Tự động nạp Bảng điều khiển Sinh viên
  if (userRole === 'STUDENT') {
    console.log(`🎓 Tự động chuyển hướng sang Giao diện Sinh viên [${username}]`);
    
    // Ẩn các phần của Giảng viên / Admin
    hideSection('lecturerDashboardSection');
    hideSection('adminSection');
    
    // Hiển thị phần bài thi Sinh viên
    showSection('studentExamContainer');
    
    if (typeof handleLoadStudentDashboard === 'function') {
      handleLoadStudentDashboard();
    }
  } 
  // 2. Nếu là Giảng viên / Admin -> Tự động nạp Bảng điều khiển Giảng viên
  else if (userRole === 'LECTURER' || userRole === 'ADMIN') {
    console.log(`👨‍🏫 Tự động chuyển hướng sang Giao diện Giảng viên [${username}]`);
    
    hideSection('studentExamContainer');
    showSection('lecturerDashboardSection');
    
    if (typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }
  }
};

/**
 * 1. BẬT / TẮT HIỂN THỊ MẬT KHẨU (TOGGLE PASSWORD VISIBILITY)
 */
window.togglePasswordVisibility = function() {
  const passInput = document.getElementById('loginPassword');
  const eyeBtn = document.getElementById('togglePasswordBtn');
  if (!passInput) return;

  if (passInput.type === 'password') {
    passInput.type = 'text';
    if (eyeBtn) eyeBtn.innerText = '🙈'; // Chuyển biểu tượng thành ẩn
  } else {
    passInput.type = 'password';
    if (eyeBtn) eyeBtn.innerText = '👁️'; // Chuyển biểu tượng thành hiện
  }
};

/**
 * 2. KÍCH HOẠT SỰ KIỆN PHÍM ENTER CHO FORM ĐĂNG NHẬP
 */
document.addEventListener('DOMContentLoaded', () => {
  const attachEnterEvent = () => {
    const userEl = document.getElementById('loginUsername') || document.getElementById('usernameInput');
    const passEl = document.getElementById('loginPassword') || document.getElementById('passwordInput');

    const triggerLogin = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        
        // Gọi hàm xử lý đăng nhập khả dụng
        if (typeof handleLogin === 'function') {
          handleLogin();
        } else if (typeof handleAuthLecturer === 'function') {
          handleAuthLecturer();
        } else {
          const loginBtn = document.getElementById('loginBtn') || document.querySelector('button[onclick*="Login"]');
          if (loginBtn) loginBtn.click();
        }
      }
    };

    if (userEl) userEl.addEventListener('keyup', triggerLogin);
    if (passEl) passEl.addEventListener('keyup', triggerLogin);
  };

  // Thử gán sự kiện lập tức và sau khi DOM ổn định
  attachEnterEvent();
  setTimeout(attachEnterEvent, 500);
});
