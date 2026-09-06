# shivanshutripath.github.io

Personal academic website for Shivanshu Tripathi. Plain HTML and CSS &mdash; no
build step, no dependencies. Edit the HTML files, commit, and GitHub Pages
publishes the result.

## Files

```
index.html            About: bio, news, research summary, selected papers,
                      education, experience, awards
research.html         Projects, talks, professional service, tools
publications.html     Full publication list with type filters
contact.html          Email, address, profile links
404.html              Shown for unknown URLs
assets/css/style.css  All styling; design tokens are at the top
assets/js/main.js     Mobile menu and publication filters
assets/img/           Portrait and favicon
assets/img/logos/     Institution logos used in Education and Experience
assets/files/cv.pdf   Current CV
.nojekyll             Tells GitHub Pages to serve the files as-is
```

## Preview locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Publish on GitHub Pages

Create a repository named exactly `shivanshutripath.github.io` (matching your
GitHub username). Leave it empty, then from this folder:

```bash
git init
git add .
git commit -m "Add personal website"
git branch -M main
git remote add origin https://github.com/shivanshutripath/shivanshutripath.github.io.git
git push -u origin main
```

In the repository, open **Settings &rarr; Pages** and set the source to
**Deploy from a branch**, branch `main`, folder `/ (root)`. The site goes live
at <https://shivanshutripath.github.io> within a minute or two.

Note that <https://shivanshutripath.github.io/robotic_controller.github.io/>
already exists as a project page in a separate repository; a user site at the
root does not conflict with it.

To publish later edits:

```bash
git add .
git commit -m "Update publications"
git push
```

## Keeping it current

- **New paper**: add an `<li class="pub" data-pub-type="conference">` block to
  the right year group in `publications.html`. Use `journal`, `conference`, or
  `preprint` for `data-pub-type` so the filter buttons pick it up. If the year
  is new, copy an existing `<h2 class="pub-year" data-pub-year="...">` heading
  and its `<ol data-pub-group="...">` list, keeping both values identical.
- **News item**: add an `<li>` at the top of the `.news` list in `index.html`.
  Keep `datetime` in `YYYY-MM` form.
- **New affiliation**: add the logo to `assets/img/logos/`, then copy an
  existing `<li>` in the Education or Experience list in `index.html`. Use
  `class="inst-logo"` for a square logo and
  `class="inst-logo inst-logo--wide"` for a horizontal wordmark, otherwise the
  wordmark shrinks to fit a square and becomes unreadable.
- **Photo**: overwrite `assets/img/portrait.jpg`, cropped to 4:5 (the current
  one is 500&times;625, which covers the 250 px display box on retina
  screens). `assets/img/favicon.png` is a square crop of the same photo.

## Logo sources

The logos in `assets/img/logos/` came from the institutions themselves or from
Wikipedia. They are trademarks of their owners, used here only to identify
where I studied and worked. The Department of Telecommunications entry uses
the emblem of its parent Ministry of Communications, since the department has
no separate mark.

## Still to fill in

- A LinkedIn link is deliberately omitted because the profile URL could not be
  verified. Add it to the `.quick-links` block in `index.html` if you want it.
- Phone number and home address are omitted on purpose. The department address
  is used in `contact.html` instead.

## Changing the look

The palette, fonts, and spacing are CSS custom properties at the top of
`assets/css/style.css`. `--accent` controls every link and highlight; change
that one value to re-theme the site. Dark mode derives from the same variables
and follows the visitor's system setting.
