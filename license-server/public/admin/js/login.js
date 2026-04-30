const form = document.getElementById('login-form');
const errorBox = document.getElementById('error');
const submitBtn = document.getElementById('submit');

const ERR_MSG = {
  invalid_credentials: '用户名或密码错误',
  invalid_body: '请填写用户名和密码',
  tenant_suspended: '该租户已被暂停，请联系管理员',
  csrf_origin_mismatch: '请求来源校验失败，请刷新页面再试',
  csrf_origin_missing: '请求来源校验失败，请刷新页面再试'
};

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}
function clearError() {
  errorBox.classList.add('hidden');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  submitBtn.disabled = true;
  submitBtn.textContent = '正在登录...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showError(ERR_MSG[data.error] || '登录失败：' + (data.error || res.statusText));
      return;
    }
    if (data.admin.role === 'super') {
      window.location.href = './super.html';
    } else {
      window.location.href = './tenant.html';
    }
  } catch (err) {
    showError('网络错误：' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '登录';
  }
});
