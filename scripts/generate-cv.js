const fs = require("fs");
const path = require("path");
const vm = require("vm");
const childProcess = require("child_process");
const PDFDocument = require("pdfkit");

const root = path.resolve(__dirname, "..");
const distIndexPath = path.join(root, "dist", "index.html");
const outputDir = path.join(root, "cv");

function readSiteData() {
    if (!fs.existsSync(distIndexPath)) {
        throw new Error("Missing dist/index.html. Run `npm run build` first.");
    }

    const html = fs.readFileSync(distIndexPath, "utf8");
    const startMarker = "const siteData = ";
    const endMarker = "\n    const icon";
    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker, start);

    if (start === -1 || end === -1) {
        throw new Error("Could not find siteData in dist/index.html.");
    }

    const objectLiteral = html.slice(start + startMarker.length, end).trim().replace(/;$/, "");
    const sandbox = {};
    vm.runInNewContext("siteData = " + objectLiteral, sandbox);
    return sandbox.siteData;
}

function clean(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, "-")
        .replace(/£/g, "GBP ")
        .replace(/€/g, "EUR ")
        .trim();
}

function professionalSummary(profile) {
    const summary = clean(profile.summary);
    const sentences = summary.split(/(?<=[.!?])\s+/).filter(Boolean);
    const filtered = sentences.filter(function (sentence) {
        return !/hopefully|I teach exoskeletons/i.test(sentence);
    });
    return (filtered.length ? filtered : sentences).slice(0, 2).join(" ");
}

function shorten(value, maxLength) {
    const text = clean(value);
    if (text.length <= maxLength) return text;
    const shortened = text.slice(0, maxLength - 1);
    const lastSpace = shortened.lastIndexOf(" ");
    return shortened.slice(0, lastSpace > 25 ? lastSpace : maxLength - 1) + "...";
}

function allSkills(data) {
    return data.skills.reduce(function (items, group) {
        return items.concat(group.items.map(function (item) { return item.label; }));
    }, []);
}

function primaryUrl(item) {
    const links = item.links || [];
    for (let i = 0; i < links.length; i += 1) {
        if (links[i].url) return links[i].url;
    }
    return item.url || "";
}

function ensureDir() {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
}

function pipePdf(doc, filename) {
    const outputPath = path.join(outputDir, filename);
    doc.pipe(fs.createWriteStream(outputPath));
    return outputPath;
}

function addLinkText(doc, text, x, y, options) {
    const opts = options || {};
    const url = opts.url;
    const color = opts.color || "#064b52";
    if (!url) {
        doc.fillColor(opts.fill || "#151a23").text(text, x, y, opts);
        return;
    }
    doc.fillColor(color).text(text, x, y, Object.assign({}, opts, { link: url, underline: false }));
}

function sectionTitle(doc, title, x, y, width, color) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(color).text(title.toUpperCase(), x, y, {
        width: width,
        characterSpacing: 0.5
    });
    doc.moveTo(x, y + 13).lineTo(x + width, y + 13).strokeColor("#d7dde1").lineWidth(0.5).stroke();
    return y + 20;
}

function bullet(doc, text, x, y, width, size) {
    doc.font("Helvetica").fontSize(size || 7.2).fillColor("#263241");
    doc.circle(x + 2, y + 4, 1.3).fill("#087f7a");
    doc.fillColor("#263241").text(clean(text), x + 8, y, { width: width - 8, lineGap: 0.6 });
    return doc.y + 4;
}

function drawChip(doc, text, x, y, options) {
    const opts = options || {};
    const fontSize = opts.fontSize || 6.6;
    const paddingX = opts.paddingX || 6;
    const height = opts.height || 14;
    const maxWidth = opts.maxWidth || 120;
    doc.font("Helvetica-Bold").fontSize(fontSize);
    const width = Math.min(maxWidth, Math.max(opts.minWidth || 36, doc.widthOfString(text) + paddingX * 2 + 4));
    doc.roundedRect(x, y, width, height, 4).fill(opts.fill || "#eef5f2");
    doc.fillColor(opts.color || "#064b52").text(text, x + paddingX, y + 4, { width: width - paddingX * 2, ellipsis: true });
    return width;
}

