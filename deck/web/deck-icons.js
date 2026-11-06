'use strict';
/* HoneyDeck – Piktogramm-Bibliothek. Flache, reduzierte Zeichen auf einem 24er-Raster.
   Jedes Zeichen besteht aus Flächen; Flächen mit acc:true werden in der Akzentfarbe gezeichnet.
   Gezeichnet wird mit Path2D (SVG-Pfade), Löcher über die Füllregel evenodd. */
(function(){
  const f = n => +n.toFixed(2);
  // Formen als SVG-Pfad
  const C = (x, y, r) => `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  const R = (x, y, w, h, r = 0) => { r = Math.min(r, w / 2, h / 2); return r ? `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}Z` : `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`; };
  const SECTOR = (x, y, r1, r2, a1, a2) => { const p = (r, d) => [x + r * Math.cos(d * Math.PI / 180), y + r * Math.sin(d * Math.PI / 180)].map(f).join(' ');
    return `M${p(r1, a1)}L${p(r2, a1)}A${r2} ${r2} 0 0 1 ${p(r2, a2)}L${p(r1, a2)}A${r1} ${r1} 0 0 0 ${p(r1, a1)}Z`; };
  const RING = (x, y, r, t) => C(x, y, r) + C(x, y, r - t);
  const POLY = (...p) => 'M' + p.map(n => f(n)).reduce((s, n, i) => s + (i && i % 2 === 0 ? 'L' : i ? ' ' : '') + n, '') + 'Z';
  // Linie mit Stärke t (als Fläche)
  const LINE = (x1, y1, x2, y2, t = 2) => { const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = -dy / l * t / 2, ny = dx / l * t / 2;
    return POLY(x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny); };
  const PERSON = (x, y, s = 1) => C(x, y - 5.2 * s, 2.6 * s) + `M${f(x - 5 * s)} ${f(y + 6 * s)}v${f(-3 * s)}a${f(5 * s)} ${f(5 * s)} 0 0 1 ${f(10 * s)} 0v${f(3 * s)}Z`;
  const ARROW_R = (x, y, w, t = 3, hd = 4) => POLY(x, y - t / 2, x + w - hd, y - t / 2, x + w - hd, y - hd, x + w, y, x + w - hd, y + hd, x + w - hd, y + t / 2, x, y + t / 2);
  const a = d => ({d, acc: true}), n = d => ({d});

  const ICONS = [
    // ───── Protest & Bewegung ─────
    ['megafon', 'Megafon', 'Protest', [n('M3 9h4l9-5v16l-9-5H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z'), n(R(5, 15, 3, 5, 1)), a('M18 8.5a5 5 0 0 1 0 7l-1.3-1.3a3.2 3.2 0 0 0 0-4.4Z'), a('M20.4 6a8.5 8.5 0 0 1 0 12l-1.3-1.3a6.7 6.7 0 0 0 0-9.4Z')]],
    ['faust', 'Erhobene Faust', 'Protest', [n('M7 9.5V6.2a1.6 1.6 0 0 1 3.2 0V9h.4V5.2a1.6 1.6 0 0 1 3.2 0V9h.4V5.8a1.6 1.6 0 0 1 3.2 0V9.5h.2a1.6 1.6 0 0 1 1.6 1.6V14a5 5 0 0 1-2 4v4H8v-4a5.6 5.6 0 0 1-2.4-4.6V11a1.5 1.5 0 0 1 1.4-1.5Z'), a(R(8, 20, 9, 2, 0.5))]],
    ['schild', 'Demo-Schild', 'Protest', [n(R(3, 3, 18, 11, 1.5)), n(R(11, 13, 2, 9, 0.5)), a(R(6, 6.5, 12, 1.8, 0.9)), a(R(6, 9.5, 8, 1.8, 0.9))]],
    ['demo', 'Demonstration', 'Protest', [n(PERSON(6, 15, 0.8)), n(PERSON(18, 15, 0.8)), n(PERSON(12, 16, 0.95)), a(R(8, 2, 8, 5, 1)), a(R(11.4, 6.5, 1.2, 4))]],
    ['streik', 'Streik', 'Protest', [n('M2 21V11l5 3V11l5 3V11l5 3V5h3v16Z'), a(R(14, 2, 8, 6, 1)), a(R(17.4, 7.5, 1.2, 4))]],
    ['flagge', 'Fahne', 'Protest', [n(R(4, 2, 2, 20, 1)), a('M6.5 3h13l-3 4.5 3 4.5h-13Z')]],
    ['solidaritaet', 'Händedruck', 'Protest', [n('M1 9l4-2 5 1 3-1.5L18 9l5-1v6l-3 1-5 4.5a1.6 1.6 0 0 1-2.3-.2 1.6 1.6 0 0 1-2.4-.6 1.6 1.6 0 0 1-2.2-1.2 1.6 1.6 0 0 1-1.8-2L1 14Z'), a('M10 8l3-1.5 5 2.5-2.2 1.4-3.5-1.6-1.8 1.4a1.4 1.4 0 0 1-1.9-.2Z')]],
    ['kette', 'Kette', 'Protest', [n('M3.5 13.5l3-3a4 4 0 0 1 5.6 0l.7.7-1.5 1.5-.7-.7a2 2 0 0 0-2.8 0l-3 3a2 2 0 0 0 2.8 2.8l1-1 1.5 1.5-1 1a4 4 0 0 1-5.6-5.6Z'), n('M20.5 10.5l-3 3a4 4 0 0 1-5.6 0l-.7-.7 1.5-1.5.7.7a2 2 0 0 0 2.8 0l3-3a2 2 0 0 0-2.8-2.8l-1 1-1.5-1.5 1-1a4 4 0 0 1 5.6 5.6Z')]],
    ['kette-gebrochen', 'Gesprengte Kette', 'Protest', [n('M3.5 13.5l3-3a4 4 0 0 1 4.4-.8L9.4 11.2a2 2 0 0 0-1.4.6l-3 3a2 2 0 0 0 2.8 2.8l1-1 1.5 1.5-1 1a4 4 0 0 1-5.8-5.6Z'), n('M20.5 10.5l-3 3a4 4 0 0 1-4.4.8l1.5-1.5a2 2 0 0 0 1.4-.6l3-3a2 2 0 0 0-2.8-2.8l-1 1-1.5-1.5 1-1a4 4 0 0 1 5.8 5.6Z'), a(LINE(11, 2, 12, 6, 1.6)), a(LINE(16, 18, 13, 21.5, 1.6)), a(LINE(5, 6, 8, 8, 1.6))]],
    ['flamme', 'Flamme', 'Protest', [n('M12 22c-4.4 0-7-2.8-7-6.6 0-4 3-6 4-9.4 1.6 1.4 2.2 3 2.2 4.6 1.4-1 2.4-3.6 2.2-7.6 3.6 2.6 6.6 6.8 6.6 12.4 0 3.8-3.2 6.6-8 6.6Z'), a('M12 21c-2 0-3.2-1.2-3.2-3 0-1.8 1.4-2.8 2-4.4.8.8 1 1.6 1 2.4.7-.4 1.3-1.4 1.3-2.8 1.6 1.2 2.5 3 2.5 4.8 0 1.8-1.4 3-3.6 3Z')]],
    ['wahlurne', 'Wahlurne', 'Politik', [n(R(3, 10, 18, 12, 1.5)), n(R(2, 8, 20, 3, 1)), a(R(8, 2, 8, 9, 0.6)), n(R(6, 9, 12, 1.2))]],
    ['stimmzettel', 'Stimmzettel', 'Politik', [n(R(4, 2, 16, 20, 1.5)), a(LINE(7, 8, 9, 10, 1.6)), a(LINE(9, 10, 12.5, 5.5, 1.6)), n(R(14, 6.5, 4, 1.6, 0.8)), n(R(7, 13, 11, 1.6, 0.8)), n(R(7, 16.5, 8, 1.6, 0.8))]],
    ['parlament', 'Parlament', 'Politik', [n('M12 2l10 5v2H2V7Z'), n(R(3.5, 10, 2.5, 8)), n(R(8, 10, 2.5, 8)), n(R(13.5, 10, 2.5, 8)), n(R(18, 10, 2.5, 8)), n(R(2, 19, 20, 3, 0.5)), a(C(12, 6, 1.4))]],
    ['kuppel', 'Kuppel', 'Politik', [n('M4 12a8 8 0 0 1 16 0Z'), a(R(11, 2, 2, 3)), n(R(3, 13, 18, 2)), n(R(4, 16, 2, 4)), n(R(9, 16, 2, 4)), n(R(13, 16, 2, 4)), n(R(18, 16, 2, 4)), n(R(2, 20.5, 20, 1.8))]],
    ['rednerpult', 'Rednerpult', 'Politik', [n('M5 11h14l-2 11H7Z'), n(R(4, 9, 16, 2.5, 0.5)), n(PERSON(12, 8.5, 0.75)), a(R(10.5, 14, 3, 3, 1.5))]],
    ['krone', 'Krone', 'Politik', [n('M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5Z'), n(R(5, 19, 14, 3, 0.8)), a(C(12, 13.5, 1.6))]],
    ['waage', 'Waage', 'Recht', [n(R(11, 4, 2, 15)), n(R(7, 19, 10, 3, 1)), n(R(4, 5, 16, 2, 1)), a('M2 13l3-6 3 6a3 3 0 0 1-6 0Z'), a('M16 13l3-6 3 6a3 3 0 0 1-6 0Z'), n(C(12, 3.5, 1.6))]],
    ['paragraf', 'Paragraf', 'Recht', [n('M14.6 7.2C14.2 5.6 13.4 5 12 5c-1.6 0-2.4.8-2.4 1.9 0 2.8 7.4 2.3 7.4 7 0 1.4-.6 2.4-1.6 3.1.5.6.8 1.4.8 2.3 0 2.2-1.8 3.7-4.2 3.7-2.4 0-4-1.2-4.6-3.4l2.1-.6c.3 1.2 1.1 1.8 2.5 1.8 1.3 0 2-.6 2-1.5 0-2.6-7.4-2.3-7.4-6.9 0-1.4.6-2.4 1.6-3.1-.5-.6-.8-1.4-.8-2.3C7.4 4.4 9.2 3 11.8 3c2.2 0 3.8 1 4.6 3.4ZM9.8 12.2c0 1.3 2 1.8 3.8 2.6.4-.4.6-.8.6-1.2 0-1.4-2-1.9-3.8-2.6-.4.3-.6.7-.6 1.2Z')]],
    ['hammer', 'Richterhammer', 'Recht', [n('M3.5 9.3l6-6 2.8 2.8-6 6Z'), n('M9 14.8l6-6 2.8 2.8-6 6Z'), n(LINE(13.5, 10.5, 21, 18, 2.6)), a(R(3, 19.5, 10, 2.5, 1))]],
    ['polizei', 'Polizei', 'Staat', [n('M12 2l8 3v6c0 5.2-3.4 9.4-8 11-4.6-1.6-8-5.8-8-11V5Z'), a('M12 7.5l1.4 2.9 3.2.5-2.3 2.2.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.2 3.2-.5Z')]],
    ['helm', 'Einsatzhelm', 'Staat', [n('M3 15a9 9 0 0 1 18 0v1H3Z'), n(R(2, 16, 20, 2.5, 1)), a(R(5, 12.5, 14, 2.4, 0.4)), n(R(11, 4, 2, 4))]],
    ['schutzschild', 'Schutzschild', 'Staat', [n('M12 2l8 3v6c0 5.2-3.4 9.4-8 11-4.6-1.6-8-5.8-8-11V5Z'), a('M12 4.3V19.7C8.8 18.2 6.2 14.8 6.2 11V6.5Z')]],
    ['gefaengnis', 'Gefängnis', 'Staat', [n(R(3, 3, 18, 18, 1.5) + R(5, 5, 14, 14)), n(R(7.5, 4, 2, 16)), n(R(11, 4, 2, 16)), n(R(14.5, 4, 2, 16)), a(R(4, 10.5, 16, 2))]],
    ['ueberwachung', 'Überwachungskamera', 'Staat', [n('M3 6.5l13 4-1.6 5-13-4Z'), n(R(15.8, 12.5, 2, 6)), n(R(15, 18, 7, 2.5, 0.8)), a(C(6.5, 9.2, 1.2))]],
    ['auge', 'Auge', 'Staat', [n('M1.5 12C4 7.5 7.8 5 12 5s8 2.5 10.5 7c-2.5 4.5-6.3 7-10.5 7S4 16.5 1.5 12Z' + C(12, 12, 4.6)), a(C(12, 12, 2.6))]],
    ['grenze', 'Grenzzaun', 'Staat', [n(R(3, 5, 2, 17)), n(R(11, 5, 2, 17)), n(R(19, 5, 2, 17)), n(R(2, 9, 20, 1.6)), n(R(2, 15, 20, 1.6)), a('M2 3l2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2v1.6l-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2Z')]],
    ['ausweis', 'Ausweis', 'Staat', [n(R(2, 5, 20, 14, 2) + R(4, 7, 16, 10, 0.6)), a(C(8.5, 10.5, 2)), a('M5.5 16a3 3 0 0 1 6 0Z'), n(R(13, 9.5, 5, 1.5, 0.7)), n(R(13, 12.5, 4, 1.5, 0.7))]],
    // ───── Arbeit & Wirtschaft ─────
    ['fabrik', 'Fabrik', 'Arbeit', [n('M2 22V10l5 3.5V10l5 3.5V10l5 3.5V3h4v19Z'), a(R(5, 16, 3, 3)), a(R(10.5, 16, 3, 3)), a(R(16, 16, 3, 3))]],
    ['zahnrad', 'Zahnrad', 'Arbeit', [n('M10.3 2h3.4l.5 2.6a7.6 7.6 0 0 1 2 1.1l2.5-.9 1.7 3-2 1.7a7.6 7.6 0 0 1 0 2.4l2 1.7-1.7 3-2.5-.9a7.6 7.6 0 0 1-2 1.1l-.5 2.6h-3.4l-.5-2.6a7.6 7.6 0 0 1-2-1.1l-2.5.9-1.7-3 2-1.7a7.6 7.6 0 0 1 0-2.4l-2-1.7 1.7-3 2.5.9a7.6 7.6 0 0 1 2-1.1Z' + C(12, 11, 3)), a(C(12, 11, 1.6))]],
    ['werkzeug', 'Schraubenschlüssel', 'Arbeit', [n('M14.5 2.5a5.5 5.5 0 0 0-5.2 7.3L2.6 16.5a2.1 2.1 0 0 0 3 3l6.7-6.7A5.5 5.5 0 0 0 19.6 7L16.4 10l-2.6-.6-.6-2.6L16.2 3.6a5.5 5.5 0 0 0-1.7-1.1Z'), a(C(4.3, 18, 1))]],
    ['helm-bau', 'Bauhelm', 'Arbeit', [n('M4 16a8 8 0 0 1 16 0Z'), n(R(2, 16, 20, 3, 1.2)), a(R(10.5, 6, 3, 8, 1))]],
    ['koffer', 'Aktenkoffer', 'Arbeit', [n(R(2, 7, 20, 14, 2)), n('M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2h-2V5h-4v2Z'), a(R(2, 12, 20, 2)), n(R(10.5, 11, 3, 4, 0.6))]],
    ['geld', 'Geldscheine', 'Wirtschaft', [n(R(2, 6, 20, 12, 1.5) + C(12, 12, 3.2)), a(C(12, 12, 1.8)), n(R(4, 8, 2, 2, 1)), n(R(18, 14, 2, 2, 1))]],
    ['euro', 'Euro', 'Wirtschaft', [n('M15.8 4.6l-.6 2.2C14.4 6.4 13.6 6.2 12.8 6.2c-2.2 0-3.9 1.3-4.6 3.3h5.6l-.5 1.8H7.9v1.4h4.9l-.5 1.8H8.2c.7 2 2.4 3.3 4.6 3.3.9 0 1.7-.2 2.4-.6l.6 2.2c-.9.5-2 .8-3.1.8-3.6 0-6.3-2.3-7-5.7H4l.5-1.8H5.5v-1.4H4l.5-1.8h1.2c.7-3.4 3.4-5.7 7.1-5.7 1.1 0 2.2.3 3 .8Z')]],
    ['muenzen', 'Münzstapel', 'Wirtschaft', [n(R(3, 17, 10, 3, 1.5)), n(R(3, 13, 10, 3, 1.5)), n(R(3, 9, 10, 3, 1.5)), a(C(17, 15, 5)), n(R(16.2, 12.5, 1.6, 5, 0.6))]],
    ['sparschwein', 'Sparschwein', 'Wirtschaft', [n('M4 12a7 6 0 0 1 7-6h3a7 6 0 0 1 5.2 2.6L21.5 8v3.5l-1.6.6a6.4 6.4 0 0 1-2 3.4V19h-3v-2.4h-4V19H8v-3.1A6 6 0 0 1 5.4 14H3v-3h1.1Z'), a(R(9, 4, 5, 2, 1)), n(C(16.5, 10.5, 0.9))]],
    ['einkauf', 'Einkaufswagen', 'Wirtschaft', [n('M1.5 3h3.4l.8 3H22l-2.4 9H8.1l.5 2H19v2H7L3.4 5H1.5Z'), a(C(9, 20.5, 1.6)), a(C(18, 20.5, 1.6))]],
    ['diagramm-hoch', 'Steigende Kurve', 'Wirtschaft', [n(R(2, 20, 20, 2)), n(R(2, 3, 2, 18)), a('M6 16.5l4-5 3.5 2.5 5-6.2-1.8-1.3L21.5 4l.4 5.3-1.8-1.3-6.2 7.6-3.5-2.5-3.2 4Z')]],
    ['diagramm-runter', 'Fallende Kurve', 'Wirtschaft', [n(R(2, 20, 20, 2)), n(R(2, 3, 2, 18)), a('M6 5.5l4 5 3.5-2.5 5 6.2-1.8 1.3 4.8 2.5.4-5.3-1.8 1.3-6.2-7.6-3.5 2.5-3.2-4Z')]],
    ['balken', 'Balkendiagramm', 'Wirtschaft', [n(R(2, 20, 20, 2)), n(R(4, 12, 4, 7)), a(R(10, 5, 4, 14)), n(R(16, 9, 4, 10))]],
    ['torte', 'Tortendiagramm', 'Wirtschaft', [n('M11 3.1V13h9.9A10 10 0 1 1 11 3.1Z'), a('M13 1.1A10 10 0 0 1 22.9 11H13Z')]],
    ['prozent', 'Prozent', 'Wirtschaft', [n(RING(6.5, 6.5, 3.6, 2) + RING(17.5, 17.5, 3.6, 2)), a(LINE(19, 4, 5, 20, 2.4))]],
    ['haus', 'Haus', 'Alltag', [n('M12 2.5l10 8.5h-3v11H5V11H2Z'), a(R(10, 15, 4, 7))]],
    ['miete', 'Miete', 'Wirtschaft', [n('M12 2.5l10 8.5h-3v11H5V11H2Z'), a('M13.6 12.4l-.4 1.2c-.4-.2-.8-.3-1.2-.3-1 0-1.8.6-2.1 1.5h2.5l-.3 1h-2.3v.4h2.1l-.3 1H10c.3.9 1.1 1.4 2.1 1.4.4 0 .8-.1 1.2-.3l.3 1.2c-.5.3-1 .4-1.6.4-1.8 0-3.2-1.1-3.6-2.7h-.8l.3-1h.4v-.4h-.6l.3-1h.4c.4-1.7 1.8-2.8 3.6-2.8.6 0 1.2.2 1.6.4Z')]],
    ['bank', 'Bank', 'Wirtschaft', [n('M12 2l10 5v2H2V7Z'), n(R(4, 10, 3, 8)), n(R(10.5, 10, 3, 8)), n(R(17, 10, 3, 8)), n(R(2, 19, 20, 3, 0.5)), a(C(12, 5.8, 1.3))]],
    ['konzern', 'Hochhaus', 'Wirtschaft', [n(R(4, 2, 10, 20, 0.6)), n(R(14, 8, 6, 14, 0.6)), a(R(6.5, 5, 2, 2)), a(R(9.5, 5, 2, 2)), a(R(6.5, 9, 2, 2)), a(R(9.5, 9, 2, 2)), a(R(6.5, 13, 2, 2)), a(R(9.5, 13, 2, 2)), n(R(8, 18, 2, 4))]],
    ['steuer', 'Steuerbescheid', 'Wirtschaft', [n('M5 2h10l5 5v15H5Z'), n(R(7.5, 10, 8, 1.6, 0.8)), n(R(7.5, 13.5, 6, 1.6, 0.8)), a(C(15, 18, 2.6)), n('M15 2v5h5')]],
    // ───── Medien & Kommunikation ─────
    ['zeitung', 'Zeitung', 'Medien', [n(R(2, 4, 20, 16, 1.5) + R(4, 6, 16, 12)), a(R(5, 7, 14, 3)), n(R(5, 11.5, 6.5, 5.5)), n(R(13, 11.5, 6, 1.4)), n(R(13, 14, 6, 1.4)), n(R(13, 16.5, 4, 1.4))]],
    ['kamera', 'Videokamera', 'Medien', [n(R(2, 6, 14, 12, 2)), a('M17 10.5l5-3v9l-5-3Z'), n(C(6, 4, 2) + C(11.5, 4, 2))]],
    ['foto', 'Fotokamera', 'Medien', [n('M4 7h3l1.6-2.5h6.8L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z' + C(12, 13, 4.2)), a(C(12, 13, 2.6))]],
    ['mikrofon', 'Mikrofon', 'Medien', [n(R(8.5, 2, 7, 12, 3.5)), n('M5 11h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 0 1 5 11Z'), a(R(8.5, 7, 7, 1.6))]],
    ['handy', 'Smartphone', 'Medien', [n(R(6, 1.5, 12, 21, 2.2) + R(7.8, 4, 8.4, 14)), a(R(9, 5.5, 6, 2, 0.5)), a(R(9, 9, 4, 2, 0.5)), n(C(12, 20.2, 0.9))]],
    ['laptop', 'Laptop', 'Medien', [n(R(4, 4, 16, 11, 1.2) + R(5.8, 5.8, 12.4, 7.4)), n('M1 17h22l-1.5 3h-19Z'), a(R(7.5, 7.5, 6, 1.4, 0.7))]],
    ['fernseher', 'Fernseher', 'Medien', [n(R(2, 5, 20, 13, 1.5) + R(4, 7, 16, 9)), n(R(9, 19, 6, 2.5, 0.8)), a('M10 9l5 2.5-5 2.5Z'), n(LINE(8, 1.5, 11, 5, 1.4)), n(LINE(16, 1.5, 13, 5, 1.4))]],
    ['play', 'Video', 'Medien', [n(R(2, 4, 20, 16, 3)), a('M10 8.5l6 3.5-6 3.5Z')]],
    ['sprechblase', 'Sprechblase', 'Medien', [n('M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 4.5V17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z'), a(C(8, 10, 1.4)), a(C(12, 10, 1.4)), a(C(16, 10, 1.4))]],
    ['dialog', 'Gespräch', 'Medien', [n('M3 2h11a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 14 12H8l-3.5 3v-3H3a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 3 2Z'), a('M10 13.5h4.5a3 3 0 0 0 3-3V7.5H21a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 21 17.5h-1.5v3l-3.5-3H11.5A1.5 1.5 0 0 1 10 16Z')]],
    ['zitat', 'Anführungszeichen', 'Medien', [n('M3 12.5C3 8 5.2 5 9 4l.8 1.8C7.6 6.8 6.6 8.4 6.5 10.5H10V20H3Z'), a('M13 12.5C13 8 15.2 5 19 4l.8 1.8c-2.2 1-3.2 2.6-3.3 4.7H20V20h-7Z')]],
    ['brief', 'Brief', 'Medien', [n(R(2, 5, 20, 14, 1.5)), a('M2.6 6l9.4 7 9.4-7v2.5L12 15.5 2.6 8.5Z')]],
    ['dokument', 'Dokument', 'Medien', [n('M5 2h10l5 5v15H5Z'), n(R(7.5, 10, 9, 1.6, 0.8)), n(R(7.5, 13.5, 9, 1.6, 0.8)), n(R(7.5, 17, 6, 1.6, 0.8)), a('M15 2v5h5Z')]],
    ['buch', 'Buch', 'Medien', [n('M3 4.5C5.5 3.5 8.5 3.5 11 5v16c-2.5-1.4-5.5-1.4-8-.4Z'), n('M21 4.5c-2.5-1-5.5-1-8 .5v16c2.5-1.4 5.5-1.4 8-.4Z'), a(R(14.5, 8, 4.5, 1.4, 0.7)), a(R(14.5, 11, 4.5, 1.4, 0.7))]],
    ['lupe', 'Lupe', 'Medien', [n(RING(10, 10, 7.5, 2.4)), n(LINE(15.5, 15.5, 21.5, 21.5, 3.2)), a(C(10, 10, 3.2))]],
    ['link', 'Link', 'Medien', [n('M10 7.5l2.2-2.2a4.5 4.5 0 0 1 6.4 6.4l-2.2 2.2-1.6-1.6 2.2-2.2a2.2 2.2 0 0 0-3.2-3.2L11.6 9.1Z'), n('M14 16.5l-2.2 2.2a4.5 4.5 0 0 1-6.4-6.4l2.2-2.2 1.6 1.6-2.2 2.2a2.2 2.2 0 0 0 3.2 3.2l2.2-2.2Z'), a(LINE(9, 15, 15, 9, 2.2))]],
    ['wlan', 'Internet', 'Medien', [n('M1 9a16 16 0 0 1 22 0l-2 2a13 13 0 0 0-18 0Z'), n('M5 13a10.5 10.5 0 0 1 14 0l-2 2a7.6 7.6 0 0 0-10 0Z'), a(C(12, 19, 2.2))]],
    ['algorithmus', 'Algorithmus', 'Medien', [n(R(3, 3, 6, 6, 1)), n(R(15, 3, 6, 6, 1)), n(R(9, 15, 6, 6, 1)), n(LINE(6, 9, 11, 15, 1.6)), n(LINE(18, 9, 13, 15, 1.6)), a(C(12, 12, 2))]],
    ['ki', 'KI-Chip', 'Medien', [n(R(5, 5, 14, 14, 2) + R(7.5, 7.5, 9, 9, 0.5)), n(R(8, 2, 1.6, 3)), n(R(11.2, 2, 1.6, 3)), n(R(14.4, 2, 1.6, 3)), n(R(8, 19, 1.6, 3)), n(R(11.2, 19, 1.6, 3)), n(R(14.4, 19, 1.6, 3)), n(R(2, 8, 3, 1.6)), n(R(2, 11.2, 3, 1.6)), n(R(2, 14.4, 3, 1.6)), n(R(19, 8, 3, 1.6)), n(R(19, 11.2, 3, 1.6)), n(R(19, 14.4, 3, 1.6)), a(R(9.5, 9.5, 5, 5, 0.6))]],
    ['like', 'Daumen hoch', 'Medien', [n(R(2, 10, 4, 11, 1)), n('M7.5 10.5L11.5 3a2 2 0 0 1 2.7 1.8l-.7 4.7H20a2 2 0 0 1 2 2.4l-1.6 7.8A2 2 0 0 1 18.4 21H7.5Z'), a(C(4, 18.5, 0.9))]],
    ['dislike', 'Daumen runter', 'Medien', [n(R(2, 3, 4, 11, 1)), n('M7.5 13.5L11.5 21a2 2 0 0 0 2.7-1.8l-.7-4.7H20a2 2 0 0 0 2-2.4l-1.6-7.8A2 2 0 0 0 18.4 3H7.5Z'), a(C(4, 5.5, 0.9))]],
    ['benachrichtigung', 'Glocke', 'Medien', [n('M12 2.5a1.5 1.5 0 0 1 1.5 1.5v.6A6.5 6.5 0 0 1 18.5 11v4.5L21 18v1H3v-1l2.5-2.5V11a6.5 6.5 0 0 1 5-6.4V4A1.5 1.5 0 0 1 12 2.5Z'), a('M9.5 20h5a2.5 2.5 0 0 1-5 0Z')]],
    // ───── Menschen & Gesellschaft ─────
    ['person', 'Person', 'Menschen', [n(PERSON(12, 13, 1.25))]],
    ['gruppe', 'Gruppe', 'Menschen', [n(PERSON(6, 14, 0.75)), n(PERSON(18, 14, 0.75)), a(PERSON(12, 13.5, 1))]],
    ['menge', 'Viele Menschen', 'Menschen', [n(PERSON(4.5, 10, 0.55)), n(PERSON(12, 10, 0.55)), n(PERSON(19.5, 10, 0.55)), n(PERSON(8.2, 18.5, 0.55)), a(PERSON(15.8, 18.5, 0.55))]],
    ['arbeiterin', 'Beschäftigte', 'Menschen', [n(PERSON(12, 14, 1.2)), a('M7.3 6.8a4.7 4.7 0 0 1 9.4 0v.8H7.3Z'), a(R(6, 7.2, 12, 1.4, 0.7))]],
    ['familie', 'Familie', 'Menschen', [n(PERSON(6.5, 13, 0.85)), n(PERSON(17.5, 13, 0.85)), a(PERSON(12, 17, 0.55))]],
    ['kind', 'Kind', 'Menschen', [n(C(12, 6.5, 3.5)), n('M7 22v-6a5 5 0 0 1 10 0v6Z'), a(R(9, 15, 6, 2, 1))]],
    ['kinderwagen', 'Kinderwagen', 'Menschen', [n('M3 10h16a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7Z'), a('M11 2.2V10H3.2A8 8 0 0 1 11 2.2Z'), n(C(7, 20, 2)), n(C(16, 20, 2)), n(R(19, 5, 3, 1.8, 0.9)), n(R(18.5, 5, 1.8, 6, 0.9))]],
    ['schule', 'Schule', 'Menschen', [n('M12 3l11 5-11 5L1 8Z'), n('M5 11v5c0 2 3.2 3.6 7 3.6s7-1.6 7-3.6v-5l-7 3.2Z'), a(R(20.5, 8, 1.4, 8, 0.7)), a(C(21.2, 16.5, 1.3))]],
    ['krankenhaus', 'Gesundheit', 'Menschen', [n(R(3, 3, 18, 18, 3)), a('M10 6.5h4v3.5h3.5v4H14v3.5h-4V14H6.5v-4H10Z')]],
    ['herz', 'Herz', 'Menschen', [a('M12 21l-1.4-1.3C5.4 15 2 12 2 8.2 2 5.1 4.4 2.8 7.4 2.8c1.7 0 3.4.8 4.6 2.1 1.2-1.3 2.9-2.1 4.6-2.1 3 0 5.4 2.3 5.4 5.4 0 3.8-3.4 6.8-8.6 11.5Z')]],
    ['hand', 'Offene Hand', 'Menschen', [n('M8 21l-4.6-6.6a1.7 1.7 0 0 1 2.7-2L8 14V4.8a1.5 1.5 0 0 1 3 0V11h.5V3.5a1.5 1.5 0 0 1 3 0V11h.5V4.8a1.5 1.5 0 0 1 3 0V11h.5V7.2a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6Z')]],
    ['haende', 'Hände', 'Menschen', [n('M2 13l3.5-1.5c1.5-.6 3.2-.4 4.4.6L12 14H8v1.5h5.6l5-2a1.6 1.6 0 0 1 1.2 3L13 19.5a4 4 0 0 1-2.8 0L2 17Z'), a(C(12, 6.5, 3.5))]],
    ['rollstuhl', 'Barrierefreiheit', 'Menschen', [n(C(11, 3.6, 2)), n('M9.4 7h2.4v5h5.2l2.4 6 1.6-.6.8 2-3.6 1.4-2.6-6.8H11a1.6 1.6 0 0 1-1.6-1.6Z'), a(RING(9.5, 16, 6, 1.8))]],
    ['einzeln', 'Einzelperson gegen viele', 'Menschen', [a(PERSON(4.5, 14, 0.8)), n(PERSON(13, 9.5, 0.55)), n(PERSON(19.5, 9.5, 0.55)), n(PERSON(13, 18.5, 0.55)), n(PERSON(19.5, 18.5, 0.55))]],
    ['sprechende', 'Rede', 'Menschen', [n(PERSON(8, 14, 1.1)), a('M15 3h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-3l-2 2V9h-1a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z')]],
    // ───── Umwelt & Energie ─────
    ['baum', 'Baum', 'Umwelt', [n('M12 2a6 6 0 0 1 5.8 7.6A4.6 4.6 0 0 1 16.4 18H7.6a4.6 4.6 0 0 1-1.4-8.4A6 6 0 0 1 12 2Z'), a(R(11, 13, 2, 9))]],
    ['blatt', 'Blatt', 'Umwelt', [n('M20 3C10 3 4 8 4 15c0 1.6.4 3 1 4.2C6.2 14 9.6 10.6 14 9c-3.6 2.4-6.2 5.6-7.6 11 1.3.6 2.8 1 4.4 1C18 21 21 13 20 3Z')]],
    ['sonne', 'Sonne', 'Umwelt', [a(C(12, 12, 4.6)), ...[0, 45, 90, 135, 180, 225, 270, 315].map(d => { const r = d * Math.PI / 180; return n(LINE(12 + Math.cos(r) * 7, 12 + Math.sin(r) * 7, 12 + Math.cos(r) * 10.4, 12 + Math.sin(r) * 10.4, 2)); })]],
    ['wolke', 'Wolke', 'Umwelt', [n('M6.5 19a4.5 4.5 0 0 1-.4-9A6.5 6.5 0 0 1 18.6 9 5 5 0 0 1 18 19Z')]],
    ['regen', 'Unwetter', 'Umwelt', [n('M6.5 14a4.5 4.5 0 0 1-.4-9A6.5 6.5 0 0 1 18.6 4 5 5 0 0 1 18 14Z'), a('M12 14.5l-3 4.5h2.5l-1.5 4 5-5.5h-2.6l1.6-3Z')]],
    ['tropfen', 'Wasser', 'Umwelt', [n('M12 2s7 7.6 7 12.5A7 7 0 0 1 5 14.5C5 9.6 12 2 12 2Z'), a('M8.5 14.5a3.5 3.5 0 0 0 3.5 3.5V20a5.5 5.5 0 0 1-5.5-5.5Z')]],
    ['thermometer', 'Klima', 'Umwelt', [n('M10 4a2 2 0 0 1 4 0v9.6a4.5 4.5 0 1 1-4 0Z'), a(C(12, 17.5, 2.4)), a(R(11.2, 8, 1.6, 9)), n(R(16, 5, 4, 1.6, 0.8)), n(R(16, 8.5, 3, 1.6, 0.8))]],
    ['erde', 'Globus', 'Umwelt', [n(C(12, 12, 10)), a('M7 5.2c1.5.5 2.2 1.8 1.6 3.2-.6 1.2-2.2 1.2-2.4 2.8-.2 1.4 1.4 2 1.2 3.6-.2 1.4-1.6 1.8-1.6 3.4A8 8 0 0 1 7 5.2Z'), a('M15 4.6c1.4.4 1.2 2 2.4 2.4 1.3.5 2.6-.2 3.2.9a8 8 0 0 1-1.8 9.9c-.8-1.2-.2-2.8-1.4-3.6-1.4-1-3.4.2-4.2-1.4-.8-1.6 1.2-2.6.6-4.4-.4-1.4-1.6-1.8-1.8-3.2A8 8 0 0 1 15 4.6Z')]],
    ['windrad', 'Windkraft', 'Umwelt', [n('M11.2 10h1.6l.8 12h-3.2Z'), a('M12 9.5L10.6 2.2a1.4 1.4 0 0 1 2.8 0Z'), a('M12.6 10.8l6.8 3a1.4 1.4 0 0 1-1.4 2.4Z'), a('M11.4 10.8l-5.6 4.8a1.4 1.4 0 0 1-1.4-2.4Z'), n(C(12, 10, 1.6))]],
    ['solar', 'Solarenergie', 'Umwelt', [n('M4 11h16l2 8H2Z'), n(R(11, 19, 2, 3)), n(R(8, 21, 8, 1.4)), a(C(12, 5, 2.6)), n(LINE(7.3, 11, 6.7, 19, 1)), n(LINE(16.7, 11, 17.3, 19, 1)), n(LINE(12, 11, 12, 19, 1)), n(R(3, 14.6, 18, 1))]],
    ['atom', 'Atomkraft', 'Umwelt', [a(C(12, 12, 2)), n('M12 7.5c5.5 0 10 2 10 4.5s-4.5 4.5-10 4.5S2 14.5 2 12s4.5-4.5 10-4.5Zm0 1.8c-4.6 0-8.2 1.4-8.2 2.7s3.6 2.7 8.2 2.7 8.2-1.4 8.2-2.7-3.6-2.7-8.2-2.7Z'), n('M7.4 4.3c2.7-4.8 6.9-2.6 9.6 2.1s2.9 9.5-.4 11.2c-3.4 1.7-7.6-1.1-9.9-5.6-1.3-2.6-1.9-5.5.7-7.7Zm.9 1.6c-1.6 1.4-.6 4.3.5 6.3 1.9 3.6 5 5.7 6.7 4.9 1.6-.9 1.3-4.6-.9-8.4s-5-4.9-6.3-2.8Z')]],
    ['strahlung', 'Strahlung', 'Umwelt', [n(RING(12, 12, 10.5, 1.8)), a(C(12, 12, 1.8)), ...[-90, 30, 150].map(d => a(SECTOR(12, 12, 2.9, 7.6, d - 30, d + 30)))]],
    ['fabrik-rauch', 'Emissionen', 'Umwelt', [n('M2 22V13l5 3v-3l5 3v-3l5 3V8h4v14Z'), a('M17 6.5c0-1.6 1.2-2 2.2-2 .2-1.4 1.4-2.5 3-2.5v2c-.6 0-1 .4-1 1v1h-1.2c-.6 0-1 .3-1 .6Z'), a(C(8, 7, 2.2)), a(C(11.5, 5, 1.6))]],
    ['auto', 'Auto', 'Alltag', [n('M5.5 6h13l2.5 6h1v6h-2.2a2.3 2.3 0 0 1-4.6 0H8.8a2.3 2.3 0 0 1-4.6 0H2v-6h1Zm1.4 2L5.3 12h13.4l-1.6-4Z'), a(R(3.6, 13.5, 3, 1.8, 0.9)), a(R(17.4, 13.5, 3, 1.8, 0.9))]],
    ['bus', 'Bus', 'Alltag', [n(R(4, 2, 16, 17, 2.5) + R(6, 5, 12, 6, 0.6)), n(R(5, 18, 3, 3.5, 1)), n(R(16, 18, 3, 3.5, 1)), a(C(8, 15, 1.3)), a(C(16, 15, 1.3))]],
    ['zug', 'Bahn', 'Alltag', [n(R(5, 2, 14, 16, 3.5) + R(7, 5, 10, 5, 0.6)), a(C(9, 14, 1.3)), a(C(15, 14, 1.3)), n(LINE(8, 18, 5, 22, 1.6)), n(LINE(16, 18, 19, 22, 1.6))]],
    ['fahrrad', 'Fahrrad', 'Alltag', [n(RING(5.5, 16, 4, 1.6) + RING(18.5, 16, 4, 1.6)), n(LINE(5.5, 16, 9.5, 8.5, 1.8)), n(LINE(9.5, 8.5, 16.5, 8.5, 1.8)), n(LINE(16.5, 8.5, 12, 16, 1.8)), n(LINE(5.5, 16, 12, 16, 1.8)), n(LINE(16.5, 8.5, 18.5, 16, 1.8)), n(LINE(15.2, 5.5, 16.5, 8.5, 1.8)), n(R(13.5, 4.6, 4, 1.8, 0.9)), n(R(7.5, 6.4, 4.5, 1.8, 0.9)), a(C(12, 16, 1.6))]],
    ['flugzeug', 'Flugzeug', 'Alltag', [n('M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5Z')]],
    ['essen', 'Teller', 'Alltag', [n(RING(13, 12, 8.6, 1.8)), a(C(13, 12, 4.4)), n(R(1.5, 3, 1.4, 6)), n(R(3.4, 3, 1.4, 6)), n('M1.5 8.5h3.3v2.2l-.8.6V21H2.3v-9.7l-.8-.6Z')]],
    ['brot', 'Lebensmittel', 'Alltag', [n('M4 10.5C2.6 10.5 2 9.6 2 8.5 2 5.5 6.4 3 12 3s10 2.5 10 5.5c0 1.1-.6 2-2 2V21H4Z'), a(R(7, 13, 10, 1.6, 0.8)), a(R(7, 16.5, 7, 1.6, 0.8))]],
    ['einkaufstasche', 'Einkauf', 'Alltag', [n('M4 8h16l-1.2 14H5.2Z'), n('M8 8V6.5a4 4 0 0 1 8 0V8h-1.8V6.5a2.2 2.2 0 0 0-4.4 0V8Z'), a(C(12, 14.5, 2.4))]],
    ['uhr', 'Uhr', 'Alltag', [n(C(12, 12, 10) + C(12, 12, 8.2)), a(R(11.1, 5.5, 1.8, 7.5, 0.9)), a(LINE(12, 12, 16, 15, 1.8))]],
    ['kalender', 'Kalender', 'Alltag', [n(R(2, 4, 20, 18, 2) + R(4, 10, 16, 10)), n(R(6.5, 2, 2, 4, 1)), n(R(15.5, 2, 2, 4, 1)), a(R(13.5, 14, 4, 4, 0.6))]],
    ['ort', 'Ortsmarke', 'Alltag', [n('M12 2a7.5 7.5 0 0 1 7.5 7.5c0 5.6-7.5 12.5-7.5 12.5S4.5 15.1 4.5 9.5A7.5 7.5 0 0 1 12 2Z' + C(12, 9.5, 3)), a(C(12, 9.5, 1.5))]],
    ['karte', 'Karte', 'Alltag', [n('M2 5l6-2.5 8 3 6-2.5v16l-6 2.5-8-3-6 2.5Z'), a('M8 2.5l8 3v16l-8-3Z')]],
    ['schluessel', 'Schlüssel', 'Alltag', [n(RING(7.5, 12, 5, 2.2)), n(R(12, 11, 10, 2.2, 1)), n(R(17, 13, 2, 3.5, 0.5)), a(R(20, 13, 2, 2.5, 0.5))]],
    ['schloss', 'Schloss', 'Alltag', [n('M7 10V7a5 5 0 0 1 10 0v3h-2.2V7a2.8 2.8 0 0 0-5.6 0v3Z'), n(R(4, 10, 16, 12, 2)), a(C(12, 15, 1.8)), a(R(11.2, 15, 1.6, 3.6, 0.6))]],
    ['gluehbirne', 'Idee', 'Alltag', [a('M12 2a7 7 0 0 1 4 12.7V17H8v-2.3A7 7 0 0 1 12 2Z'), n(R(8, 18, 8, 1.8, 0.9)), n(R(9, 20.4, 6, 1.8, 0.9))]],
    ['tuer', 'Tür', 'Alltag', [n(R(5, 2, 14, 20, 1) + R(7, 4, 10, 18)), a('M7 4l7 2v16l-7-2Z'), n(C(12.5, 13, 0.9))]],
    ['mauer', 'Mauer', 'Alltag', [n(R(2, 4, 9, 4)), n(R(13, 4, 9, 4)), n(R(2, 10, 4, 4)), n(R(8, 10, 8, 4)), n(R(18, 10, 4, 4)), n(R(2, 16, 9, 4)), a(R(13, 16, 9, 4))]],
    ['bruecke', 'Brücke', 'Alltag', [n('M1 12h22v2.5h-2v6h-3v-3a6 6 0 0 0-12 0v3H3v-6H1Z'), a(R(1, 8, 22, 2))]],
    ['baustelle', 'Baustelle', 'Alltag', [n('M9.6 3h4.8l5 16h-14.8Z'), a('M8.6 8h6.8l1.1 3.6h-9Z'), a('M6.8 14h10.4l1.1 3.6H5.7Z'), n(R(2, 19, 20, 3, 1))]],
    // ───── Krieg & Frieden ─────
    ['taube', 'Friedenstaube', 'Frieden', [n('M2 11c3.6-1.4 6.6-1 9 1 .6-3 2.4-5.6 5-6.8.6-1.4 1.8-2.2 3.2-2.2L22 4.4l-2.2.9c.4 4.4-1.6 9.4-6.6 11.7l2 4h-2.2l-1.7-3.4c-.6.1-1.3.2-2 .2l-1 3.2H6.2l1.2-3.6C4.8 16.4 3 14.2 2 11Z'), a('M16.6 2.8l3.2 1.2-.8.7Z')]],
    ['frieden', 'Friedenszeichen', 'Frieden', [n(RING(12, 12, 10, 2.2)), n(R(10.9, 2.5, 2.2, 19)), n(LINE(12, 12.4, 5.2, 18.8, 2.2)), n(LINE(12, 12.4, 18.8, 18.8, 2.2))]],
    ['panzer', 'Panzer', 'Krieg', [n(R(2, 14, 20, 6, 3)), n('M5 9h10l2 5H4Z'), n(R(14, 9.6, 8, 1.8, 0.4)), a(C(6, 17, 1.4)), a(C(10, 17, 1.4)), a(C(14, 17, 1.4)), a(C(18, 17, 1.4))]],
    ['soldat', 'Soldat', 'Krieg', [n(C(12, 8, 3.2)), n('M6.6 7.4a5.4 5.4 0 0 1 10.8 0v1.3H6.6Z'), n('M5 22v-4.4a5.6 5.6 0 0 1 5.6-5.6h2.8a5.6 5.6 0 0 1 5.6 5.6V22Z'), a(R(5, 15.5, 14, 2))]],
    ['rakete', 'Rakete', 'Krieg', [n('M12 1.5c2.6 2 4 5 4 8.5v7H8v-7c0-3.5 1.4-6.5 4-8.5Z'), n('M8 12l-3 4v3h3Z'), n('M16 12l3 4v3h-3Z'), a('M9.5 18h5l-1 4h-3Z'), a(C(12, 8, 1.6))]],
    ['bombe', 'Explosion', 'Krieg', [a('M12 1l2.2 5.4L19.8 3.6 17.8 9l5.2 1.8-5.2 2.4 3 5-5.6-1.4L14.2 22 12 17l-2.2 5-1-5.6-5.6 1.4 3-5L1 10.8 6.2 9 4.2 3.6l5.6 2.8Z'), n('M12 6.5l1.3 3.2 3.4-1.1-1.6 3.2 3.2 1.4-3.4.8.9 3.4-3-2-1.6 3-.6-3.4-3.4.5L9.2 13l-3-1.6 3.4-.9-.8-3.4 2.9 1.9Z')]],
    ['schwert', 'Schwert', 'Krieg', [n('M19.5 2.5L21.5 4.5 10 16l-2-2Z'), a(LINE(5.5, 13, 11, 18.5, 2.4)), n(LINE(8, 16, 3, 21, 2.2)), n(C(3, 21, 1.5))]],
    ['abruestung', 'Abrüstung', 'Frieden', [n('M19.5 2.5L21.5 4.5 10 16l-2-2Z'), n(LINE(8, 16, 3, 21, 2.2)), a(RING(12, 12, 10, 2)), a(LINE(5, 19, 19, 5, 2))]],
    // ───── Zeichen & Pfeile ─────
    ['haken', 'Haken', 'Zeichen', [a('M3 12.5l2.4-2.4 4.1 4.1L18.6 5l2.4 2.4L9.5 19Z')]],
    ['kreuz', 'Kreuz', 'Zeichen', [a('M5 3l7 7 7-7 2 2-7 7 7 7-2 2-7-7-7 7-2-2 7-7-7-7Z')]],
    ['haken-kreis', 'Richtig', 'Zeichen', [n(C(12, 12, 10)), a('M6.5 12.5l1.8-1.8 2.7 2.7 5-5 1.8 1.8L11 17Z')]],
    ['kreuz-kreis', 'Falsch', 'Zeichen', [n(C(12, 12, 10)), a('M8 9.6L9.6 8l2.4 2.4L14.4 8 16 9.6 13.6 12l2.4 2.4-1.6 1.6-2.4-2.4-2.4 2.4L8 14.4l2.4-2.4Z')]],
    ['ausrufe', 'Achtung', 'Zeichen', [n('M12 2l10.5 19h-21Z'), a(R(11, 8, 2, 7, 1)), a(C(12, 17.6, 1.2))]],
    ['frage', 'Frage', 'Zeichen', [n(C(12, 12, 10)), a('M9 9.3a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1-1.5 2.1v.5h-2v-.6c0-1.9 1-2.7 2-3.3a1 1 0 1 0-1.5-.9V10H9Z'), a(C(11, 17, 1.2))]],
    ['info', 'Info', 'Zeichen', [n(C(12, 12, 10)), a(R(11, 10, 2, 7.5, 1)), a(C(12, 7.2, 1.3))]],
    ['stopp', 'Stopp', 'Zeichen', [a('M8 2h8l6 6v8l-6 6H8l-6-6V8Z'), n(R(6, 10.8, 12, 2.4, 1))]],
    ['verbot', 'Verbot', 'Zeichen', [a(RING(12, 12, 10, 2.4)), a(LINE(5, 19, 19, 5, 2.4))]],
    ['pfeil-rechts', 'Pfeil rechts', 'Pfeile', [a(ARROW_R(2, 12, 20, 4, 7))]],
    ['pfeil-links', 'Pfeil links', 'Pfeile', [a('M22 10v4H9v5l-7-7 7-7v5Z')]],
    ['pfeil-hoch', 'Pfeil hoch', 'Pfeile', [a('M10 22h4V9h5l-7-7-7 7h5Z')]],
    ['pfeil-runter', 'Pfeil runter', 'Pfeile', [a('M10 2h4v13h5l-7 7-7-7h5Z')]],
    ['pfeil-kreis', 'Kreislauf', 'Pfeile', [n('M12 4a8 8 0 0 1 7.7 5.9l-2 .5A6 6 0 0 0 6.3 10l2.2 1.2L3 13.5l.2-6 1.5 2A8 8 0 0 1 12 4Z'), a('M12 20a8 8 0 0 1-7.7-5.9l2-.5a6 6 0 0 0 11.4.4l-2.2-1.2 5.5-2.3-.2 6-1.5-2A8 8 0 0 1 12 20Z')]],
    ['pfeile-gegen', 'Gegenüber', 'Pfeile', [n('M2 8l5-5v3h8v4H7v3Z'), a('M22 16l-5 5v-3H9v-4h8v-3Z')]],
    ['tauschen', 'Wechsel', 'Pfeile', [n('M7 3l5 5H9v8H5V8H2Z'), a('M17 21l-5-5h3V8h4v8h3Z')]],
    ['ziel', 'Ziel', 'Zeichen', [n(RING(12, 12, 10, 2.2) + RING(12, 12, 6, 2.2)), a(C(12, 12, 2.2))]],
    ['stern', 'Stern', 'Zeichen', [a('M12 2l2.9 6.4 7 .7-5.2 4.7 1.5 6.9L12 17.2l-6.2 3.5 1.5-6.9L2.1 9.1l7-.7Z')]],
    ['blitz', 'Blitz', 'Zeichen', [a('M14 1L4 14h7l-2 9 11-13h-7Z')]],
    ['plus', 'Plus', 'Zeichen', [a('M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7Z')]],
    ['minus', 'Minus', 'Zeichen', [a(R(3, 10, 18, 4, 1))]],
    ['gleich', 'Gleich', 'Zeichen', [n(R(3, 6.5, 18, 4, 1)), a(R(3, 13.5, 18, 4, 1))]],
    ['ungleich', 'Ungleich', 'Zeichen', [n(R(3, 6.5, 18, 4, 1)), n(R(3, 13.5, 18, 4, 1)), a(LINE(17, 2, 7, 22, 2.6))]],
    ['rang', 'Rangliste', 'Zeichen', [n(R(2, 13, 6, 9, 0.6)), a(R(9, 7, 6, 15, 0.6)), n(R(16, 16, 6, 6, 0.6))]],
    ['waage-ungleich', 'Ungleichheit', 'Recht', [n(R(11, 4, 2, 15)), n(R(7, 19, 10, 3, 1)), n(LINE(3.5, 8.5, 20.5, 3.5, 2)), a('M1 14.5l2.5-5.5 2.5 5.5a2.5 2.5 0 0 1-5 0Z'), n('M18 10l2.5-5.5L23 10a2.5 2.5 0 0 1-5 0Z')]],
    ['spaltung', 'Spaltung', 'Gesellschaft', [n('M2 4h8.5l-2 4 2.5 3-2 4 2 5H2Z'), a('M22 4h-9.5l-2 4 2.5 3-2 4 2 5H22Z')]],
    ['oben-unten', 'Oben und unten', 'Gesellschaft', [a(PERSON(12, 8.5, 0.7)), n(R(3, 13, 18, 1.6, 0.8)), n(PERSON(5.5, 21, 0.45)), n(PERSON(12, 21, 0.45)), n(PERSON(18.5, 21, 0.45))]],
  ];
  const LIB = new Map();
  for (const [k, label, cat, parts] of ICONS) LIB.set(k, {k, label, cat, parts: parts.map(p => ({acc: !!p.acc, p: null, d: p.d}))});
  const path = part => part.p || (part.p = new Path2D(part.d));
  // Zeichen in eine Fläche (x, y, s = Kantenlänge) zeichnen. col = Grundfarbe, acc = Akzentfarbe (null = alles in col)
  function draw(ctx, k, x, y, s, col, acc){
    const ic = LIB.get(k); if (!ic) return false;
    ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24);
    for (const part of ic.parts){ ctx.fillStyle = part.acc && acc ? acc : col; ctx.fill(path(part), 'evenodd'); }
    ctx.restore(); return true;
  }
  // Als SVG (für Vorschaubilder in der Bibliothek)
  function svg(k, col = 'currentColor', acc = 'var(--acc, #E5402A)'){
    const ic = LIB.get(k); if (!ic) return '';
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ic.parts.map(p => `<path fill-rule="evenodd" d="${p.d}" fill="${p.acc ? acc : col}"/>`).join('')}</svg>`;
  }
  const CATS = [...new Set(ICONS.map(i => i[2]))];
  // Suche nach Bezeichnung, Schlüssel und Kategorie
  const EXTRA = {megafon: 'lautsprecher aufruf', faust: 'widerstand kampf', streik: 'arbeitskampf gewerkschaft', wahlurne: 'wahl abstimmung', parlament: 'bundestag regierung',
    polizei: 'staat ordnung', ueberwachung: 'geheimdienst kontrolle', geld: 'lohn einkommen kapital', euro: 'preis kosten', handy: 'social media tiktok instagram',
    play: 'youtube', kind: 'kinderrechte jugend', familie: 'alleinerziehend eltern', atom: 'kernkraft akw nuklear', thermometer: 'klimakrise erwärmung', taube: 'pazifismus',
    panzer: 'bundeswehr militär aufrüstung', soldat: 'wehrpflicht bundeswehr armee', rakete: 'aufrüstung waffe', haus: 'wohnen wohnung', miete: 'wohnen mietendeckel',
    krone: 'herrschaft macht monarchie', kette: 'unterdrückung', 'kette-gebrochen': 'befreiung revolution', waage: 'gerechtigkeit justiz gericht', paragraf: 'gesetz recht',
    zeitung: 'presse journalismus', kamera: 'film video', algorithmus: 'plattform netzwerk', ki: 'künstliche intelligenz computer', 'oben-unten': 'klasse hierarchie',
    einzeln: 'talkshow einer gegen alle', spaltung: 'polarisierung', solidaritaet: 'bündnis zusammenhalt', grenze: 'migration abschiebung flucht', ausweis: 'staatsbürgerschaft migration'};
  function search(q){
    q = String(q || '').trim().toLowerCase(); const all = [...LIB.values()];
    if (!q) return all;
    return all.filter(i => (i.k + ' ' + i.label + ' ' + i.cat + ' ' + (EXTRA[i.k] || '')).toLowerCase().includes(q));
  }
  // Passendes Zeichen zu einem Text vorschlagen: Stichwort muss am Wortanfang stehen (Streik → Streikkasse, nicht bestellte → Teller)
  const STOP = new Set(['gegen', 'einer', 'alle', 'oben', 'unten', 'viele', 'offene', 'hoch', 'runter', 'links', 'rechts', 'mitte', 'zeichen', 'symbol', 'personen', 'person']);
  const kw = new Map();
  for (const i of LIB.values()) kw.set(i.k, [...new Set((i.label + ' ' + (EXTRA[i.k] || '') + ' ' + i.k.replace(/-/g, ' ')).toLowerCase().split(/[\s/]+/).filter(w => w.length >= 4 && !STOP.has(w)))]);
  function suggest(text, min = 4){
    const ws = String(text || '').toLowerCase().split(/[^a-zäöüß0-9]+/).filter(w => w.length >= 4), hits = [];
    if (!ws.length) return [];
    for (const [k, keys] of kw){
      let sc = 0;
      for (const key of keys){ const stem = key.slice(0, Math.max(4, key.length - 2)); if (ws.some(w => w.startsWith(stem) && w.length <= key.length + 9)) sc += key.length; }
      if (sc >= min) hits.push([sc, k]);
    }
    return hits.sort((p, q) => q[0] - p[0]).map(h => h[1]);
  }
  (typeof window !== 'undefined' ? window : globalThis).HoneyDeckIcons = {LIB, CATS, draw, svg, search, suggest, list: () => [...LIB.values()]};
})();
