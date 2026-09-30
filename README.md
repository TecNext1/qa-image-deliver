# qa-image-deliver

Designer page: connect this repo to Netlify and set one environment variable, `GITHUB_TOKEN`. Use a token that can write to this repo only, from an account that can push straight to `main`. Designers open the Netlify URL, drop images, and copy links. They never see the token.

```
https://image-deliver.netlify.app/Creta_Grand_1.png
```

Public image host. The link keeps the exact filename and does not include the GitHub account or repo. Netlify loads the file from jsDelivr behind that address.

```
https://image-deliver.netlify.app/Creta_Grand_1.png
```

GitHub public hosting and jsDelivr are free. The link keeps working while this repository stays public and the file stays on `main`.

## Publish an image

From this folder:

```bash
./upload ~/Desktop/Creta_Grand_1.png
```

Several files go up in one commit:

```bash
./upload ~/Desktop/Creta_Grand_1.png ~/Desktop/Creta_Grand_2.png
```

The script copies each file here under its current filename, commits it, pushes `main`, and prints the CDN link. See what it would publish without pushing:

```bash
./upload --dry-run ~/Desktop/Creta_Grand_1.png
```

## If the push is rejected

`main` on this repo is set to require a pull request. An admin can still push directly, and `./upload` does that. If GitHub rejects the push, allow direct pushes to `main` for this repository, or run the script from an account that can bypass that rule.

## By hand

```bash
cp ~/Desktop/Creta_Grand_1.png .
git add Creta_Grand_1.png
git commit -m "Publish Creta_Grand_1.png"
git push
```

## What keeps the link stable

- Leave this repository **public**. jsDelivr only serves public GitHub repos.
- Keep each file at or under **20 MB**. jsDelivr does not serve larger files from GitHub.
- Leave **Git LFS** off. jsDelivr would serve the LFS pointer text instead of the image.
- A new filename is ready on the first request after the push. That first open can take a few seconds while jsDelivr fetches the file from GitHub.
- Replacing a file that already uses the same name can take up to **12 hours** to show on the `@main` link. jsDelivr caches branch URLs for 12 hours. The script prints a purge link when that happens. Open it once, then reload the image URL.
- A link pinned to a commit hash stays on that exact file even after later commits:

```
https://cdn.jsdelivr.net/gh/TecNext1/qa-image-deliver@<commit>/Creta_Grand_1.png
```

The script prints that pinned link after every publish. Use the `@main` link when you want the exact filename on the latest `main`.

Accepted types: png, jpg, jpeg, gif, webp, avif, svg, ico, bmp, tif, tiff, heic, heif, pdf.
