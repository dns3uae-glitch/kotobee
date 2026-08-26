/* متجر الغنيمة — سكربت الواجهة. بدون أي مكتبات خارجية. */
(function () {
  'use strict';

  /* منع الإرسال المزدوج لأي نموذج */
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.sent === '1') {
      event.preventDefault();
      return;
    }
    form.dataset.sent = '1';
    var button = form.querySelector('button[type="submit"], button:not([type])');
    if (button) {
      button.disabled = true;
      window.setTimeout(function () {
        button.disabled = false;
        form.dataset.sent = '0';
      }, 4000);
    }
  });

  /* حراسة حدود الكمية */
  document.addEventListener('input', function (event) {
    var input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'number') return;
    var max = parseInt(input.max, 10);
    var min = parseInt(input.min, 10);
    var value = parseInt(input.value, 10);
    if (!isNaN(max) && value > max) input.value = String(max);
    if (!isNaN(min) && value < min) input.value = String(min);
  });

  /* نسخ الآيبان بلمسة واحدة */
  var ibans = document.querySelectorAll('.bank-box .mono');
  Array.prototype.forEach.call(ibans, function (node) {
    node.style.cursor = 'copy';
    node.title = 'انسخ';
    node.addEventListener('click', function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(node.textContent.trim()).then(function () {
        var original = node.textContent;
        node.textContent = 'تم النسخ';
        window.setTimeout(function () { node.textContent = original; }, 1200);
      });
    });
  });
})();
