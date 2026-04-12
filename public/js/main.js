/* ==========================================
   CaYaDev E-Ticaret - Ana JavaScript
   ========================================== */

document.addEventListener('DOMContentLoaded', function () {

  // --- Toast Notification ---
  window.showToast = function (message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(function () { toast.remove(); }, 300);
    }, 4000);
  };

  // --- Flash mesajları otomatik kapat ---
  document.querySelectorAll('.flash-msg').forEach(function (msg) {
    setTimeout(function () {
      msg.style.opacity = '0';
      msg.style.transform = 'translateX(100%)';
      setTimeout(function () { msg.remove(); }, 300);
    }, 5000);
  });

  // --- Loading Overlay ---
  window.showLoading = function () {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) overlay.classList.remove('hidden');
  };
  window.hideLoading = function () {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) overlay.classList.add('hidden');
  };

  // --- Mobile Menu ---
  var mobileBtn = document.querySelector('.mobile-menu-btn');
  var mobileNav = document.querySelector('.mobile-nav');
  if (mobileBtn && mobileNav) {
    mobileBtn.addEventListener('click', function () {
      var isOpen = mobileNav.classList.toggle('active');
      mobileBtn.classList.toggle('is-active', isOpen);
      mobileBtn.setAttribute('aria-expanded', isOpen);
      mobileNav.setAttribute('aria-hidden', !isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target === mobileNav) {
        mobileNav.classList.remove('active');
        mobileBtn.classList.remove('is-active');
        mobileBtn.setAttribute('aria-expanded', 'false');
        mobileNav.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
      }
    });
  }

  // --- Lazy Image Loading ---
  if ('IntersectionObserver' in window) {
    var lazyImages = document.querySelectorAll('img[data-src]');
    var imageObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var img = entry.target;
          img.src = img.dataset.src;
          if (img.dataset.srcset) img.srcset = img.dataset.srcset;
          img.removeAttribute('data-src');
          imageObserver.unobserve(img);
        }
      });
    }, { rootMargin: '200px' });
    lazyImages.forEach(function (img) { imageObserver.observe(img); });
  }

  // --- Quantity Controls ---
  document.querySelectorAll('.quantity-control').forEach(function (ctrl) {
    var input = ctrl.querySelector('input');
    var minusBtn = ctrl.querySelector('.qty-minus');
    var plusBtn = ctrl.querySelector('.qty-plus');
    if (!input) return;
    var min = parseInt(input.min) || 1;
    var max = parseInt(input.max) || 999;
    if (minusBtn) {
      minusBtn.addEventListener('click', function () {
        var val = parseInt(input.value) || min;
        if (val > min) { input.value = val - 1; input.dispatchEvent(new Event('change')); }
      });
    }
    if (plusBtn) {
      plusBtn.addEventListener('click', function () {
        var val = parseInt(input.value) || min;
        if (val < max) { input.value = val + 1; input.dispatchEvent(new Event('change')); }
      });
    }
  });

  // --- AJAX Helper ---
  window.apiRequest = function (url, method, body) {
    method = method || 'GET';
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    // CSRF token
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    var csrfToken = csrfMeta ? csrfMeta.content : (window.SITE && window.SITE.csrf ? window.SITE.csrf : '');
    if (csrfToken) opts.headers['X-CSRF-Token'] = csrfToken;
    return fetch(url, opts).then(function (res) {
      if (!res.ok) return res.json().then(function (d) { throw d; });
      return res.json();
    });
  };

  // --- Cart Functions ---
  window.addToCart = function (productId, quantity) {
    quantity = quantity || 1;
    return apiRequest('/api/cart/add', 'POST', { product_id: productId, quantity: quantity })
      .then(function (data) {
        showToast(data.message || 'Sepete eklendi', 'success');
        updateCartBadge(data.cartCount);
        return data;
      })
      .catch(function (err) {
        showToast(err.message || 'Bir hata oluştu', 'error');
      });
  };

  window.updateCartItem = function (productId, quantity) {
    return apiRequest('/api/cart/' + productId, 'PUT', { quantity: quantity })
      .then(function (data) {
        updateCartBadge(data.cartCount);
        return data;
      })
      .catch(function (err) {
        showToast(err.message || 'Bir hata oluştu', 'error');
      });
  };

  window.removeFromCart = function (productId) {
    return apiRequest('/api/cart/' + productId, 'DELETE')
      .then(function (data) {
        showToast('Ürün sepetten kaldırıldı', 'info');
        updateCartBadge(data.cartCount);
        return data;
      })
      .catch(function (err) {
        showToast(err.message || 'Bir hata oluştu', 'error');
      });
  };

  function updateCartBadge(count) {
    var badge = document.getElementById('cartBadge');
    if (!badge) {
      badge = document.querySelector('.cart-badge');
    }
    if (badge) {
      var num = parseInt(count) || 0;
      badge.textContent = num > 0 ? num.toString() : '';
      badge.style.display = num > 0 ? 'flex' : 'none';
    }
  }
  window.updateCartBadge = updateCartBadge;

  // --- Form Submit Helper (disable double submit) ---
  document.querySelectorAll('form[data-submit-once]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var btn = form.querySelector('[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = 'Gönderiliyor...';
      }
    });
  });

  // --- Image Preview ---
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

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // --- Auto-dismiss flash on click ---
  document.querySelectorAll('.flash-msg').forEach(function (msg) {
    msg.style.cursor = 'pointer';
    msg.addEventListener('click', function () {
      msg.style.opacity = '0';
      setTimeout(function () { msg.remove(); }, 300);
    });
  });

  // --- Intercept form-based cart add buttons (homepage etc.) ---
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.action && form.action.indexOf('/api/cart/add') !== -1 && form.method.toUpperCase() === 'POST') {
      e.preventDefault();
      var formData = new FormData(form);
      var body = { product_id: formData.get('product_id'), quantity: parseInt(formData.get('quantity')) || 1 };
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = '...'; }
      apiRequest('/api/cart/add', 'POST', body)
        .then(function (data) {
          showToast(data.message || 'Sepete eklendi', 'success');
          updateCartBadge(data.cartCount);
          if (btn) { btn.textContent = '✓'; setTimeout(function () { btn.disabled = false; btn.textContent = btn.dataset.origText; }, 1500); }
        })
        .catch(function (err) {
          showToast(err.message || err.error || 'Bir hata oluştu', 'error');
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText; }
        });
    }
  });

});
