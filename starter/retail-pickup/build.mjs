import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


const STARTER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(STARTER_ROOT, '..', '..');
const SCHEMA_PATH = path.join(STARTER_ROOT, 'template-installation.v1.schema.json');
const APP_ROOT = path.join(STARTER_ROOT, 'app');
const SDK_PLACEHOLDER = '__NOAH_COMPANY_SDK_MODULE__';


export class ManifestValidationError extends Error {
  constructor(location, message) {
    super(`${location}: ${message}`);
    this.name = 'ManifestValidationError';
  }
}


function fail(location, message) {
  throw new ManifestValidationError(location, message);
}


function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}


function validateFormat(value, format, location) {
  if (format === 'uuid') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      fail(location, 'must be a UUID');
    }
    return;
  }
  if (format === 'uri') {
    try { new URL(value); } catch { fail(location, 'must be a URI'); }
    return;
  }
  fail(location, `schema uses unsupported format ${format}`);
}


function validateNode(value, schema, location) {
  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    fail(location, `must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) fail(location, 'must use an allowed value');

  if (schema.type === 'object') {
    if (!isObject(value)) fail(location, 'must be an object');
    for (const field of schema.required ?? []) {
      if (!Object.hasOwn(value, field)) fail(`${location}.${field}`, 'is required');
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!Object.hasOwn(properties, field)) fail(`${location}.${field}`, 'is not allowed');
      }
    }
    for (const [field, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, field)) validateNode(value[field], childSchema, `${location}.${field}`);
    }
    return;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') fail(location, 'must be a string');
    if (schema.minLength !== undefined && [...value].length < schema.minLength) fail(location, 'is too short');
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) fail(location, 'is too long');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(location, 'has invalid format');
    if (schema.format) validateFormat(value, schema.format, location);
  }
}


export function validateInstallation(value, schema) {
  if (!isObject(schema) || schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new TypeError('The bundled installation schema is invalid.');
  }
  validateNode(value, schema, '$');
  return value;
}


async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}


function replaceSdkPlaceholder(source, sdkFile) {
  const occurrences = source.split(SDK_PLACEHOLDER).length - 1;
  if (occurrences !== 1) throw new Error('Starter app must contain exactly one SDK module placeholder.');
  return source.replace(SDK_PLACEHOLDER, `./assets/${sdkFile}`);
}


export async function buildRetailPickup({ manifestPath, outputDirectory }) {
  if (!manifestPath || !outputDirectory) throw new TypeError('manifestPath and outputDirectory are required.');
  const input = path.resolve(manifestPath);
  const output = path.resolve(outputDirectory);
  if (await pathExists(output)) throw new Error(`Output already exists: ${output}`);

  const schemaBytes = await readFile(SCHEMA_PATH);
  const schema = JSON.parse(schemaBytes.toString('utf8'));
  const manifest = JSON.parse(await readFile(input, 'utf8'));
  validateInstallation(manifest, schema);

  const packageDocument = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const sdkFile = `noah-company.v${packageDocument.version}.js`;
  const parent = path.dirname(output);
  const staging = path.join(parent, `.${path.basename(output)}.tmp-${process.pid}-${randomUUID()}`);
  await mkdir(parent, { recursive: true });
  await mkdir(path.join(staging, 'assets'), { recursive: true });

  try {
    const appSource = await readFile(path.join(APP_ROOT, 'app.js'), 'utf8');
    await Promise.all([
      copyFile(path.join(APP_ROOT, 'index.html'), path.join(staging, 'index.html')),
      copyFile(path.join(APP_ROOT, 'styles.css'), path.join(staging, 'styles.css')),
      copyFile(path.join(PACKAGE_ROOT, 'index.js'), path.join(staging, 'assets', sdkFile)),
      writeFile(path.join(staging, 'app.js'), replaceSdkPlaceholder(appSource, sdkFile)),
      writeFile(path.join(staging, 'package.json'), '{"private":true,"type":"module"}\n'),
      writeFile(path.join(staging, 'template-installation.json'), `${JSON.stringify(manifest, null, 2)}\n`),
      writeFile(path.join(staging, 'template-installation.v1.schema.json'), schemaBytes),
    ]);
    await rename(staging, output);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
      throw new Error(`Output already exists: ${output}`);
    }
    throw error;
  }

  return {
    outputDirectory: output,
    sdkVersion: packageDocument.version,
    templateVersion: manifest.metadata.template.version,
  };
}


function usage() {
  return 'Usage: node starter/retail-pickup/build.mjs --manifest FILE --out DIRECTORY\n';
}


function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (argument === '--manifest' || argument === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      options[argument === '--manifest' ? 'manifestPath' : 'outputDirectory'] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}


if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else {
      const result = await buildRetailPickup(options);
      process.stdout.write(`Built retail-pickup ${result.templateVersion} with SDK ${result.sdkVersion}.\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    process.exitCode = 1;
  }
}
