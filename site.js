(function () {
  'use strict';
  var views = JSON.parse(document.getElementById('preview-data').textContent);
  var buttons = document.querySelectorAll('[data-view]');
  var preview = document.getElementById('preview-image');
  var description = document.getElementById('preview-description');
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var view = views[button.dataset.view];
      if (!view) return;
      preview.src = view.image;
      preview.alt = view.alt;
      description.textContent = view.description;
      buttons.forEach(function (item) {
        item.setAttribute('aria-pressed', String(item === button));
      });
    });
  });
  var assetName = document.documentElement.lang === 'en' ? 'agentbridge-en.apk' : 'agentbridge-zh.apk';
  var options = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(8000) } : {};
  fetch('https://api.github.com/repos/otterview-labs/agentBridge/releases/latest', options)
    .then(function (response) {
      if (!response.ok) throw new Error('Release unavailable');
      return response.json();
    })
    .then(function (release) {
      var asset = (release.assets || []).find(function (item) { return item.name === assetName; });
      if (!asset) return;
      var version = String(release.tag_name || '').replace(/^android-v/, '');
      if (version) document.getElementById('release-version').textContent = 'v' + version;
      if (asset.size) document.getElementById('release-size').textContent = (asset.size / 1024 / 1024).toFixed(1) + ' MB';
    })
    .catch(function () { /* Keep the published version when GitHub is unavailable. */ });
})();
