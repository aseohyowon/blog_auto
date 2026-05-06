(() => {
  // ── DOM refs ──────────────────────────────────────────────
  const topicInput   = document.getElementById('topicInput');
  const toneSelect   = document.getElementById('tone');
  const generateBtn  = document.getElementById('generateBtn');
  const charCount    = document.getElementById('charCount');
  const htmlOutput   = document.getElementById('htmlOutput');
  const previewFrame = document.getElementById('previewFrame');
  const emptyState   = document.getElementById('emptyState');
  const loadingState = document.getElementById('loadingState');
  const copyBtn      = document.getElementById('copyBtn');
  const downloadBtn  = document.getElementById('downloadBtn');
  const statusDot    = document.getElementById('statusDot');
  const statusText   = document.getElementById('statusText');
  const tokenBadge   = document.getElementById('tokenBadge');
  const tokenCount   = document.getElementById('tokenCount');
  const toast        = document.getElementById('toast');
  const tabs         = document.querySelectorAll('.tab');

  let currentHTML = '';
  let toastTimer  = null;

  // ── Char counter ──────────────────────────────────────────
  topicInput.addEventListener('input', () => {
    charCount.textContent = topicInput.value.length;
  });

  // ── Tab switching ─────────────────────────────────────────
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${target}`).classList.add('active');
    });
  });

  // ── Status helper ─────────────────────────────────────────
  function setStatus(state, text) {
    statusDot.className = `status-dot ${state}`;
    statusText.textContent = text;
  }

  // ── Toast helper ──────────────────────────────────────────
  function showToast(message, type = 'default') {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // ── Show result ───────────────────────────────────────────
  function showResult(html) {
    currentHTML = html;

    emptyState.style.display   = 'none';
    loadingState.style.display = 'none';

    htmlOutput.textContent = html;
    htmlOutput.style.display = 'block';

    previewFrame.innerHTML = html;
  }

  // ── Show loading ──────────────────────────────────────────
  function showLoading() {
    emptyState.style.display   = 'none';
    htmlOutput.style.display   = 'none';
    loadingState.style.display = 'flex';
  }

  // ── Show empty ────────────────────────────────────────────
  function showEmpty() {
    loadingState.style.display = 'none';
    htmlOutput.style.display   = 'none';
    emptyState.style.display   = 'flex';
  }

  // ── Generate ──────────────────────────────────────────────
  generateBtn.addEventListener('click', generate);

  topicInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();
  });

  async function generate() {
    const topic = topicInput.value.trim();
    if (!topic) {
      topicInput.focus();
      showToast('주제를 입력해주세요.', 'error');
      return;
    }

    const tone   = toneSelect.value;
    const length = document.querySelector('input[name="length"]:checked')?.value || 'medium';

    generateBtn.disabled    = true;
    generateBtn.querySelector('.btn-text').textContent = '생성 중...';
    setStatus('loading', '생성 중...');
    showLoading();

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, tone, length }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `서버 오류 (${res.status})`);
      }

      showResult(data.html);
      setStatus('success', '완료');

      if (data.usage?.total_tokens) {
        tokenCount.textContent = data.usage.total_tokens.toLocaleString();
        tokenBadge.style.display = 'flex';
      }

      showToast('블로그 HTML이 생성되었습니다!', 'success');

    } catch (err) {
      console.error(err);
      showEmpty();
      setStatus('error', '오류 발생');
      showToast(err.message || '오류가 발생했습니다.', 'error');
    } finally {
      generateBtn.disabled = false;
      generateBtn.querySelector('.btn-text').textContent = '생성하기';
    }
  }

  // ── Copy to clipboard ─────────────────────────────────────
  copyBtn.addEventListener('click', async () => {
    if (!currentHTML) {
      showToast('복사할 내용이 없습니다.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(currentHTML);
      showToast('클립보드에 복사되었습니다!', 'success');
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = currentHTML;
      el.style.position = 'fixed';
      el.style.opacity  = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showToast('클립보드에 복사되었습니다!', 'success');
    }
  });

  // ── Download HTML ─────────────────────────────────────────
  downloadBtn.addEventListener('click', () => {
    if (!currentHTML) {
      showToast('다운로드할 내용이 없습니다.', 'error');
      return;
    }
    const topic    = topicInput.value.trim().replace(/[^\w가-힣\s]/g, '').slice(0, 40) || 'blog-post';
    const fileName = `${topic.replace(/\s+/g, '-')}.html`;
    const blob     = new Blob([currentHTML], { type: 'text/html;charset=utf-8' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${fileName} 다운로드 시작`, 'success');
  });

})();
