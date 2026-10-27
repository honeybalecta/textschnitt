'use strict';
/* Flache Piktogramme statt Emoji: Jedes bisher verwendete Zeichen bekommt ein schlichtes Strich-Symbol.
   icon(zeichen) liefert SVG; iconize(wurzel) ersetzt Zeichen in Knöpfen und <i>-Elementen. */
(() => {
  const P = {
    '✂': '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    '🗑': '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    '＋': '<path d="M12 5v14M5 12h14"/>',
    'T': '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
    '🔍': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
    '⚙': '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    'gear': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    '↶': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    '↷': '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    '⌁': '<path d="m6 15-4-4 6.8-6.8a7.8 7.8 0 0 1 11 11L13 22l-4-4 6.4-6.4a2.1 2.1 0 0 0-3-3z"/><path d="m5 8 4 4M12 15l4 4"/>',
    '⇥': '<path d="M3 12h13M10 6l6 6-6 6M21 5v14"/>',
    '⇤': '<path d="M21 12H8M14 6l-6 6 6 6M3 5v14"/>',
    '⤢': '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    '−': '<path d="M5 12h14"/>',
    '⌨': '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    '‹': '<path d="m15 18-6-6 6-6"/>',
    '⧉': '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
    '▶': '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
    '❚❚': '<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" stroke="none"/>',
    '⤴': '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    '🗣': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
    '⏸': '<path d="M9 6v12M15 6v12"/>',
    '🎞': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
    '🎬': '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
    '✨': '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17v4M17 19h4"/>',
    '💬': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M14 15h3M7 11h2M12 11h5"/>',
    '↺': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    '↻': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    '⟳': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    '⇄': '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    '⌫': '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="m18 9-6 6M12 9l6 6"/>',
    '⌦': '<path d="M3 4h13l7 8-7 8H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="m6 9 6 6M12 9l-6 6"/>',
    '◎': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    '👁': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    '⦸': '<path d="M3 3l18 18M10.6 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    '✎': '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    '◰': '<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>',
    '▣': '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
    '↗': '<path d="M7 17 17 7M8 7h9v9"/>', '↖': '<path d="M17 17 7 7M16 7H7v9"/>', '↙': '<path d="M17 7 7 17M7 8v9h9"/>', '↘': '<path d="M7 7l10 10M17 8v9H8"/>',
    '🔊': '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    '🔇': '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    '🎨': '<path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A1.7 1.7 0 0 1 12 22z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
    '⌖': '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    '↕': '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    '⤓': '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    '✕': '<path d="M18 6 6 18M6 6l12 12"/>',
    '◆': '<path d="M12 3 21 12 12 21 3 12Z"/><circle cx="12" cy="12" r="1.6"/>',
    '🔗': '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    '⛓': '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/><path d="M3 3l18 18"/>',
    '✓': '<path d="M20 6 9 17l-5-5"/>',
    '↑': '<path d="M12 19V5M5 12l7-7 7 7"/>', '↓': '<path d="M12 5v14M5 12l7 7 7-7"/>',
    '♪': '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    'Aa': '<path d="M3 19 8 5l5 14M4.7 14.5h6.6"/><path d="M15 12.5a3 3 0 0 1 6 0V19M21 15.5h-3.5a2 2 0 0 0 0 4c2 0 3.5-1.5 3.5-3.5"/>',
    'cc': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2.5 2.5 0 1 0 0 3M17 10.5a2.5 2.5 0 1 0 0 3"/>',
    'step-': '<path d="M19 20 9 12l10-8z"/><path d="M5 19V5"/>', 'step+': '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>',
    'cutprev': '<path d="M11 19 2 12l9-7z"/><path d="M22 19l-9-7 9-7z"/>', 'cutnext': '<path d="M13 19l9-7-9-7z"/><path d="M2 19l9-7-9-7z"/>',
  };
  const svg = d => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  window.icon = (ch, fallback) => P[ch] ? svg(P[ch]) : (fallback != null ? fallback : ch);
  window.hasIcon = ch => !!P[ch];
  // Knöpfe und <i>-Felder: führendes Zeichen durch das Piktogramm ersetzen
  const lead = /^([←-⯿＋]|[\uD83C-\uD83E][\uDC00-\uDFFF]|❚❚|T(?=$))(️)?\s?/;
  function iconize(root){
    root = root || document;
    const els = [...root.querySelectorAll('button, i, .ico-auto')];
    if (root.matches && root.matches('button, i, .ico-auto')) els.push(root);
    els.forEach(el => {
      if (el.querySelector('svg')) return;
      if (el.dataset.ico){ el.innerHTML = svg(P[el.dataset.ico] || '') + (el.dataset.lbl ? `<span>${el.dataset.lbl}</span>` : ''); el.dataset.ic = '1'; return; }
      if (el.children.length && el.tagName === 'BUTTON') return;   // Knöpfe mit eigenem Aufbau (<i>…</i><span>…</span>) bekommen ihr Symbol über das <i>
      const t = el.textContent; const m = t.match(lead); if (!m || !P[m[1]]) return;
      const rest = t.slice(m[0].length);
      if (el.tagName === 'I' && rest.trim()) return;
      el.innerHTML = svg(P[m[1]]) + (rest ? `<span>${rest.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</span>` : '');
      el.dataset.ic = '1';
    });
  }
  window.iconize = iconize;
  // Neue Elemente automatisch umstellen (Werkzeugleisten, Menüs, Listen)
  const mo = new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes){ const el = n.nodeType === 1 ? n : n.parentNode; if (el && el.nodeType === 1 && !el.closest('.transcript')) iconize(el); } });
  const start = () => { iconize(document); mo.observe(document.body, {childList:true, subtree:true}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
