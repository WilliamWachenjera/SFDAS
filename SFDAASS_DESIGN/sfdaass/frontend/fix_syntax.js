const fs = require('fs');
const filepath = 'c:/Users/comadmin/Desktop/PT/sfdaass/frontend/SFDAASS_App.html';
let content = fs.readFileSync(filepath, 'utf8');

// The problematic block in SFDAASS_App.html has a syntax error due to escaped backticks inside template string expressions
content = content.replace("?\\`<button", "? `<button");
content = content.replace("?\\`<button", "? `<button");
content = content.replace("?\\`<button", "? `<button");

content = content.replace("</button>\\`", "</button>`");
content = content.replace("</button>\\`", "</button>`");
content = content.replace("</button>\\`", "</button>`");

content = content.replace("  \\`;", "  `;");

content = content.replace(/\\\\\$\\{inc\.id\\|\\|inc\.incident_code\\}/g, "\\${inc.id||inc.incident_code}");

fs.writeFileSync(filepath, content, 'utf8');
