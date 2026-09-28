
const fs = require("fs");
const path = require("path");


if (!process.env.KAGGLE_API_TOKEN) {
  throw new Error("KAGGLE_API_TOKEN is missing");
}

console.log("Kaggle API token detected.");

async function testKaggleConnection() {
  const response = await fetch(
    "https://www.kaggle.com/api/v1/datasets/download/irkaal/foodcom-recipes-and-reviews?filename=recipes.parquet",
    {
      headers: {
        Authorization: `Bearer ${process.env.KAGGLE_API_TOKEN}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Kaggle API error: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  const AdmZip = require("adm-zip");
  const parquet = require("parquetjs-lite");

  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("recipes.parquet");

  if (!entry) {
    throw new Error("recipes.parquet not found inside ZIP");
  }

  const tempPath = "/tmp/recipes.parquet";
  fs.writeFileSync(tempPath, entry.getData());

  const reader = await parquet.ParquetReader.openFile(tempPath);

  const cursor = reader.getCursor([
    "Name",
    "RecipeCategory",
    "Keywords"
  ]);

  console.log("Sample recipes:");

  for (let i = 0; i < 50; i++) {
    const record = await cursor.next();

    if (!record) break;

    console.log({
      Name: record.Name,
      RecipeCategory: record.RecipeCategory,
      Keywords: record.Keywords
    });
  }

  await reader.close();
}

testKaggleConnection().catch(error => {
  console.error(error);
  process.exit(1);
});





const templatePath = path.join(__dirname, "template.html");
const dataPath = path.join(__dirname, "data", "pages.json");
const outputDir = path.join(__dirname, "generated");

const template = fs.readFileSync(templatePath, "utf8");
const pages = JSON.parse(fs.readFileSync(dataPath, "utf8"));

fs.mkdirSync(outputDir, { recursive: true });

function replacePlaceholder(template, key, value) {
  return template.replace(
    new RegExp(`{{${key}}}`, "g"),
    value ?? ""
  );
}

for (const [slug, page] of Object.entries(pages)) {
  let html = template;

  const sections = (page.sections || [])
    .map(section => `
      <section class="content-section" id="${section.id}">
        <h2>${section.title}</h2>
        ${section.content}
      </section>
    `)
    .join("\n");

  const faqs = (page.faqs || [])
    .map(faq => `
      <div class="faq-item">
        <h3>${faq.question}</h3>
        <p>${faq.answer}</p>
      </div>
    `)
    .join("\n");

  const quickNav = (page.sections || []).length
    ? `<ul>
        ${(page.sections || [])
          .map(section => `
            <li><a href="#${section.id}">${section.title}</a></li>
          `)
          .join("")}
      </ul>`
    : "";

  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": page.h1,
    "description": page.metaDescription
  });

  const values = {
    TITLE: page.title,
    META_DESCRIPTION: page.metaDescription,
    CANONICAL_URL: page.canonicalUrl || `{{SITE_URL}}/${slug}.html`,
    OG_IMAGE: page.ogImage || "",
    H1: page.h1,
    INTRO: page.intro,
    QUICK_NAV: quickNav,
    SECTIONS: sections,
    HOW_TO_TITLE: page.howToTitle,
    HOW_TO_CONTENT: page.howToContent,
    FAQS: faqs,
    CTA_TITLE: page.ctaTitle,
    CTA_TEXT: page.ctaText,
    CTA_BUTTON: page.ctaButton,
    YEAR: new Date().getFullYear()
  };

  for (const [key, value] of Object.entries(values)) {
    html = replacePlaceholder(html, key, value);
  }

  html = replacePlaceholder(html, "SITE_URL", "https://yourdomain.com");
  html = replacePlaceholder(html, "APP_URL", "https://yourdomain.com");
  html = replacePlaceholder(html, "DATE_IDEAS_URL", "https://yourdomain.com/date-ideas");
  html = replacePlaceholder(html, "PAGE_TITLE", page.h1);
  html = replacePlaceholder(html, "STRUCTURED_DATA", structuredData);

  const outputPath = path.join(outputDir, `${slug}.html`);

  fs.writeFileSync(outputPath, html, "utf8");

  console.log(`Generated: ${outputPath}`);
}