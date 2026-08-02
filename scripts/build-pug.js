'use strict';
const upath = require('upath');
const sh = require('shelljs');
const renderPug = require('./render-pug');

const srcPath = upath.resolve(upath.dirname(__filename), '../src');
const staticPath = upath.resolve(srcPath, 'static');
const distPath = upath.resolve(upath.dirname(__filename), '../dist');

sh.find(srcPath).forEach(_processFile);

if (sh.test('-d', staticPath)) {
    sh.cp('-R', `${staticPath}/*`, distPath);
}

function _processFile(filePath) {
    if (
        filePath.match(/\.pug$/)
        && !filePath.match(/\/pug\/index\.pug$/)
        && !filePath.match(/include/)
        && !filePath.match(/mixin/)
        && !filePath.match(/\/pug\/layouts\//)
    ) {
        renderPug(filePath);
    }
}