function drawModernSection(doc, title, x, y, width) {
    doc.roundedRect(x, y + 2, 5, 15, 2).fill("#087f7a");
    doc.font("Helvetica-Bold").fontSize(8.6).fillColor("#111827").text(title.toUpperCase(), x + 10, y, {
        width: width - 10,
        characterSpacing: 0.55
    });
    doc.moveTo(x + 10, y + 16).lineTo(x + width, y + 16).strokeColor("#dbe2e5").lineWidth(0.6).stroke();
    return y + 24;
}

function drawWrappedChips(doc, items, x, y, width, options) {
    const opts = options || {};
    let cursorX = x;
    let cursorY = y;
    const gap = opts.gap || 5;
    items.forEach(function (item) {
        const text = clean(item);
        doc.font("Helvetica-Bold").fontSize(opts.fontSize || 6.6);
        const chipWidth = Math.min(opts.maxChipWidth || 112, Math.max(opts.minWidth || 36, doc.widthOfString(text) + (opts.paddingX || 6) * 2 + 4));
        if (cursorX + chipWidth > x + width) {
            cursorX = x;
            cursorY += (opts.height || 14) + gap;
        }
        drawChip(doc, text, cursorX, cursorY, opts);
        cursorX += chipWidth + gap;
    });
    return cursorY + (opts.height || 14);
}

function onePageSkillLabel(label) {
    return {
        "scikit-learn": "Sklearn",
        "Raspberry Pi": "Raspberry Pi",
        "TensorFlow": "TensorFlow"
    }[label] || label;
}

function onePageAwardTitle(title) {
    if (/Exoplanet/i.test(title)) return "3rd Place - Exoplanet ML Challenge";
    if (/Cambridge Summer School Scholarship/i.test(title)) return "Cambridge Scholarship & Grant";
    return title;
}

