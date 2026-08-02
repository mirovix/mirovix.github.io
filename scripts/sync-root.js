'use strict';
const fs = require('fs');
const path = require('path');
const sh = require('shelljs');

const rootPath = path.resolve(__dirname, '..');
const distPath = path.resolve(rootPath, 'dist');

[
    'index.html',
    'neve.html',
    'privacy.html',
    'robots.txt',
    'sitemap.xml',
].forEach(file => {
    const source = path.join(distPath, file);
    if (fs.existsSync(source)) {
        sh.cp(source, path.join(rootPath, file));
    }
});

['assets', 'css', 'js'].forEach(dir => {
    const source = path.join(distPath, dir);
    const target = path.join(rootPath, dir);
    if (fs.existsSync(source)) {
        sh.rm('-rf', target);
        sh.cp('-R', source, target);
    }
});

fs.closeSync(fs.openSync(path.join(rootPath, '.nojekyll'), 'w'));
