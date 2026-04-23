const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const { FaShieldAlt, FaChartLine, FaGhost, FaBrain, FaSearch, FaCalendarWeek, FaPhone, FaHeartbeat, FaExclamationTriangle, FaRocket, FaUserTie, FaLightbulb, FaSync, FaDatabase, FaBullseye, FaEnvelope, FaTrophy, FaChartBar, FaPencilAlt, FaTicketAlt, FaEye, FaCog, FaStar } = require("react-icons/fa");

// ============================================================
// THEME & CONSTANTS
// ============================================================
const NAVY = "0D1B2A";
const DARK = "1B2838";
const CHARCOAL = "2C3E50";
const TEAL = "00BFA6";
const GOLD = "F0B429";
const WHITE = "FFFFFF";
const LIGHT_GRAY = "B0BEC5";
const MID_GRAY = "78909C";
const RED = "EF5350";
const ORANGE = "FF9800";
const YELLOW = "FDD835";
const GREEN = "66BB6A";
const SLIDE_W = 10;
const SLIDE_H = 5.625;

function renderIconSvg(IconComponent, color = "#FFFFFF", size = 256) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
}

async function iconToBase64Png(IconComponent, color, size = 256) {
  const svg = renderIconSvg(IconComponent, color, size);
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + pngBuffer.toString("base64");
}

// Helper: dark slide with optional accent bar
function darkSlide(pres, opts = {}) {
  const slide = pres.addSlide();
  slide.background = { color: opts.bg || NAVY };
  // Top teal accent line
  if (opts.accentTop !== false) {
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: 0.04, fill: { color: TEAL } });
  }
  return slide;
}

// Helper: section header slide
function sectionHeader(pres, number, title, subtitle, icon) {
  const slide = darkSlide(pres, { bg: DARK });
  // Large number — wider box and smaller font for ranges like "18-21"
  const isRange = number.includes("-");
  const numW = isRange ? 4.5 : 2;
  const numSize = isRange ? 60 : 72;
  slide.addText(number, { x: 0.6, y: 0.8, w: numW, h: 1.5, fontSize: numSize, fontFace: "Arial Black", color: TEAL, bold: true, align: "left", margin: 0 });
  // Title
  slide.addText(title.toUpperCase(), { x: 0.6, y: 2.3, w: 8.5, h: 0.8, fontSize: 30, fontFace: "Arial Black", color: WHITE, bold: true, margin: 0 });
  // Subtitle
  slide.addText(subtitle, { x: 0.6, y: 3.1, w: 8.5, h: 0.7, fontSize: 14, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  // Right accent bar
  slide.addShape(pres.shapes.RECTANGLE, { x: 9.6, y: 0, w: 0.4, h: SLIDE_H, fill: { color: TEAL } });
  if (icon) {
    slide.addImage({ data: icon, x: 8.5, y: 1.0, w: 0.8, h: 0.8 });
  }
  return slide;
}

// Helper: content slide with title
function contentSlide(pres, title, opts = {}) {
  const slide = darkSlide(pres, { bg: opts.bg || NAVY });
  slide.addText(title, { x: 0.5, y: 0.2, w: 9, h: 0.5, fontSize: 20, fontFace: "Arial Black", color: TEAL, bold: true, margin: 0 });
  // thin separator
  slide.addShape(pres.shapes.LINE, { x: 0.5, y: 0.72, w: 3, h: 0, line: { color: TEAL, width: 1.5 } });
  return slide;
}

// Helper: metric card (rounded rect with big number)
function addMetricCard(slide, pres, x, y, w, h, value, label, color) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: CHARCOAL }, rectRadius: 0.08 });
  slide.addText(value, { x, y: y + 0.15, w, h: h * 0.5, fontSize: 28, fontFace: "Arial Black", color: color || TEAL, bold: true, align: "center", margin: 0 });
  slide.addText(label, { x, y: y + h * 0.5, w, h: h * 0.45, fontSize: 10, fontFace: "Calibri", color: LIGHT_GRAY, align: "center", margin: 0 });
}

// Helper: flow arrow
function addFlowArrow(slide, pres, x, y) {
  slide.addText("\u2192", { x, y, w: 0.3, h: 0.35, fontSize: 18, color: TEAL, align: "center", margin: 0 });
}

// Helper: flow box
function addFlowBox(slide, pres, x, y, w, text, color) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.4, fill: { color: color || CHARCOAL }, rectRadius: 0.05 });
  slide.addText(text, { x, y, w, h: 0.4, fontSize: 8, fontFace: "Calibri", color: WHITE, align: "center", valign: "middle", margin: 0 });
}

// Helper: bullet list on dark bg
function addBullets(slide, items, x, y, w, h, opts = {}) {
  const textItems = items.map((item, i) => ({
    text: item,
    options: { bullet: true, breakLine: i < items.length - 1, fontSize: opts.fontSize || 11, fontFace: "Calibri", color: opts.color || LIGHT_GRAY }
  }));
  slide.addText(textItems, { x, y, w, h, valign: "top", margin: 0 });
}

// Helper: "Who Uses It" badge row
function addUsersRow(slide, users, x, y) {
  slide.addText("WHO USES IT", { x, y, w: 1.2, h: 0.25, fontSize: 8, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  users.forEach((user, i) => {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 1.3 + i * 2.1, y, w: 2, h: 0.25, fill: { color: CHARCOAL }, rectRadius: 0.04 });
    slide.addText(user, { x: x + 1.3 + i * 2.1, y, w: 2, h: 0.25, fontSize: 8, fontFace: "Calibri", color: WHITE, align: "center", margin: 0 });
  });
}

// Helper: "LIVE EXAMPLE" slide header badge
function addLiveExampleBadge(slide, toolName, date) {
  // Gold badge top-left
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 0.15, w: 1.6, h: 0.28, fill: { color: GOLD }, rectRadius: 0.06 });
  slide.addText("LIVE OUTPUT", { x: 0.5, y: 0.15, w: 1.6, h: 0.28, fontSize: 10, fontFace: "Arial Black", color: NAVY, align: "center", margin: 0 });
  // Tool name
  slide.addText(toolName, { x: 2.3, y: 0.15, w: 5, h: 0.28, fontSize: 10, fontFace: "Calibri", color: TEAL, bold: true, margin: 0 });
  // Date
  slide.addText(date, { x: 7.5, y: 0.15, w: 2, h: 0.28, fontSize: 9, fontFace: "Calibri", color: MID_GRAY, align: "right", margin: 0 });
  // Separator
  slide.addShape(pres.shapes.LINE, { x: 0.5, y: 0.48, w: 9, h: 0, line: { color: GOLD, width: 1 } });
}

// Helper: account risk row for example slides
function addRiskRow(slide, x, y, w, score, name, mrr, owner, riskFactors, tier) {
  const tierColor = score <= 29 ? RED : score <= 49 ? ORANGE : score <= 69 ? YELLOW : GREEN;
  // Score badge
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 0.55, h: 0.55, fill: { color: tierColor }, rectRadius: 0.06 });
  slide.addText(String(score), { x, y, w: 0.55, h: 0.35, fontSize: 16, fontFace: "Arial Black", color: NAVY, align: "center", margin: 0 });
  slide.addText("/100", { x, y: y + 0.3, w: 0.55, h: 0.2, fontSize: 7, fontFace: "Calibri", color: NAVY, align: "center", margin: 0 });
  // Account name
  slide.addText(name, { x: x + 0.65, y, w: 3.2, h: 0.25, fontSize: 11, fontFace: "Arial Black", color: WHITE, margin: 0 });
  // MRR + Owner
  slide.addText((mrr || "MRR unknown") + "  |  " + owner, { x: x + 0.65, y: y + 0.22, w: 3.2, h: 0.18, fontSize: 8, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  // Risk factors
  slide.addText(riskFactors, { x: x + 4.0, y, w: w - 4.0, h: 0.5, fontSize: 8, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0, valign: "top" });
}

// Helper: health score bar visualization
function addScoreBar(slide, x, y, w, label, score, weight) {
  const barW = w - 3.0;
  const fillW = barW * (score / 100);
  const barColor = score >= 70 ? GREEN : score >= 40 ? YELLOW : RED;
  // Label
  slide.addText(label + " (" + weight + ")", { x, y, w: 2.0, h: 0.3, fontSize: 10, fontFace: "Arial Black", color: WHITE, margin: 0, valign: "middle" });
  // Bar background
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 2.1, y: y + 0.03, w: barW, h: 0.24, fill: { color: CHARCOAL }, rectRadius: 0.05 });
  // Bar fill
  if (fillW > 0.05) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 2.1, y: y + 0.03, w: fillW, h: 0.24, fill: { color: barColor }, rectRadius: 0.05 });
  }
  // Score text
  slide.addText(score + "/100", { x: x + 2.1 + barW + 0.15, y, w: 0.7, h: 0.3, fontSize: 10, fontFace: "Arial Black", color: barColor, margin: 0, valign: "middle" });
}

let pres;

