const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('public/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously' });
const window = dom.window;

// wait for DOMContentLoaded to run
setTimeout(() => {
  try {
    window.openAddUser();
    console.log('Success!');
  } catch(e) {
    console.error('Error:', e);
  }
}, 500);
