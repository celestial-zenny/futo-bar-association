# FUTO Bar Association — website

Static site for the FUTO Bar Association (FBA), the student law association of the
Federal University of Technology Owerri. Plain HTML, CSS and vanilla JavaScript — no
build step, no framework. The legal aid clinic, blog and archive store their data in
[Supabase](https://supabase.com) (project `futo-bar-association`); the only third-party
code is a pinned copy of `supabase-js` served from `assets/js/vendor/`.

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
├── legal-aid.html          Legal aid clinic: report a case, check its status
├── blog.html               Blog posts and legal articles, month archive sidebar
├── post.html               A single post (?slug=…)
├── archive.html            Anonymised case summaries + article archive by month
├── admin/index.html        Admin dashboard (sign-in required, not indexed)
├── 404.html                Styled not-found page
├── favicon.ico             16/32/48px, generated from the FBA logo
├── robots.txt
├── sitemap.xml
├── llms.txt
├── site.webmanifest
├── assets/
│   ├── css/styles.css      Single stylesheet
│   ├── js/main.js          Nav toggle + tabs
│   ├── js/fba.js           Supabase client, labels, safe Markdown renderer
│   ├── js/legal-aid.js     Case form + status lookup
│   ├── js/blog.js          Blog list + single post
│   ├── js/archive.js       Case and article archive
│   ├── js/admin.js         Admin dashboard
│   ├── js/vendor/          supabase-js 2.57.4 (MIT)
│   └── img/                Logo, favicons, og-share.jpg (1200×630)
└── docs/
    ├── constitutions/      3 PDFs
    └── study-materials/
        ├── course-information/   3 images
        ├── lecturers-notes/      4 PDFs + 1 DOCX
        └── week-01 … week-10/    1 PDF each
```

## Legal aid clinic, blog and archive

These three features read and write a Supabase database. The schema, security rules and
database functions are in `supabase/migrations/` and are already applied to the
`futo-bar-association` Supabase project. The project URL and publishable key are at the
top of `site/assets/js/fba.js`. The publishable key is meant to be public, because
row-level security in the database decides what each visitor can see.

How it works:

- **Students** submit a case on `/legal-aid.html` with their 11-digit FUTO matric number.
  They get a reference number such as `FBA-26-7F3A9C`. A student can submit at most three
  cases in 24 hours. Students can't read the cases table. They can only check one case,
  by giving both its reference number and their matric number.
- **Admins** sign in at `/admin/`. From there they assign a student barrister and change
  the case status. They can also write an update the student will see and keep private
  notes. The barrister's name, email and phone are shown to the student once assigned.
- **Blog & articles**: admins write posts in the dashboard using simple Markdown
  (`## heading`, `**bold**`, `*italic*`, `[link](https://…)`, lists, `> quote`). Raw HTML
  is shown as text, never run. Drafts stay private until "Published" is ticked.
- **Case archive**: from a case, "Write archive summary" starts an anonymised summary.
  Nothing is public until it is published, and the admin must remove identifying details.

### Adding an administrator

1. Supabase dashboard → **Authentication → Users → Invite user**, and enter their email.
2. Supabase dashboard → **SQL Editor**, run:

   ```sql
   insert into public.admins (user_id, full_name)
   select id, 'Their Name' from auth.users where email = 'their@email.com';
   ```

3. They open the invite email, which brings them to `/admin/` to set a password.

To remove an admin: `delete from public.admins where user_id = (select id from auth.users where email = '…');`

### One-time Supabase settings

In **Authentication → URL Configuration**:

- **Site URL**: `https://YOUR-DOMAIN/admin/`. Invite emails link here, and the dashboard
  is where a new admin sets their password. The site sends no other auth emails.
- **Redirect URLs**: add `https://YOUR-DOMAIN/admin/` too, which "Forgot password?" uses.

In **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**.
Admins are invited instead. A self-registered account couldn't see anything anyway,
because it isn't in `public.admins`.

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
  footer of every page, in `assets/js/fba.js`, in the JSON-LD `contactPoint` blocks, and in `llms.txt`.

## Verified

- Zero console errors on all six pages; every asset returns HTTP 200.
- Unique `<title>`, `<meta description>` and canonical on every page; exactly one `<h1>`.
- Valid JSON-LD (Organization, WebSite, WebPage/AboutPage/CollectionPage, Course,
  BreadcrumbList) on every content page.
- Descriptive `alt` text on all 17 images; no empty `alt` attributes.
- Balanced HTML on all pages, no inline styles, no source maps, no unused JavaScript.
