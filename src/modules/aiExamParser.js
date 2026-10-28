import { appsScriptService } from '../services/appsScriptService.js';
import { parseDocxFile } from '../parsers/docxParser.js';
import { parsePdfFile } from '../parsers/pdfParser.js';
import { renderKaTeX } from '../utils/domHelper.js';
import { examModel } from '../models/examModel.js';
import { currentUser, getLoggedInUsername, showAppLoading, hideAppLoading, escapeHtml } from './authAndCore.js';

// =========================================================================
// 1. BIẾN TRẠNG THÁI AI & CHỈNH SỬA
// =========================================================================
export let currentExamState = null;
let aiTimerInterval = null;
let aiSecondsElapsed = 0;
window.rawFetchedExams = [];
window.currentEditingExamContext = null;

// =========================================================================
// 2. CẤU HÌNH API KEY CÁ NHÂN & TIỆN ÍCH TRÍCH XUẤT ẢNH (CANVAS CROP)
// =========================================================================
export async function saveUserApiKey() {
  const input = document.getElementById('userGeminiApiKey');
  if (!input) return;

  const apiKey = input.value.trim();
  if (!apiKey) {
    alert('Vui lòng dán Gemini API Key của bạn (bắt đầu bằng AIzaSy...).');
    return;
  }

  localStorage.setItem('userGeminiApiKey', apiKey);
  localStorage.setItem('custom_gemini_api_key', apiKey);

  const badge = document.getElementById('aiQuotaBadge');
  if (badge) {
    badge.style.background = '#dcfce7';
    badge.style.color = '#15803d';
    badge.innerHTML = '🔑 API Key cá nhân: Đang kích hoạt (Không giới hạn)';
  }

  const username = getLoggedInUsername() || 'admin';

  try {
    const res = await appsScriptService.saveUserApiKey(username, apiKey);
    alert(res.message || 'Đã lưu API Key cá nhân thành công!');
  } catch (err) {
    alert(`Đã lưu Key tại trình duyệt! (${err.message})`);
  }
}

export function updateAIQuotaBadge(serverUsageCount = null) {
  const badge = document.getElementById('aiQuotaBadge');
  const userKey = localStorage.getItem('custom_gemini_api_key');

  if (!badge) return;

  if (userKey) {
    badge.style.background = '#d1fae5';
    badge.style.color = '#047857';
    badge.textContent = '🔑 Key cá nhân: Đang kích hoạt';
  } else if (serverUsageCount !== null) {
    if (serverUsageCount >= 1) {
      badge.style.background = '#fee2e2';
      badge.style.color = '#b91c1c';
      badge.textContent = '⚠️ AI Hệ thống: 0/1 lượt';
    } else {
      badge.style.background = '#dbeafe';
      badge.style.color = '#1d4ed8';
      badge.textContent = '🎁 AI Hệ thống: 1/1 lượt miễn phí';
    }
  }
}

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
  ctx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
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

async function extractTextFromFile(file) {
  let parsed = file.name.endsWith('.docx') ? await parseDocxFile(file) : await parsePdfFile(file);
  return typeof parsed === 'string' ? parsed : String(parsed?.value || parsed || '');
}

