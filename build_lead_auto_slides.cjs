const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");

// Icon rendering
function renderIconSvg(IconComponent, color, size) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color: color, size: String(size) })
  );
}

async function iconToBase64Png(IconComponent, color, size) {
  const svg = renderIconSvg(IconComponent, color || "#00D9A6", size || 256);
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + pngBuffer.toString("base64");
}

async function build() {
  // Load icons
  const fa = require("react-icons/fa");
  const md = require("react-icons/md");

  // ── Design tokens (matched from existing deck) ──
  const BG = "2B3544";        // dark slate background
  const TEAL = "00D9A6";      // primary accent (teal/cyan)
  const TEAL_DIM = "1B5E50";  // dimmer teal for cards
  const CARD_BG = "2F4050";   // card/box background
  const CARD_BORDER = "3A5568"; // subtle card border
  const WHITE = "FFFFFF";
  const LIGHT_GRAY = "A0AEC0"; // secondary text
  const GOLD = "E8A838";       // gold accent (for callouts)
  const GREEN_BRIGHT = "48BB78"; // success green

  // Generate icons
  const radarIcon = await iconToBase64Png(fa.FaSatelliteDish, "#00D9A6", 256);
  const robotIcon = await iconToBase64Png(fa.FaRobot, "#00D9A6", 256);
  const filterIcon = await iconToBase64Png(fa.FaFilter, "#00D9A6", 256);
  const dbIcon = await iconToBase64Png(fa.FaDatabase, "#00D9A6", 256);
  const searchIcon = await iconToBase64Png(fa.FaSearchLocation, "#00D9A6", 256);
  const checkIcon = await iconToBase64Png(fa.FaCheckCircle, "#48BB78", 256);
  const starIcon = await iconToBase64Png(fa.FaStar, "#E8A838", 256);
  const layerIcon = await iconToBase64Png(fa.FaLayerGroup, "#00D9A6", 256);
  const chartIcon = await iconToBase64Png(fa.FaChartBar, "#00D9A6", 256);
  const boltIcon = await iconToBase64Png(fa.FaBolt, "#E8A838", 256);

  let pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "William Summers";
  pres.title = "Prophet — Lead Automation System";

  // Helper: add right teal edge stripe (matching deck pattern)
  function addStripe(slide) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 9.65, y: 0, w: 0.35, h: 5.625,
      fill: { color: TEAL }
    });
  }

  // Helper: add dark card shape
  function addCard(slide, x, y, w, h) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: x, y: y, w: w, h: h,
      fill: { color: CARD_BG },
      line: { color: CARD_BORDER, width: 1 }
    });
  }

  // ═══════════════════════════════════════════
  // SLIDE 1: SECTION DIVIDER
  // ═══════════════════════════════════════════
  var s1 = pres.addSlide();
  s1.background = { color: BG };
  addStripe(s1);

  // Large section number
  s1.addText("22", {
    x: 0.7, y: 0.4, w: 3, h: 1.8,
    fontSize: 96, fontFace: "Arial Black", bold: true,
    color: TEAL, margin: 0
  });

  // Icon top-right
  s1.addImage({
    data: radarIcon,
    x: 8.4, y: 0.5, w: 1.0, h: 1.0
  });

  // Title
  s1.addText("LEAD AUTOMATION\nSYSTEM", {
    x: 0.7, y: 2.4, w: 8, h: 1.8,
    fontSize: 48, fontFace: "Arial Black", bold: true,
    color: WHITE, margin: 0, lineSpacingMultiple: 0.95
  });

  // Subtitle
  s1.addText("Scan 150 metros. Discover new prospects. Enrich with AI. Write to Salesforce automatically.", {
    x: 0.7, y: 4.3, w: 8, h: 0.6,
    fontSize: 16, fontFace: "Calibri",
    color: LIGHT_GRAY, margin: 0
  });


  // ═══════════════════════════════════════════
  // SLIDE 2: HOW IT WORKS — PIPELINE FLOW
  // ═══════════════════════════════════════════
  var s2 = pres.addSlide();
  s2.background = { color: BG };

  // Title
  s2.addText("HOW IT WORKS", {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 28, fontFace: "Arial Black", bold: true,
    color: TEAL, margin: 0
  });

  // ── Pipeline flow boxes (6 steps) ──
  var steps = [
    { label: "6 Google\nSearches", bg: TEAL },
    { label: "Dedup vs.\nSalesforce", bg: CARD_BG },
    { label: "Firecrawl\nScrape", bg: CARD_BG },
    { label: "Claude AI\nAnalysis", bg: CARD_BG },
    { label: "Quality\nFilter", bg: CARD_BG },
    { label: "Salesforce\nWrite-back", bg: TEAL }
  ];

  var stepW = 1.25;
  var stepH = 0.7;
  var stepY = 1.15;
  var gapX = 0.22;
  var startX = 0.5;

  steps.forEach(function(step, i) {
    var sx = startX + i * (stepW + gapX);
    s2.addShape(pres.shapes.RECTANGLE, {
      x: sx, y: stepY, w: stepW, h: stepH,
      fill: { color: step.bg },
      line: { color: CARD_BORDER, width: 1 }
    });
    s2.addText(step.label, {
      x: sx, y: stepY, w: stepW, h: stepH,
      fontSize: 10, fontFace: "Calibri", bold: true,
      color: WHITE, align: "center", valign: "middle", margin: 0
    });
    // Arrow between steps
    if (i < steps.length - 1) {
      s2.addText("\u2192", {
        x: sx + stepW, y: stepY, w: gapX, h: stepH,
        fontSize: 14, color: TEAL, align: "center", valign: "middle", margin: 0
      });
    }
  });

  // ── Left column: SEARCH QUERIES ──
  s2.addText("SEARCH QUERIES", {
    x: 0.5, y: 2.15, w: 4, h: 0.35,
    fontSize: 13, fontFace: "Arial", bold: true,
    color: TEAL, margin: 0
  });

  var queries = [
    "dental implant marketing + [city]",
    "full arch dental advertising + [city]",
    "dental implant PPC agency + [city]",
    "dental practice SEO company + [city]",
    "dental implant lead generation + [city]",
    "All-on-4 marketing + [city]"
  ];

  queries.forEach(function(q, i) {
    addCard(s2, 0.5, 2.55 + i * 0.42, 4.2, 0.36);
    s2.addText(q, {
      x: 0.65, y: 2.55 + i * 0.42, w: 3.9, h: 0.36,
      fontSize: 10, fontFace: "Calibri", color: LIGHT_GRAY,
      valign: "middle", margin: 0
    });
  });

  // ── Right column: ENRICHMENT FIELDS ──
  s2.addText("12 FIELDS WRITTEN TO SALESFORCE", {
    x: 5.2, y: 2.15, w: 4.3, h: 0.35,
    fontSize: 13, fontFace: "Arial", bold: true,
    color: TEAL, margin: 0
  });

  var fields = [
    ["Doctor_Name__c", "Point_of_Contact__c"],
    ["Priority_Score__c", "Ready_to_Buy_Score__c"],
    ["Est_Marketing_Maturity__c", "Likely_Vendor__c"],
    ["Service_Gaps__c", "Best_Outreach_Angle__c"],
    ["Best_Poach_Lever__c", "PDM_Solution__c"],
    ["Scan_Tier__c", "POC_Role__c"]
  ];

  fields.forEach(function(pair, i) {
    // Left field
    addCard(s2, 5.2, 2.55 + i * 0.42, 2.05, 0.36);
    s2.addText(pair[0], {
      x: 5.3, y: 2.55 + i * 0.42, w: 1.85, h: 0.36,
      fontSize: 9.5, fontFace: "Consolas", color: LIGHT_GRAY,
      valign: "middle", margin: 0
    });
    // Right field
    addCard(s2, 7.4, 2.55 + i * 0.42, 2.05, 0.36);
    s2.addText(pair[1], {
      x: 7.5, y: 2.55 + i * 0.42, w: 1.85, h: 0.36,
      fontSize: 9.5, fontFace: "Consolas", color: LIGHT_GRAY,
      valign: "middle", margin: 0
    });
  });

  // ── WHO USES IT bar ──
  s2.addText("WHO USES IT", {
    x: 0.5, y: 5.15, w: 1.3, h: 0.35,
    fontSize: 11, fontFace: "Arial", bold: true,
    color: GOLD, margin: 0, valign: "middle"
  });

  var users2 = ["Sales Reps", "Sales Leadership", "Marketing"];
  users2.forEach(function(u, i) {
    s2.addShape(pres.shapes.RECTANGLE, {
      x: 2.0 + i * 1.7, y: 5.15, w: 1.5, h: 0.35,
      fill: { color: CARD_BG },
      line: { color: TEAL, width: 1 }
    });
    s2.addText(u, {
      x: 2.0 + i * 1.7, y: 5.15, w: 1.5, h: 0.35,
      fontSize: 10, fontFace: "Calibri", color: WHITE,
      align: "center", valign: "middle", margin: 0
    });
  });


  // ═══════════════════════════════════════════
  // SLIDE 3: QUALITY, TIER SYSTEM & BUSINESS IMPACT
  // ═══════════════════════════════════════════
  var s3 = pres.addSlide();
  s3.background = { color: BG };

  // Title
  s3.addText("QUALITY GATES & MARKET TIERS", {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 28, fontFace: "Arial Black", bold: true,
    color: TEAL, margin: 0
  });

  // ── Left: Quality Gates ──
  s3.addText("QUALITY FILTERS", {
    x: 0.5, y: 1.05, w: 4.5, h: 0.35,
    fontSize: 13, fontFace: "Arial", bold: true,
    color: TEAL, margin: 0
  });

  var gates = [
    { icon: checkIcon, label: "Ready-to-Buy Score", val: "\u2265 70 to pass" },
    { icon: filterIcon, label: "Dedup Gate", val: "No existing Lead, Account, or Member" },
    { icon: dbIcon, label: "Salesforce Write", val: "12 custom fields per Lead" },
    { icon: searchIcon, label: "Email Validation", val: "Rejects AI-generated 'Unknown'" }
  ];

  gates.forEach(function(g, i) {
    var gy = 1.5 + i * 0.65;
    addCard(s3, 0.5, gy, 4.5, 0.62);
    s3.addImage({ data: g.icon, x: 0.65, y: gy + 0.12, w: 0.38, h: 0.38 });
    s3.addText(g.label, {
      x: 1.15, y: gy + 0.05, w: 2.5, h: 0.3,
      fontSize: 12, fontFace: "Calibri", bold: true,
      color: WHITE, valign: "middle", margin: 0
    });
    s3.addText(g.val, {
      x: 1.15, y: gy + 0.32, w: 3.7, h: 0.25,
      fontSize: 10, fontFace: "Calibri",
      color: LIGHT_GRAY, valign: "middle", margin: 0
    });
  });

  // ── Right: 5-Tier Market System ──
  s3.addText("5-TIER MARKET SYSTEM", {
    x: 5.3, y: 1.05, w: 4.2, h: 0.35,
    fontSize: 13, fontFace: "Arial", bold: true,
    color: TEAL, margin: 0
  });

  var tiers = [
    { tier: "TIER 1", desc: "Top 15 metros", color: "48BB78", ex: "NYC, LA, Chicago" },
    { tier: "TIER 2", desc: "Mid-size growth", color: "4299E1", ex: "Knoxville, Boise" },
    { tier: "TIER 3", desc: "Regional hubs", color: "9F7AEA", ex: "Chattanooga, Sarasota" },
    { tier: "TIER 4", desc: "Affluent suburbs", color: "ED8936", ex: "Scottsdale, Naples" },
    { tier: "TIER 5", desc: "Specialty niches", color: "FC8181", ex: "University towns, military" }
  ];

  tiers.forEach(function(t, i) {
    var ty = 1.5 + i * 0.52;
    // Tier badge
    s3.addShape(pres.shapes.RECTANGLE, {
      x: 5.3, y: ty, w: 0.85, h: 0.48,
      fill: { color: t.color }
    });
    s3.addText(t.tier, {
      x: 5.3, y: ty, w: 0.85, h: 0.48,
      fontSize: 10, fontFace: "Arial", bold: true,
      color: WHITE, align: "center", valign: "middle", margin: 0
    });
    // Description
    addCard(s3, 6.25, ty, 3.25, 0.48);
    s3.addText(t.desc, {
      x: 6.35, y: ty, w: 1.6, h: 0.48,
      fontSize: 11, fontFace: "Calibri", bold: true,
      color: WHITE, valign: "middle", margin: 0
    });
    s3.addText(t.ex, {
      x: 7.9, y: ty, w: 1.5, h: 0.48,
      fontSize: 9, fontFace: "Calibri",
      color: LIGHT_GRAY, valign: "middle", margin: 0
    });
  });

  // ── Bottom: Business Impact callout ──
  s3.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.2, w: 9.0, h: 0.75,
    fill: { color: "1A2F3A" },
    line: { color: GOLD, width: 2 }
  });

  s3.addText([
    { text: "BUSINESS IMPACT:  ", options: { bold: true, color: GOLD, fontSize: 12 } },
    { text: "150 metro areas scanned automatically. RTB \u2265 70 filter ensures only high-quality leads enter the pipeline. Every lead arrives with AI-enriched intelligence, service gaps identified, and a recommended PDM solution \u2014 before a rep ever makes a call.", options: { color: LIGHT_GRAY, fontSize: 11 } }
  ], {
    x: 0.7, y: 4.22, w: 8.6, h: 0.7,
    fontFace: "Calibri", valign: "middle", margin: 0
  });

  // ── WHO USES IT bar ──
  s3.addText("WHO USES IT", {
    x: 0.5, y: 5.15, w: 1.3, h: 0.35,
    fontSize: 11, fontFace: "Arial", bold: true,
    color: GOLD, margin: 0, valign: "middle"
  });

  var users3 = ["Sales Reps", "Sales Leadership", "Marketing"];
  users3.forEach(function(u, i) {
    s3.addShape(pres.shapes.RECTANGLE, {
      x: 2.0 + i * 1.7, y: 5.15, w: 1.5, h: 0.35,
      fill: { color: CARD_BG },
      line: { color: TEAL, width: 1 }
    });
    s3.addText(u, {
      x: 2.0 + i * 1.7, y: 5.15, w: 1.5, h: 0.35,
      fontSize: 10, fontFace: "Calibri", color: WHITE,
      align: "center", valign: "middle", margin: 0
    });
  });


  // ═══════════════════════════════════════════
  // SAVE
  // ═══════════════════════════════════════════
  await pres.writeFile({ fileName: "/Users/williamsummers/salesforce-retention-mcp/Prophet_Lead_Automation_Slides.pptx" });
  console.log("DONE — 3 slides saved to Prophet_Lead_Automation_Slides.pptx");
}

build().catch(function(e) { console.error(e); process.exit(1); });
