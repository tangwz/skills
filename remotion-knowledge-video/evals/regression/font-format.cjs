function detectChineseFontFormat(data) {
  if (data.length >= 12) {
    const signature = data.subarray(0, 4).toString("latin1");
    if (signature === "ttcf") return "collection";
    if (signature === "true" || data.readUInt32BE(0) === 0x00010000)
      return "truetype";
  }
  throw new Error("chinese.ttf must contain a TrueType font or TTC collection");
}

module.exports = { detectChineseFontFormat };