// =========================================================================
// 3. TIẾN TRÌNH AI PHÂN TÍCH & BÓC TÁCH ĐỀ THI
// =========================================================================
export function startAILoading() {
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

export function stopAILoading(isSuccess = true) {
  clearInterval(aiTimerInterval);
  const loadingContainer = document.getElementById('aiLoadingContainer');
  const progressBar = document.getElementById('aiProgressBar');

  if (isSuccess && progressBar) progressBar.style.width = '100%';
  setTimeout(() => {
    if (loadingContainer) loadingContainer.style.display = 'none';
  }, 800);
}

export function setUploadStatus(text, style) {
  const el = document.getElementById('uploadStatus');
  if (el) {
    el.innerHTML = text;
    el.setAttribute('style', `margin-top: 8px; font-size: 13px; font-weight: 600; ${style}`);
  }
}

export async function handleProcessExamWithAI() {
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
    return alert('Vui lòng chọn tệp (.docx, .pdf) hoặc dán văn bản đề thi!');
  }

  startAILoading();

  try {
    const customApiKey = localStorage.getItem('userGeminiApiKey') || localStorage.getItem('custom_gemini_api_key') || '';
    const username = currentUser ? currentUser.username : '';

    const response = await appsScriptService.parseExamAI(
      rawText, imageBase64, mimeType, 'gemini-2.0-flash', parsedQuestionsFromDocx, customApiKey, username
    );

    const resData = response.data || response;
    const questionsRaw = resData.questions || (Array.isArray(resData) ? resData : null);

    if (!questionsRaw || !Array.isArray(questionsRaw)) {
      throw new Error('Dữ liệu câu hỏi trả về từ Server không hợp lệ.');
    }

    let questions = questionsRaw;

    if (sourceCanvas) {
      questions = questions.map(q => {
        if (q.hasImage && q.imageBox && typeof cropImageFromBox === 'function') {
          q.imageUrl = cropImageFromBox(sourceCanvas, q.imageBox);
        }
        return q;
      });
    }

    currentExamState = examModel.createStandardExam({ title: 'Đề thi phân tích AI' }, questions);
    stopAILoading(true);

    const isFallback = Boolean(resData.isFallback || response.isFallback);
    setUploadStatus(
      isFallback ? '⚠️ Đã bóc tách bằng Code thuần.' : `✅ Đã hoàn tất phân tích ${questions.length} câu hỏi!`,
      isFallback ? 'color: #d97706' : 'color: #10b981'
    );
    renderQuestionListForReview(currentExamState.questions);

  } catch (err) {
    stopAILoading(false);
    setUploadStatus(`❌ Lỗi xử lý: ${err.message}`, 'color: #ef4444');
  }
}