function generateOnePagePdf(data) {
    const doc = new PDFDocument({
        size: "A4",
        margin: 22,
        autoFirstPage: true,
        info: {
            Title: data.profile.name + " - CV",
            Author: data.profile.name
        }
    });
    const outputPath = pipePdf(doc, "miroljub-mihailovic-cv-one-page.pdf");
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 30;
    const gap = 18;
    const colWidth = (pageWidth - margin * 2 - gap) / 2;
    const leftX = margin;
    const rightX = margin + colWidth + gap;
    const accent = "#087f7a";
    const ink = "#111827";
    const muted = "#647181";
    const warm = "#d47b2b";
    const line = "#d8e0e2";
    const soft = "#eef5f2";

    function section(label, x, y, width) {
        doc.font("Helvetica-Bold").fontSize(8.8).fillColor(ink).text(label.toUpperCase(), x + 8, y, {
            width: width - 8,
            characterSpacing: 0.45
        });
        doc.moveTo(x, y + 13).lineTo(x + width, y + 13).strokeColor(line).lineWidth(0.55).stroke();
        doc.roundedRect(x, y + 2, 4, 10, 1.5).fill(accent);
        return y + 20;
    }

    function compactItem(item, x, y, width, options) {
        const opts = options || {};
        const titleSize = opts.titleSize || 7.4;
        const bodySize = opts.bodySize || 6.35;
        const maxDetail = opts.maxDetail || 0;
        const titleWidth = item.date ? width - 68 : width;
        doc.font("Helvetica-Bold").fontSize(titleSize).fillColor(ink).text(clean(item.title), x, y, { width: titleWidth, lineGap: 0 });
        const titleBottom = doc.y;
        if (item.date) {
            doc.font("Helvetica-Bold").fontSize(5.9).fillColor(warm).text(clean(item.date), x + width - 65, y + 1, {
                width: 65,
                align: "right"
            });
        }
        y = titleBottom + 0.8;
        const meta = item.subtitle || item.venue || item.summary || "";
        if (meta) {
            doc.font("Helvetica").fontSize(bodySize).fillColor(muted).text(shorten(meta, opts.maxMeta || 92), x, y, {
                width: width,
                lineGap: 0
            });
            y = doc.y + 0.5;
        }
        if (item.authors && opts.authors) {
            doc.font("Helvetica-Oblique").fontSize(bodySize).fillColor("#364150").text(shorten(item.authors, opts.maxAuthors || 90), x, y, {
                width: width,
                lineGap: 0
            });
            y = doc.y + 0.5;
        }
        if (maxDetail && item.details) {
            doc.font("Helvetica").fontSize(bodySize).fillColor("#263241").text(shorten(item.details, maxDetail), x, y, {
                width: width,
                lineGap: 0
            });
            y = doc.y + 2;
        } else {
            y += opts.gap || 4.2;
        }
        return y;
    }

    function tinyList(items, x, y, width, options) {
        const opts = options || {};
        items.forEach(function (item) {
            y = compactItem(item, x, y, width, opts);
        });
        return y;
    }

    function textBlock(text, x, y, width, size, color) {
        doc.font("Helvetica").fontSize(size).fillColor(color || "#263241").text(text, x, y, {
            width: width,
            lineGap: 1.1
        });
        return doc.y;
    }

    doc.rect(0, 0, pageWidth, pageHeight).fill("#ffffff");
    doc.rect(0, 0, pageWidth, 82).fill(ink);
    doc.rect(0, 79, pageWidth, 3).fill(accent);
    doc.circle(pageWidth - 54, 40, 42).fill("#172332");

    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(clean(data.profile.name), margin, 18, { width: 320 });
    doc.fillColor("#b8f0e6").font("Helvetica-Bold").fontSize(8).text(clean(data.profile.role).toUpperCase(), margin, 45, {
        width: 320,
        characterSpacing: 0.7
    });
    doc.fillColor("#d4dde4").font("Helvetica").fontSize(6.8).text("Robotics AI | Exoskeletons | Motion Planning | Machine Learning", margin, 62, {
        width: 330
    });

    const contactX = 350;
    doc.font("Helvetica").fontSize(6.9).fillColor("#d4dde4");
    doc.text(clean(data.profile.location), contactX, 20, { width: 140, align: "right" });
    addLinkText(doc, clean(data.profile.email), contactX, 35, {
        width: 140,
        align: "right",
        fontSize: 6.9,
        url: "mailto:" + data.profile.email,
        color: "#b8f0e6"
    });
    const socialText = data.profile.socials.map(function (social) { return social.label; }).join(" | ");
    doc.fillColor("#d4dde4").font("Helvetica").fontSize(6.4).text(socialText, contactX, 49, { width: 140, align: "right" });

    const photoPath = path.join(root, "dist", data.profile.photo || "");
    if (fs.existsSync(photoPath)) {
        try {
            doc.save();
            doc.circle(pageWidth - 48, 40, 24).clip();
            doc.image(photoPath, pageWidth - 72, 16, { width: 48, height: 48 });
            doc.restore();
        } catch (error) {
            doc.restore();
        }
    }

    let y = 96;
    y = section("Profile", leftX, y, pageWidth - margin * 2);
    y = textBlock(professionalSummary(data.profile), leftX, y, pageWidth - margin * 2, 7.9, "#263241") + 9;

    let leftY = y;
    let rightY = y;

    leftY = section("Experience", leftX, leftY, colWidth);
    data.experiences.forEach(function (item, index) {
        leftY = compactItem(item, leftX, leftY, colWidth, {
            titleSize: 7.15,
            bodySize: 6.15,
            maxDetail: index < 4 ? 95 : 70,
            maxMeta: 72
        });
    });

    leftY = section("Education", leftX, leftY + 2, colWidth);
    leftY = tinyList(data.education, leftX, leftY, colWidth, {
        titleSize: 7.0,
        bodySize: 6.0,
        maxMeta: 76,
        gap: 3.2
    });

    leftY = section("Projects", leftX, leftY + 2, colWidth);
    leftY = tinyList(data.projects, leftX, leftY, colWidth, {
        titleSize: 6.75,
        bodySize: 5.9,
        maxMeta: 84,
        maxDetail: 70
    });

    leftY = section("Training", leftX, leftY + 2, colWidth);
    leftY = tinyList(data.training, leftX, leftY, colWidth, {
        titleSize: 6.55,
        bodySize: 5.75,
        maxMeta: 82,
        maxDetail: 58
    });

    rightY = section("Publications", rightX, rightY, colWidth);
    data.publications.forEach(function (item) {
        rightY = compactItem(item, rightX, rightY, colWidth, {
            titleSize: 6.85,
            bodySize: 5.8,
            maxMeta: 86,
            authors: true,
            maxAuthors: 82,
            gap: 3.5
        });
    });

    rightY = section("Awards & Scholarships", rightX, rightY + 2, colWidth);
    data.awards.forEach(function (item) {
        rightY = compactItem({
            title: onePageAwardTitle(item.title),
            date: item.date,
            subtitle: item.summary
        }, rightX, rightY, colWidth, {
            titleSize: 6.65,
            bodySize: 5.75,
            maxMeta: 82,
            gap: 3.2
        });
    });

    rightY = section("Skills", rightX, rightY + 2, colWidth);
    data.skills.forEach(function (group) {
        doc.font("Helvetica-Bold").fontSize(6.55).fillColor(ink).text(clean(group.title), rightX, rightY, { width: colWidth });
        rightY = doc.y + 1.5;
        doc.font("Helvetica").fontSize(5.95).fillColor("#263241").text(group.items.map(function (item) {
            return onePageSkillLabel(item.label);
        }).join(", "), rightX, rightY, { width: colWidth, lineGap: 0.2 });
        rightY = doc.y + 4.5;
    });

    rightY = section("Languages & Interests", rightX, rightY + 1, colWidth);
    doc.font("Helvetica").fontSize(6.05).fillColor("#263241").text(
        data.languages.map(function (item) { return clean(item.title) + " (" + clean(item.summary) + ")"; }).join(" | "),
        rightX,
        rightY,
        { width: colWidth, lineGap: 0.2 }
    );
    rightY = doc.y + 3;
    doc.font("Helvetica").fontSize(6.05).fillColor("#263241").text(
        data.interests.map(function (item) { return clean(item.title); }).join(" | "),
        rightX,
        rightY,
        { width: colWidth, lineGap: 0.2 }
    );

    const overflowY = Math.max(leftY, doc.y);
    if (overflowY > pageHeight - 24) {
        doc.font("Helvetica-Bold").fontSize(5.8).fillColor("#c8465d").text("Layout warning: content exceeds one page.", margin, pageHeight - 18, {
            width: pageWidth - margin * 2,
            align: "center"
        });
    } else {
        doc.moveTo(margin, pageHeight - 26).lineTo(pageWidth - margin, pageHeight - 26).strokeColor("#edf1f2").lineWidth(0.5).stroke();
    }

    doc.end();
    return outputPath;
}

