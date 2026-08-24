import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'public', 'data', 'hydrology');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'nhd-flowlines-kauai.geojson');
const ENDPOINT =
  'https://geodata.hawaii.gov/arcgis/rest/services/FreshWater/MapServer/10/query';
const BOUNDS = '-160.05,21.8,-159.2,22.3';
const PAGE_SIZE = 2000;
const RETRIEVED_ON = '2026-08-24';

function roundCoordinate(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeCoordinates(coordinates) {
  if (typeof coordinates[0] === 'number') {
    return [roundCoordinate(coordinates[0]), roundCoordinate(coordinates[1])];
  }
  return coordinates.map(normalizeCoordinates);
}

async function fetchPage(offset) {
  const query = new URLSearchParams({
    where: 'ftype IN (334,336,460,558)',
    geometry: BOUNDS,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields:
      'objectid,permanent_identifier,gnis_name,lengthkm,reachcode,flowdir,ftype,fcode,mainpath,innetwork',
    returnGeometry: 'true',
    maxAllowableOffset: '0.000005',
    orderByFields: 'objectid',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: 'geojson',
  });
  const response = await fetch(`${ENDPOINT}?${query}`);
  if (!response.ok) {
    throw new Error(`Hydrography request failed: ${response.status}`);
  }
  return response.json();
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const features = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    console.log(`Fetching NHD flowlines at offset ${offset}`);
    const page = await fetchPage(offset);
    for (const feature of page.features ?? []) {
      feature.geometry.coordinates = normalizeCoordinates(
        feature.geometry.coordinates,
      );
      const {
        objectid,
        permanent_identifier,
        gnis_name,
        lengthkm,
        reachcode,
        flowdir,
        ftype,
        fcode,
        mainpath,
        innetwork,
      } = feature.properties;
      feature.properties = {
        objectId: objectid,
        permanentId: permanent_identifier,
        name: gnis_name,
        lengthKm: lengthkm,
        reachCode: reachcode,
        flowDirection: flowdir,
        featureType: ftype,
        featureCode: fcode,
        mainPath: mainpath,
        inNetwork: innetwork,
      };
      features.push(feature);
    }
    if (!page.properties?.exceededTransferLimit && (page.features?.length ?? 0) < PAGE_SIZE) {
      break;
    }
  }

  const collection = {
    type: 'FeatureCollection',
    name: 'USGS NHD Flowlines — Kauaʻi',
    source: {
      provider: 'State of Hawaiʻi Office of Planning and Sustainable Development',
      originalDataset: 'USGS National Hydrography Dataset, October 2022',
      service: ENDPOINT,
      horizontalCrs: 'EPSG:4326',
      license: 'United States public-domain government data',
      retrievedOn: RETRIEVED_ON,
      bounds: BOUNDS.split(',').map(Number),
      featureSha256: createHash('sha256')
        .update(JSON.stringify(features))
        .digest('hex'),
    },
    features,
  };

  await writeFile(OUTPUT_FILE, `${JSON.stringify(collection)}\n`);
  console.log(`Wrote ${features.length} flowlines to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});