const form = document.getElementById('login-form');
const errorBox = document.getElementById('error');
const submitBtn = document.getElementById('submit');

const ERR_MSG = {
  invalid_credentials: '用户名或密码错误',
  invalid_body: '请填写用户名和密码',
  tenant_suspended: '该租户已被暂停，请联系管理员',
  csrf_origin_mismatch: '请求来源校验失败，请刷新页面再试',
  csrf_origin_missing: '请求来源校验失败，请刷新页面再试',
  license_key_required: '请填写公司的 License Key (NCLW-...)',
  invalid_license_key: 'License Key 错误或不属于该公司',
  license_revoked: '该 License Key 已被吊销，请联系超管换发',
  license_expired: '该 License Key 已过期，请联系超管续期'
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
        password: document.getElementById('password').value,
        // The License Key field only exists on the tenant-admin login surface;
        // on the super-admin host the row is removed entirely by login.html's
        // host-detection JS. Guard the lookup so super admins don't null-deref.
        license_key: (() => {
          const el = document.getElementById('license_key');
          if (!el) return undefined;
          const v = (el.value || '').trim().toUpperCase();
          return v || undefined;
        })()
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