function addSection(doc, title, y) {
    if (y > doc.page.height - 80) {
        doc.addPage();
        y = 42;
    }
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827").text(title, 42, y);
    doc.moveTo(42, doc.y + 4).lineTo(doc.page.width - 42, doc.y + 4).strokeColor("#bbbbbb").lineWidth(0.5).stroke();
    return doc.y + 14;
}

function ensureSpace(doc, y, amount) {
    if (y + amount < doc.page.height - 44) return y;
    doc.addPage();
    return 42;
}

function academicItem(doc, item, y) {
    y = ensureSpace(doc, y, 70);
    doc.font("Helvetica-Bold").fontSize(10.4).fillColor("#111827").text(clean(item.title), 42, y, { width: 390 });
    if (item.date) {
        doc.font("Helvetica").fontSize(8.2).fillColor("#555555").text(clean(item.date), 455, y + 1, { width: 98, align: "right" });
    }
    y = doc.y + 2;
    const secondary = item.subtitle || item.venue || item.summary || "";
    if (secondary) {
        doc.font("Helvetica-Oblique").fontSize(8.7).fillColor("#444444").text(clean(secondary), 42, y, { width: 510 });
        y = doc.y + 2;
    }
    if (item.authors) {
        doc.font("Helvetica").fontSize(8.4).fillColor("#333333").text(clean(item.authors), 42, y, { width: 510 });
        y = doc.y + 2;
    }
    if (item.details) {
        doc.font("Helvetica").fontSize(8.3).fillColor("#333333").text(clean(item.details), 42, y, { width: 510, lineGap: 1 });
        y = doc.y + 4;
    }
    const url = primaryUrl(item);
    if (url) {
        addLinkText(doc, url, 42, y, { width: 510, fontSize: 7.6, url: url });
        y = doc.y + 4;
    }
    return y + 2;
}

