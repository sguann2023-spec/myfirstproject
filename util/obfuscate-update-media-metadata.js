const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const sourcePath = path.resolve(__dirname, 'update_media_metadata.js');
const outputPath = path.resolve(process.cwd(), 'out/util/update_media_metadata.js');

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Source file not found: ${sourcePath}`);
}

const sourceCode = fs.readFileSync(sourcePath, 'utf8');
const result = JavaScriptObfuscator.obfuscate(sourceCode, {
  target: 'node',
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.35,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  ignoreRequireImports: true,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 1,
  stringArrayEncoding: ['base64'],
  stringArrayIndexesType: ['hexadecimal-number'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, result.getObfuscatedCode(), 'utf8');

console.log(`Obfuscated update_media_metadata.js -> ${outputPath}`);
