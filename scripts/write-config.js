const fs = require("fs");
const path = require("path");

const config = {
  owner: "TecNext1",
  repo: "qa-image-deliver",
  branch: "main",
};

const file = path.join(__dirname, "..", "site", "config.js");
fs.writeFileSync(file, `window.CDN_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
console.log("Wrote site/config.js with no token.");
