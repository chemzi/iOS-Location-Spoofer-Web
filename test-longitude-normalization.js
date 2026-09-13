"use strict";

var assert = require("assert");
var fs = require("fs");
var spoofer = require("./location-spoofer.js");

function approximatelyEqual(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, actual + " != " + expected);
}

approximatelyEqual(spoofer.normalizeLongitude(139.7005), 139.7005);
assert.strictEqual(spoofer.normalizeLongitude(0), 0);
assert.ok(Math.abs(spoofer.normalizeLongitude(286.1843633651734) - (-73.8156366348266)) < 1e-10);
assert.ok(Math.abs(spoofer.normalizeConfig({ longitude: 286.1843633651734 }).longitude - (-73.8156366348266)) < 1e-10);
assert.strictEqual(spoofer.normalizeLongitude(-181), 179);
assert.strictEqual(spoofer.normalizeLongitude(540), -180);

for (var longitude = -1080; longitude <= 1080; longitude += 0.25) {
  var normalized = spoofer.normalizeLongitude(longitude);
  assert.ok(normalized >= -180 && normalized < 180);
  approximatelyEqual((normalized - longitude) / 360, Math.round((normalized - longitude) / 360));
}

var pickerSource = fs.readFileSync("./public/index.html", "utf8");
assert.ok(pickerSource.includes("lng:normalizeLongitude(w[1])"));

(async function () {
  var stored = null;
  var setHandler = await import("./functions/set.js");
  var response = await setHandler.onRequestPost({
    request: {
      url: "https://example.test/set",
      json: async function () {
        return { latitude: 40.58583206837979, longitude: 286.1843633651734 };
      }
    },
    env: {
      SPOOFER_DATA: {
        get: async function () { return null; },
        put: async function (_key, value) { stored = JSON.parse(value); }
      }
    }
  });

  assert.strictEqual(response.status, 200);
  approximatelyEqual(stored.longitude, -73.8156366348266);
  console.log("longitude normalization tests passed");
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
