const fs = require("fs");
const path = require("path");
const { app } = require("electron");

class Store {
  constructor() {
    const userDataPath = app.getPath("userData");
    this._path = path.join(userDataPath, "prefs.json");
    try {
      this._data = JSON.parse(fs.readFileSync(this._path, "utf-8"));
    } catch (_) {
      this._data = {};
    }
  }

  get(key) {
    return this._data[key];
  }

  set(key, value) {
    this._data[key] = value;
    try {
      fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2));
    } catch (_) {}
  }
}

module.exports = Store;
