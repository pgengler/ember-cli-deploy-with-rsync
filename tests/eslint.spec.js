/* eslint-env node */
const lint = require('mocha-eslint');

lint([
  'index.js',
  'lib',
  'tests'
]);
