# FUTO Bar Association — website

Static site for the FUTO Bar Association (FBA), the student law association of the
Federal University of Technology Owerri. Plain HTML, CSS and vanilla JavaScript — no
build step, no framework, no dependencies.

## Run it locally

```bash
cd site
python3 -m http.server 8000
# then open http://localhost:8000
```

A server is required (not `file://`) because every link is root-relative (`/assets/...`).

## Deploy

Upload the **contents of `site/`** to the web root. It works as-is on GitHub Pages,
Netlify, Cloudflare Pages, Vercel or any Apache/Nginx host.

Configure the host to serve `404.html` for missing paths:

- **GitHub Pages / Netlify / Cloudflare Pages** — automatic, no config needed.
- **Nginx** — `error_page 404 /404.html;`
- **Apache** — `ErrorDocument 404 /404.html`

### Set the real domain before going live

Every canonical URL, Open Graph URL, sitemap entry and JSON-LD `@id` currently uses the
placeholder `https://futobarassociation.org`. Replace it everywhere with one command:

```bash
cd site
grep -rl 'futobarassociation.org' . --include='*.html' --include='*.xml' \
  --include='*.txt' | xargs sed -i 's|https://futobarassociation\.org|https://YOUR-DOMAIN|g'
```

## Structure

```
site/
├── index.html              Hero, About, Executives, Constitutions, Study Materials
├── about.html              Preamble, aims and objectives, code of conduct, SSPS
├── executives.html         Five offices + duties table + accountability
├── constitutions.html      Three PDFs + tables of contents
├── study-materials.html    Tabbed file library + course outline + timetable
├── 404.html                Styled not-found page
├── favicon.ico             16/32/48px, generated from the FBA logo
├── robots.txt
├── sitemap.xml
├── llms.txt
├── site.webmanifest
├── assets/
│   ├── css/styles.css      Single stylesheet
│   ├── js/main.js          Nav toggle + study-material tabs. Nothing else.
│   └── img/                Logo, favicons, og-share.jpg (1200×630)
└── docs/
    ├── constitutions/      3 PDFs
    └── study-materials/
        ├── course-information/   3 images
        ├── lecturers-notes/      4 PDFs + 1 DOCX
        └── week-01 … week-10/    1 PDF each
```

## Adding executive photographs

The five cards in `index.html` and `executives.html` use a dashed circular placeholder.
To add a portrait, replace the `.exec-card__avatar` block with an image of the same size
and update the name line:

```html
<img class="exec-card__avatar" src="/assets/img/executives/president.jpg"
     width="104" height="104" alt="Portrait of [Name], President of the FUTO Bar Association.">
<p class="exec-card__role">President</p>
<p class="exec-card__name">[Name]</p>
```

Crop portraits square (at least 208×208 for sharpness on retina screens); the CSS applies
the circular mask.

## Adding a new week of notes

1. Drop the PDF at `docs/study-materials/week-11/week-11-notes.pdf`.
2. In both `index.html` and `study-materials.html`, copy the Week 10 tab button and its
   panel, bumping the numbers. Tab ids follow `tab-week-NN` / `panel-week-NN` — the
   JavaScript picks up new tabs automatically, no code change needed.

## Study-material tab deep links

Any group can be linked to directly, e.g.
`/study-materials.html#tab-week-04` or `/study-materials.html#panel-lecturers`.

## Notes on content

- All copy in the About, Executives and Constitutions sections is drawn from the FBA
  Constitution (2020/2021 review) and the SUG Constitution 2025. Nothing is invented.
- Weekly note titles come from the first heading of each PDF.
- The contact email `futobarassociation@gmail.com` is a placeholder — replace it in the
  footer of all six pages, in the JSON-LD `contactPoint` blocks, and in `llms.txt`.

## Verified

- Zero console errors on all six pages; every asset returns HTTP 200.
- Unique `<title>`, `<meta description>` and canonical on every page; exactly one `<h1>`.
- Valid JSON-LD (Organization, WebSite, WebPage/AboutPage/CollectionPage, Course,
  BreadcrumbList) on every content page.
- Descriptive `alt` text on all 17 images; no empty `alt` attributes.
- Balanced HTML on all pages, no inline styles, no source maps, no unused JavaScript.
