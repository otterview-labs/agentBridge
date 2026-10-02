(function () {
  'use strict';
  const language = window.AGENTBRIDGE_LANGUAGE === 'en' ? 'en' : 'zh-CN';
  const catalog = window.AGENTBRIDGE_EN || {};
  const text = source => language === 'en' && Object.prototype.hasOwnProperty.call(catalog, source)
    ? catalog[source] : source;
  // This runs once on bundled static HTML before tasks or messages are rendered.
  // Dynamic UI labels call text() at their source. Never scan user/task DOM.
  if (language === 'en') {
    document.documentElement.lang = 'en';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) nodes.push(node);
    }
    nodes.forEach(node => { node.nodeValue = text(node.nodeValue); });
    document.querySelectorAll('[placeholder],[title],[aria-label],[data-quick-prompt]').forEach(node => {
      ['placeholder', 'title', 'aria-label', 'data-quick-prompt'].forEach(name => {
        if (node.hasAttribute(name)) node.setAttribute(name, text(node.getAttribute(name)));
      });
    });
  }
  window.OfficeI18n = { language, text };
})();
