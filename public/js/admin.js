/* ==========================================
   CaYaDev E-Ticaret - Admin Panel JavaScript
   ========================================== */

document.addEventListener('DOMContentLoaded', function () {

  // --- Sidebar Toggle (Mobile) ---
  var sidebar = document.querySelector('.admin-sidebar');
  var mobileBtn = document.querySelector('.mobile-sidebar-btn');
  var closeBtn = document.querySelector('.sidebar-close');

  if (mobileBtn && sidebar) {
    mobileBtn.addEventListener('click', function () {
      sidebar.classList.toggle('active');
    });
  }
  if (closeBtn && sidebar) {
    closeBtn.addEventListener('click', function () {
      sidebar.classList.remove('active');
    });
  }

  // --- Confirmation Dialogs ---
  document.querySelectorAll('[data-confirm]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      var msg = el.dataset.confirm || 'Bu işlemi onaylıyor musunuz?';
      if (!confirm(msg)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
  });

  // --- Image Preview on File Input ---
  document.querySelectorAll('input[type="file"][data-preview]').forEach(function (input) {
    input.addEventListener('change', function () {
      var previewId = input.dataset.preview;
      var preview = document.getElementById(previewId);
      if (!preview || !input.files || !input.files[0]) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        if (preview.tagName === 'IMG') { preview.src = e.target.result; }
        else { preview.style.backgroundImage = 'url(' + e.target.result + ')'; }
      };
      reader.readAsDataURL(input.files[0]);
    });
  });

  // --- Settings Tab Navigation ---
  var settingsNavBtns = document.querySelectorAll('.settings-nav-btn');
  var settingsSections = document.querySelectorAll('.settings-section');

  settingsNavBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.target;
      settingsNavBtns.forEach(function (b) { b.classList.remove('active'); });
      settingsSections.forEach(function (s) { s.classList.remove('active'); });
      btn.classList.add('active');
      var section = document.getElementById(target);
      if (section) section.classList.add('active');
    });
  });

  // --- Tabs ---
  document.querySelectorAll('.tabs').forEach(function (tabContainer) {
    var buttons = tabContainer.querySelectorAll('.tab-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.tab;
        buttons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var parent = tabContainer.parentElement;
        parent.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
        var content = parent.querySelector('#' + target);
        if (content) content.classList.add('active');
      });
    });
  });

  // --- Inline Edit Toggle ---
  window.toggleInlineEdit = function (formId) {
    var form = document.getElementById(formId);
    if (form) form.classList.toggle('active');
  };

  // --- Color Input Sync ---
  document.querySelectorAll('.color-input-wrap').forEach(function (wrap) {
    var colorInput = wrap.querySelector('input[type="color"]');
    var textInput = wrap.querySelector('input[type="text"]');
    if (!colorInput || !textInput) return;
    colorInput.addEventListener('input', function () { textInput.value = colorInput.value; });
    textInput.addEventListener('input', function () {
      if (/^#[0-9a-fA-F]{6}$/.test(textInput.value)) {
        colorInput.value = textInput.value;
      }
    });
  });

  // --- Auto-slug Generation ---
  var titleInput = document.getElementById('title');
  var slugInput = document.getElementById('slug');
  if (titleInput && slugInput && !slugInput.value) {
    titleInput.addEventListener('input', function () {
      var map = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u' };
      var slug = titleInput.value.toLowerCase();
      slug = slug.replace(/[çğışöüÇĞİŞÖÜ]/g, function (c) { return map[c] || c; });
      slug = slug.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      slugInput.value = slug;
    });
  }

  // --- SEO Character Counter ---
  document.querySelectorAll('[data-maxlength]').forEach(function (input) {
    var max = parseInt(input.dataset.maxlength);
    var counter = document.createElement('span');
    counter.className = 'form-help';
    counter.style.float = 'right';
    input.parentNode.appendChild(counter);
    function update() {
      var len = input.value.length;
      counter.textContent = len + '/' + max;
      counter.style.color = len > max ? '#dc2626' : '#6b7280';
    }
    input.addEventListener('input', update);
    update();
  });

  // --- Bulk Select (Checkbox Header) ---
  var selectAllCheckbox = document.querySelector('.select-all-checkbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', function () {
      var checkboxes = document.querySelectorAll('.row-checkbox');
      checkboxes.forEach(function (cb) { cb.checked = selectAllCheckbox.checked; });
    });
  }

  // --- Disable double submit on admin forms ---
  document.querySelectorAll('form').forEach(function (form) {
    var submitted = false;
    form.addEventListener('submit', function (e) {
      if (submitted) { e.preventDefault(); return; }
      submitted = true;
      var btn = form.querySelector('[type="submit"]');
      if (btn) {
        btn.disabled = true;
        setTimeout(function () { btn.disabled = false; submitted = false; }, 5000);
      }
    });
  });

  // --- File Upload Progress ---
  document.querySelectorAll('form[enctype="multipart/form-data"]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var fileInputs = form.querySelectorAll('input[type="file"]');
      var hasFiles = false;
      fileInputs.forEach(function (fi) { if (fi.files && fi.files.length > 0) hasFiles = true; });
      if (!hasFiles) return; // Normal submit if no files

      e.preventDefault();
      var btn = form.querySelector('[type="submit"]');
      var originalText = btn ? btn.textContent : '';

      // Create progress bar
      var progressWrap = document.createElement('div');
      progressWrap.className = 'upload-progress-wrap';
      progressWrap.innerHTML = '<div class="upload-progress-bar"><div class="upload-progress-fill"></div></div><span class="upload-progress-text">Yükleniyor... 0%</span>';
      if (btn && btn.parentNode) { btn.parentNode.insertBefore(progressWrap, btn.nextSibling); }
      else { form.appendChild(progressWrap); }

      var fill = progressWrap.querySelector('.upload-progress-fill');
      var text = progressWrap.querySelector('.upload-progress-text');

      var xhr = new XMLHttpRequest();
      xhr.open(form.method || 'POST', form.action, true);

      // CSRF token'ı header olarak da gönder (multipart body parse edilmeden önce erişilebilir)
      var csrfInput = form.querySelector('input[name="_csrf"]');
      if (csrfInput) { xhr.setRequestHeader('X-CSRF-Token', csrfInput.value); }

      xhr.upload.addEventListener('progress', function (ev) {
        if (ev.lengthComputable) {
          var pct = Math.round((ev.loaded / ev.total) * 100);
          fill.style.width = pct + '%';
          text.textContent = 'Yükleniyor... ' + pct + '%';
        }
      });

      xhr.addEventListener('load', function () {
        if (xhr.status >= 200 && xhr.status < 400) {
          fill.style.width = '100%';
          text.textContent = 'Tamamlandı!';
          // Follow redirect
          if (xhr.responseURL) { window.location.href = xhr.responseURL; }
          else { window.location.reload(); }
        } else {
          text.textContent = 'Hata oluştu.';
          if (btn) { btn.disabled = false; btn.textContent = originalText; }
        }
      });

      xhr.addEventListener('error', function () {
        text.textContent = 'Bağlantı hatası.';
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
      });

      var formData = new FormData(form);
      xhr.send(formData);

      if (btn) { btn.disabled = true; btn.textContent = 'Yükleniyor...'; }
    });
  });

  // --- Homepage Section JSON Editor Helper ---
  document.querySelectorAll('.json-format-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.dataset.target;
      var textarea = document.getElementById(targetId);
      if (!textarea) return;
      try {
        var parsed = JSON.parse(textarea.value);
        textarea.value = JSON.stringify(parsed, null, 2);
      } catch (e) {
        alert('Geçersiz JSON formatı');
      }
    });
  });

  // --- Period Selector (Analytics) ---
  document.querySelectorAll('.period-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var period = btn.dataset.period;
      if (period) {
        window.location.href = window.location.pathname + '?period=' + period;
      }
    });
  });

});