async function buildDeck() {
  pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "William Summers";
  pres.title = "Prophet by PDM — Platform Intelligence Briefs";

  // Pre-render icons
  const icons = {
    shield: await iconToBase64Png(FaShieldAlt, "#" + TEAL),
    chart: await iconToBase64Png(FaChartLine, "#" + TEAL),
    ghost: await iconToBase64Png(FaGhost, "#" + TEAL),
    brain: await iconToBase64Png(FaBrain, "#" + TEAL),
    search: await iconToBase64Png(FaSearch, "#" + TEAL),
    calendar: await iconToBase64Png(FaCalendarWeek, "#" + TEAL),
    phone: await iconToBase64Png(FaPhone, "#" + TEAL),
    heart: await iconToBase64Png(FaHeartbeat, "#" + TEAL),
    warning: await iconToBase64Png(FaExclamationTriangle, "#" + TEAL),
    rocket: await iconToBase64Png(FaRocket, "#" + TEAL),
    user: await iconToBase64Png(FaUserTie, "#" + TEAL),
    bulb: await iconToBase64Png(FaLightbulb, "#" + TEAL),
    sync: await iconToBase64Png(FaSync, "#" + TEAL),
    db: await iconToBase64Png(FaDatabase, "#" + TEAL),
    target: await iconToBase64Png(FaBullseye, "#" + TEAL),
    email: await iconToBase64Png(FaEnvelope, "#" + TEAL),
    trophy: await iconToBase64Png(FaTrophy, "#" + TEAL),
    bar: await iconToBase64Png(FaChartBar, "#" + TEAL),
    pencil: await iconToBase64Png(FaPencilAlt, "#" + TEAL),
    ticket: await iconToBase64Png(FaTicketAlt, "#" + TEAL),
    eye: await iconToBase64Png(FaEye, "#" + TEAL),
    cog: await iconToBase64Png(FaCog, "#" + TEAL),
    star: await iconToBase64Png(FaStar, "#" + GOLD),
    ghostWhite: await iconToBase64Png(FaGhost, "#" + WHITE),
    shieldGold: await iconToBase64Png(FaShieldAlt, "#" + GOLD),
  };

  // ============================================================
  // SLIDE 1: TITLE
  // ============================================================
  let s = darkSlide(pres, { accentTop: false, bg: NAVY });
  // Full teal accent bar left
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.15, h: SLIDE_H, fill: { color: TEAL } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: 0.04, fill: { color: TEAL } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: SLIDE_H - 0.04, w: SLIDE_W, h: 0.04, fill: { color: TEAL } });
  s.addText("PROPHET", { x: 0.6, y: 0.8, w: 9, h: 1.2, fontSize: 60, fontFace: "Arial Black", color: WHITE, bold: true, margin: 0 });
  s.addText("BY PDM", { x: 0.6, y: 1.8, w: 9, h: 0.7, fontSize: 36, fontFace: "Arial Black", color: TEAL, bold: true, margin: 0 });
  s.addShape(pres.shapes.LINE, { x: 0.6, y: 2.65, w: 2, h: 0, line: { color: GOLD, width: 2 } });
  s.addText("Platform Intelligence Briefs", { x: 0.6, y: 2.8, w: 9, h: 0.5, fontSize: 20, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  s.addText("AI-Powered Client Retention, Sales Intelligence & Competitive Strategy", { x: 0.6, y: 3.3, w: 8, h: 0.4, fontSize: 13, fontFace: "Calibri", color: MID_GRAY, margin: 0 });
  s.addText("Progressive Dental Marketing  |  April 2026", { x: 0.6, y: 4.6, w: 5, h: 0.3, fontSize: 11, fontFace: "Calibri", color: MID_GRAY, margin: 0 });
  s.addText("CONFIDENTIAL", { x: 7.5, y: 4.6, w: 2, h: 0.3, fontSize: 10, fontFace: "Calibri", color: GOLD, bold: true, align: "right", margin: 0 });

  // ============================================================
  // SLIDE 2: PLATFORM OVERVIEW
  // ============================================================
  s = contentSlide(pres, "PLATFORM OVERVIEW");
  s.addText("Prophet is PDM\u2019s proprietary AI intelligence platform. It connects directly to Salesforce and gives Account Managers and Sales Reps real-time intelligence about clients, prospects, and competitors \u2014 seeing churn, renewals, competitive threats, and opportunities before they become obvious.", { x: 0.5, y: 0.95, w: 9, h: 0.8, fontSize: 12, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  // Strategic goal callout
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.9, w: 9, h: 0.7, fill: { color: CHARCOAL }, rectRadius: 0.06 });
  s.addText([
    { text: "STRATEGIC GOAL:  ", options: { bold: true, color: GOLD, fontSize: 13 } },
    { text: "Increase average client length from 2 years to 8 years. At 8 years, annual churn drops from 35.7% to 12.5% \u2014 protecting $4M+ in annual revenue.", options: { color: WHITE, fontSize: 13 } }
  ], { x: 0.7, y: 1.95, w: 8.6, h: 0.6, fontFace: "Calibri", margin: 0 });
  // Metric cards row
  addMetricCard(s, pres, 0.5, 2.9, 1.7, 1.0, "23", "TOOLS LIVE", TEAL);
  addMetricCard(s, pres, 2.4, 2.9, 1.7, 1.0, "5", "AUTOMATED\nWORKFLOWS", TEAL);
  addMetricCard(s, pres, 4.3, 2.9, 1.7, 1.0, "7", "CONNECTED\nSYSTEMS", TEAL);
  addMetricCard(s, pres, 6.2, 2.9, 1.7, 1.0, "$4M+", "REVENUE\nPROTECTED", GOLD);
  addMetricCard(s, pres, 8.1, 2.9, 1.4, 1.0, "24/7", "TELEGRAM\nASSISTANT", GOLD);
  // Connected systems row
  s.addText("CONNECTED SYSTEMS", { x: 0.5, y: 4.15, w: 3, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const systems = ["Salesforce", "Zoom", "Telegram", "Google Chat", "Gmail", "Gamma", "n8n"];
  systems.forEach((sys, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.3 + i * 1.35, y: 4.45, w: 1.25, h: 0.28, fill: { color: sys === "Telegram" ? TEAL : CHARCOAL }, rectRadius: 0.04 });
    s.addText(sys, { x: 0.3 + i * 1.35, y: 4.45, w: 1.25, h: 0.28, fontSize: 9, fontFace: "Calibri", color: sys === "Telegram" ? NAVY : TEAL, bold: sys === "Telegram", align: "center", margin: 0 });
  });

  // ============================================================
  // SECTION 1: AGENCY COMPETITIVE INTELLIGENCE
  // ============================================================
  sectionHeader(pres, "01", "Agency Competitive Intelligence Scanner", "Reverse-engineer competitor agencies. Discover their clients. Build prospecting lists.", icons.shield);

  s = contentSlide(pres, "HOW IT WORKS");
  // 3-step flow
  const steps = [
    { num: "1", title: "AGENCY AUDIT", desc: "Scan competitor agency website, services, pricing signals, tech stack, team size" },
    { num: "2", title: "CLIENT DISCOVERY", desc: "Use technical fingerprints to identify their actual client list from web footprints" },
    { num: "3", title: "INTELLIGENCE PACKAGE", desc: "Excel spreadsheet + Salesforce write-back with Why Switch to PDM pitch" }
  ];
  steps.forEach((step, i) => {
    const bx = 0.5 + i * 3.2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: bx, y: 0.95, w: 2.8, h: 2.2, fill: { color: CHARCOAL }, rectRadius: 0.08 });
    s.addShape(pres.shapes.OVAL, { x: bx + 1.05, y: 1.05, w: 0.6, h: 0.6, fill: { color: TEAL } });
    s.addText(step.num, { x: bx + 1.05, y: 1.05, w: 0.6, h: 0.6, fontSize: 22, fontFace: "Arial Black", color: NAVY, align: "center", valign: "middle", margin: 0 });
    s.addText(step.title, { x: bx + 0.15, y: 1.75, w: 2.5, h: 0.35, fontSize: 12, fontFace: "Arial Black", color: WHITE, align: "center", margin: 0 });
    s.addText(step.desc, { x: bx + 0.15, y: 2.1, w: 2.5, h: 0.9, fontSize: 10, fontFace: "Calibri", color: LIGHT_GRAY, align: "center", margin: 0 });
    if (i < 2) addFlowArrow(s, pres, bx + 2.85, 1.85);
  });
  // Fingerprints
  s.addText("CONFIRMED AGENCY FINGERPRINTS", { x: 0.5, y: 3.4, w: 4, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const agencies = [
    { name: "DIM", sig: "Duda DFP" }, { name: "Lasso MD", sig: "WP + Elementor" },
    { name: "Implant Engine", sig: "Custom stack" }, { name: "DentalROI", sig: "WP themes" },
    { name: "Driven Dental", sig: "Duda" }, { name: "Implant Prospects", sig: "GoHighLevel" },
    { name: "Dental Lead Machine", sig: "ClickFunnels" }
  ];
  agencies.forEach((a, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5 + col * 2.3, y: 3.75 + row * 0.5, w: 2.15, h: 0.4, fill: { color: CHARCOAL }, rectRadius: 0.04 });
    s.addText([
      { text: a.name, options: { bold: true, color: WHITE, fontSize: 9 } },
      { text: "  " + a.sig, options: { color: MID_GRAY, fontSize: 8 } }
    ], { x: 0.6 + col * 2.3, y: 3.75 + row * 0.5, w: 2, h: 0.4, fontFace: "Calibri", margin: 0, valign: "middle" });
  });
  addUsersRow(s, ["Sales Leadership", "Sales Reps", "Marketing"], 0.5, 4.9);

  // Agency metrics slide
  s = contentSlide(pres, "QUALITY GATES & MEASUREMENT");
  s.addTable([
    [
      { text: "METRIC", options: { fill: { color: TEAL }, color: NAVY, bold: true, fontSize: 11, fontFace: "Arial" } },
      { text: "TARGET", options: { fill: { color: TEAL }, color: NAVY, bold: true, fontSize: 11, fontFace: "Arial" } },
      { text: "HOW MEASURED", options: { fill: { color: TEAL }, color: NAVY, bold: true, fontSize: 11, fontFace: "Arial" } }
    ],
    [
      { text: "Clients Discovered per Scan", options: { color: WHITE, fontSize: 10, fontFace: "Calibri" } },
      { text: "30%+ of estimated base", options: { color: TEAL, bold: true, fontSize: 10, fontFace: "Calibri" } },
      { text: "Dynamic quality gate: floor 20, cap 100", options: { color: LIGHT_GRAY, fontSize: 10, fontFace: "Calibri" } }
    ],
    [
      { text: "Scan Thoroughness Score", options: { color: WHITE, fontSize: 10, fontFace: "Calibri" } },
      { text: "Moderate or Deep", options: { color: TEAL, bold: true, fontSize: 10, fontFace: "Calibri" } },
      { text: "Deep (60%+), Moderate (30-59%), Shallow (<30%)", options: { color: LIGHT_GRAY, fontSize: 10, fontFace: "Calibri" } }
    ],
    [
      { text: "Agencies Fingerprinted", options: { color: WHITE, fontSize: 10, fontFace: "Calibri" } },
      { text: "7 confirmed", options: { color: TEAL, bold: true, fontSize: 10, fontFace: "Calibri" } },
      { text: "Technical signatures validated via live client scans", options: { color: LIGHT_GRAY, fontSize: 10, fontFace: "Calibri" } }
    ],
    [
      { text: "Data Persistence", options: { color: WHITE, fontSize: 10, fontFace: "Calibri" } },
      { text: "100% to Salesforce", options: { color: GOLD, bold: true, fontSize: 10, fontFace: "Calibri" } },
      { text: "Competitor_Snapshot__c + Scan_Analysis__c", options: { color: LIGHT_GRAY, fontSize: 10, fontFace: "Calibri" } }
    ],
    [
      { text: "Excel Output", options: { color: WHITE, fontSize: 10, fontFace: "Calibri" } },
      { text: "4 tabs per scan", options: { color: TEAL, bold: true, fontSize: 10, fontFace: "Calibri" } },
      { text: "Clients, Service Comparison, Overlap, Why Switch", options: { color: LIGHT_GRAY, fontSize: 10, fontFace: "Calibri" } }
    ]
  ], { x: 0.5, y: 1.0, w: 9, rowH: 0.45, border: { pt: 0.5, color: CHARCOAL }, fill: { color: DARK } });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 3.9, w: 9, h: 0.8, fill: { color: CHARCOAL }, rectRadius: 0.06 });
  s.addText([
    { text: "BUSINESS IMPACT:  ", options: { bold: true, color: GOLD, fontSize: 11 } },
    { text: "Sales Reps get ready-made prospecting lists of practices already buying marketing services. These are not cold leads \u2014 they\u2019re warm switchers. Every client comes with a specific \u201CWhy Switch to PDM\u201D pitch. Intelligence compounds with every quarterly re-scan.", options: { color: WHITE, fontSize: 11 } }
  ], { x: 0.7, y: 3.95, w: 8.6, h: 0.7, fontFace: "Calibri", margin: 0 });

  // ============================================================
  // SECTION 2: NIGHTLY CHURN SCANNER
  // ============================================================
  sectionHeader(pres, "02", "Nightly Churn Scanner", "Not a financial report. A real-time scan of the true operational health of every active account.", icons.heart);

  s = contentSlide(pres, "HEALTH SCORING MODEL");
  // Important callout
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 0.9, w: 9, h: 0.5, fill: { color: "3E2723" }, rectRadius: 0.06 });
  s.addText([
    { text: "\u26A0\uFE0F  THIS IS NOT A FINANCIAL CHURN REPORT.  ", options: { bold: true, color: GOLD, fontSize: 11 } },
    { text: "It scans the true operational health of every active account based on AM engagement, unresolved issues, and renewal proximity.", options: { color: WHITE, fontSize: 11 } }
  ], { x: 0.7, y: 0.92, w: 8.6, h: 0.45, fontFace: "Calibri", margin: 0 });

  // Scoring model - 3 columns
  const scores = [
    { pct: "40%", name: "ENGAGEMENT", desc: "How recently the AM touched the account. Based on LastActivityDate. No contact = score drops.", color: TEAL },
    { pct: "30%", name: "CASE HEALTH", desc: "Open ticket count and priority. Unresolved high-priority issues signal risk before the client says it.", color: GOLD },
    { pct: "30%", name: "RENEWAL", desc: "Proximity to Contract_Renewal_Date__c. Approaching renewal without engagement = highest risk.", color: ORANGE }
  ];
  scores.forEach((sc, i) => {
    const bx = 0.5 + i * 3.15;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: bx, y: 1.6, w: 2.9, h: 1.6, fill: { color: CHARCOAL }, rectRadius: 0.08 });
    s.addText(sc.pct, { x: bx, y: 1.7, w: 2.9, h: 0.5, fontSize: 30, fontFace: "Arial Black", color: sc.color, align: "center", margin: 0 });
    s.addText(sc.name, { x: bx + 0.15, y: 2.2, w: 2.6, h: 0.3, fontSize: 11, fontFace: "Arial Black", color: WHITE, align: "center", margin: 0 });
    s.addText(sc.desc, { x: bx + 0.15, y: 2.5, w: 2.6, h: 0.6, fontSize: 9, fontFace: "Calibri", color: LIGHT_GRAY, align: "center", margin: 0 });
  });
  // Tier bar
  s.addText("HEALTH TIERS", { x: 0.5, y: 3.4, w: 3, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const tiers = [
    { name: "HEALTHY", range: "70-100", color: GREEN, w: 3 },
    { name: "WATCH", range: "50-69", color: YELLOW, w: 2 },
    { name: "AT RISK", range: "30-49", color: ORANGE, w: 2 },
    { name: "CRITICAL", range: "0-29", color: RED, w: 2 }
  ];
  let tx = 0.5;
  tiers.forEach(t => {
    s.addShape(pres.shapes.RECTANGLE, { x: tx, y: 3.75, w: t.w, h: 0.45, fill: { color: t.color } });
    s.addText(t.name + " (" + t.range + ")", { x: tx, y: 3.75, w: t.w, h: 0.45, fontSize: 10, fontFace: "Arial Black", color: t.color === YELLOW ? NAVY : WHITE, align: "center", valign: "middle", margin: 0 });
    tx += t.w + 0.05;
  });
  // Priority override
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.4, w: 9, h: 0.5, fill: { color: "3E2723" }, rectRadius: 0.06 });
  s.addText([
    { text: "PRIORITY OVERRIDE:  ", options: { bold: true, color: RED, fontSize: 10 } },
    { text: "Accounts with open Refund Requests are forced to CRITICAL regardless of composite score.", options: { color: WHITE, fontSize: 10 } }
  ], { x: 0.7, y: 4.42, w: 8.6, h: 0.45, fontFace: "Calibri", margin: 0 });

  // Churn scanner automation slide
  s = contentSlide(pres, "AUTOMATION & ALERTS");
  // Flow diagram
  s.addText("NIGHTLY FLOW \u2014 11:00 PM", { x: 0.5, y: 0.9, w: 3, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const flow = ["n8n Schedule\n11 PM", "Scan All Active\nAccounts", "Calculate\nHealth Scores", "Detect Tier\nDrops", "Create AM\nTasks", "Google Chat\nAlerts"];
  flow.forEach((f, i) => {
    addFlowBox(s, pres, 0.2 + i * 1.6, 1.25, 1.35, f, i === 0 ? TEAL : CHARCOAL);
    if (i < flow.length - 1) addFlowArrow(s, pres, 0.2 + i * 1.6 + 1.35, 1.25);
  });
  // Signals detected
  s.addText("ADDITIONAL SIGNALS DETECTED", { x: 0.5, y: 1.95, w: 4, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  addBullets(s, [
    "Open Refund Requests \u2192 forced to Critical",
    "Cancellation Change Orders \u2192 immediate escalation",
    "Delinquency flags \u2192 billing risk signal",
    "Cancellation/Pause Request Date \u2192 leading churn indicator",
    "Flagged Status \u2192 manual attention flag from AM"
  ], 0.5, 2.25, 4.5, 2.0);
  // Notification channels
  s.addText("NOTIFICATION CHANNELS", { x: 5.5, y: 1.95, w: 4, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const channels = [
    { name: "#churn-alerts", desc: "Critical accounts \u2014 immediate AM attention", color: RED },
    { name: "#churn-alerts", desc: "Tier drops \u2014 Watch \u2192 At Risk, etc.", color: ORANGE },
    { name: "#foresight-log", desc: "Daily scan summary \u2014 all tiers", color: TEAL },
    { name: "Salesforce Tasks", desc: "Created per account on tier drop", color: GOLD }
  ];
  channels.forEach((ch, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.5, y: 2.3 + i * 0.5, w: 4, h: 0.4, fill: { color: CHARCOAL }, rectRadius: 0.04 });
    s.addShape(pres.shapes.RECTANGLE, { x: 5.5, y: 2.3 + i * 0.5, w: 0.08, h: 0.4, fill: { color: ch.color } });
    s.addText([
      { text: ch.name + "  ", options: { bold: true, color: WHITE, fontSize: 9 } },
      { text: ch.desc, options: { color: LIGHT_GRAY, fontSize: 9 } }
    ], { x: 5.75, y: 2.3 + i * 0.5, w: 3.6, h: 0.4, fontFace: "Calibri", margin: 0, valign: "middle" });
  });
  addUsersRow(s, ["Account Managers", "AM Leadership", "Exec Team"], 0.5, 4.9);

  // --- LIVE EXAMPLE: Churn Risk Accounts ---
  s = darkSlide(pres);
  addLiveExampleBadge(s, "sf_get_churn_risk_accounts", "April 1, 2026");
  s.addText("TOP ACCOUNTS AT RISK OF CHURNING", { x: 0.5, y: 0.6, w: 9, h: 0.35, fontSize: 16, fontFace: "Arial Black", color: WHITE, margin: 0 });
  s.addText("10 accounts flagged  |  1,265 active accounts scanned  |  Sorted by composite health score", { x: 0.5, y: 0.92, w: 9, h: 0.22, fontSize: 9, fontFace: "Calibri", color: MID_GRAY, margin: 0 });
  // Risk rows — real data
  addRiskRow(s, 0.5, 1.3, 9, 25, "Boulevard Dental", "$2,699/mo", "Shelby Dorvil", "Last contact 43 days ago\nContract ends in 29 days\nCancel/pause request on file");
  addRiskRow(s, 0.5, 1.95, 9, 30, "Akron Area Oral & Facial Surgery", "MRR unknown", "Tara Schulman", "No activity in 166 days\nCancel/pause request on file\nFlagged for attention");
  addRiskRow(s, 0.5, 2.6, 9, 35, "Remmers Dental", "$7,699/mo", "Corey Sokolov", "Contract expired\nCancel/pause request on file\nFlagged for attention");
  addRiskRow(s, 0.5, 3.25, 9, 35, "Idaho Perio", "$15,448/mo", "Lisa Maisonet", "Contract expired\nCancel/pause request on file\nFlagged for attention");
  addRiskRow(s, 0.5, 3.9, 9, 35, "One Solution Dental Implant Centers", "$84,898/mo", "Stephanie Bolivar", "Contract expired — PLATINUM TIER\nCancel/pause request on file\nFlagged for attention");
  // Revenue at risk callout
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.65, w: 9, h: 0.45, fill: { color: "3D1111" }, rectRadius: 0.06, line: { color: RED, width: 1 } });
  s.addText([
    { text: "REVENUE AT RISK:  ", options: { fontSize: 11, fontFace: "Arial Black", color: RED } },
    { text: "$110,744/mo MRR across top 5 accounts  |  $1.3M+ annualized exposure", options: { fontSize: 11, fontFace: "Calibri", color: WHITE } }
  ], { x: 0.7, y: 4.65, w: 8.6, h: 0.45, margin: 0, valign: "middle" });

  // ============================================================
  // SECTION 3: PIPELINE REVIVAL (RAISE THE GHOSTS)
  // ============================================================
  sectionHeader(pres, "03", "Weekly Pipeline Revival", "Find deals that ghosted you. Analyze why they went cold. Revive them with intelligence.", icons.ghost);

  s = contentSlide(pres, "RAISE THE GHOSTS \u2014 EVERY MONDAY 7 AM");
  // Flow
  const ghostFlow = ["Monday\n7 AM", "Scan\nSalesforce", "Enrich with\nCI Data", "Create\nPipeline_Revival__c", "Email Each\nRep", "Google\nChat"];
  ghostFlow.forEach((f, i) => {
    addFlowBox(s, pres, 0.15 + i * 1.6, 0.95, 1.35, f, i === 0 ? TEAL : CHARCOAL);
    if (i < ghostFlow.length - 1) addFlowArrow(s, pres, 0.15 + i * 1.6 + 1.35, 0.95);
  });
  // 3 search categories
  s.addText("THREE SEARCH CATEGORIES", { x: 0.5, y: 1.6, w: 4, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const cats = [
    { title: "Open Opportunities", desc: "Deals with no activity for 30+ days" },
    { title: "Prospect Accounts", desc: "TCI/Prospect accounts with VideoCall history but no follow-up" },
    { title: "Cold Leads", desc: "Leads that went silent after initial engagement" }
  ];
  cats.forEach((c, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5 + i * 3.15, y: 1.95, w: 2.9, h: 0.7, fill: { color: CHARCOAL }, rectRadius: 0.06 });
    s.addText([
      { text: c.title + "\n", options: { bold: true, color: WHITE, fontSize: 10 } },
      { text: c.desc, options: { color: LIGHT_GRAY, fontSize: 9 } }
    ], { x: 0.6 + i * 3.15, y: 1.98, w: 2.7, h: 0.65, fontFace: "Calibri", margin: 0 });
  });
  // Cold reasons
  s.addText("WHY THEY WENT COLD \u2014 AI-DETERMINED", { x: 0.5, y: 2.85, w: 5, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const reasons = ["Budget", "Timing", "Competitor", "Stall", "No Next Step", "Unknown"];
  reasons.forEach((r, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5 + i * 1.55, y: 3.15, w: 1.4, h: 0.3, fill: { color: CHARCOAL }, rectRadius: 0.04 });
    s.addText(r, { x: 0.5 + i * 1.55, y: 3.15, w: 1.4, h: 0.3, fontSize: 9, fontFace: "Calibri", color: TEAL, align: "center", margin: 0 });
  });
  // Revival lifecycle
  s.addText("SALESFORCE REVIVAL LIFECYCLE (Pipeline_Revival__c)", { x: 0.5, y: 3.65, w: 6, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const lifecycle = ["Identified", "Email Drafted", "Email Sent", "Reply Received", "Re-Engaged"];
  lifecycle.forEach((l, i) => {
    const lc = i === lifecycle.length - 1 ? GREEN : CHARCOAL;
    addFlowBox(s, pres, 0.5 + i * 1.85, 3.95, 1.6, l, lc);
    if (i < lifecycle.length - 1) addFlowArrow(s, pres, 0.5 + i * 1.85 + 1.6, 3.95);
  });
  s.addText("Each Sales Rep receives a personalized HTML email every Monday with their ghost list: name, days silent, type, last topic, and why they went cold.", { x: 0.5, y: 4.5, w: 9, h: 0.4, fontSize: 10, fontFace: "Calibri", color: LIGHT_GRAY, italic: true, margin: 0 });
  addUsersRow(s, ["Sales Reps", "Sales Leadership"], 0.5, 4.95);

  // ============================================================
  // SECTION 4: CONVERSATION INTELLIGENCE PROCESSING
  // ============================================================
  sectionHeader(pres, "04", "Nightly Conversation Intelligence", "Every call analyzed. Every signal extracted. The dataset that makes Prophet smarter.", icons.brain);

  s = contentSlide(pres, "CI PROCESSING PIPELINE \u2014 NIGHTLY 1 AM");
  // Flow
  const ciFlow = ["VideoCall\nRecords", "Fetch\nTranscript", "Claude AI\nAnalysis", "Call_Intelligence__c\nRecord", "Risk\nAlert?"];
  ciFlow.forEach((f, i) => {
    addFlowBox(s, pres, 0.3 + i * 1.9, 0.95, 1.6, f, CHARCOAL);
    if (i < ciFlow.length - 1) addFlowArrow(s, pres, 0.3 + i * 1.9 + 1.6, 0.95);
  });
  // Extraction fields - 2 columns
  s.addText("INTELLIGENCE EXTRACTED PER CALL", { x: 0.5, y: 1.6, w: 5, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const fields1 = ["Sentiment Score (-100 to +100)", "Sentiment Label (Pos/Neg/Neutral/Mixed)", "Tone Shift (Improved/Stable/Declined)", "Key Topics Discussed", "Commitments Made (who promised what)", "Risk Signals Detected"];
  const fields2 = ["Competitor Mentions", "Doctor Reached (yes/no)", "Satisfaction Signal", "Follow-Up Required (yes/no)", "Budget Concern Detected", "Pause/Cancel Language Detected"];
  addBullets(s, fields1, 0.5, 1.9, 4.3, 2.0, { fontSize: 10 });
  addBullets(s, fields2, 5.0, 1.9, 4.5, 2.0, { fontSize: 10 });
  // Critical alert path
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.0, w: 9, h: 0.6, fill: { color: "3E2723" }, rectRadius: 0.06 });
  s.addText([
    { text: "CRITICAL ALERT PATH:  ", options: { bold: true, color: RED, fontSize: 10 } },
    { text: "If risk signals or pause/cancel language detected \u2192 immediately creates Salesforce Task for AM + updates Account.Sentiment_Trend__c to \u201CDeclining.\u201D  Rate limit: 50 calls per nightly run.", options: { color: WHITE, fontSize: 10 } }
  ], { x: 0.7, y: 4.02, w: 8.6, h: 0.55, fontFace: "Calibri", margin: 0 });
  s.addText("This is the training data that makes Prophet smarter over time. Every call analyzed becomes part of PDM\u2019s proprietary intelligence dataset. No competitor has this.", { x: 0.5, y: 4.7, w: 9, h: 0.35, fontSize: 10, fontFace: "Calibri", color: GOLD, italic: true, margin: 0 });

  // ============================================================
  // SECTION 5: PROSPECT RESEARCH ENGINE v2.0
  // ============================================================
  sectionHeader(pres, "05", "Prospect Research Engine v2.0", "21-section intelligence report. Patient psychology. Safety hierarchy. Competitive gap mapping. Auto-generated Gamma deck.", icons.search);

  s = contentSlide(pres, "TWO-TOOL ARCHITECTURE");
  // Flow
  const prFlow = ["SF Pre-Check\n(existing records?)", "Web Research\n(market + competition)", "21-Section\nAI Analysis", "Salesforce\nWrite-back", "Gamma Deck\n(12 slides)"];
  prFlow.forEach((f, i) => {
    addFlowBox(s, pres, 0.2 + i * 1.9, 0.95, 1.65, f, i === 2 ? GOLD : i === 4 ? TEAL : CHARCOAL);
    if (i < prFlow.length - 1) addFlowArrow(s, pres, 0.2 + i * 1.9 + 1.65, 0.95);
  });
  // v2.0 upgrade callout
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.5, w: 9, h: 0.5, fill: { color: CHARCOAL }, rectRadius: 0.06 });
  s.addText([
    { text: "v2.0 UPGRADE:  ", options: { bold: true, color: GOLD, fontSize: 11 } },
    { text: "Expanded from 16 to 21 sections. Added patient psychology, clinical authority assessment, safety hierarchy, patient decision journey, 3-engine growth system, and full competitive gap mapping.", options: { color: WHITE, fontSize: 10 } }
  ], { x: 0.7, y: 1.5, w: 8.6, h: 0.5, fontFace: "Calibri", margin: 0, valign: "middle" });
  // Two columns: v1 vs v2
  s.addText("v1.0 (16 SECTIONS)", { x: 0.5, y: 2.15, w: 4.2, h: 0.25, fontSize: 9, fontFace: "Arial", color: MID_GRAY, bold: true, margin: 0 });
  addBullets(s, [
    "Market demographics & competitive landscape",
    "Practice website & SEO audit",
    "Google Ads & Maps analysis",
    "Reputation analysis & opportunity gaps",
    "Sales enablement summary"
  ], 0.5, 2.4, 4.2, 1.5, { fontSize: 9, color: MID_GRAY });
  s.addText("v2.0 (21 SECTIONS) \u2014 NEW", { x: 5.3, y: 2.15, w: 4.2, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  addBullets(s, [
    "Patient Psychology & Trust Architecture",
    "Clinical Authority Assessment (guided surgery, candidacy, sedation)",
    "Trust Signal Assessment & Local Differentiation",
    "The Safety Hierarchy \u2014 why patients choose one doctor over another",
    "Patient Decision Journey \u2014 SEARCH \u2192 COMPARE \u2192 VALIDATE \u2192 UNDERSTAND \u2192 COMMIT",
    "\"What If You Do Nothing\" \u2014 12-month competitive erosion projection",
    "3-Engine Growth System \u2014 Visibility / Authority / Conversion",
    "Full Competitive Gap Summary \u2014 every PDM product mapped vs. competitor"
  ], 5.3, 2.4, 4.2, 2.0, { fontSize: 9 });
  // Key differentiator
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.5, w: 9, h: 0.5, fill: { color: CHARCOAL }, rectRadius: 0.06 });
  s.addText([
    { text: "THE MOAT:  ", options: { bold: true, color: GOLD, fontSize: 11 } },
    { text: "Reps walk into discovery calls with patient psychology scripts, clinical authority talking points, and a 12-slide authority-framed Gamma deck. No competitor agency has anything close.", options: { color: WHITE, fontSize: 11 } }
  ], { x: 0.7, y: 4.5, w: 8.6, h: 0.5, fontFace: "Calibri", margin: 0, valign: "middle" });

  // ── Research Engine v2.0 — 3-Engine Framework Slide ───────────────────
  s = contentSlide(pres, "THE 3-ENGINE GROWTH SYSTEM");
  s.addText("How Prophet frames PDM's value \u2014 not a list of services, but three integrated engines:", { x: 0.5, y: 0.85, w: 9, h: 0.3, fontSize: 11, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  // Engine 1
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.3, w: 2.8, h: 2.5, fill: { color: CHARCOAL }, rectRadius: 0.08 });
  s.addText("ENGINE 1", { x: 0.5, y: 1.35, w: 2.8, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, align: "center", margin: 0 });
  s.addText("VISIBILITY", { x: 0.5, y: 1.6, w: 2.8, h: 0.35, fontSize: 18, fontFace: "Arial Black", color: TEAL, align: "center", margin: 0 });
  s.addText("Getting Found", { x: 0.5, y: 1.95, w: 2.8, h: 0.25, fontSize: 11, fontFace: "Calibri", color: WHITE, align: "center", margin: 0 });
  addBullets(s, ["SEO & organic rankings", "Google Ads", "Maps optimization", "Review generation"], 0.7, 2.3, 2.4, 1.2, { fontSize: 9 });
  // Arrow 1
  s.addText("\u27A4", { x: 3.4, y: 2.3, w: 0.4, h: 0.4, fontSize: 20, color: TEAL, align: "center", margin: 0 });
  // Engine 2
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.6, y: 1.3, w: 2.8, h: 2.5, fill: { color: CHARCOAL }, rectRadius: 0.08 });
  s.addText("ENGINE 2", { x: 3.6, y: 1.35, w: 2.8, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, align: "center", margin: 0 });
  s.addText("AUTHORITY", { x: 3.6, y: 1.6, w: 2.8, h: 0.35, fontSize: 18, fontFace: "Arial Black", color: TEAL, align: "center", margin: 0 });
  s.addText("Getting Trusted", { x: 3.6, y: 1.95, w: 2.8, h: 0.25, fontSize: 11, fontFace: "Calibri", color: WHITE, align: "center", margin: 0 });
  addBullets(s, ["Doctor authority video", "Before/after proof", "Clinical content", "CBCT & guided surgery"], 3.8, 2.3, 2.4, 1.2, { fontSize: 9 });
  // Arrow 2
  s.addText("\u27A4", { x: 6.5, y: 2.3, w: 0.4, h: 0.4, fontSize: 20, color: TEAL, align: "center", margin: 0 });
  // Engine 3
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.7, y: 1.3, w: 2.8, h: 2.5, fill: { color: CHARCOAL }, rectRadius: 0.08 });
  s.addText("ENGINE 3", { x: 6.7, y: 1.35, w: 2.8, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, align: "center", margin: 0 });
  s.addText("CONVERSION", { x: 6.7, y: 1.6, w: 2.8, h: 0.35, fontSize: 18, fontFace: "Arial Black", color: TEAL, align: "center", margin: 0 });
  s.addText("Getting Chosen", { x: 6.7, y: 1.95, w: 2.8, h: 0.25, fontSize: 11, fontFace: "Calibri", color: WHITE, align: "center", margin: 0 });
  addBullets(s, ["Patient psychology", "Fear-reduction architecture", "Financial confidence", "Case acceptance optimization"], 6.9, 2.3, 2.4, 1.2, { fontSize: 9 });
  // Bottom insight
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.1, w: 9, h: 0.7, fill: { color: CHARCOAL }, rectRadius: 0.06 });
  s.addText([
    { text: "CLOSER LINE:  ", options: { bold: true, color: GOLD, fontSize: 11 } },
    { text: "\"Most marketing companies help you get found. We help you get found, trusted, AND chosen. That's three engines, not one \u2014 and it's why our clients close more of the leads they generate.\"", options: { color: WHITE, fontSize: 10, italic: true } }
  ], { x: 0.7, y: 4.1, w: 8.6, h: 0.7, fontFace: "Calibri", margin: 0, valign: "middle" });
  addUsersRow(s, ["Sales Reps", "Sales Leadership"], 0.5, 5.0);

  // ============================================================
  // SECTION 6: WEEKLY AM SYNOPSIS
  // ============================================================
  sectionHeader(pres, "06", "Weekly AM Synopsis", "Every Account Manager\u2019s Monday morning brief. Prepared calls. Zero surprises.", icons.calendar);

  s = contentSlide(pres, "MONDAY MORNING INTELLIGENCE");
  s.addText("Shows all accounts with scheduled alignment calls this week, each enriched with:", { x: 0.5, y: 0.9, w: 9, h: 0.35, fontSize: 12, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  const synFields = [
    { icon: icons.heart, label: "Health Tier", desc: "Current health score and tier color" },
    { icon: icons.chart, label: "MRR", desc: "Monthly recurring revenue at stake" },
    { icon: icons.calendar, label: "Days Since Contact", desc: "Last AM touchpoint" },
    { icon: icons.warning, label: "Open Refund Requests", desc: "Critical churn signal" },
    { icon: icons.user, label: "Doctor Contact", desc: "Last time doctor was reached" },
    { icon: icons.target, label: "Renewal Proximity", desc: "Days until contract renewal" }
  ];
  synFields.forEach((f, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const bx = 0.5 + col * 4.6;
    const by = 1.4 + row * 0.9;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: bx, y: by, w: 4.3, h: 0.75, fill: { color: CHARCOAL }, rectRadius: 0.06 });
    s.addImage({ data: f.icon, x: bx + 0.15, y: by + 0.15, w: 0.4, h: 0.4 });
    s.addText([
      { text: f.label + "\n", options: { bold: true, color: WHITE, fontSize: 11 } },
      { text: f.desc, options: { color: LIGHT_GRAY, fontSize: 9 } }
    ], { x: bx + 0.65, y: by + 0.05, w: 3.4, h: 0.65, fontFace: "Calibri", margin: 0 });
  });
  s.addText("Suggested talking points generated per account. 6 parallel Salesforce queries for maximum speed.", { x: 0.5, y: 4.2, w: 9, h: 0.3, fontSize: 10, fontFace: "Calibri", color: MID_GRAY, italic: true, margin: 0 });
  addUsersRow(s, ["Account Managers"], 0.5, 4.9);

  // --- LIVE EXAMPLE: Weekly Synopsis snippet ---
  s = darkSlide(pres);
  addLiveExampleBadge(s, "sf_get_weekly_synopsis + sf_get_renewal_pipeline", "April 1, 2026");
  s.addText("MONDAY MORNING INTELLIGENCE", { x: 0.5, y: 0.6, w: 9, h: 0.35, fontSize: 16, fontFace: "Arial Black", color: WHITE, margin: 0 });
  s.addText("42 accounts with scheduled calls  |  2 renewals in next 30 days  |  0 open refund requests", { x: 0.5, y: 0.92, w: 9, h: 0.22, fontSize: 9, fontFace: "Calibri", color: MID_GRAY, margin: 0 });

  // Sample account cards from synopsis
  const synAccounts = [
    { name: "Seville Dental Aesthetics", score: 44, tier: "At Risk", mrr: "$14,948/mo", owner: "Taylor Coppage", flag: "RENEWAL TODAY", flagColor: RED },
    { name: "Boulevard Dental", score: 25, tier: "Critical", mrr: "$2,699/mo", owner: "Shelby Dorvil", flag: "CANCEL REQUEST", flagColor: RED },
    { name: "Fadi Assaf DDS", score: 60, tier: "At Risk", mrr: "unknown", owner: "Gerritt Cora", flag: "14+ DAYS NO CONTACT", flagColor: ORANGE }
  ];
  synAccounts.forEach((a, i) => {
    const cy = 1.3 + i * 0.75;
    const scoreColor = a.score <= 29 ? RED : a.score <= 49 ? ORANGE : YELLOW;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: cy, w: 9, h: 0.65, fill: { color: CHARCOAL }, rectRadius: 0.06 });
    // Score circle
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.65, y: cy + 0.08, w: 0.5, h: 0.5, fill: { color: scoreColor }, rectRadius: 0.25 });
    s.addText(String(a.score), { x: 0.65, y: cy + 0.08, w: 0.5, h: 0.5, fontSize: 16, fontFace: "Arial Black", color: NAVY, align: "center", valign: "middle", margin: 0 });
    // Name + details
    s.addText(a.name, { x: 1.3, y: cy + 0.05, w: 4, h: 0.25, fontSize: 12, fontFace: "Arial Black", color: WHITE, margin: 0 });
    s.addText(a.tier + "  |  " + a.mrr + "  |  " + a.owner, { x: 1.3, y: cy + 0.32, w: 4, h: 0.2, fontSize: 9, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
    // Flag badge
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.5, y: cy + 0.15, w: 1.8, h: 0.3, fill: { color: a.flagColor }, rectRadius: 0.04 });
    s.addText(a.flag, { x: 7.5, y: cy + 0.15, w: 1.8, h: 0.3, fontSize: 8, fontFace: "Arial Black", color: a.flagColor === ORANGE ? NAVY : WHITE, align: "center", valign: "middle", margin: 0 });
  });

  // Renewal countdown
  s.addText("RENEWAL PIPELINE — NEXT 30 DAYS", { x: 0.5, y: 3.65, w: 5, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 3.95, w: 4.3, h: 0.6, fill: { color: CHARCOAL }, rectRadius: 0.06, line: { color: RED, width: 1 } });
  s.addText([
    { text: "Seville Dental Aesthetics\n", options: { fontSize: 10, fontFace: "Arial Black", color: WHITE } },
    { text: "Renews TODAY  |  $14,948/mo  |  Gold Tier  |  Flagged", options: { fontSize: 8, fontFace: "Calibri", color: RED } }
  ], { x: 0.65, y: 3.95, w: 4, h: 0.6, margin: 0, valign: "middle" });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.0, y: 3.95, w: 4.5, h: 0.6, fill: { color: CHARCOAL }, rectRadius: 0.06, line: { color: ORANGE, width: 1 } });
  s.addText([
    { text: "Boulevard Dental\n", options: { fontSize: 10, fontFace: "Arial Black", color: WHITE } },
    { text: "Renews in 29 days  |  $2,699/mo  |  Cancel/Pause request on file", options: { fontSize: 8, fontFace: "Calibri", color: ORANGE } }
  ], { x: 5.15, y: 3.95, w: 4.2, h: 0.6, margin: 0, valign: "middle" });

  // Total MRR renewing
  s.addText([
    { text: "Total MRR renewing: ", options: { fontSize: 10, fontFace: "Calibri", color: MID_GRAY } },
    { text: "$17,647/mo", options: { fontSize: 12, fontFace: "Arial Black", color: GOLD } }
  ], { x: 0.5, y: 4.7, w: 4, h: 0.3, margin: 0 });
  // Doctor coaching note
  s.addText("42 accounts have NEVER had doctor contact logged — coaching opportunity", { x: 4.5, y: 4.75, w: 5, h: 0.25, fontSize: 8, fontFace: "Calibri", color: RED, italic: true, margin: 0, align: "right" });

  // ============================================================
  // SECTION 7: PRE-CALL BRIEF
  // ============================================================
  sectionHeader(pres, "07", "Pre-Call Brief", "Complete intelligence package for any account. 10 parallel queries. One unified brief.", icons.phone);

  s = contentSlide(pres, "10-QUERY INTELLIGENCE ASSEMBLY");
  const sections = [
    "Critical Alerts", "Account Overview", "Account Intel", "Budget Snapshot",
    "Active Services", "Business Objectives", "AM Transition History", "Zoom AI Summary",
    "Key Contacts", "Recent Activity", "Open Tickets", "Health Score"
  ];
  sections.forEach((sec, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5 + col * 2.3, y: 1.0 + row * 0.55, w: 2.15, h: 0.45, fill: { color: i === 0 ? "3E2723" : CHARCOAL }, rectRadius: 0.04 });
    s.addText(sec, { x: 0.5 + col * 2.3, y: 1.0 + row * 0.55, w: 2.15, h: 0.45, fontSize: 10, fontFace: "Calibri", color: i === 0 ? RED : WHITE, align: "center", valign: "middle", margin: 0 });
  });
  s.addText("Accepts account ID or name (fuzzy search). Pulls 25+ account fields, contacts with doctor/primary flags, full task notes with Spoke_with_Doctor__c, and Zoom Meeting AI Summaries.", { x: 0.5, y: 2.8, w: 9, h: 0.5, fontSize: 11, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  addUsersRow(s, ["Account Managers", "Sales Reps"], 0.5, 4.9);

  // --- LIVE EXAMPLE: Pre-Call Brief ---
  s = darkSlide(pres);
  addLiveExampleBadge(s, "sf_get_pre_call_brief", "April 1, 2026");
  s.addText("PRE-CALL BRIEF: SEVILLE DENTAL AESTHETICS", { x: 0.5, y: 0.6, w: 9, h: 0.35, fontSize: 16, fontFace: "Arial Black", color: WHITE, margin: 0 });

  // Critical Alert box
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.05, w: 9, h: 0.5, fill: { color: "3D1111" }, rectRadius: 0.06, line: { color: RED, width: 1 } });
  s.addText([
    { text: "CRITICAL ALERT:  ", options: { fontSize: 9, fontFace: "Arial Black", color: RED } },
    { text: "TCI EVENT ACCOUNT — Conference ticket purchaser, not Phase 2 marketing client. Goal: convert to active Phase 2.", options: { fontSize: 9, fontFace: "Calibri", color: WHITE } }
  ], { x: 0.7, y: 1.05, w: 8.6, h: 0.5, margin: 0, valign: "middle" });

  // Account overview cards
  const briefCards = [
    { label: "STATUS", val: "Active | TCI: Member", color: GREEN },
    { label: "MRR", val: "$14,948/mo", color: GOLD },
    { label: "TIER", val: "Gold ($10k-$19,999)", color: GOLD },
    { label: "LAST CONTACT", val: "7 days ago", color: TEAL },
    { label: "RENEWAL", val: "Apr 1, 2026 (TODAY)", color: RED },
    { label: "HEALTH", val: "44/100 — At Risk", color: ORANGE }
  ];
  briefCards.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = 0.5 + col * 3.05;
    const cy = 1.7 + row * 0.6;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx, y: cy, w: 2.9, h: 0.5, fill: { color: CHARCOAL }, rectRadius: 0.05 });
    s.addText(c.label, { x: cx + 0.1, y: cy + 0.04, w: 1.2, h: 0.2, fontSize: 7, fontFace: "Arial", color: MID_GRAY, bold: true, margin: 0 });
    s.addText(c.val, { x: cx + 0.1, y: cy + 0.22, w: 2.7, h: 0.22, fontSize: 10, fontFace: "Arial Black", color: c.color, margin: 0 });
  });

  // Key Contacts
  s.addText("KEY CONTACTS (9)", { x: 0.5, y: 3.0, w: 4, h: 0.22, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const contacts = [
    "Dr Anna Wilson (Dentist)  |  dr.anna@sevilledentalaesthetics.com",
    "Dr Rita Garabet (Dentist)  |  dr.rita@sevilledentalaesthetics.com",
    "Ellen Pierpont  |  TCI Progress: Level 1 Complete"
  ];
  contacts.forEach((c, i) => {
    s.addText(c, { x: 0.5, y: 3.25 + i * 0.2, w: 5, h: 0.2, fontSize: 8, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  });

  // Active Products
  s.addText("ACTIVE PRODUCTS", { x: 5.5, y: 3.0, w: 3, h: 0.22, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const prods = ["Video & Photography", "Social Media", "TCI Events", "TCI Mentorship"];
  prods.forEach((p, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.5 + (i % 2) * 2.15, y: 3.25 + Math.floor(i / 2) * 0.3, w: 2, h: 0.25, fill: { color: CHARCOAL }, rectRadius: 0.04 });
    s.addText(p, { x: 5.5 + (i % 2) * 2.15, y: 3.25 + Math.floor(i / 2) * 0.3, w: 2, h: 0.25, fontSize: 8, fontFace: "Calibri", color: TEAL, align: "center", margin: 0 });
  });

  // Missing Products
  s.addText("NOT USING", { x: 5.5, y: 3.9, w: 3, h: 0.22, fontSize: 9, fontFace: "Arial", color: ORANGE, bold: true, margin: 0 });
  s.addText("Web Dev  |  PPC  |  SEO  |  Traditional Media", { x: 5.5, y: 4.1, w: 4, h: 0.2, fontSize: 8, fontFace: "Calibri", color: ORANGE, margin: 0 });

  // Recent Activity preview
  s.addText("RECENT ACTIVITY (8 items in last 90 days)", { x: 0.5, y: 4.0, w: 4.5, h: 0.22, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  s.addText("Mar 25: Q2 Growth Updates & Events\nMar 17: Targeting Confirmation & Updates\nMar 10: Budget transitioned entirely to Social", { x: 0.5, y: 4.22, w: 4.5, h: 0.6, fontSize: 8, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0, lineSpacingMultiple: 1.2 });

  // Suggested talking point
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.9, w: 9, h: 0.35, fill: { color: "1A3A2A" }, rectRadius: 0.06, line: { color: TEAL, width: 1 } });
  s.addText([
    { text: "TALKING POINT:  ", options: { fontSize: 9, fontFace: "Arial Black", color: TEAL } },
    { text: "Low engagement score (20) — establish regular check-in cadence. Renewal is TODAY.", options: { fontSize: 9, fontFace: "Calibri", color: WHITE } }
  ], { x: 0.7, y: 4.9, w: 8.6, h: 0.35, margin: 0, valign: "middle" });

  // ============================================================
  // SECTION 8-11: HEALTH, CHURN RISK, RENEWAL, UPSELL (combined)
  // ============================================================
  sectionHeader(pres, "08-11", "Client Intelligence Suite", "Health Reports \u2022 Churn Risk Ranking \u2022 Renewal Pipeline \u2022 Upsell Opportunities", icons.chart);

  s = contentSlide(pres, "FOUR TOOLS, ONE INTELLIGENCE LAYER");
  const suite = [
    { num: "08", name: "ACCOUNT HEALTH REPORT", desc: "Deep-dive health analysis for a single account. Full breakdown: Engagement (40%), Case Health (30%), Renewal (30%). Includes MRR, tier, active services, delinquency status.", icon: icons.heart, users: "AMs, AM Leadership" },
    { num: "09", name: "CHURN RISK RANKING", desc: "Ranked list of accounts most likely to churn. Refund Requests forced to top. Signals: Cancellation Change Orders, delinquency, pause requests. Default top 25 below score 50.", icon: icons.warning, users: "AMs, Leadership, Execs" },
    { num: "10", name: "RENEWAL PIPELINE", desc: "Upcoming renewals sorted by date with health enrichment. Each shows health score, tier, MRR at risk, days until renewal. Configurable lookahead window.", icon: icons.target, users: "AMs, AM Leadership" },
    { num: "11", name: "UPSELL OPPORTUNITIES", desc: "Gap analysis: which PDM services each client does NOT have. Cross-references active Assets vs. full product catalog. Only targets healthy accounts.", icon: icons.rocket, users: "AMs, Sales Leadership" }
  ];
  suite.forEach((t, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const bx = 0.5 + col * 4.6;
    const by = 0.9 + row * 1.9;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: bx, y: by, w: 4.3, h: 1.7, fill: { color: CHARCOAL }, rectRadius: 0.08 });
    s.addImage({ data: t.icon, x: bx + 0.15, y: by + 0.15, w: 0.35, h: 0.35 });
    s.addText(t.num, { x: bx + 0.6, y: by + 0.12, w: 0.5, h: 0.35, fontSize: 16, fontFace: "Arial Black", color: TEAL, margin: 0 });
    s.addText(t.name, { x: bx + 1.1, y: by + 0.15, w: 3, h: 0.3, fontSize: 11, fontFace: "Arial Black", color: WHITE, margin: 0 });
    s.addText(t.desc, { x: bx + 0.15, y: by + 0.55, w: 4, h: 0.85, fontSize: 9, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
    s.addText(t.users, { x: bx + 0.15, y: by + 1.35, w: 4, h: 0.25, fontSize: 8, fontFace: "Calibri", color: TEAL, margin: 0 });
  });

  // --- LIVE EXAMPLE: Health Report ---
  s = darkSlide(pres);
  addLiveExampleBadge(s, "sf_get_account_health_report", "April 1, 2026");
  s.addText("HEALTH REPORT: SEVILLE DENTAL AESTHETICS", { x: 0.5, y: 0.6, w: 9, h: 0.35, fontSize: 16, fontFace: "Arial Black", color: WHITE, margin: 0 });
  s.addText("Owner: Taylor Coppage  |  Active  |  TCI: Member  |  $14,948/mo  |  Gold Tier", { x: 0.5, y: 0.95, w: 9, h: 0.22, fontSize: 9, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  // Overall score — large
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.3, w: 9, h: 0.8, fill: { color: CHARCOAL }, rectRadius: 0.08 });
  s.addText("OVERALL SCORE", { x: 0.7, y: 1.35, w: 2, h: 0.3, fontSize: 10, fontFace: "Arial", color: MID_GRAY, bold: true, margin: 0 });
  s.addText([
    { text: "44/100  ", options: { fontSize: 28, fontFace: "Arial Black", color: ORANGE } },
    { text: "AT RISK", options: { fontSize: 14, fontFace: "Arial Black", color: ORANGE } }
  ], { x: 0.7, y: 1.55, w: 3.0, h: 0.45, margin: 0, valign: "middle" });
  // Overall bar
  const overallBarX = 3.8;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: overallBarX, y: 1.55, w: 5.5, h: 0.3, fill: { color: NAVY }, rectRadius: 0.06 });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: overallBarX, y: 1.55, w: 5.5 * 0.44, h: 0.3, fill: { color: ORANGE }, rectRadius: 0.06 });

  // Score breakdown bars — each bar gets its own row with detail text below
  addScoreBar(s, 0.5, 2.35, 9, "ENGAGEMENT", 20, "40%");
  s.addText("0 calls, 8 emails, 0 meetings in last 30 days", { x: 2.0, y: 2.6, w: 6, h: 0.2, fontSize: 8, fontFace: "Calibri", color: MID_GRAY, margin: 0 });
  addScoreBar(s, 0.5, 2.95, 9, "CASE HEALTH", 100, "30%");
  s.addText("No open cases", { x: 2.0, y: 3.2, w: 6, h: 0.2, fontSize: 8, fontFace: "Calibri", color: MID_GRAY, margin: 0 });
  addScoreBar(s, 0.5, 3.55, 9, "RENEWAL", 20, "30%");
  s.addText("Contract has expired — renewal is TODAY", { x: 2.0, y: 3.8, w: 6, h: 0.2, fontSize: 8, fontFace: "Calibri", color: MID_GRAY, margin: 0 });

  // --- LIVE EXAMPLE: Upsell Opportunities ---
  s = darkSlide(pres);
  addLiveExampleBadge(s, "sf_get_upsell_opportunities", "April 1, 2026");
  s.addText("TOP UPSELL OPPORTUNITIES BY MRR", { x: 0.5, y: 0.6, w: 9, h: 0.35, fontSize: 16, fontFace: "Arial Black", color: WHITE, margin: 0 });
  s.addText("310 accounts with product gaps identified  |  Sorted by monthly recurring revenue", { x: 0.5, y: 0.92, w: 9, h: 0.22, fontSize: 9, fontFace: "Calibri", color: MID_GRAY, margin: 0 });

  // Upsell table header
  const tableY = 1.3;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: tableY, w: 9, h: 0.3, fill: { color: TEAL }, rectRadius: 0.04 });
  s.addText("ACCOUNT", { x: 0.6, y: tableY, w: 2.5, h: 0.3, fontSize: 8, fontFace: "Arial Black", color: NAVY, margin: 0, valign: "middle" });
  s.addText("MRR", { x: 3.2, y: tableY, w: 1.2, h: 0.3, fontSize: 8, fontFace: "Arial Black", color: NAVY, margin: 0, valign: "middle" });
  s.addText("CURRENT PRODUCTS", { x: 4.5, y: tableY, w: 2.5, h: 0.3, fontSize: 8, fontFace: "Arial Black", color: NAVY, margin: 0, valign: "middle" });
  s.addText("GAPS", { x: 7.1, y: tableY, w: 2.2, h: 0.3, fontSize: 8, fontFace: "Arial Black", color: NAVY, margin: 0, valign: "middle" });

  // Upsell rows
  const upsellData = [
    { name: "In A Day Smile", mrr: "$95,448", current: "PPC, SEO, Social, TCI", gaps: "Web, Video, Traditional" },
    { name: "One Solution Dental", mrr: "$84,898", current: "PPC, SEO, Social, TCI", gaps: "Web, Video, Traditional" },
    { name: "The Ferber Dental Group", mrr: "$76,448", current: "PPC, SEO, Social, TCI", gaps: "Web, Video, Traditional" },
    { name: "EXO Dental", mrr: "$66,448", current: "PPC, Social, TCI", gaps: "SEO, Web, Video, Trad." },
    { name: "Dental Associates of Aurora", mrr: "$60,749", current: "PPC, SEO, Social, TCI", gaps: "Web, Video, Traditional" },
    { name: "Novi Smile", mrr: "$57,948", current: "PPC, SEO, Social", gaps: "TCI, Web, Video, Trad." },
    { name: "MoArk Dental & Implants", mrr: "$56,448", current: "PPC, SEO, Social, TCI", gaps: "Web, Video, Traditional" },
    { name: "Northside & Golden Oak", mrr: "$51,199", current: "PPC, SEO, Social, TCI", gaps: "Web, Video, Traditional" }
  ];
  upsellData.forEach((r, i) => {
    const ry = tableY + 0.35 + i * 0.35;
    const rowBg = i % 2 === 0 ? CHARCOAL : DARK;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: ry, w: 9, h: 0.35, fill: { color: rowBg } });
    s.addText(r.name, { x: 0.6, y: ry, w: 2.5, h: 0.35, fontSize: 9, fontFace: "Calibri", color: WHITE, margin: 0, valign: "middle" });
    s.addText(r.mrr, { x: 3.2, y: ry, w: 1.2, h: 0.35, fontSize: 9, fontFace: "Arial Black", color: GOLD, margin: 0, valign: "middle" });
    s.addText(r.current, { x: 4.5, y: ry, w: 2.5, h: 0.35, fontSize: 8, fontFace: "Calibri", color: TEAL, margin: 0, valign: "middle" });
    s.addText(r.gaps, { x: 7.1, y: ry, w: 2.2, h: 0.35, fontSize: 8, fontFace: "Calibri", color: ORANGE, margin: 0, valign: "middle" });
  });

  // Total MRR callout
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.25, w: 9, h: 0.45, fill: { color: "1A3A2A" }, rectRadius: 0.06, line: { color: TEAL, width: 1 } });
  s.addText([
    { text: "COMBINED MRR WITH GAPS:  ", options: { fontSize: 11, fontFace: "Arial Black", color: TEAL } },
    { text: "$549,586/mo across top 8 accounts  |  Every gap = a specific PDM product they can buy today", options: { fontSize: 11, fontFace: "Calibri", color: WHITE } }
  ], { x: 0.7, y: 4.25, w: 8.6, h: 0.45, margin: 0, valign: "middle" });

  // ============================================================
  // SECTION 12-13: CALL INTELLIGENCE + COMPETITIVE ALERTS
  // ============================================================
  sectionHeader(pres, "12-13", "Intelligence Retrieval", "Call Intelligence \u2022 Competitive Alerts", icons.eye);

  s = contentSlide(pres, "ON-DEMAND INTELLIGENCE");
  // Call Intelligence
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 0.9, w: 4.3, h: 3.0, fill: { color: CHARCOAL }, rectRadius: 0.08 });
  s.addText("12", { x: 0.65, y: 0.95, w: 0.6, h: 0.4, fontSize: 20, fontFace: "Arial Black", color: TEAL, margin: 0 });
  s.addText("CALL INTELLIGENCE RETRIEVAL", { x: 1.3, y: 1.0, w: 3.3, h: 0.3, fontSize: 11, fontFace: "Arial Black", color: WHITE, margin: 0 });
  addBullets(s, [
    "AI-generated call summaries for any account",
    "Sources: Zoom Meeting AI, Phone AI, Call_Intelligence__c",
    "Lookback: 90 days default, up to 5 calls",
    "Optional full transcript inclusion",
    "Sentiment trends across multiple calls"
  ], 0.65, 1.5, 3.9, 2.0, { fontSize: 9 });
  // Competitive Alerts
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.2, y: 0.9, w: 4.3, h: 3.0, fill: { color: CHARCOAL }, rectRadius: 0.08 });
  s.addText("13", { x: 5.35, y: 0.95, w: 0.6, h: 0.4, fontSize: 20, fontFace: "Arial Black", color: TEAL, margin: 0 });
  s.addText("COMPETITIVE ALERTS", { x: 5.95, y: 1.0, w: 3.3, h: 0.3, fontSize: 11, fontFace: "Arial Black", color: WHITE, margin: 0 });
  addBullets(s, [
    "Delta report from stored competitor snapshots",
    "Competitors gaining reviews, launching ads, entering Maps",
    "Each signal mapped to a specific PDM product",
    "4 conversation contexts:"
  ], 5.35, 1.5, 3.9, 1.2, { fontSize: 9 });
  const contexts = [
    { name: "New Prospect", action: "Close the deal" },
    { name: "Active Client", action: "Upsell" },
    { name: "Renewal", action: "Proof + expand" },
    { name: "Paused/Cancel", action: "Save play" }
  ];
  contexts.forEach((c, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.35, y: 2.7 + i * 0.35, w: 3.9, h: 0.28, fill: { color: DARK }, rectRadius: 0.03 });
    s.addText([
      { text: c.name + "  ", options: { bold: true, color: TEAL, fontSize: 8 } },
      { text: "\u2192 " + c.action, options: { color: LIGHT_GRAY, fontSize: 8 } }
    ], { x: 5.45, y: 2.7 + i * 0.35, w: 3.7, h: 0.28, fontFace: "Calibri", margin: 0, valign: "middle" });
  });

  // ============================================================
  // SECTION 14-17: REP TOOLS + AM COACHING
  // ============================================================
  sectionHeader(pres, "14-17", "Sales & Coaching Intelligence", "Rep Pipeline \u2022 Lead Intelligence \u2022 Renewal Proof \u2022 AM Coaching", icons.user);

  s = contentSlide(pres, "TOOLS FOR EVERY ROLE");
  const roleTools = [
    { num: "14", name: "REP PIPELINE SYNOPSIS", desc: "Monday morning brief for Sales Reps. Top prospects by LTB score, leads needing research, stale opportunities, recommended first calls.", users: "Sales Reps" },
    { num: "15", name: "LEAD INTELLIGENCE", desc: "Full pre-call brief for any Lead. Pardot engagement (UTM, score, grade, campaign), research scores, activity history, competitor snapshots.", users: "Sales Reps" },
    { num: "16", name: "RENEWAL PROOF PACKAGE", desc: "Auto-assembles renewal narrative: baseline vs. current maturity, competitive position change, sentiment trend. Auto-generates Gamma deck.", users: "Account Managers" },
    { num: "17", name: "AM COACHING BRIEF", desc: "Manager-facing dashboard per AM: health tier distribution, doctor contact rates, MRR managed, activity frequency, at-risk count. Data-driven 1:1s.", users: "AM Leadership" }
  ];
  roleTools.forEach((t, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const bx = 0.5 + col * 4.6;
    const by = 0.9 + row * 1.9;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: bx, y: by, w: 4.3, h: 1.7, fill: { color: CHARCOAL }, rectRadius: 0.08 });
    s.addText(t.num, { x: bx + 0.15, y: by + 0.1, w: 0.5, h: 0.35, fontSize: 18, fontFace: "Arial Black", color: TEAL, margin: 0 });
    s.addText(t.name, { x: bx + 0.7, y: by + 0.12, w: 3.4, h: 0.3, fontSize: 11, fontFace: "Arial Black", color: WHITE, margin: 0 });
    s.addText(t.desc, { x: bx + 0.15, y: by + 0.5, w: 4, h: 0.9, fontSize: 9, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
    s.addText(t.users, { x: bx + 0.15, y: by + 1.35, w: 4, h: 0.25, fontSize: 8, fontFace: "Calibri", color: TEAL, margin: 0 });
  });

  // ============================================================
  // SECTION 18-21: OPERATIONAL TOOLS
  // ============================================================
  sectionHeader(pres, "18-21", "Operational Tools", "Health Scanner \u2022 Activity Logging \u2022 Event Pipeline \u2022 Practice Competitor Scan", icons.cog);

  s = contentSlide(pres, "PLATFORM OPERATIONS");
  const opTools = [
    { num: "18", name: "NIGHTLY HEALTH SCANNER", desc: "Batch recalculation of health scores for all active accounts. Writes Health_Score__c, Health_Tier__c, Health_Score_Date__c. Detects tier drops, creates AM Tasks automatically. Powers Workflow 3.", color: TEAL },
    { num: "19", name: "ACTIVITY LOGGING", desc: "Quick logging: Call, Email, Meeting, or Note. Creates completed Task in Salesforce linked to Account and optionally Contact. One command, done.", color: TEAL },
    { num: "20", name: "EVENT CONVERSION PIPELINE", desc: "Tracks TCI Event attendees (FABC, FAGC) through the conversion funnel. Ticket buyer \u2192 prospect \u2192 client pipeline visibility.", color: TEAL },
    { num: "21", name: "PRACTICE COMPETITOR SCAN", desc: "Scans individual competing dental practices. Tracks reviews, velocity, Maps ranking, ads, website, social. Stores snapshots for quarterly delta comparison.", color: TEAL }
  ];
  opTools.forEach((t, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 0.9 + i * 1.05, w: 9, h: 0.9, fill: { color: CHARCOAL }, rectRadius: 0.06 });
    s.addText(t.num, { x: 0.65, y: 0.95 + i * 1.05, w: 0.6, h: 0.4, fontSize: 20, fontFace: "Arial Black", color: TEAL, margin: 0 });
    s.addText(t.name, { x: 1.35, y: 0.95 + i * 1.05, w: 3, h: 0.35, fontSize: 12, fontFace: "Arial Black", color: WHITE, margin: 0 });
    s.addText(t.desc, { x: 1.35, y: 1.3 + i * 1.05, w: 7.8, h: 0.45, fontSize: 10, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  });

  // ============================================================
  // SECTION: PROPHET PERSONAL ASSISTANT (TELEGRAM)
  // ============================================================
  s = darkSlide(pres, { accentTop: false, bg: NAVY });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.15, h: SLIDE_H, fill: { color: GOLD } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: 0.04, fill: { color: GOLD } });
  s.addText("One more thing...", { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, fontFace: "Calibri", color: GOLD, italic: true, margin: 0 });
  s.addText("PROPHET PERSONAL ASSISTANT", { x: 0.5, y: 1.0, w: 9, h: 0.8, fontSize: 34, fontFace: "Arial Black", color: WHITE, bold: true, margin: 0 });
  s.addShape(pres.shapes.LINE, { x: 0.5, y: 1.85, w: 2.5, h: 0, line: { color: GOLD, width: 2 } });
  s.addText("A dedicated AI team member on every phone. Text, voice, or photo \u2014 Prophet responds in seconds with live Salesforce intelligence.", { x: 0.5, y: 2.1, w: 8.5, h: 0.6, fontSize: 15, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  // Four capability cards
  const paCards = [
    { icon: "\uD83D\uDCF1", title: "TEXT", desc: "\"How is Coastal Dental doing?\"\nInstant health reports, pre-call briefs, churn risk lists" },
    { icon: "\uD83C\uDF99\uFE0F", title: "VOICE", desc: "Voice notes from your car.\nProphet transcribes, routes, and logs to Salesforce." },
    { icon: "\uD83D\uDCF7", title: "PHOTO", desc: "Snap a whiteboard or meeting notes.\nProphet extracts and saves to the account." },
    { icon: "\u2600\uFE0F", title: "MORNING BRIEF", desc: "6:30 AM every weekday. Your calls,\nchurn alerts, stale accounts, and actions." }
  ];
  paCards.forEach((c, i) => {
    const cx = 0.5 + i * 2.35;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx, y: 3.0, w: 2.15, h: 1.8, fill: { color: CHARCOAL }, rectRadius: 0.08 });
    s.addText(c.icon, { x: cx, y: 3.1, w: 2.15, h: 0.35, fontSize: 22, align: "center", margin: 0 });
    s.addText(c.title, { x: cx, y: 3.45, w: 2.15, h: 0.3, fontSize: 13, fontFace: "Arial Black", color: TEAL, align: "center", margin: 0 });
    s.addText(c.desc, { x: cx + 0.1, y: 3.8, w: 1.95, h: 0.9, fontSize: 8, fontFace: "Calibri", color: LIGHT_GRAY, align: "center", margin: 0 });
  });

  // ── Personal Assistant — Morning Brief Detail ─────────────────────────
  s = contentSlide(pres, "THE 6:30 AM MORNING BRIEF");
  s.addText("Prophet texts first. Every weekday morning, each team member receives a personalized intelligence brief before their first coffee.", { x: 0.5, y: 0.85, w: 9, h: 0.3, fontSize: 11, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  // Mock Telegram message
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.3, w: 5.5, h: 3.8, fill: { color: "1A2634" }, rectRadius: 0.12 });
  const mockLines = [
    { text: "Good morning, Sarah. Here\u2019s your Tuesday brief.", bold: true, color: WHITE },
    { text: "" },
    { text: "\uD83D\uDCC5 Today\u2019s Calls (3)", bold: true, color: TEAL },
    { text: "9:00 AM \u2014 Smile Design Tampa", color: WHITE },
    { text: "  \u2514 Health dropped to 41. PPC frustration detected.", color: LIGHT_GRAY },
    { text: "11:30 AM \u2014 Dr. Chen (renewal in 18 days)", color: WHITE },
    { text: "2:00 PM \u2014 New prospect discovery call", color: WHITE },
    { text: "" },
    { text: "\uD83D\uDEA8 Attention Needed (2 accounts \u2014 $97k/mo)", bold: true, color: RED },
    { text: "\uD83D\uDD34 Boulevard Dental \u2014 contract ends in 29 days", color: LIGHT_GRAY },
    { text: "\uD83D\uDD34 One Solution \u2014 $84.9k/mo at risk", color: LIGHT_GRAY },
    { text: "" },
    { text: "\uD83D\uDCA1 3 things I can do for you right now:", bold: true, color: GOLD },
    { text: "1. Pre-call brief for Smile Design Tampa", color: WHITE },
    { text: "2. Draft save play email for Boulevard Dental", color: WHITE },
    { text: "3. Research the Phoenix lead from last night", color: WHITE },
    { text: "" },
    { text: "Reply 1, 2, 3, or \"all\" to execute.", color: TEAL, italic: true },
  ];
  mockLines.forEach((ln, i) => {
    if (ln.text) {
      s.addText(ln.text, { x: 0.7, y: 1.4 + i * 0.2, w: 5.1, h: 0.2, fontSize: 8, fontFace: "Calibri", color: ln.color || LIGHT_GRAY, bold: !!ln.bold, italic: !!ln.italic, margin: 0 });
    }
  });
  // Right side: what powers it
  s.addText("WHAT RUNS OVERNIGHT", { x: 6.3, y: 1.3, w: 3.2, h: 0.25, fontSize: 9, fontFace: "Arial", color: GOLD, bold: true, margin: 0 });
  const overnightSteps = [
    { label: "Calendar Scan", desc: "Cross-references tomorrow\u2019s meetings with Salesforce accounts" },
    { label: "Churn Alerts", desc: "Accounts that crossed a threshold since yesterday" },
    { label: "Stale Accounts", desc: "30/60/90 days no contact, sorted by MRR" },
    { label: "Renewal Countdown", desc: "Anything inside 30 days without a deck" },
    { label: "Action Suggestions", desc: "AI-generated \u201Chere\u2019s what moves the needle today\u201D" }
  ];
  overnightSteps.forEach((os, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.3, y: 1.65 + i * 0.6, w: 3.2, h: 0.5, fill: { color: CHARCOAL }, rectRadius: 0.04 });
    s.addText(os.label, { x: 6.45, y: 1.67 + i * 0.6, w: 2.9, h: 0.2, fontSize: 9, fontFace: "Arial Black", color: TEAL, margin: 0 });
    s.addText(os.desc, { x: 6.45, y: 1.87 + i * 0.6, w: 2.9, h: 0.2, fontSize: 7, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  });
  addUsersRow(s, ["Account Managers", "Sales Reps", "Leadership"], 0.5, 5.15);

  // ── Personal Assistant — Command Showcase ──────────────────────────────
  s = contentSlide(pres, "NATURAL LANGUAGE COMMANDS");
  s.addText("No menus. No training. Just text what you need in plain English.", { x: 0.5, y: 0.85, w: 9, h: 0.3, fontSize: 11, fontFace: "Calibri", color: LIGHT_GRAY, margin: 0 });
  const cmdExamples = [
    { cmd: "\"How is Coastal Dental doing?\"", tool: "Account Health Report", icon: "\u2764\uFE0F" },
    { cmd: "\"Brief me for Dr. Martinez\"", tool: "Pre-Call Brief", icon: "\uD83D\uDCCB" },
    { cmd: "\"Who\u2019s at risk?\"", tool: "Churn Risk Accounts", icon: "\uD83D\uDEA8" },
    { cmd: "\"My week\"", tool: "Weekly AM Synopsis", icon: "\uD83D\uDCC5" },
    { cmd: "\"Research Smile Design in Tampa\"", tool: "Prospect Research Engine", icon: "\uD83D\uDD0D" },
    { cmd: "\"Just left Dr. Chen. He\u2019s renewing.\"", tool: "Log Account Note to SF", icon: "\u270D\uFE0F" },
    { cmd: "\"Renewals\"", tool: "Renewal Pipeline", icon: "\uD83D\uDD04" },
    { cmd: "\"Upsell opportunities\"", tool: "Upsell Analysis", icon: "\uD83D\uDCC8" },
    { cmd: "\"Dead deals\"", tool: "Raise the Ghosts", icon: "\uD83D\uDC7B" },
    { cmd: "[Send a voice note from your car]", tool: "Transcribe \u2192 Route \u2192 Execute", icon: "\uD83C\uDF99\uFE0F" },
    { cmd: "[Send a photo of whiteboard notes]", tool: "Extract \u2192 Save to Salesforce", icon: "\uD83D\uDCF7" },
  ];
  cmdExamples.forEach((ce, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const cx = 0.5 + col * 4.7;
    const cy = 1.25 + row * 0.7;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx, y: cy, w: 4.5, h: 0.6, fill: { color: CHARCOAL }, rectRadius: 0.04 });
    s.addText(ce.icon, { x: cx + 0.1, y: cy + 0.05, w: 0.35, h: 0.5, fontSize: 14, align: "center", margin: 0 });
    s.addText(ce.cmd, { x: cx + 0.5, y: cy + 0.03, w: 3.8, h: 0.3, fontSize: 9, fontFace: "Calibri", color: WHITE, bold: true, margin: 0 });
    s.addText("\u2192 " + ce.tool, { x: cx + 0.5, y: cy + 0.3, w: 3.8, h: 0.25, fontSize: 8, fontFace: "Calibri", color: TEAL, margin: 0 });
  });
  // Bottom callout
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 5.0, w: 9, h: 0.4, fill: { color: CHARCOAL }, rectRadius: 0.06 });
  s.addText([
    { text: "STATUS:  ", options: { bold: true, color: GOLD, fontSize: 10 } },
    { text: "LIVE NOW. Built and tested April 1, 2026. Running on Telegram via @ProphetPDMBot.", options: { color: TEAL, fontSize: 10, bold: true } }
  ], { x: 0.7, y: 5.0, w: 8.6, h: 0.4, fontFace: "Calibri", margin: 0, valign: "middle" });

  // ============================================================
  // CLOSING: THE PROPHET FLYWHEEL
  // ============================================================
  s = darkSlide(pres, { bg: DARK });
  s.addText("THE PROPHET FLYWHEEL", { x: 0.5, y: 0.15, w: 9, h: 0.5, fontSize: 26, fontFace: "Arial Black", color: WHITE, margin: 0 });
  s.addShape(pres.shapes.LINE, { x: 0.5, y: 0.65, w: 2.5, h: 0, line: { color: TEAL, width: 1.5 } });
  // Circular flywheel using positioned boxes
  const flySteps = [
    { x: 3.5, y: 0.9, label: "RESEARCH\nPROSPECT", desc: "Scores written to Salesforce" },
    { x: 6.5, y: 1.5, label: "CONVERT\nTO CLIENT", desc: "Baseline locked forever" },
    { x: 7.5, y: 3.0, label: "DELIVER\nSERVICES", desc: "Health tracked, calls analyzed" },
    { x: 5.5, y: 4.2, label: "QUARTERLY\nRE-RESEARCH", desc: "Gaps updated, threats surfaced" },
    { x: 2.5, y: 4.2, label: "RENEWAL\nPROOF", desc: "Before/after evidence assembled" },
    { x: 1.0, y: 3.0, label: "RETAIN &\nGROW", desc: "Every data point compounds" }
  ];
  flySteps.forEach((fs, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: fs.x, y: fs.y, w: 2, h: 0.85, fill: { color: CHARCOAL }, rectRadius: 0.06 });
    s.addText([
      { text: fs.label + "\n", options: { bold: true, color: TEAL, fontSize: 9 } },
      { text: fs.desc, options: { color: LIGHT_GRAY, fontSize: 8 } }
    ], { x: fs.x + 0.1, y: fs.y + 0.05, w: 1.8, h: 0.75, fontFace: "Calibri", margin: 0, align: "center" });
    // Arrow to next
    if (i < flySteps.length - 1) {
      const nx = flySteps[i + 1];
      const arrowX = (fs.x + 1 + nx.x + 1) / 2 - 0.15;
      const arrowY = (fs.y + 0.4 + nx.y + 0.4) / 2 - 0.15;
      s.addText("\u27A4", { x: arrowX, y: arrowY, w: 0.3, h: 0.3, fontSize: 14, color: TEAL, align: "center", margin: 0 });
    }
  });
  // Return arrow from last to first
  s.addText("\u27A4", { x: 2.6, y: 1.3, w: 0.3, h: 0.3, fontSize: 14, color: GOLD, align: "center", margin: 0 });
  // Center text
  s.addShape(pres.shapes.OVAL, { x: 3.5, y: 2.3, w: 3, h: 1.5, fill: { color: NAVY } });
  s.addText([
    { text: "EVERY INTERACTION\n", options: { fontSize: 10, bold: true, color: GOLD } },
    { text: "MAKES PROPHET\n", options: { fontSize: 10, bold: true, color: WHITE } },
    { text: "SMARTER", options: { fontSize: 14, bold: true, color: TEAL } }
  ], { x: 3.5, y: 2.4, w: 3, h: 1.3, fontFace: "Arial Black", align: "center", valign: "middle", margin: 0 });

  // ============================================================
  // FINAL SLIDE
  // ============================================================
  s = darkSlide(pres, { accentTop: false, bg: NAVY });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.15, h: SLIDE_H, fill: { color: TEAL } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: SLIDE_W, h: 0.04, fill: { color: TEAL } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: SLIDE_H - 0.04, w: SLIDE_W, h: 0.04, fill: { color: TEAL } });
  s.addImage({ data: icons.star, x: 4.5, y: 0.8, w: 1, h: 1 });
  s.addText("Prophet sees what\u2019s coming\nbefore it arrives.", { x: 1, y: 2.0, w: 8, h: 1.2, fontSize: 32, fontFace: "Arial Black", color: WHITE, align: "center", margin: 0 });
  s.addShape(pres.shapes.LINE, { x: 3.5, y: 3.3, w: 3, h: 0, line: { color: GOLD, width: 2 } });
  s.addText("Built by William Summers", { x: 1, y: 3.6, w: 8, h: 0.4, fontSize: 14, fontFace: "Calibri", color: LIGHT_GRAY, align: "center", margin: 0 });
  s.addText("Progressive Dental Marketing  |  2026", { x: 1, y: 4.0, w: 8, h: 0.3, fontSize: 12, fontFace: "Calibri", color: MID_GRAY, align: "center", margin: 0 });

  // ============================================================
  // SAVE
  // ============================================================
  const outPath = "/Users/williamsummers/salesforce-retention-mcp/Prophet_Executive_Briefs.pptx";
  await pres.writeFile({ fileName: outPath });
  console.log("Saved to: " + outPath);
}

buildDeck().catch(e => { console.error(e); process.exit(1); });
