const fs = require("fs");
const path = require("path");

const token = process.env.GITHUB_TOKEN || "";
const config = {
  owner: "TecNext1",
  repo: "qa-image-deliver",
  branch: "main",
  token,
};

const file = path.join(__dirname, "..", "site", "config.js");
fs.writeFileSync(file, `window.CDN_CONFIG = ${JSON.stringify(config, null, 2)};\n`);

if (token) console.log("Wrote site/config.js");
else console.warn("GITHUB_TOKEN is empty. Uploads stay off until you set it in Netlify.");
