const fs = require('fs');
const path = 'android/app/build.gradle';
let content = fs.readFileSync(path, 'utf8');

function replaceRegexOnce(regex, replacer, label){
  const matches = content.match(regex);
  if (!matches) {
    console.error('SKIP (' + label + '): pattern not found');
    return false;
  }
  content = content.replace(regex, replacer);
  console.log('OK: ' + label);
  return true;
}

replaceRegexOnce(
  /apply plugin: 'com\.android\.application'/,
  (m) => m + "\n\ndef keystorePropertiesFile = rootProject.file(\"keystore.properties\")\ndef keystoreProperties = new Properties()\nif (keystorePropertiesFile.exists()) {\n    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n}",
  'load keystore.properties'
);

replaceRegexOnce(
  /buildTypes\s*\{/,
  () => "signingConfigs {\n        release {\n            if (keystorePropertiesFile.exists()) {\n                storeFile file(keystoreProperties['storeFile'])\n                storePassword keystoreProperties['storePassword']\n                keyAlias keystoreProperties['keyAlias']\n                keyPassword keystoreProperties['keyPassword']\n            }\n        }\n    }\n    buildTypes {",
  'insert signingConfigs block'
);

replaceRegexOnce(
  /proguardFiles getDefaultProguardFile\('proguard-android\.txt'\), 'proguard-rules\.pro'/,
  (m) => m + "\n            signingConfig signingConfigs.release",
  'attach signingConfig to release build type'
);

fs.writeFileSync(path, content, 'utf8');
console.log('Done. File saved.');