function generateAcademicPdf(data) {
    const doc = new PDFDocument({
        size: "A4",
        margin: 42,
        info: {
            Title: data.profile.name + " - Academic CV",
            Author: data.profile.name
        }
    });
    const outputPath = pipePdf(doc, "miroljub-mihailovic-academic-cv.pdf");
    let y = 42;

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#111111").text(clean(data.profile.name), 42, y);
    y = doc.y + 4;
    doc.font("Helvetica").fontSize(10).fillColor("#333333").text(clean(data.profile.role), 42, y);
    y = doc.y + 6;
    doc.font("Helvetica").fontSize(8.5).fillColor("#444444").text([
        clean(data.profile.location),
        clean(data.profile.email),
        data.profile.socials.map(function (social) { return social.url; }).join(" | ")
    ].filter(Boolean).join(" | "), 42, y, { width: 510 });
    y = doc.y + 16;

    y = addSection(doc, "Research Profile", y);
    doc.font("Helvetica").fontSize(9).fillColor("#333333").text(professionalSummary(data.profile), 42, y, { width: 510, lineGap: 1.2 });
    y = doc.y + 14;

    y = addSection(doc, "Education", y);
    data.education.forEach(function (item) { y = academicItem(doc, item, y); });

    y = addSection(doc, "Research and Professional Experience", y);
    data.experiences.forEach(function (item) { y = academicItem(doc, item, y); });

    y = addSection(doc, "Publications", y);
    data.publications.forEach(function (item) { y = academicItem(doc, item, y); });

    y = addSection(doc, "Projects", y);
    data.projects.forEach(function (item) { y = academicItem(doc, item, y); });

    y = addSection(doc, "Workshops and Summer Schools", y);
    data.training.forEach(function (item) { y = academicItem(doc, item, y); });

    y = addSection(doc, "Awards and Scholarships", y);
    data.awards.forEach(function (item) { y = academicItem(doc, item, y); });

    y = addSection(doc, "Skills", y);
    data.skills.forEach(function (group) {
        y = ensureSpace(doc, y, 28);
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111").text(clean(group.title), 42, y, { continued: true });
        doc.font("Helvetica").fillColor("#333333").text(": " + group.items.map(function (item) { return clean(item.label); }).join(", "), { width: 510 });
        y = doc.y + 6;
    });

    y = addSection(doc, "Languages and Interests", y);
    doc.font("Helvetica").fontSize(9).fillColor("#333333").text(
        data.languages.map(function (item) { return clean(item.title) + " (" + clean(item.summary) + ")"; }).join("; "),
        42,
        y,
        { width: 510 }
    );
    y = doc.y + 6;
    doc.text("Interests: " + data.interests.map(function (item) { return clean(item.title); }).join(", "), 42, y, { width: 510 });

    doc.end();
    return outputPath;
}