export function renderQuestionListForReview(questions = []) {
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

    const hasEmptyOption = q.options.some(opt => !String(opt || '').trim());
    const isWarning = Boolean(q.flags?.needsUserConfirmation) || hasEmptyOption;
    if (isWarning) needReviewCount++;

    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `review-card-${q.id || `q_${idx + 1}`}`;

    let optionsHtml = '';
    q.options.forEach((opt, oIdx) => {
      const optLetter = String.fromCharCode(65 + oIdx);
      const isCorrect = Number(q.correctAnswer) === oIdx;
      const optText = typeof opt === 'string' ? opt : (opt?.text || String(opt || ''));

      optionsHtml += `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
          <input type="radio" name="correct_opt_${q.id || idx}" value="${oIdx}" ${isCorrect ? 'checked' : ''} onchange="window.updateCorrectAnswer('${q.id}', ${oIdx})">
          <label style="font-weight: bold;">${optLetter}.</label>
          <input type="text" value="${escapeHtml(optText)}" onchange="window.updateOptionText('${q.id}', ${oIdx}, this.value)">
        </div>
      `;
    });

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <strong style="font-size: 14px;">Câu ${idx + 1}:</strong>
        <span style="font-size:12px; color:${isWarning ? '#d97706' : '#059669'}; font-weight:600;">
          ${isWarning ? '⚠️ Cần kiểm tra' : '✓ Hoàn thiện'}
        </span>
      </div>
      <textarea rows="2" onchange="window.updateQuestionStem('${q.id}', this.value)">${escapeHtml(q.stem || '')}</textarea>
      <div>${optionsHtml}</div>
    `;

    container.appendChild(card);
  });

  if (summaryText) {
    summaryText.innerHTML = `Tổng số <strong>${questions.length}</strong> câu hỏi (${needReviewCount} câu cần duyệt).`;
  }
  renderKaTeX(container);
}

export function updateQuestionStem(qId, val) {
  if (currentExamState) {
    const q = currentExamState.questions.find(item => item.id === qId);
    if (q) q.stem = val;
  }
}

export function updateOptionText(qId, optIdx, val) {
  if (currentExamState) {
    const q = currentExamState.questions.find(item => item.id === qId);
    if (q && q.options) q.options[optIdx] = val;
  }
}

export function updateCorrectAnswer(qId, selectedIdx) {
  if (currentExamState) {
    const q = currentExamState.questions.find(item => String(item.id) === String(qId));
    if (q) q.correctAnswer = selectedIdx;
  }
}

// =========================================================================
// 4. XUẤT BẢN ĐỀ THI MỚI (PUBLISH EXAM)
// =========================================================================
export async function handlePublishExam() {
  if (!currentExamState || !currentExamState.questions || currentExamState.questions.length === 0) {
    return alert('Chưa có dữ liệu đề thi để xuất bản!');
  }

  const examTitleInput = document.getElementById('examTitleInput');
  const examTitle = examTitleInput?.value.trim();
  const durationMinutes = parseInt(document.getElementById('examDurationInput')?.value || '45', 10);
  const maxViolations = parseInt(document.getElementById('examMaxViolationsInput')?.value || '3', 10);

  if (!examTitle) return alert('Vui lòng nhập Tên đề thi!');

  try {
    setUploadStatus('⏳ Đang tạo đề thi và lưu lên kho dữ liệu...', 'color: #2563eb');

    // Ưu tiên lấy Mã Giảng viên thực tế đang đăng nhập
    const lecturerId = getLoggedInUsername() || currentUser?.username || 'admin';
    console.log("🔍 [FE_LOG] handlePublishExam - ID Giảng viên tạo đề:", lecturerId);

    currentExamState.title = examTitle;
    currentExamState.durationMinutes = durationMinutes;
    currentExamState.maxViolations = maxViolations;
    currentExamState.createdBy = lecturerId;

    const { studentExam, masterKey } = examModel.splitExamForPublishing(currentExamState);
    const rawId = String(studentExam.examId || `exam_${Date.now()}`);
    const cleanExamCode = rawId.replace(/^exam_/, '');
    const fileNameOnGithub = `exams/exam_${cleanExamCode.slice(0, 8)}.json`;

    await appsScriptService.saveAndPublishExam(
      studentExam.examId, masterKey, studentExam, fileNameOnGithub, lecturerId
    );

    setUploadStatus(`🎉 Xuất bản thành công! Mã đề thi: <strong>${fileNameOnGithub}</strong>`, 'color: #10b981');
    alert(`🎉 Xuất bản đề thi thành công!\nMã đề: ${fileNameOnGithub}`);
    
    // Tải lại danh sách đề thi ngay sau khi xuất bản thành công
    handleLoadMyExams();
  } catch (err) {
    console.error("❌ [FE_LOG] handlePublishExam Error:", err);
    setUploadStatus(`❌ Lỗi xuất bản: ${err.message}`, 'color: #ef4444');
  }
}

// =========================================================================
// 5. HIỂN THỊ, XÓA VÀ CHỈNH SỬA / GHI ĐÈ ĐỀ THI ĐÃ TẠO
// =========================================================================
export async function handleLoadMyExams() {
  const container = document.getElementById('myExamsListTable');
  const btnReload = document.getElementById('loadMyExamsBtn');
  const filterWrapper = document.getElementById('adminAuthorFilterWrapper');
  const filterSelect = document.getElementById('filterAuthorSelect');

  if (btnReload) {
    btnReload.disabled = true;
    btnReload.innerText = '⏳...';
  }

  if (!container) return;
  container.innerHTML = '<p style="color: #2563eb; font-size: 13px;">🔄 Đang lấy danh sách đề thi...</p>';

  try {
    // Trích xuất Mã Giảng viên đăng nhập
    const username = getLoggedInUsername();
    console.log("🔍 [FE_LOG] handleLoadMyExams - Extracted Lecturer ID:", username);

    if (!username) {
      console.warn("⚠️ [FE_LOG] handleLoadMyExams: Không tìm thấy ID Giảng viên đăng nhập!");
      container.innerHTML = '<p style="color: #ef4444; font-size: 13px;">⚠️ Chưa đăng nhập hoặc phiên đăng nhập hết hạn!</p>';
      return;
    }

    // Truyền đồng thời cả lecturerCode và username về Apps Script + Log theo dõi
    const response = await appsScriptService.request('GET_MY_EXAMS', { 
      lecturerCode: username, 
      username: username 
    });

    console.log("✅ [FE_LOG] handleLoadMyExams Response from BE:", response);

    const exams = Array.isArray(response.exams) 
      ? response.exams 
      : (Array.isArray(response.data) ? response.data : []);
      
    window.rawFetchedExams = exams;

    const isAdmin = String(username).trim().toLowerCase() === 'admin';
    if (isAdmin && filterWrapper && filterSelect) {
      filterWrapper.style.display = 'flex';
      const authors = [...new Set(exams.map(e => e.createdBy || 'N/A'))];
      let optionsHtml = '<option value="ALL">-- Tất cả --</option>';
      authors.forEach(author => {
        optionsHtml += `<option value="${escapeHtml(author)}">${escapeHtml(author)}</option>`;
      });
      filterSelect.innerHTML = optionsHtml;
    } else if (filterWrapper) {
      filterWrapper.style.display = 'none';
    }

    if (typeof renderExamsList === 'function') {
      renderExamsList(exams, username);
    } else if (typeof window.renderExamsList === 'function') {
      window.renderExamsList(exams, username);
    }

  } catch (err) {
    console.error("❌ [FE_LOG] handleLoadMyExams Error:", err);
    container.innerHTML = `<p style="color: #ef4444; font-size: 13px;">❌ Lỗi kết nối: ${err.message}</p>`;
  } finally {
    if (btnReload) {
      btnReload.disabled = false;
      btnReload.innerText = '🔄 Tải lại';
    }
  }
}

export function renderExamsList(exams, currentUsername = '') {
  const container = document.getElementById('myExamsListTable');
  if (!container) return;

  if (!exams || exams.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">Chưa có đề thi nào.</p>`;
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">';
  
  exams.forEach((ex) => {
    const examId = escapeHtml(ex.examId || '');
    const examCode = escapeHtml(ex.examCode || ex.examId || 'N/A');
    const title = escapeHtml(ex.title || 'Đề thi trắc nghiệm');
    const duration = ex.durationMinutes || 45;
    const createdBy = escapeHtml(ex.createdBy || currentUsername || 'N/A');

    html += `
      <div style="background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--shadow);">
        <div>
          <strong style="font-size: 14px; color: #0f172a; display: block; margin-bottom: 4px;">${title}</strong>
          <div style="font-size: 12px; color: var(--text-muted); display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; color:#2563eb; font-weight:600;">${examCode}</code>
            <span>• ${duration} phút</span>
            <span>• Tạo bởi: <strong style="color:#d97706;">${createdBy}</strong></span>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 6px; border-top: 1px solid #f1f5f9; padding-top: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button type="button" onclick="handleOpenAssignModal('${examId}', '${title}')" style="background: #059669; min-height:34px; padding: 4px 10px; font-size: 12px;">
            📤 Giao đề
          </button>
          <button type="button" onclick="handleEditExam('${ex.examId}', '${ex.examCode || ''}')" style="background: #d97706; min-height:34px; padding: 4px 10px; font-size: 12px;">
            ✏️ Sửa
          </button>
          <button type="button" onclick="handleDeleteExam('${examId}')" style="background: #dc2626; min-height:34px; padding: 4px 10px; font-size: 12px;">
            🗑️ Xóa
          </button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

export async function handleDeleteExam(examId) {
  if (!confirm(`Bạn có chắc chắn muốn XÓA vĩnh viễn đề thi [${examId}]?`)) return;
  
  try {
    const username = getLoggedInUsername();
    const res = await appsScriptService.deleteExam(examId, username);
    alert(res.message || 'Đã xóa đề thi thành công!');
    handleLoadMyExams();
  } catch (err) {
    alert('Lỗi khi xóa đề thi: ' + err.message);
  }
}

export async function handleEditExam(examId, examCode = '') {
  showAppLoading('⏳ Đang nạp đề thi hiện tại...');

  try {
    let rawName = String(examCode || examId).trim();
    if (rawName.includes('-')) rawName = rawName.split('-')[0];
    if (!rawName.endsWith('.json')) rawName = `${rawName}.json`;

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/${filePath}?v=${Date.now()}`;
    
    let examData = null;
    try {
      const res = await fetch(cdnUrl);
      if (res.ok) examData = await res.json();
    } catch (e) {}

    if (!examData && typeof appsScriptService !== 'undefined') {
      const backendRes = await appsScriptService.request('GET_EXAM_DETAIL', { examId, examCode, filePath });
      if (backendRes.status === 'success' && backendRes.examData) {
        examData = backendRes.examData;
      }
    }

    hideAppLoading();

    if (!examData) throw new Error(`Không tìm thấy dữ liệu tệp [${filePath}].`);

    const currentQuestions = Array.isArray(examData) 
      ? examData 
      : (examData.questions || examData.data?.questions || []);

    if (!Array.isArray(currentQuestions) || currentQuestions.length === 0) {
      throw new Error('Đề thi không chứa câu hỏi hợp lệ.');
    }

    window.currentEditingExamContext = {
      examId: examId,
      examCode: rawName,
      filePath: filePath,
      title: examData.title || 'Đề thi trắc nghiệm',
      durationMinutes: examData.durationMinutes || 45
    };

    renderFullQuestionEditor(currentQuestions, rawName);

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi nạp đề thi: ${err.message}`);
  }
}

export function renderFullQuestionEditor(questions, fileName) {
  const container = document.getElementById('myExamsListTable');
  if (!container) return;

  const headerHtml = `
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px; border-radius: 8px; color: #1e40af; font-weight: 600; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
      <span>📝 Đang chỉnh sửa: <strong>[${escapeHtml(fileName)}]</strong> (${questions.length} câu)</span>
      <button type="button" onclick="handleSaveEditedExam()" style="background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;">
        💾 Lưu thay đổi
      </button>
    </div>
  `;

  const cardsHtml = questions.map((q, idx) => {
    const stemText = q.stem || q.text || '';
    const optionsList = Array.isArray(q.options) ? q.options : [];
    const answerKey = String(q.answerKey || q.answer || 'A').trim().toUpperCase();

    const formattedOptions = ['', '', '', ''];
    optionsList.forEach((opt, oIdx) => {
      if (oIdx < 4) formattedOptions[oIdx] = String(opt).replace(/^[A-D][.:)]\s*/i, '').trim();
    });

    const optionsHtml = formattedOptions.map((optVal, oIdx) => {
      const letter = String.fromCharCode(65 + oIdx);
      const isChecked = (answerKey === letter);

      return `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
          <label style="display: flex; align-items: center; gap: 4px; font-weight: bold;">
            <input type="radio" name="edit_ans_${idx}" class="q-radio-ans" value="${letter}" ${isChecked ? 'checked' : ''}>
            ${letter}.
          </label>
          <input type="text" class="q-option-input" value="${escapeHtml(optVal)}" placeholder="Phương án ${letter}...">
        </div>
      `;
    }).join('');

    return `
      <div class="question-editor-card" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
        <strong style="font-size: 14px;">Câu ${idx + 1}:</strong>
        <textarea class="q-stem-input" rows="2" style="margin-top: 6px; margin-bottom: 8px;">${escapeHtml(stemText)}</textarea>
        <div>${optionsHtml}</div>
      </div>
    `;
  }).join('');

  const footerHtml = `
    <div style="text-align: right; margin-top: 12px;">
      <button type="button" onclick="handleSaveEditedExam()" style="background: #2563eb; color: white; border: none; padding: 8px 18px; border-radius: 6px;">
        💾 Lưu thay đổi đề thi
      </button>
    </div>
  `;

  container.innerHTML = headerHtml + cardsHtml + footerHtml;
}

export async function handleSaveEditedExam() {
  const context = window.currentEditingExamContext;
  if (!context || !context.examId) return alert('⚠️ Chưa xác định được đề thi đang sửa!');

  showAppLoading('⏳ Đang ghi đè dữ liệu đề thi...');

  try {
    const cards = document.querySelectorAll('.question-editor-card');
    const updatedQuestions = Array.from(cards).map((card, idx) => {
      const stemInput = card.querySelector('.q-stem-input');
      const checkedRadio = card.querySelector('.q-radio-ans:checked');
      const optionInputs = card.querySelectorAll('.q-option-input');

      const options = Array.from(optionInputs).map(optEl => optEl.value.trim());
      while (options.length < 4) options.push('');

      return {
        id: idx + 1,
        stem: stemInput ? stemInput.value.trim() : '',
        options: options.slice(0, 4),
        answerKey: checkedRadio ? checkedRadio.value : 'A'
      };
    });

    const username = getLoggedInUsername() || 'admin';

    const res = await appsScriptService.saveAndPublishExam(
      context.examId,
      'MASTER_KEY',
      { title: context.title, durationMinutes: context.durationMinutes, questions: updatedQuestions },
      context.filePath,
      username
    );

    hideAppLoading();
    alert(res.message || `✅ Đã ghi đè tệp đề thi thành công!`);
    handleLoadMyExams();
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi ghi đè: ${err.message}`);
  }
}

// Bán các hàm ra Window toàn cục để tương thích sự kiện HTML
window.saveUserApiKey = saveUserApiKey;
window.handleProcessExamWithAI = handleProcessExamWithAI;
window.updateQuestionStem = updateQuestionStem;
window.updateOptionText = updateOptionText;
window.updateCorrectAnswer = updateCorrectAnswer;
window.handlePublishExam = handlePublishExam;
window.handleLoadMyExams = handleLoadMyExams;
window.handleDeleteExam = handleDeleteExam;
window.handleEditExam = handleEditExam;
window.handleSaveEditedExam = handleSaveEditedExam;