function latexEscape(value) {
    return clean(value)
        .replace(/\\/g, "\\textbackslash{}")
        .replace(/([#$%&_{}])/g, "\\$1")
        .replace(/\^/g, "\\textasciicircum{}")
        .replace(/~/g, "\\textasciitilde{}");
}

function latexUrl(value) {
    return String(value || "").replace(/\\/g, "/").replace(/%/g, "\\%");
}

function latexTags(tags) {
    if (!tags || !tags.length) return "";
    return "\\\\[-0.1em] " + tags.map(function (tag) {
        return "\\cvtag{" + latexEscape(tag) + "}";
    }).join(" ");
}

function latexEntry(item) {
    const title = latexEscape(item.title);
    const date = item.date ? latexEscape(item.date) : "";
    const meta = item.subtitle || item.venue || item.summary || "";
    const parts = [
        "\\cvitem{" + title + "}{" + date + "}{"
    ];
    if (meta) parts.push("\\textcolor{cvaccent}{" + latexEscape(meta) + "}\\\\[-0.1em]");
    if (item.authors) parts.push("\\emph{" + latexEscape(item.authors) + "}\\\\[-0.1em]");
    if (item.details) parts.push(latexEscape(item.details));
    parts.push(latexTags(item.tags));
    const url = primaryUrl(item);
    if (url) parts.push("\\\\[-0.1em] \\small\\href{" + latexUrl(url) + "}{Open reference}");
    parts.push("}");
    return parts.join("\n") + "\n";
}

function latexSection(title, items) {
    if (!items || !items.length) return "";
    return [
        "\\cvsection{" + latexEscape(title) + "}",
        items.map(latexEntry).join(""),
        ""
    ].join("\n");
}

function generateLatex(data) {
    const tex = [
        "\\documentclass[11pt,a4paper]{article}",
        "\\usepackage[margin=1.65cm]{geometry}",
        "\\usepackage[T1]{fontenc}",
        "\\usepackage[utf8]{inputenc}",
        "\\IfFileExists{glyphtounicode.tex}{\\input{glyphtounicode}\\pdfgentounicode=1}{}",
        "\\usepackage{helvet}",
        "\\usepackage{enumitem}",
        "\\usepackage{xcolor}",
        "\\usepackage{tabularx}",
        "\\usepackage{array}",
        "\\usepackage{ragged2e}",
        "\\usepackage{hyperref}",
        "\\usepackage{titlesec}",
        "\\definecolor{cvdark}{HTML}{111827}",
        "\\definecolor{cvaccent}{HTML}{087F7A}",
        "\\definecolor{cvwarm}{HTML}{D47B2B}",
        "\\definecolor{cvmuted}{HTML}{647181}",
        "\\definecolor{cvsoft}{HTML}{EEF5F2}",
        "\\hypersetup{colorlinks=true,urlcolor=cvaccent,linkcolor=cvaccent}",
        "\\renewcommand{\\familydefault}{\\sfdefault}",
        "\\pagestyle{empty}",
        "\\setlength{\\parindent}{0pt}",
        "\\setlength{\\parskip}{0.18em}",
        "\\setlist[itemize]{leftmargin=1.2em, topsep=0.1em, itemsep=0.08em}",
        "\\titleformat{\\section}{\\Large\\bfseries\\color{cvdark}}{}{0em}{}",
        "\\newcommand{\\cvsection}[1]{\\vspace{0.85em}{\\large\\bfseries\\color{cvdark} #1}\\par\\vspace{0.25em}{\\color{cvaccent}\\rule{\\textwidth}{0.8pt}}\\vspace{0.35em}}",
        "\\newcommand{\\cvtag}[1]{\\begingroup\\setlength{\\fboxsep}{3pt}\\colorbox{cvsoft}{\\textcolor{cvdark}{\\scriptsize #1}}\\endgroup}",
        "\\newcommand{\\cvitem}[3]{\\noindent\\begin{tabularx}{\\textwidth}{@{}>{\\RaggedRight\\arraybackslash}X r@{}}\\textbf{#1} & {\\small\\textcolor{cvwarm}{#2}}\\\\\\end{tabularx}\\vspace{-0.1em}{\\small #3}\\par\\vspace{0.65em}}",
        "\\begin{document}",
        "\\noindent\\colorbox{cvdark}{\\parbox{\\dimexpr\\textwidth-2\\fboxsep\\relax}{\\vspace{0.55em}\\color{white}{\\Huge\\textbf{" + latexEscape(data.profile.name) + "}}\\\\[0.25em]{\\large\\textcolor{cvsoft}{" + latexEscape(data.profile.role) + "}}\\\\[0.35em]{\\small\\textcolor{cvsoft}{" + latexEscape(data.profile.location) + " \\quad | \\quad \\href{mailto:" + latexUrl(data.profile.email) + "}{" + latexEscape(data.profile.email) + "}}}\\vspace{0.55em}}}",
        "\\vspace{0.45em}",
        "\\small",
        data.profile.socials.map(function (social) {
            return "\\href{" + latexUrl(social.url) + "}{" + latexEscape(social.label) + "}";
        }).join(" \\hfill "),
        "",
        "\\cvsection{Research Profile}",
        "\\normalsize " + latexEscape(professionalSummary(data.profile)),
        "",
        "\\cvsection{Core Profile}",
        "\\begin{tabularx}{\\textwidth}{@{}>{\\bfseries\\color{cvdark}}p{0.22\\textwidth}X@{}}",
        "Research focus & Lower-limb exoskeletons, adaptive gait planning, perception, learning-based control, motion planning.\\\\",
        "Methods & " + allSkills(data).slice(0, 14).map(latexEscape).join(", ") + ".\\\\",
        "Languages & " + data.languages.map(function (item) { return latexEscape(item.title) + " (" + latexEscape(item.summary) + ")"; }).join("; ") + ".",
        "\\end{tabularx}",
        "",
        latexSection("Education", data.education),
        latexSection("Research and Professional Experience", data.experiences),
        latexSection("Publications", data.publications),
        latexSection("Projects", data.projects),
        latexSection("Workshops and Summer Schools", data.training),
        latexSection("Awards and Scholarships", data.awards),
        "\\cvsection{Technical Skills}",
        "\\begin{tabularx}{\\textwidth}{@{}>{\\bfseries\\color{cvdark}}p{0.28\\textwidth}X@{}}",
        data.skills.map(function (group) {
            return latexEscape(group.title) + " & " + group.items.map(function (item) {
                return latexEscape(item.label);
            }).join(", ") + "\\\\";
        }).join("\n"),
        "\\end{tabularx}",
        "\\cvsection{Interests}",
        data.interests.map(function (item) { return "\\cvtag{" + latexEscape(item.title) + "}"; }).join(" "),
        "\\end{document}",
        ""
    ].join("\n");

    const outputPath = path.join(outputDir, "miroljub-mihailovic-academic-cv.tex");
    fs.writeFileSync(outputPath, tex);
    return outputPath;
}

function compileLatexIfAvailable(texPath) {
    try {
        childProcess.execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", path.basename(texPath)], {
            cwd: outputDir,
            stdio: "ignore"
        });
        ["aux", "log", "out"].forEach(function (extension) {
            const tempPath = texPath.replace(/\.tex$/, "." + extension);
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        });
        return true;
    } catch (error) {
        return false;
    }
}

function writeReadme() {
    const readme = [
        "# CV",
        "",
        "Generated from `dist/index.html`.",
        "",
        "Run:",
        "",
        "```bash",
        "npm run cv",
        "```",
        "",
        "Outputs:",
        "",
        "- `miroljub-mihailovic-cv-one-page.pdf`: modern compact one-page CV for companies.",
        "- `miroljub-mihailovic-academic-cv.pdf`: longer academic-style CV generated as PDF.",
        "- `miroljub-mihailovic-academic-cv.tex`: classic LaTeX source for the academic CV.",
        "",
        "If `pdflatex` is installed, the command also compiles the LaTeX source directly.",
        ""
    ].join("\n");
    fs.writeFileSync(path.join(outputDir, "README.md"), readme);
}

function main() {
    ensureDir();
    const data = readSiteData();
    const onePage = generateOnePagePdf(data);
    const latex = generateLatex(data);
    const latexCompiled = compileLatexIfAvailable(latex);
    const academicPdf = latexCompiled ? path.join(outputDir, "miroljub-mihailovic-academic-cv.pdf") : generateAcademicPdf(data);
    writeReadme();

    console.log("Generated:");
    console.log("- " + path.relative(root, onePage));
    console.log("- " + path.relative(root, academicPdf));
    console.log("- " + path.relative(root, latex));
    if (!latexCompiled) {
        console.log("pdflatex not found or failed; kept PDFKit academic PDF and LaTeX source.");
    }
}

main();
